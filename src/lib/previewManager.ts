import * as vscode from 'vscode';
import * as path from 'path';
import { SearchQuickPickItem } from '../types';
import { isBinaryFile, setCursorPosition } from '../utils/fileUtils';
import { DecorationManager } from '../utils/decorationUtils';

export class PreviewManager {
    private lastPreviewEditor?: vscode.TextEditor;
    private decorationManager: DecorationManager;
    
    constructor() {
        this.decorationManager = new DecorationManager();
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
            // Proceed with text file preview using async/await
            const documentPromise = vscode.workspace.openTextDocument(path.resolve(filePath));
            
            // Handle the document opening with proper error handling
            documentPromise
                .then(document => {
                    return vscode.window.showTextDocument(document, {
                        preview: true,
                        preserveFocus: true,
                    })
                    .then(editor => {
                        this.lastPreviewEditor = editor;
                        setCursorPosition(editor, linePos, colPos);
                        
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