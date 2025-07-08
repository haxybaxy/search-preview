import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { SettingsManager } from './settingsUtils';

/**
 * Convert file URIs to SearchQuickPickItems
 */

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
 * @returns Promise that resolves to array of file URIs
 */
export async function fuzzySearchFiles(files: vscode.Uri[], searchText: string): Promise<{ uri: vscode.Uri }[]> {
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
        
        // Create input for fzf (newline-separated list)
        const fzfInput = filePaths.join('\n');
        
        // Spawn fzf directly and pipe the file list through stdin. This avoids
        // expensive shell interpolation and command-line length limits.
        const spawnRegistry: any[] = [];
        const spawnProcess = spawn('fzf', ['--filter', searchText], {
            stdio: ['pipe', 'pipe', 'pipe']
        });
        // Feed the file list to fzf and close stdin.
        spawnProcess.stdin.write(fzfInput);
        spawnProcess.stdin.end();
        spawnRegistry.push(spawnProcess);
        
        const searchResults: { uri: vscode.Uri }[] = [];
        
        spawnProcess.stdout.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n').filter(Boolean);
            
            // Each line is a match, fzf already sorts by best match
            lines.forEach(line => {
                const uri = pathToUriMap.get(line);
                if (uri) {
                    searchResults.push({ uri });
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
