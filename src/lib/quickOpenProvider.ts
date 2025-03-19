import * as vscode from 'vscode';
import * as path from 'path';
import { SearchQuickPickItem } from '../types';
import { EditorHistoryManager } from './editorHistory';
import { PreviewManager } from './previewManager';
import { createFileSearchItems, searchInFileContents } from '../utils/searchUtils';
import { getFileIcon, getFileLocation, isBinaryFile } from '../utils/fileUtils';

export class QuickOpenProvider {
    private editorHistoryManager: EditorHistoryManager;
    private previewManager: PreviewManager;
    
    constructor(editorHistoryManager: EditorHistoryManager) {
        this.editorHistoryManager = editorHistoryManager;
        this.previewManager = new PreviewManager(editorHistoryManager);
    }
    
    /**
     * Main function to show quick open with preview, with different modes
     * @param mode 'standard' for normal quick open, 'recent' for most recently used editors
     */
    public async show(mode: 'standard' | 'recent'): Promise<void> {
        // Create the quick pick UI
        const quickPick = vscode.window.createQuickPick<SearchQuickPickItem>();
        
        // Set placeholder text based on mode
        if (mode === 'standard') {
            quickPick.placeholder = 'Go to file with preview';
        } else {
            quickPick.placeholder = 'Search open editors by most recently used';
        }
        
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        
        // Show progress indicator while loading initial files
        quickPick.busy = true;
        
        // Enable preview mode to prevent files from being added to history during preview
        this.previewManager.setPreviewMode(true);
        
        // Show the quick pick UI immediately
        quickPick.show();
        
        // Handle when the picker is closed
        quickPick.onDidHide(() => {
            // Disable preview mode when the quick pick is closed
            this.previewManager.setPreviewMode(false);
        });
        
        // Load initial files list based on mode
        try {
            if (mode === 'standard') {
                await this.loadInitialFilesList(quickPick);
            } else {
                await this.loadRecentEditorsList(quickPick);
            }
        } finally {
            quickPick.busy = false;
        }
        
        // Update results based on user input
        quickPick.onDidChangeValue(async (value) => {
            if (!value || value.length < 2) {
                // Restore the initial files list if user clears the input
                if (mode === 'standard') {
                    await this.loadInitialFilesList(quickPick);
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
        });

        // Set up the on change handler to show file previews
        quickPick.onDidChangeActive(items => {
            // Clear previous decorations
            this.previewManager.clearDecorations();
            // Preview the file
            this.previewManager.peekItem(items);
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
        // Get all workspace files for filename matching
        const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
        
        // Calculate relevance scores and filter files based on filename and path
        const valueLC = value.toLowerCase();
        const scoredMatches = files
            .filter(file => {
                // First, filter out binary files for search performance
                if (isBinaryFile(file.fsPath)) {
                    return false;
                }
                
                const fileName = path.basename(file.fsPath).toLowerCase();
                const filePath = vscode.workspace.asRelativePath(file.fsPath).toLowerCase();
                
                // Only include files that match the search in filename or path
                return fileName.includes(valueLC) || filePath.includes(valueLC);
            })
            .map(file => {
                const fileName = path.basename(file.fsPath).toLowerCase();
                const filePath = vscode.workspace.asRelativePath(file.fsPath).toLowerCase();
                
                // Calculate relevance score based on multiple factors
                let score = 0;
                
                // 1. Exact filename match gets highest priority
                if (fileName === valueLC) {
                    score += 100;
                }
                // 2. Filename starts with the search term
                else if (fileName.startsWith(valueLC)) {
                    score += 80;
                }
                // 3. Filename contains the search term
                else if (fileName.includes(valueLC)) {
                    score += 60;
                }
                // 4. Direct parent directory matches
                const parentDir = path.dirname(filePath).split(path.sep).pop() || '';
                if (parentDir.toLowerCase().includes(valueLC)) {
                    score += 40;
                }
                // 5. Path contains the search term
                if (filePath.includes(valueLC)) {
                    score += 20;
                    
                    // Bonus points for each segment of the path that matches
                    const pathSegments = filePath.split(path.sep);
                    for (const segment of pathSegments) {
                        if (segment.includes(valueLC)) {
                            score += 5;
                        }
                    }
                    
                    // Adjust score by how close the match is to the search term
                    // Closer matches = higher scores
                    const indexInPath = filePath.indexOf(valueLC);
                    const pathLength = filePath.length;
                    // Files with matches closer to the end of the path (filename/dirname) get a boost
                    score += Math.round(10 * (indexInPath / pathLength));
                }
                
                return { file, score };
            })
            // Sort by score (descending)
            .sort((a, b) => b.score - a.score);
            
        // Convert to quick pick items
        const filenameResults = scoredMatches.map(({ file }) => {
            const relativePath = vscode.workspace.asRelativePath(file.fsPath);
            const fileIcon = getFileIcon(file.fsPath);
            
            return {
                label: `${fileIcon} ${path.basename(file.fsPath)}`,
                description: getFileLocation(relativePath),
                data: {
                    filePath: file.fsPath,
                    linePos: 0,
                    colPos: 0,
                    searchText: value,
                    type: 'file' as 'file' | 'content'
                }
            };
        });
        
        // Only attempt content search for 3+ characters
        const contentResults: SearchQuickPickItem[] = [];
        
        // Skip file content search for short queries
        if (value.length >= 3) {
            // Use the top files from filename search as the source for content search
            const textFilesToSearch = scoredMatches
                .slice(0, 20) // Limit to 20 files for performance
                .map(({ file }) => file);
            
            await searchInFileContents(textFilesToSearch, value, contentResults);
        }
        
        // Combine and display results
        quickPick.items = [...filenameResults, ...contentResults];
    }
    
    /**
     * Handles search for the most recently used editors mode
     */
    private async handleRecentEditorsSearch(quickPick: vscode.QuickPick<SearchQuickPickItem>, value: string): Promise<void> {
        // Get the currently active editor URI to exclude it
        const activeEditor = vscode.window.activeTextEditor;
        const activeEditorUri = activeEditor?.document.uri.fsPath;
        
        // Filter editor history based on filename or path
        const filteredHistory = this.editorHistoryManager.getHistory().filter(item => {
            if (item.uri.scheme !== 'file' || (activeEditorUri && item.uri.fsPath === activeEditorUri)) {
                return false;
            }
            
            const fileName = path.basename(item.uri.fsPath).toLowerCase();
            const filePath = vscode.workspace.asRelativePath(item.uri.fsPath).toLowerCase();
            return fileName.includes(value.toLowerCase()) || filePath.includes(value.toLowerCase());
        });
        
        // Convert to quick pick items
        const historyItems = filteredHistory.map(item => {
            const relativePath = vscode.workspace.asRelativePath(item.uri.fsPath);
            const fileIcon = getFileIcon(item.uri.fsPath);
            
            return {
                label: `${fileIcon} ${path.basename(item.uri.fsPath)}`,
                description: getFileLocation(relativePath),
                detail: 'recently used',
                data: {
                    filePath: item.uri.fsPath,
                    linePos: item.linePos || 0,
                    colPos: item.colPos || 0,
                    searchText: value,
                    type: 'file' as 'file' | 'content'
                }
            };
        });
        
        // Set the quick pick items
        quickPick.items = historyItems;
    }
    
    /**
     * Loads the initial list of files for standard quick open
     */
    private async loadInitialFilesList(quickPick: vscode.QuickPick<SearchQuickPickItem>): Promise<void> {
        // Show loading indicator
        quickPick.busy = true;
        
        try {
            // First try to get all workspace files (limited to 200 for a broader selection)
            const allFiles = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 200);
            
            // Get currently open text editors to prioritize them
            const openEditors = vscode.window.visibleTextEditors.map(editor => editor.document.uri);
            
            // Create a Map to track which files are already added
            const addedFiles = new Map<string, boolean>();
            const results: SearchQuickPickItem[] = [];
            
            // First add currently open files at the top
            for (const uri of openEditors) {
                if (uri.scheme === 'file' && !addedFiles.has(uri.fsPath)) {
                    addedFiles.set(uri.fsPath, true);
                    const relativePath = vscode.workspace.asRelativePath(uri.fsPath);
                    const fileIcon = getFileIcon(uri.fsPath);
                    
                    results.push({
                        label: `${fileIcon} ${path.basename(uri.fsPath)}`,
                        description: getFileLocation(relativePath),
                        detail: 'currently open',
                        data: {
                            filePath: uri.fsPath,
                            linePos: 0,
                            colPos: 0,
                            type: 'file' as 'file' | 'content'
                        }
                    });
                }
            }
            
            // Filter out binary files and prioritize common source code files
            const filteredFiles = allFiles
                .filter(file => !addedFiles.has(file.fsPath) && !isBinaryFile(file.fsPath))
                .sort((a, b) => {
                    // Helper function to get a priority score for file types
                    const getPriority = (filePath: string): number => {
                        const ext = path.extname(filePath).toLowerCase();
                        // Prioritize common source code files
                        switch (ext) {
                            case '.ts':
                            case '.tsx':
                            case '.js':
                            case '.jsx':
                            case '.py':
                            case '.go':
                            case '.java':
                            case '.c':
                            case '.cpp':
                            case '.cs':
                            case '.rb':
                            case '.php':
                                return 1;
                            case '.json':
                            case '.yaml':
                            case '.yml':
                            case '.toml':
                            case '.md':
                            case '.css':
                            case '.scss':
                            case '.html':
                            case '.xml':
                                return 2;
                            default:
                                // For other text files
                                return 3;
                        }
                    };
                    
                    // Sort by priority
                    const priorityA = getPriority(a.fsPath);
                    const priorityB = getPriority(b.fsPath);
                    
                    if (priorityA !== priorityB) {
                        return priorityA - priorityB;
                    }
                    
                    // If same priority, sort alphabetically
                    return path.basename(a.fsPath).localeCompare(path.basename(b.fsPath));
                })
                .slice(0, 50); // Limit to 50 files
            
            // Add the filtered and prioritized files
            for (const uri of filteredFiles) {
                addedFiles.set(uri.fsPath, true);
                const relativePath = vscode.workspace.asRelativePath(uri.fsPath);
                const fileIcon = getFileIcon(uri.fsPath);
                
                results.push({
                    label: `${fileIcon} ${path.basename(uri.fsPath)}`,
                    description: getFileLocation(relativePath),
                    data: {
                        filePath: uri.fsPath,
                        linePos: 0,
                        colPos: 0,
                        type: 'file' as 'file' | 'content'
                    }
                });
            }
            
            // Update quickpick items
            quickPick.items = results;
        } catch (error) {
            console.error('Error loading initial files:', error);
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
                        const fileIcon = getFileIcon(historyItem.uri.fsPath);
                        
                        // Find whether this file is currently open
                        const isCurrentlyOpen = vscode.window.visibleTextEditors.some(
                            editor => editor.document.uri.fsPath === historyItem.uri.fsPath
                        );
                        
                        results.push({
                            label: `${fileIcon} ${path.basename(historyItem.uri.fsPath)}`,
                            description: getFileLocation(relativePath),
                            detail: isCurrentlyOpen ? 'currently open' : 'recently used',
                            data: {
                                filePath: historyItem.uri.fsPath,
                                linePos: historyItem.linePos || 0,
                                colPos: historyItem.colPos || 0,
                                type: 'file' as 'file' | 'content'
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