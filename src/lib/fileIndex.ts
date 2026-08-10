import * as vscode from 'vscode';
import { SettingsManager } from '../utils/settingsUtils';
import { log } from '../utils/logger';

/**
 * An immutable view of the searchable files, with everything fzf needs already
 * computed.
 */
export interface FileSnapshot {
    /** Exclude-filtered files, in the same order as the lines of `fzfInput`. */
    uris: vscode.Uri[];
    /** Workspace-relative path to uri, for mapping fzf's output back. */
    byPath: Map<string, vscode.Uri>;
    /** The newline-delimited payload written to fzf's stdin. */
    fzfInput: string;
}

/**
 * The workspace file list, enumerated once and reused until something changes it.
 *
 * Every keystroke used to re-walk the file array to filter it, convert each path
 * to a relative one, and rebuild fzf's input from scratch. That work is identical
 * for every keystroke in a session and dominated search latency - fzf itself
 * scans 50,000 paths in under four milliseconds. It happens here once instead.
 */
export class FileIndex implements vscode.Disposable {
    private snapshot?: FileSnapshot;
    private building?: Promise<FileSnapshot>;
    private generation = 0;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        // Only creation and deletion change the *set* of files; edits do not,
        // so onDidChange would invalidate constantly for nothing.
        const watcher = vscode.workspace.createFileSystemWatcher('**/*');
        watcher.onDidCreate(uri => this.invalidateFor(uri), null, this.disposables);
        watcher.onDidDelete(uri => this.invalidateFor(uri), null, this.disposables);
        this.disposables.push(watcher);

        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate())
        );
    }

    /**
     * Invalidate only for a file that could actually appear in results.
     *
     * The watcher covers the whole workspace, so without this a build writing
     * into `dist/` would invalidate the index continuously and make every
     * picker open re-walk the workspace for files nobody can search for.
     */
    private invalidateFor(uri: vscode.Uri): void {
        if (!SettingsManager.shouldExclude(vscode.workspace.asRelativePath(uri))) {
            this.invalidate();
        }
    }

    /**
     * Mark the cached list stale.
     *
     * Deliberately does no work: a watcher over the whole workspace fires in
     * bursts, and rebuilding can wait until the picker is next opened.
     */
    public invalidate(): void {
        this.generation++;
        this.snapshot = undefined;
        this.building = undefined;
    }

    /**
     * The current file list, rebuilt only if it has gone stale.
     *
     * Concurrent callers share one in-flight build, so pre-warming and an
     * immediate picker open do not walk the workspace twice.
     */
    public async get(): Promise<FileSnapshot> {
        if (this.snapshot) {
            return this.snapshot;
        }

        if (!this.building) {
            const attempt = this.build();
            this.building = attempt;
            // A failed build must not be cached, or every later open fails too.
            attempt.catch(() => {
                if (this.building === attempt) {
                    this.building = undefined;
                }
            });
        }

        return this.building;
    }

    /**
     * Start building without waiting, so that opening the picker is never the
     * thing that pays for the workspace walk.
     */
    public prewarm(): void {
        void this.get().catch(error => log('Could not pre-build the file index', error));
    }

    private async build(): Promise<FileSnapshot> {
        const generation = this.generation;
        const files = await vscode.workspace.findFiles('**/*', SettingsManager.getGlobExcludePattern());

        const uris: vscode.Uri[] = [];
        const paths: string[] = [];
        const byPath = new Map<string, vscode.Uri>();

        for (const uri of files) {
            const relativePath = vscode.workspace.asRelativePath(uri);

            // findFiles already applied the exclude glob; this also covers the
            // patterns that glob syntax cannot express, and costs a string
            // comparison per file now that the matchers are compiled properly.
            if (SettingsManager.shouldExclude(relativePath)) {
                continue;
            }

            // Two files sharing a relative path would make fzf's output
            // ambiguous, since we map its lines back through this table.
            if (byPath.has(relativePath)) {
                continue;
            }

            byPath.set(relativePath, uri);
            paths.push(relativePath);
            uris.push(uri);
        }

        const snapshot: FileSnapshot = { uris, byPath, fzfInput: paths.join('\n') };

        // Something invalidated us while findFiles was running. Hand this result
        // to the caller that asked for it, but do not cache it.
        if (generation === this.generation) {
            this.snapshot = snapshot;
            this.building = undefined;
        }

        return snapshot;
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}

/**
 * Build a snapshot from an arbitrary set of files.
 *
 * Used for the recent-editors list, which comes from history rather than the
 * workspace and is small enough (capped at 100) to prepare per search.
 */
export function snapshotOf(uris: vscode.Uri[]): FileSnapshot {
    const kept: vscode.Uri[] = [];
    const paths: string[] = [];
    const byPath = new Map<string, vscode.Uri>();

    for (const uri of uris) {
        const relativePath = vscode.workspace.asRelativePath(uri);
        if (byPath.has(relativePath)) {
            continue;
        }
        byPath.set(relativePath, uri);
        paths.push(relativePath);
        kept.push(uri);
    }

    return { uris: kept, byPath, fzfInput: paths.join('\n') };
}
