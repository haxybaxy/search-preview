import * as vscode from 'vscode';
import { EditorHistoryItem } from '../types';

export class EditorHistoryManager {
    private history: EditorHistoryItem[] = [];
    private readonly MAX_HISTORY_SIZE = 100;

    constructor() {
        // Initialize with currently open editors
        vscode.window.visibleTextEditors.forEach(editor => {
            if (editor.document.uri.scheme === 'file') {
                this.updateHistory(editor);
            }
        });
    }

    /**
     * Get the current editor history
     */
    public getHistory(): EditorHistoryItem[] {
        return this.history;
    }

    /**
     * Update the editor history when an editor is opened or becomes active
     */
    public updateHistory(editor: vscode.TextEditor): void {
        const uri = editor.document.uri;
        
        // Remove this URI from the history if it exists
        const existingIndex = this.history.findIndex(item => item.uri.fsPath === uri.fsPath);
        if (existingIndex >= 0) {
            this.history.splice(existingIndex, 1);
        }
        
        // Add to the beginning of the history (most recent)
        this.history.unshift({
            uri: uri,
            timestamp: Date.now(),
            linePos: editor.selection.active.line,
            colPos: editor.selection.active.character
        });
        
        // Trim history if it's too long
        if (this.history.length > this.MAX_HISTORY_SIZE) {
            this.history.pop();
        }
    }

    /**
     * Register event listeners to track editor history
     */
    public registerListeners(context: vscode.ExtensionContext): void {
        // Add text document open listener to track editor history
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor && editor.document.uri.scheme === 'file') {
                    this.updateHistory(editor);
                }
            })
        );
    }
} 