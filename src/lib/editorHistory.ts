import * as vscode from 'vscode';
import { EditorHistoryItem } from '../types';

export class EditorHistoryManager {
    private history: EditorHistoryItem[] = [];
    private readonly MAX_HISTORY_SIZE = 100;
    private previewMode = false;
    private previewedFiles = new Set<string>();
    private lastOpenedFile?: string;

    constructor() {
        // Initialize with currently open editors
        vscode.window.visibleTextEditors.forEach(editor => {
            if (editor.document.uri.scheme === 'file') {
                this.updateHistory(editor);
            }
        });

        // Listen for editor changes
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.uri.scheme === 'file' && !this.previewMode) {
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
    public forceAddToHistory(filePath: string, linePos: number = 0, colPos: number = 0): void {
        // Create a Uri from the file path
        const uri = vscode.Uri.file(filePath);
        
        // Mark that this was the last opened file, so even if it becomes active later
        // we know it should be added to history
        this.lastOpenedFile = filePath;
        
        // Remove this URI from the history if it exists
        const existingIndex = this.history.findIndex(item => item.uri.fsPath === uri.fsPath);
        if (existingIndex >= 0) {
            this.history.splice(existingIndex, 1);
        }
        
        // Add to the beginning of the history (most recent)
        this.history.unshift({
            uri: uri,
            timestamp: Date.now(),
            linePos: linePos,
            colPos: colPos
        });
        
        // Trim history if it's too long
        if (this.history.length > this.MAX_HISTORY_SIZE) {
            this.history.pop();
        }
    }

    /**
     * Update the editor history when an editor is opened or becomes active
     */
    public updateHistory(editor: vscode.TextEditor): void {
        const uri = editor.document.uri;
        
        // Skip if we're in preview mode and this is a previewed file
        // But don't skip if this was just explicitly opened (lastOpenedFile)
        if (this.previewMode && 
            this.previewedFiles.has(uri.fsPath) && 
            this.lastOpenedFile !== uri.fsPath) {
            return;
        }
        
        // Reset the last opened file tracking
        this.lastOpenedFile = undefined;
        
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
                    // Only add to history if:
                    // 1. Not in preview mode, or
                    // 2. This file wasn't just previewed, or
                    // 3. This is the file that was just explicitly opened
                    const filePath = editor.document.uri.fsPath;
                    if (!this.previewMode || 
                        !this.previewedFiles.has(filePath) || 
                        this.lastOpenedFile === filePath) {
                        this.updateHistory(editor);
                    }
                }
            })
        );
    }
} 