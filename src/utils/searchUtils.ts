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
        // Pre-filter files to exclude unwanted paths
        const filteredFiles = files.filter(file => !SettingsManager.shouldExcludeFile(file.fsPath));
        
        // Create list of file paths for fzf
        const filePaths = filteredFiles.map(file => vscode.workspace.asRelativePath(file.fsPath));
        
        // Map from file path to URI for later lookup
        const pathToUriMap = new Map<string, vscode.Uri>();
        filteredFiles.forEach(file => {
            pathToUriMap.set(vscode.workspace.asRelativePath(file.fsPath), file);
        });
        
        // Create input for fzf
        const fzfInput = filePaths.join('\n');
        
        // Prepare the fzf command with better options
        const fzfCmd = `echo "${fzfInput}" | fzf --filter "${searchText}"`;
        
        const spawnRegistry: any[] = [];
        const spawnProcess = spawn(fzfCmd, [], { shell: true });
        spawnRegistry.push(spawnProcess);
        
        const searchResults: { uri: vscode.Uri; score: number }[] = [];
        
        spawnProcess.stdout.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n').filter(Boolean);
            
            // Each line is a match, and fzf already sorts by best match first
            lines.forEach((line, index) => {
                const uri = pathToUriMap.get(line);
                if (uri) {
                    // Use index as score - earlier results (lower index) get higher scores
                    // This preserves fzf's natural sorting
                    const score = 1000 - index;
                    
                    searchResults.push({
                        uri,
                        score
                    });
                }
            });
        });
        
        spawnProcess.stderr.on('data', (data: Buffer) => {
            console.error(`fzf error: ${data.toString()}`);
        });
        
        spawnProcess.on('exit', (code: number) => {
            if (code === 0 || code === 1) {
                // Return results - already sorted by fzf's ranking
                resolve(searchResults);
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