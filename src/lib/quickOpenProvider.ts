import * as vscode from 'vscode';
import * as path from 'path';
import { SearchQuickPickItem } from '../types';
import { EditorHistoryManager } from './editorHistory';
import { PreviewManager } from './previewManager';
import { fuzzySearchFiles } from '../utils/searchUtils';
import { getFileLocation } from '../utils/fileUtils';
import { SettingsManager } from '../utils/settingsUtils';

export class QuickOpenProvider {
    private editorHistoryManager: EditorHistoryManager;
    private previewManager: PreviewManager;
    // Debounce timer for search input
    private searchDebounceTimer?: NodeJS.Timeout;
    
    constructor(editorHistoryManager: EditorHistoryManager) {
        this.editorHistoryManager = editorHistoryManager;
        this.previewManager = new PreviewManager(editorHistoryManager);
    }
    
    /**
     * Main function to show quick open with preview, with different modes
     * @param mode 'standard' for normal quick open, 'recent' for most recently used editors
     */
    public async show(mode: 'standard' | 'recent'): Promise<void> {
        const quickPick = vscode.window.createQuickPick<SearchQuickPickItem>();
        
        // Force VSCode to show everything
        quickPick.matchOnDescription = false;
        quickPick.matchOnDetail = true;
        (quickPick as any).sortByLabel = false;
        
        // Set placeholder text based on mode
        if (mode === 'standard') {
            quickPick.placeholder = 'Go to file with preview';
        } else {
            quickPick.placeholder = 'Search open editors by most recently used';
        }
        
        quickPick.busy = true;
        
        // Enable preview mode to prevent files from being added to history during preview
        this.previewManager.setPreviewMode(true);
        
        // Show the quick pick UI immediately
        quickPick.show();
        
        // Handle when the picker is closed
        quickPick.onDidHide(() => {
            // Disable preview mode when the quick pick is closed
            this.previewManager.setPreviewMode(false);
            
            // Clear any search-related decorations
            this.previewManager.clearDecorations();
            
            // Dispose of the quickPick to free resources
            quickPick.dispose();
        });
        
        // Load initial files list based on mode
        try {
            if (mode === 'standard') {
                await this.handleStandardSearch(quickPick, '');
            } else {
                await this.loadRecentEditorsList(quickPick);
            }
        } finally {
            quickPick.busy = false;
        }
        
        // Update results based on user input
        quickPick.onDidChangeValue((value) => {
            // Clear any pending search
            if (this.searchDebounceTimer) {
                clearTimeout(this.searchDebounceTimer);
            }

            // Debounce execution to avoid kicking off a search on every single keystroke
            this.searchDebounceTimer = setTimeout(async () => {
                if (!value || value.length < 2) {
                    // Restore the initial files list if user clears the input
                    if (mode === 'standard') {
                        await this.handleStandardSearch(quickPick, '');
                    } else {
                        await this.loadRecentEditorsList(quickPick);
                    }
                    return;
                }

                // Handle search for both modes
                if (mode === 'standard') {
                    await this.handleStandardSearch(quickPick, value);
                } else {
                    await this.handleRecentEditorsSearch(quickPick, value);
                }
            }, 50); // 50 ms debounce delay – tweak in settings if desired
        });

        // Set up the on change handler to show file previews
        quickPick.onDidChangeActive(async items => {
            try {
                // Clear previous decorations
                this.previewManager.clearDecorations();
                
                // Preview the file (await to ensure settings are applied)
                await this.previewManager.peekItem(items);
            } catch (error) {
                console.error('Error during file preview:', error);
            }
        });

        // Handle selection
        quickPick.onDidAccept(async () => {
            const selectedItem = quickPick.selectedItems[0];
            
            if (selectedItem && selectedItem.data) {
                await this.previewManager.openSelectedFile(selectedItem.data);
            }
            
            quickPick.hide();
        });
    }
    
