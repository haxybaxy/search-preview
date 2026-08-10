import * as vscode from 'vscode';
import { EditorHistoryItem, StoredEditorHistoryItem } from '../types';
import { log } from '../utils/logger';

const STORAGE_KEY = 'editorHistory';
const MAX_HISTORY_SIZE = 100;

/**
 * How long to batch history writes.
 *
 * Persisting hits VS Code's state store, and previewing a file counts as an
 * editor change - so without this, arrowing through the picker writes to disk
 * once per row. Flushed on deactivate so nothing is lost.
 */
const SAVE_DEBOUNCE_MS = 500;

export class EditorHistoryManager {
    private history: EditorHistoryItem[] = [];
    private previewMode = false;
    private previewedFiles = new Set<string>();
    private lastOpenedFile?: string;
    private saveTimer?: NodeJS.Timeout;
    private storage: vscode.Memento;

    constructor(context: vscode.ExtensionContext) {
        // workspaceState rather than globalState: history is project-specific.
        this.storage = context.workspaceState;

        this.history = this.storage
            .get<StoredEditorHistoryItem[]>(STORAGE_KEY, [])
            .map(item => ({
                uri: vscode.Uri.parse(item.uri),
                linePos: item.linePos,
                colPos: item.colPos
            }));

        // Seed from editors that are already open. The listener that keeps this
        // current is registered separately in registerListeners() so that it is
        // owned by the extension's subscriptions and disposed with it.
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.scheme === 'file') {
                this.updateHistory(editor);
            }
        }
    }

    /**
     * Get the current editor history
     */
    public getHistory(): EditorHistoryItem[] {
        return this.history;
    }

    /**
     * Set preview mode on/off
     * When preview mode is on, files won't be added to history when they become active
     */
    public setPreviewMode(mode: boolean): void {
        this.previewMode = mode;

        // When exiting preview mode, clear the set of previewed files
        if (!mode) {
            this.previewedFiles.clear();
        }
    }

    /**
     * Register a file as being previewed
     */
    public addPreviewedFile(filePath: string): void {
        this.previewedFiles.add(filePath);
    }

    /**
     * Force a file to be added to history, regardless of preview mode
     * Used when a file is explicitly opened
     */
    public forceAddToHistory(filePath: string, linePos = 0, colPos = 0): void {
        // Remember this so the activation event that follows is not skipped as
        // though it were just another preview.
        this.lastOpenedFile = filePath;
        this.pushHistoryEntry(vscode.Uri.file(filePath), linePos, colPos);
    }

    /**
     * Update the editor history when an editor is opened or becomes active
     */
    public updateHistory(editor: vscode.TextEditor): void {
        const uri = editor.document.uri;
        if (this.isPreviewOnly(uri.fsPath)) {
            return;
        }

        this.lastOpenedFile = undefined;
        this.pushHistoryEntry(uri, editor.selection.active.line, editor.selection.active.character);
    }

    /**
     * True when this editor became active only because it was being previewed,
     * and so should not count as a visit.
     */
    private isPreviewOnly(filePath: string): boolean {
        return this.previewMode
            && this.previewedFiles.has(filePath)
            && this.lastOpenedFile !== filePath;
    }

    /**
     * Move a file to the front of the history, de-duplicating by relative path
     * and trimming to MAX_HISTORY_SIZE.
     */
    private pushHistoryEntry(uri: vscode.Uri, linePos: number, colPos: number): void {
        // fsPath is the canonical identity for these URIs. The previous
        // asRelativePath comparison called into the workspace API on both sides
        // of every element, up to 200 times per editor switch.
        const existingIndex = this.history.findIndex(item => item.uri.fsPath === uri.fsPath);
        if (existingIndex >= 0) {
            this.history.splice(existingIndex, 1);
        }

        this.history.unshift({ uri, linePos, colPos });

        if (this.history.length > MAX_HISTORY_SIZE) {
            this.history.pop();
        }

        this.scheduleSave();
    }

    /**
     * Batch up rapid history changes into a single write.
     */
    private scheduleSave(): void {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(() => {
            this.saveTimer = undefined;
            void this.saveHistory();
        }, SAVE_DEBOUNCE_MS);
    }

    /**
     * Write any pending history immediately. Called on deactivate, where a
     * debounced write would otherwise never fire.
     */
    public async flush(): Promise<void> {
        if (!this.saveTimer) {
            return;
        }
        clearTimeout(this.saveTimer);
        this.saveTimer = undefined;
        await this.saveHistory();
    }

    /**
     * Save the current history to persistent storage
     */
    private async saveHistory(): Promise<void> {
        const stored: StoredEditorHistoryItem[] = this.history.map(item => ({
            uri: item.uri.toString(),
            linePos: item.linePos,
            colPos: item.colPos
        }));

        try {
            await this.storage.update(STORAGE_KEY, stored);
        } catch (error) {
            log('Failed to save editor history', error);
        }
    }

    /**
     * Register event listeners to track editor history
     */
    public registerListeners(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor?.document.uri.scheme === 'file') {
                    this.updateHistory(editor);
                }
            })
        );
    }
}
