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
    private originalAutoRevealSetting: boolean | undefined;
    
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
            // When entering preview mode, disable auto reveal
            this.disableAutoReveal();
        } else {
            // When exiting preview mode, restore auto reveal setting
            this.restoreAutoReveal();
        }
    }
    
    /**
     * Temporarily disable auto reveal in explorer
     */
    private async disableAutoReveal(): Promise<void> {
        // Store the original setting
        this.originalAutoRevealSetting = vscode.workspace
            .getConfiguration('explorer')
            .get<boolean>('autoReveal');
            
        // Disable auto reveal
        await vscode.workspace
            .getConfiguration('explorer')
            .update('autoReveal', false, vscode.ConfigurationTarget.Workspace);
    }
    
    /**
     * Restore the original auto reveal setting
     */
    private async restoreAutoReveal(): Promise<void> {
        if (this.originalAutoRevealSetting !== undefined) {
            await vscode.workspace
                .getConfiguration('explorer')
                .update('autoReveal', this.originalAutoRevealSetting, vscode.ConfigurationTarget.Workspace);
                
            this.originalAutoRevealSetting = undefined;
        }
    }
    
    /**
     * Preview a file based on the selected quick pick item
     */
    public peekItem(items: readonly SearchQuickPickItem[]): void {
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
        
        // Use a try-catch block to handle errors
        try {
            // Register this file as being previewed
            if (this.editorHistoryManager) {
                this.editorHistoryManager.addPreviewedFile(filePath);
            }
            
            // Proceed with text file preview using async/await
            const documentPromise = vscode.workspace.openTextDocument(path.resolve(filePath));
            
            // Handle the document opening with proper error handling
            documentPromise
                .then(document => {
                    // Use only valid options for TextDocumentShowOptions
                    return vscode.window.showTextDocument(document, {
                        preview: true,
                        preserveFocus: true,
                        viewColumn: vscode.ViewColumn.Active,
                        selection: new vscode.Range(linePos, colPos, linePos, colPos)
                    })
                    .then(editor => {
                        this.lastPreviewEditor = editor;
                        
                        // Highlight the current line
                        this.decorationManager.highlightLine(editor, linePos);
                        
                        // If this is a content match, also highlight the matching text
                        if (type === 'content' && searchText) {
                            this.decorationManager.highlightSearchMatches(editor, searchText);
                        }
                    });
                })
                .then(undefined, (error: Error) => {
                    // Handle any errors opening the file silently
                    console.log(`Could not preview file: ${filePath}`, error);
                });
        } catch (error) {
            // Handle any synchronous errors
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
            
            // Restore auto reveal for actually opening files
            await this.restoreAutoReveal();
            
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
        } catch (error) {
            // Handle errors gracefully
            vscode.window.showErrorMessage(`Could not open file: ${path.basename(filePath)}`);
        }
    }
} 