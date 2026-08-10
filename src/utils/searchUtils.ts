import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { SettingsManager } from './settingsUtils';
import { log } from './logger';

/**
 * Raised when the `fzf` binary is not on the PATH. The extension cannot search
 * without it, so this is surfaced to the user rather than just logged.
 */
export class FzfNotFoundError extends Error {
    constructor() {
        super(
            'fzf was not found on your PATH. Install it from ' +
            'https://github.com/junegunn/fzf for Search Preview to work.'
        );
        this.name = 'FzfNotFoundError';
    }
}

/**
 * Raised when a search is superseded by a newer one, or the picker is dismissed.
 * Callers are expected to swallow this.
 */
export class SearchAbortedError extends Error {
    constructor() {
        super('Search aborted');
        this.name = 'SearchAbortedError';
    }
}

/**
 * Filter file paths through fzf, preserving fzf's own ranking.
 *
 * @param files Candidate file URIs
 * @param searchText Query passed to `fzf --filter`
 * @param signal Aborting this kills the fzf process and rejects with SearchAbortedError
 */
export async function fuzzySearchFiles(
    files: vscode.Uri[],
    searchText: string,
    signal?: AbortSignal
): Promise<vscode.Uri[]> {
    const pathToUri = new Map<string, vscode.Uri>();
    for (const file of files) {
        if (!SettingsManager.shouldExcludeFile(file.fsPath)) {
            pathToUri.set(vscode.workspace.asRelativePath(file.fsPath), file);
        }
    }

    return new Promise<vscode.Uri[]>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new SearchAbortedError());
            return;
        }

        // Pipe the file list through stdin rather than the command line: it
        // avoids shell interpolation and the argv length limit.
        const fzf = spawn('fzf', ['--filter', searchText], { stdio: ['pipe', 'pipe', 'pipe'] });

        const onAbort = (): void => {
            fzf.kill();
            reject(new SearchAbortedError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        const detachAbort = (): void => signal?.removeEventListener('abort', onAbort);

        // Buffer the whole stream: a path can straddle two chunks, so splitting
        // each chunk on newlines as it arrives corrupts entries at the seams.
        let stdout = '';
        fzf.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });

        fzf.stderr.on('data', (chunk: Buffer) => {
            log(`fzf stderr: ${chunk.toString().trim()}`);
        });

        fzf.on('error', (error: NodeJS.ErrnoException) => {
            detachAbort();
            reject(error.code === 'ENOENT' ? new FzfNotFoundError() : error);
        });

        fzf.on('close', code => {
            detachAbort();

            // fzf exits 1 when nothing matched, which is not a failure here.
            if (code !== 0 && code !== 1) {
                reject(new Error(`fzf exited with code ${code}`));
                return;
            }

            const matches: vscode.Uri[] = [];
            for (const line of stdout.split('\n')) {
                const uri = pathToUri.get(line);
                if (uri) {
                    matches.push(uri);
                }
            }
            resolve(matches);
        });

        // fzf can exit before we finish writing; that surfaces here as EPIPE
        // and is already handled by the 'close' handler above.
        fzf.stdin.on('error', () => undefined);
        fzf.stdin.end([...pathToUri.keys()].join('\n'));
    });
}
