import * as vscode from 'vscode';
import { EditorHistoryItem, SearchQuickPickItem } from '../types';
import { EditorHistoryManager } from './editorHistory';
import { PreviewManager } from './previewManager';
import { FzfNotFoundError, SearchAbortedError, fuzzySearchFiles } from '../utils/searchUtils';
import { toQuickPickItem } from '../utils/fileUtils';
import { SettingsManager } from '../utils/settingsUtils';
import { log } from '../utils/logger';

/** Delay before a keystroke triggers a search, so we don't search per character. */
const SEARCH_DEBOUNCE_MS = 50;

/** Below this many characters we show the unfiltered list instead of searching. */
const MIN_QUERY_LENGTH = 2;

type Mode = 'standard' | 'recent';

export class QuickOpenProvider {
    private previewManager: PreviewManager;

    constructor(private editorHistoryManager: EditorHistoryManager) {
        this.previewManager = new PreviewManager(editorHistoryManager);
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

        // Per-picker state. show() can be re-entered, so none of this may live on
        // the instance or a second picker would cancel the first one's work.
        let debounceTimer: NodeJS.Timeout | undefined;
        let inFlight: AbortController | undefined;
        let hidden = false;

        // Enumerate the workspace once per picker rather than once per keystroke.
        const workspaceFiles: Thenable<vscode.Uri[]> = mode === 'standard'
            ? vscode.workspace.findFiles('**/*', SettingsManager.getGlobExcludePattern())
            : Promise.resolve([]);

        const cancelPending = (): void => {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
                debounceTimer = undefined;
            }
            inFlight?.abort();
            inFlight = undefined;
        };

        // True once a newer query, or a dismissal, has superseded this attempt.
        const isStale = (controller: AbortController): boolean =>
            hidden || controller.signal.aborted;

        const settle = (controller: AbortController): void => {
            if (inFlight !== controller) {
                return;
            }
            inFlight = undefined;
            if (!hidden) {
                quickPick.busy = false;
            }
        };

        const render = async (value: string): Promise<void> => {
            cancelPending();

            const controller = new AbortController();
            inFlight = controller;
            quickPick.busy = true;

            try {
                const items = await this.buildItems(mode, value, workspaceFiles, controller.signal);
                if (!isStale(controller)) {
                    quickPick.items = items;
                }
            } catch (error) {
                if (!isStale(controller)) {
                    this.reportSearchFailure(error);
                    quickPick.items = [];
                }
            } finally {
                settle(controller);
            }
        };

        // Prevent previews from polluting the history.
        this.previewManager.setPreviewMode(true);
        quickPick.show();

        quickPick.onDidHide(() => {
            hidden = true;
            cancelPending();
            this.previewManager.setPreviewMode(false);
            this.previewManager.clearDecorations();
            quickPick.dispose();
        });

        quickPick.onDidChangeValue(value => {
            cancelPending();
            debounceTimer = setTimeout(() => void render(value), SEARCH_DEBOUNCE_MS);
        });

        quickPick.onDidChangeActive(async items => {
            this.previewManager.clearDecorations();
            await this.previewManager.peekItem(items);
        });

        quickPick.onDidAccept(async () => {
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
        workspaceFiles: Thenable<vscode.Uri[]>,
        signal: AbortSignal
    ): Promise<SearchQuickPickItem[]> {
        const isSearch = value.length >= MIN_QUERY_LENGTH;

        if (mode === 'recent') {
            const history = this.editorHistoryManager.getHistory()
                .filter(item => item.uri.scheme === 'file');

            if (!isSearch) {
                return this.recentEditorItems(history);
            }

            const positions = new Map(history.map(item => [item.uri.fsPath, item]));
            const matches = await fuzzySearchFiles(history.map(item => item.uri), value, signal);
            return this.limit(matches).map(uri => {
                const item = positions.get(uri.fsPath);
                return toQuickPickItem(uri, item?.linePos ?? 0, item?.colPos ?? 0);
            });
        }

        const files = await workspaceFiles;
        const matches = isSearch
            ? await fuzzySearchFiles(files, value, signal)
            : files.filter(file => !SettingsManager.shouldExcludeFile(file.fsPath));

        return this.limit(matches).map(uri => toQuickPickItem(uri));
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