    /**
     * Handles search for the standard quick open mode
     */
    private async handleStandardSearch(quickPick: vscode.QuickPick<SearchQuickPickItem>, value: string): Promise<void> {
        quickPick.busy = true;
        
        try {
            const excludePattern = SettingsManager.getGlobExcludePattern();
            const files = await vscode.workspace.findFiles('**/*', excludePattern);
            
            // Let fzf do ALL the filtering
            const matchResults = await fuzzySearchFiles(files, value);
                
            const filenameResults = matchResults.map(({ uri }) => {
                const relativePath = vscode.workspace.asRelativePath(uri.fsPath);
                const searchablePath = relativePath.replace(/[\/\\]/g, '');
                
                return {
                    label: `${relativePath}`,
                    description: '', 
                    data: {
                        filePath: uri.fsPath,
                        searchablePath,
                        fileName: path.basename(uri.fsPath),
                        linePos: 0,
                        colPos: 0,
                        searchText: value,
                        type: 'file' as 'file' 
                    }
                };
            });
            
            // Respect fzf's original ranking, no additional sorting
            const maxResults = SettingsManager.getMaxResults();
            quickPick.items = filenameResults.slice(0, maxResults);
        } catch (error) {
            console.error('Error during search:', error);
            quickPick.items = [];
        } finally {
            quickPick.busy = false;
        }
    }
    
    /**
     * Handles search for the most recently used editors mode
     */
    private async handleRecentEditorsSearch(quickPick: vscode.QuickPick<SearchQuickPickItem>, value: string): Promise<void> {
        quickPick.busy = true;
        
        try {
            // Get editor history items
            const historyItems = this.editorHistoryManager.getHistory().filter(item => {
                return item.uri.scheme === 'file';
            });
            
            // Convert to URI array for fzf search
            const historyUris = historyItems.map(item => item.uri);
            
            // Create a map to quickly get history items by fsPath
            const historyItemsByPath = new Map();
            historyItems.forEach(item => {
                historyItemsByPath.set(item.uri.fsPath, item);
            });
            
            // Use fzf for searching, just like in standard search
            const matchResults = await fuzzySearchFiles(historyUris, value);
                
            const filenameResults = matchResults.map(({ uri }) => {
                const relativePath = vscode.workspace.asRelativePath(uri.fsPath);
                const searchablePath = relativePath.replace(/[\/\\]/g, '');
                const historyItem = historyItemsByPath.get(uri.fsPath);
                
                return {
                    label: `${relativePath}`,
                    description: '', 
                    data: {
                        filePath: uri.fsPath,
                        searchablePath,
                        fileName: path.basename(uri.fsPath),
                        linePos: historyItem?.linePos || 0,
                        colPos: historyItem?.colPos || 0,
                        searchText: value,
                        type: 'file' as 'file' 
                    }
                };
            });
            
            // Respect fzf's original ranking – no additional sorting
            const maxResults = SettingsManager.getMaxResults();
            quickPick.items = filenameResults.slice(0, maxResults);
        } catch (error) {
            console.error('Error during search:', error);
            quickPick.items = [];
        } finally {
            quickPick.busy = false;
        }
    }
    
    
    /**
     * Loads the list of most recently used editors from the tracked history
     */
    private async loadRecentEditorsList(quickPick: vscode.QuickPick<SearchQuickPickItem>): Promise<void> {
        // Show loading indicator
        quickPick.busy = true;
        
        try {
            const results: SearchQuickPickItem[] = [];
            
            // Get the currently active editor URI to exclude it
            const activeEditor = vscode.window.activeTextEditor;
            const activeEditorUri = activeEditor?.document.uri.fsPath;
            
            // Use the editor history we've been tracking
            // This includes both currently open and previously opened editors
            for (const historyItem of this.editorHistoryManager.getHistory()) {
                // Skip the currently active editor
                if (historyItem.uri.scheme === 'file' && historyItem.uri.fsPath !== activeEditorUri) {
                    try {
                        // Verify the file still exists
                        await vscode.workspace.fs.stat(historyItem.uri);
                        
                        const relativePath = vscode.workspace.asRelativePath(historyItem.uri.fsPath);
                        
                        // Find whether this file is currently open
                        const isCurrentlyOpen = vscode.window.visibleTextEditors.some(
                            editor => editor.document.uri.fsPath === historyItem.uri.fsPath
                        );
                        
                        results.push({
                            label: `${relativePath}`,
                            description: getFileLocation(relativePath),
                            data: {
                                filePath: historyItem.uri.fsPath,
                                fileName: path.basename(historyItem.uri.fsPath),
                                searchablePath: relativePath.replace(/[\/\\]/g, ''),
                                linePos: historyItem.linePos || 0,
                                colPos: historyItem.colPos || 0,
                                type: 'file' as 'file' 
                            }
                        });
                    } catch (error) {
                        // Skip files that no longer exist
                        continue;
                    }
                }
            }
            
            // Update quickpick items
            quickPick.items = results;
        } catch (error) {
            console.error('Error loading recent editors:', error);
            quickPick.items = [];
        } finally {
            quickPick.busy = false;
        }
    }
} 