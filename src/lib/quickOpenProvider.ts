import * as vscode from 'vscode';
import { EditorHistoryItem, SearchQuickPickItem } from '../types';
import { EditorHistoryManager } from './editorHistory';
import { FileIndex, FileSnapshot, snapshotOf } from './fileIndex';
import { PreviewManager } from './previewManager';
import { SearchSession } from './searchSession';
import { FzfNotFoundError, SearchAbortedError, fuzzyFilter } from '../utils/searchUtils';
import { toQuickPickItem } from '../utils/fileUtils';
import { SettingsManager } from '../utils/settingsUtils';
import { log } from '../utils/logger';

/**
 * Delay before a keystroke triggers a search.
 *
 * With the candidate list prepared up front a search costs single-digit
 * milliseconds, so this wait is now the dominant part of the latency. It only
 * needs to be long enough to coalesce a fast typist's burst; superseded searches
 * are aborted anyway, and their fzf process killed with them.
 */
const SEARCH_DEBOUNCE_MS = 15;

/**
 * Delay before the highlighted row is previewed.
 *
 * Opening a document is expensive - it parses and renders. Key repeat runs at
 * roughly 25-33ms, so this is set above that to preview only the row the user
 * settles on rather than every row they pass through.
 */
const PREVIEW_DEBOUNCE_MS = 60;

/** Below this many characters we show the unfiltered list instead of searching. */
const MIN_QUERY_LENGTH = 2;

type Mode = 'standard' | 'recent';

export class QuickOpenProvider implements vscode.Disposable {
    private previewManager: PreviewManager;

    constructor(
        private editorHistoryManager: EditorHistoryManager,
        private fileIndex: FileIndex
    ) {
        this.previewManager = new PreviewManager(editorHistoryManager);
    }

    public dispose(): void {
        this.previewManager.dispose();
    }

    /**
     * Show quick open with preview.
     *
     * @param mode 'standard' searches the workspace, 'recent' searches editor history
     */
    public async show(mode: Mode): Promise<void> {
        const quickPick = vscode.window.createQuickPick<SearchQuickPickItem>();
        quickPick.matchOnDescription = false;
        quickPick.matchOnDetail = true;
        quickPick.placeholder = mode === 'standard'
            ? 'Go to file with preview'
            : 'Search open editors by most recently used';

        // VS Code re-ranks quick pick items by its own fuzzy score as the user
        // types, which would override fzf's ranking. `sortByLabel` disables that.
        // It is an internal, not part of the public QuickPick API.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (quickPick as any).sortByLabel = false;

        const session = new SearchSession();

        // The recent list comes from history rather than the workspace, so it is
        // prepared here once per picker instead of living in the file index.
        let recentSnapshot: FileSnapshot | undefined;
        const snapshotFor = async (): Promise<FileSnapshot> => {
            if (mode === 'standard') {
                return this.fileIndex.get();
            }
            if (!recentSnapshot) {
                recentSnapshot = snapshotOf(this.fileHistory().map(item => item.uri));
            }
            return recentSnapshot;
        };

        const render = async (value: string): Promise<void> => {
            const signal = session.begin();
            quickPick.busy = true;

            try {
                const items = await this.buildItems(mode, value, snapshotFor, signal);
                if (!session.isStale(signal)) {
                    quickPick.items = items;
                }
            } catch (error) {
                if (!session.isStale(signal)) {
                    this.reportSearchFailure(error);
                    quickPick.items = [];
                }
            } finally {
                if (session.end(signal)) {
                    quickPick.busy = false;
                }
            }
        };

        // Prevent previews from polluting the history.
        this.previewManager.setPreviewMode(true);
        quickPick.show();

        quickPick.onDidHide(() => {
            session.close();
            this.previewManager.setPreviewMode(false);
            this.previewManager.clearDecorations();
            quickPick.dispose();
        });

        quickPick.onDidChangeValue(value => {
            session.debounceSearch(SEARCH_DEBOUNCE_MS, () => void render(value));
        });

        quickPick.onDidChangeActive(items => {
            session.debouncePreview(PREVIEW_DEBOUNCE_MS, () => {
                this.previewManager.clearDecorations();
                void this.previewManager.peekItem(items);
            });
        });

        quickPick.onDidAccept(async () => {
            // The chosen row may not have been previewed yet.
            session.cancelPreview();

            const selected = quickPick.selectedItems[0];
            if (selected?.data) {
                await this.previewManager.openSelectedFile(selected.data);
            }
            quickPick.hide();
        });

        await render('');
    }

    /**
     * Surface a failed search. A missing fzf is the only failure the user can
     * act on, so it is the only one worth interrupting them for.
     */
    private reportSearchFailure(error: unknown): void {
        if (error instanceof SearchAbortedError) {
            return;
        }
        if (error instanceof FzfNotFoundError) {
            vscode.window.showErrorMessage(error.message);
            return;
        }
        log('Search failed', error);
    }

    /**
     * Resolve the items to display: the full list while the query is too short
     * to be worth searching, otherwise fzf's ranked matches.
     */
    private async buildItems(
        mode: Mode,
        value: string,
        snapshotFor: () => Promise<FileSnapshot>,
        signal: AbortSignal
    ): Promise<SearchQuickPickItem[]> {
        const isSearch = value.length >= MIN_QUERY_LENGTH;

        if (mode === 'recent' && !isSearch) {
            return this.recentEditorItems(this.fileHistory());
        }

        const snapshot = await snapshotFor();
        const matches = isSearch
            ? await this.match(snapshot, value, signal)
            : snapshot.uris;

        if (mode === 'recent') {
            const positions = new Map(this.fileHistory().map(item => [item.uri.fsPath, item]));
            return this.limit(matches).map(uri => {
                const item = positions.get(uri.fsPath);
                return toQuickPickItem(uri, item?.linePos ?? 0, item?.colPos ?? 0);
            });
        }

        return this.limit(matches).map(uri => toQuickPickItem(uri));
    }

    /**
     * Run the query through fzf and map its output back to file URIs.
     */
    private async match(
        snapshot: FileSnapshot,
        query: string,
        signal: AbortSignal
    ): Promise<vscode.Uri[]> {
        if (!snapshot.fzfInput) {
            return [];
        }

        const matches: vscode.Uri[] = [];
        for (const line of await fuzzyFilter(snapshot.fzfInput, query, signal)) {
            const uri = snapshot.byPath.get(line);
            if (uri) {
                matches.push(uri);
            }
        }
        return matches;
    }

    private fileHistory(): EditorHistoryItem[] {
        return this.editorHistoryManager.getHistory().filter(item => item.uri.scheme === 'file');
    }

    /**
     * The recent-editors list: everything in history that still exists on disk,
     * minus the file already in front of the user.
     */
    private async recentEditorItems(history: EditorHistoryItem[]): Promise<SearchQuickPickItem[]> {
        const activeEditorPath = vscode.window.activeTextEditor?.document.uri.fsPath;
        const candidates = history.filter(item => item.uri.fsPath !== activeEditorPath);

        const resolved = await Promise.all(candidates.map(async item => {
            try {
                await vscode.workspace.fs.stat(item.uri);
                return item;
            } catch {
                return undefined;   // deleted or moved since it was recorded
            }
        }));

        return resolved
            .filter((item): item is EditorHistoryItem => item !== undefined)
            .map(item => toQuickPickItem(item.uri, item.linePos, item.colPos));
    }

    private limit<T>(items: T[]): T[] {
        return items.slice(0, SettingsManager.getMaxResults());
    }
}
