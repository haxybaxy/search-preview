import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { SearchQuickPickItem } from '../types';
import { getFileIcon, getFileLocation } from './fileUtils';
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

// Utility function to check if a process exists
export function checkKillProcess(spawnRegistry: any[]) {
    spawnRegistry.forEach((spawnProcess) => {
        spawnProcess.stdout.destroy();
        spawnProcess.stderr.destroy();
        spawnProcess.kill();
    });

    // check if spawn process is no longer running and if so remove from registry
    return spawnRegistry.filter((spawnProcess) => !spawnProcess.killed);
}

/**
 * Perform a fuzzy search on file paths using fzf
 * @param files Array of file URIs to search
 * @param searchText Search query
 * @returns Promise that resolves to sorted array of file URIs with their scores
 */
export async function fuzzySearchFiles(files: vscode.Uri[], searchText: string): Promise<{ uri: vscode.Uri; score: number }[]> {
    return new Promise((resolve, reject) => {
        // Create list of file paths for fzf
        const filePaths = files.map(file => vscode.workspace.asRelativePath(file.fsPath));
        
        // Map from file path to URI for later lookup
        const pathToUriMap = new Map<string, vscode.Uri>();
        files.forEach(file => {
            pathToUriMap.set(vscode.workspace.asRelativePath(file.fsPath), file);
        });
        
        // Create a temporary file with all paths (could also use stdin)
        const fzfInput = filePaths.join('\n');
        
        // Prepare the fzf command
        const fzfCmd = `echo "${fzfInput}" | fzf --filter "${searchText}" --no-sort`;
        
        const spawnRegistry: any[] = [];
        const spawnProcess = spawn(fzfCmd, [], { shell: true });
        spawnRegistry.push(spawnProcess);
        
        const searchResults: { uri: vscode.Uri; score: number; path: string }[] = [];
        
        spawnProcess.stdout.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n').filter(Boolean);
            
            // Each line is a match
            lines.forEach((line, index) => {
                const uri = pathToUriMap.get(line);
                if (uri) {
                    // Higher index = lower score (fzf returns best matches first)
                    // Adjust scores based on file paths
                    let score = 1000 - index;
                    
                    // Apply the same contextual scoring adjustments as before
                    if (SettingsManager.shouldExcludeFile(uri.fsPath)) {
                        score *= 0.1; // 90% penalty for files that match exclusion patterns
                    }
                    
                    // Penalize library paths
                    if (isLikelyLibraryPath(line)) {
                        score *= 0.2; // 80% penalty for library paths
                    }
                    
                    // Penalize specific libraries
                    if (pathContains(line, '/isort/') || 
                        pathContains(line, '/pylint/') || 
                        pathContains(line, '/autopep8/') || 
                        pathContains(line, '/black/') ||
                        pathContains(line, '/flake8/') ||
                        pathContains(line, '/mypy/')) {
                        score *= 0.1; // 90% additional penalty for specific libraries
                    }
                    
                    // Adjust score based on path depth
                    const pathDepth = line.split(/[\/\\]/).filter(Boolean).length;
                    if (pathDepth <= 2) {
                        score *= 1.5; // 50% boost for root-level files
                    } else if (pathDepth <= 3) {
                        score *= 1.3; // 30% boost for files 1 level deep
                    } else if (pathDepth >= 6) {
                        score *= 0.7; // 30% penalty for deeply nested files
                    }
                    
                    searchResults.push({
                        uri,
                        score,
                        path: line
                    });
                }
            });
        });
        
        spawnProcess.stderr.on('data', (data: Buffer) => {
            console.error(`fzf error: ${data.toString()}`);
        });
        
        spawnProcess.on('exit', (code: number) => {
            if (code === 0 || code === 1) {
                // Sort by score (descending)
                resolve(searchResults.sort((a, b) => b.score - a.score));
            } else {
                reject(`fzf exited with code ${code}`);
            }
            
            // Clear the process registry
            checkKillProcess(spawnRegistry);
        });
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