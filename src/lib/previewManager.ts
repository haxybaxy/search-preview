import * as vscode from 'vscode';
import * as path from 'path';
import { SearchQuickPickItem } from '../types';
import { setCursorPosition } from '../utils/fileUtils';
import { DecorationManager } from '../utils/decorationUtils';
import { EditorHistoryManager } from './editorHistory';
import { log } from '../utils/logger';

export class PreviewManager {
    private decorationManager: DecorationManager;
    private editorHistoryManager?: EditorHistoryManager;
    private previousActiveEditor?: vscode.TextEditor;

    constructor(editorHistoryManager?: EditorHistoryManager) {
        this.decorationManager = new DecorationManager();
        this.editorHistoryManager = editorHistoryManager;
    }

    /**
     * Enable or disable preview mode to prevent files from being added to history
     */
    public setPreviewMode(enabled: boolean): void {
        this.editorHistoryManager?.setPreviewMode(enabled);

        if (enabled) {
            // When entering preview mode, store active editor
            this.previousActiveEditor = vscode.window.activeTextEditor;
        } else {
            // When exiting preview mode, restore active editor
            void this.restoreActiveEditor();
        }
    }

    /**
     * Restore the active editor that was open before preview started
     */
    private async restoreActiveEditor(): Promise<void> {
        if (!this.previousActiveEditor) {
            return;
        }

        const previous = this.previousActiveEditor;
        this.previousActiveEditor = undefined;

        try {
            await vscode.window.showTextDocument(previous.document, previous.viewColumn);

            // Restore cursor position
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                editor.selection = previous.selection;
                editor.revealRange(previous.selection, vscode.TextEditorRevealType.Default);
            }
        } catch (error) {
            log('Could not restore the previously active editor', error);
        }
    }

    /**
     * Preview a file based on the selected quick pick item
     */
    public async peekItem(items: readonly SearchQuickPickItem[]): Promise<void> {
        const data = items[0]?.data;
        if (!data) {
            return;
        }

        const { filePath, linePos, colPos } = data;

        try {
            // Register this file as being previewed
            this.editorHistoryManager?.addPreviewedFile(filePath);

            // Use VS Code's native open command to handle all file types appropriately
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath), {
                preview: true,
                preserveFocus: true,
                viewColumn: vscode.ViewColumn.Active
            });

            // For text files, VS Code will create a text editor
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.fsPath === filePath) {
                setCursorPosition(editor, linePos, colPos);
                this.decorationManager.highlightLine(editor, linePos);
            }
        } catch (error) {
            log(`Could not preview ${filePath}`, error);
        }
    }

    /**
     * Clear all decorations
     */
    public clearDecorations(): void {
        this.decorationManager.clearDecorations();
    }

    /**
     * Open the selected file
     */
    public async openSelectedFile(data: SearchQuickPickItem['data']): Promise<void> {
        if (!data) {
            return;
        }

        const { filePath, linePos, colPos } = data;

        try {
            // An explicit open should be recorded, so leave preview mode first.
            this.editorHistoryManager?.setPreviewMode(false);
            this.editorHistoryManager?.forceAddToHistory(filePath, linePos, colPos);

            // Let VS Code determine how to open the file based on its type
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath), {
                preview: false,
                preserveFocus: false
            });

            // For text files, VS Code will create a text editor and we can set the cursor
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.fsPath === filePath) {
                setCursorPosition(editor, linePos, colPos);
            }

            // Drop the restore target: the user chose this file, so dismissing
            // the picker must not send them back to where they started.
            this.previousActiveEditor = undefined;
        } catch (error) {
            log(`Could not open ${filePath}`, error);
            vscode.window.showErrorMessage(`Could not open file: ${path.basename(filePath)}`);
        }
    }
}
