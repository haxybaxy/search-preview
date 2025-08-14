import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { SettingsManager } from './settingsUtils';
import * as fuzzysort from 'fuzzysort';

let fdSpawnRegistry: any[] = [];
let fdAvailabilityChecked = false;
let fdIsAvailable = false;
function cancelOngoingFdSearches() {
    if (fdSpawnRegistry.length === 0) {
        return;
    }
    fdSpawnRegistry.forEach(proc => {
        try {
            proc.stdout?.destroy();
            proc.stderr?.destroy();
            proc.kill();
        } catch {}
    });
    fdSpawnRegistry = [];
}

async function ensureFdAvailable(): Promise<void> {
    if (fdAvailabilityChecked) {
        if (!fdIsAvailable) {
            throw new Error('fd executable not found in PATH. Please install fd (https://github.com/sharkdp/fd).');
        }
        return;
    }

    await new Promise<void>((resolve) => {
        try {
            const proc = spawn('fd', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
            proc.on('error', () => {
                fdAvailabilityChecked = true;
                fdIsAvailable = false;
                resolve();
            });
            proc.on('exit', (code: number) => {
                fdAvailabilityChecked = true;
                fdIsAvailable = code === 0;
                resolve();
            });
        } catch {
            fdAvailabilityChecked = true;
            fdIsAvailable = false;
            resolve();
        }
    });

    if (!fdIsAvailable) {
        throw new Error('fd executable not found in PATH. Please install fd (https://github.com/sharkdp/fd).');
    }
}

/**
 * Convert file URIs to SearchQuickPickItems
 */

// Utility function to check if a process exists
export function checkKillProcess(spawnRegistry: any[]) {
    spawnRegistry.forEach((spawnProcess) => {
        spawnProcess.stdout.destroy();
        spawnProcess.stderr.destroy();
        spawnProcess.kill();
    });

    // check if spawn process is no longer running and if so remove from registry
    return spawnRegistry.filter((spawnProcess) => !spawnProcess.killed);
}

/**
 * Perform an in-memory fuzzy search on the provided URIs using fuzzysort.
 * Replaces previous external fzf-based filtering.
 */
export async function fuzzySearchFiles(files: vscode.Uri[], searchText: string): Promise<{ uri: vscode.Uri }[]> {
    const trimmed = (searchText || '').trim();
    const filteredFiles = files.filter(file => !SettingsManager.shouldExcludeFile(file.fsPath));
    if (!trimmed) {
        return filteredFiles.map(uri => ({ uri }));
    }

    const pathToUriMap = new Map<string, vscode.Uri>();
    const filePaths = filteredFiles.map(file => {
        const rel = vscode.workspace.asRelativePath(file.fsPath);
        pathToUriMap.set(rel, file);
        return rel;
    });

    const results = fuzzysort.go(trimmed, filePaths, {
        limit: SettingsManager.getMaxResults() * 3,
        threshold: -Infinity
    });

    return results
        .map(r => r.target as string)
        .map(rel => ({ uri: pathToUriMap.get(rel)! }))
        .filter(item => !!item.uri);
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFuzzyRegexFromQuery(query: string): string {
    const trimmed = query.trim();
    if (!trimmed) { return ''; }
    const tokens = trimmed.split(/\s+/).map(token => escapeRegex(token));
    return tokens.join('.*');
}

/**
 * Use fd to search the workspace using a fuzzy-ish regex, then rank with fuzzysort.
 */
export async function searchWorkspaceWithFd(searchText: string): Promise<{ uri: vscode.Uri }[]> {
    const query = (searchText || '').trim();
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        return [];
    }

    // Require fd; do not fallback
    await ensureFdAvailable();

    const regex = buildFuzzyRegexFromQuery(query);
    const excludeDirs = SettingsManager.getExcludeDirectories();
    const excludePatterns = SettingsManager.getExcludePatterns();

    const fdArgsBase = ['--color', 'never', '--type', 'f', '--absolute-path', '--ignore-case'];
    if (regex) {
        fdArgsBase.push('--regex', regex);
    }
    const maxResultsCap = Math.max(10, SettingsManager.getMaxResults() * 5);
    fdArgsBase.push('--max-results', String(maxResultsCap));

    // Run fd in each workspace folder
    cancelOngoingFdSearches();
    const spawnProcesses: any[] = [];
    const stdoutBuffers: string[] = [];

    const runForFolder = (folder: vscode.WorkspaceFolder) => new Promise<void>((resolve) => {
        const args: string[] = [...fdArgsBase];
        excludeDirs.forEach(dir => { args.push('--exclude', dir); });
        excludePatterns.forEach(pat => { args.push('--exclude', pat); });

        const proc = spawn('fd', args, { cwd: folder.uri.fsPath, stdio: ['ignore', 'pipe', 'pipe'] });
        spawnProcesses.push(proc);
        fdSpawnRegistry.push(proc);

        proc.stdout.on('data', (data: Buffer) => {
            stdoutBuffers.push(data.toString());
        });
        proc.stderr.on('data', () => { /* silence to avoid console spam */ });
        proc.on('exit', () => resolve());
        proc.on('error', () => resolve()); // fd not found or other error: resolve and fall back later
    });

    await Promise.all(vscode.workspace.workspaceFolders.map(runForFolder));
    checkKillProcess(spawnProcesses);
    fdSpawnRegistry = fdSpawnRegistry.filter(p => !p.killed);

    const allLines = stdoutBuffers.join('').split('\n').filter(Boolean);

    const uniqueAbs = Array.from(new Set(allLines))
        .filter(abs => !SettingsManager.shouldExcludeFile(abs));

    // Prepare for ranking using relative paths
    const pathToUriMap = new Map<string, vscode.Uri>();
    const relativePaths: string[] = uniqueAbs.map(absPath => {
        let rel = absPath;
        for (const folder of vscode.workspace.workspaceFolders!) {
            const root = folder.uri.fsPath;
            if (absPath.startsWith(root + '/')) {
                rel = absPath.slice(root.length + 1);
                break;
            }
        }
        const uri = vscode.Uri.file(absPath);
        pathToUriMap.set(rel, uri);
        return rel;
    });

    if (!query) {
        return relativePaths.map(rel => ({ uri: pathToUriMap.get(rel)! }));
    }

    const ranked = fuzzysort.go(query, relativePaths, {
        limit: SettingsManager.getMaxResults() * 3,
        threshold: -Infinity
    });
    return ranked
        .map(r => r.target as string)
        .map(rel => ({ uri: pathToUriMap.get(rel)! }))
        .filter(item => !!item.uri);
}
