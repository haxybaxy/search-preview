import * as vscode from 'vscode';
import * as path from 'path';
import { SearchQuickPickItem } from '../types';
import { isBinaryFile, setCursorPosition } from '../utils/fileUtils';
import { DecorationManager } from '../utils/decorationUtils';
import { EditorHistoryManager } from './editorHistory';

export class PreviewManager {
    private lastPreviewEditor?: vscode.TextEditor;
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
        if (this.editorHistoryManager) {
            this.editorHistoryManager.setPreviewMode(enabled);
        }
        
        if (enabled) {
            // When entering preview mode, store active editor
            this.previousActiveEditor = vscode.window.activeTextEditor;
        } else {
            // When exiting preview mode, restore active editor
            this.restoreActiveEditor();
        }
    }
    
    /**
     * Restore the active editor that was open before preview started
     */
    private async restoreActiveEditor(): Promise<void> {
        if (this.previousActiveEditor) {
            try {
                await vscode.window.showTextDocument(
                    this.previousActiveEditor.document, 
                    this.previousActiveEditor.viewColumn
                );
                
                // Restore cursor position
                if (vscode.window.activeTextEditor) {
                    vscode.window.activeTextEditor.selection = this.previousActiveEditor.selection;
                    vscode.window.activeTextEditor.revealRange(
                        this.previousActiveEditor.selection,
                        vscode.TextEditorRevealType.Default
                    );
                }
                
                this.previousActiveEditor = undefined;
            } catch (error) {
                // Ignore errors restoring the editor
                console.log('Error restoring previous editor', error);
            }
        }
    }
    
    /**
     * Preview a file based on the selected quick pick item
     */
    public async peekItem(items: readonly SearchQuickPickItem[]): Promise<void> {
        if (items.length === 0) {
            return;
        }

        const currentItem = items[0];
        if (!currentItem.data) {
            return;
        }

        const { filePath, linePos, colPos, searchText, type } = currentItem.data;
        
        // Skip preview for binary files
        if (isBinaryFile(filePath)) {
            return;
        }
        
        try {
            // Register this file as being previewed
            if (this.editorHistoryManager) {
                this.editorHistoryManager.addPreviewedFile(filePath);
            }
            
            // Open the document for preview
            const document = await vscode.workspace.openTextDocument(path.resolve(filePath));
            const editor = await vscode.window.showTextDocument(document, {
                preview: true,
                preserveFocus: true,
                viewColumn: vscode.ViewColumn.Active,
                selection: new vscode.Range(linePos, colPos, linePos, colPos)
            });
            
            this.lastPreviewEditor = editor;
            
            // Highlight the current line
            this.decorationManager.highlightLine(editor, linePos);
            
        } catch (error) {
            // Handle any errors
            console.log(`Error previewing file: ${filePath}`, error);
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
            // When a file is explicitly opened, turn off preview mode
            // so this file actually gets added to history
            if (this.editorHistoryManager) {
                this.editorHistoryManager.setPreviewMode(false);
                // Force add this file to history
                this.editorHistoryManager.forceAddToHistory(filePath, linePos, colPos);
            }
            
            // Check if it's a binary file
            if (isBinaryFile(filePath)) {
                // For binary files, use the default editor associated with the file type
                vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
            } else {
                // For text files, open with the text editor
                const document = await vscode.workspace.openTextDocument(filePath);
                await vscode.window.showTextDocument(document, {
                    preview: false,
                    preserveFocus: false
                });
                
                // Position cursor 
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    setCursorPosition(editor, linePos, colPos);
                }
            }
            
            // Clear the previous active editor reference since we're opening a new file
            this.previousActiveEditor = undefined;
        } catch (error) {
            // Handle errors gracefully
            vscode.window.showErrorMessage(`Could not open file: ${path.basename(filePath)}`);
        }
    }
} 