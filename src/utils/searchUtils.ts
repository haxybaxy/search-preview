import * as vscode from 'vscode';
import * as path from 'path';
import * as fuzzysort from 'fuzzysort';
import { SearchQuickPickItem } from '../types';
import { getFileIcon, getFileLocation, isBinaryFile } from './fileUtils';
import { SettingsManager } from './settingsUtils';

/**
 * Convert file URIs to SearchQuickPickItems
 */
export function createFileSearchItems(files: vscode.Uri[], searchText?: string): SearchQuickPickItem[] {
    return files.map(file => {
        const relativePath = vscode.workspace.asRelativePath(file.fsPath);
        const fileIcon = getFileIcon(file.fsPath);
        
        return {
            label: `${fileIcon} ${path.basename(file.fsPath)}`,
            description: getFileLocation(relativePath),
            data: {
                filePath: file.fsPath,
                linePos: 0,
                colPos: 0,
                searchText: searchText,
                type: 'file'
            }
        };
    });
}

// Helper function to check path components regardless of slash type
const pathContains = (path: string, segment: string): boolean => {
    // Normalize path for cross-platform comparison
    const normalizedPath = path.replace(/\\/g, '/');
    return normalizedPath.includes(segment);
};

// Detect if path is likely a system/library path
const isLikelyLibraryPath = (path: string): boolean => {
    const normalizedPath = path.replace(/\\/g, '/');
    
    // Check for common library path patterns
    if (normalizedPath.match(/\/python\d+\.\d+\//)) { return true; }
    if (normalizedPath.match(/\/site-packages\//)) { return true; }
    
    // Common library directories
    const libraryDirs = [
        '/lib/', '/libs/', '/vendor/', '/node_modules/', 
        '/dist/', '/build/', '/venv/', '/env/',
        '/usr/lib/', '/usr/local/', '/usr/share/',
        '/Library/Python/'
    ];
    
    return libraryDirs.some(dir => normalizedPath.includes(dir));
};

/**
 * Perform a fuzzy search on file paths
 * @param files Array of file URIs to search
 * @param searchText Search query
 * @returns Sorted array of file URIs with their scores
 */
export function fuzzySearchFiles(files: vscode.Uri[], searchText: string): { uri: vscode.Uri; score: number }[] {
    // Prepare data for fuzzy search
    const searchData = files.map(file => ({
        uri: file,
        path: vscode.workspace.asRelativePath(file.fsPath),
        basename: path.basename(file.fsPath)
    }));
    
    // Perform fuzzy search on file basenames
    const basenameResults = fuzzysort.go(searchText, searchData, { 
        key: 'basename',
        threshold: -5000 // More restrictive threshold
    });
    
    // Perform fuzzy search on file paths
    const pathResults = fuzzysort.go(searchText, searchData, { 
        key: 'path',
        threshold: -5000 // More restrictive threshold
    });
    
    // Combine and deduplicate results
    const combinedResults = new Map<string, { uri: vscode.Uri; score: number }>();
    
    // Process results and adjust scores based on path
    const processResults = (results: typeof basenameResults, isBasename: boolean) => {
        if (results && Array.isArray(results)) {
            results.forEach(result => {
                const fsPath = result.obj.uri.fsPath;
                const relativePath = result.obj.path;
                const filename = result.obj.basename;
                let score = result.score;
                
                // Apply contextual scoring adjustments
                
                // Check if file should be excluded based on settings
                if (SettingsManager.shouldExcludeFile(fsPath)) {
                    score *= 0.1; // 90% penalty for files that match exclusion patterns
                }
                
                // Heavily penalize library/vendored paths
                if (isLikelyLibraryPath(relativePath)) {
                    score *= 0.2; // 80% penalty for library paths
                }
                
                // Penalize specific libraries/patterns even more
                if (pathContains(relativePath, '/isort/') || 
                    pathContains(relativePath, '/pylint/') || 
                    pathContains(relativePath, '/autopep8/') || 
                    pathContains(relativePath, '/black/') ||
                    pathContains(relativePath, '/flake8/') ||
                    pathContains(relativePath, '/mypy/')) {
                    score *= 0.1; // 90% additional penalty for specific libraries
                }
                
                // Penalty for common utility filenames that often appear in libraries
                const commonUtilityNames = ['__init__', 'utils', 'helpers', 'common', 'core', 'base', 'config'];
                if (commonUtilityNames.some(name => filename.includes(name))) {
                    // Don't penalize project utility files (close to root)
                    const pathDepth = relativePath.split(/[\/\\]/).filter(Boolean).length;
                    if (pathDepth > 3 || isLikelyLibraryPath(relativePath)) {
                        score *= 0.7; // 30% penalty for utility files in libraries
                    }
                }
                
                // Boost files closer to the workspace root based on path depth
                // Handle both slash types for cross-platform compatibility
                const pathDepth = relativePath.split(/[\/\\]/).filter(Boolean).length;
                if (pathDepth <= 2) {
                    score *= 1.5; // 50% boost for root-level files
                } else if (pathDepth <= 3) {
                    score *= 1.3; // 30% boost for files 1 level deep
                } else if (pathDepth >= 6) {
                    score *= 0.7; // 30% penalty for deeply nested files
                }
                
                // Boost for basename matches vs path matches
                if (isBasename) {
                    score *= 2; // Double the score for basename matches
                }
                
                // Add or update the result in our map
                const existing = combinedResults.get(fsPath);
                if (!existing || score > existing.score) {
                    combinedResults.set(fsPath, {
                        uri: result.obj.uri,
                        score: score
                    });
                }
            });
        }
    };
    
    // Process both result sets
    processResults(basenameResults, true);
    processResults(pathResults, false);
    
    // Convert to array and sort by score (descending)
    return Array.from(combinedResults.values())
        .sort((a, b) => b.score - a.score);
}

/**
 * Search for text within file contents and create QuickPickItems for matches
 */
export async function searchInFileContents(
    files: vscode.Uri[], 
    searchText: string, 
    contentResults: SearchQuickPickItem[]
): Promise<void> {
    const maxContentMatches = SettingsManager.getMaxResults() / 2; // Use half of max results for content
    
    for (const file of files) {
        try {
            // Skip binary files and excluded files
            if (isBinaryFile(file.fsPath) || SettingsManager.shouldExcludeFile(file.fsPath)) {
                continue;
            }

            const document = await vscode.workspace.openTextDocument(file);
            const text = document.getText();
            const lines = text.split('\n');
            
            // Use fuzzy search for line content
            const lineResults = fuzzysort.go(searchText, lines, {
                threshold: -10000, // Lower threshold to include more results
                limit: 5 // Limit matches per file
            });
            
            // Create items for matches
            lineResults.forEach(result => {
                const lineIndex = lines.indexOf(result.target);
                const line = result.target;
                const fileIcon = getFileIcon(file.fsPath);
                
                contentResults.push({
                    label: `${fileIcon} ${path.basename(file.fsPath)}:${lineIndex + 1}`,
                    description: getFileLocation(vscode.workspace.asRelativePath(file.fsPath)),
                    detail: line.length > 50 ? `...${line.substring(0, 50)}...` : line,
                    data: {
                        filePath: file.fsPath,
                        linePos: lineIndex,
                        colPos: 0, // We don't know exact match position in fuzzy search
                        searchText: searchText,
                        type: 'content',
                        lineText: line
                    }
                });
            });
        } catch (error) {
            // Skip files that can't be read
            continue;
        }
        
        // Limit the total number of results based on settings
        if (contentResults.length >= maxContentMatches) {
            break;
        }
    }
} 