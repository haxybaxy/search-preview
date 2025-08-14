import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { SettingsManager } from './settingsUtils';
import * as fuzzysort from 'fuzzysort';

// Global process registry for better process management
let fdSpawnRegistry: Array<{
    process: any;
    id: string;
    timestamp: number;
    searchQuery?: string;
}> = [];
let fdAvailabilityChecked = false;
let fdIsAvailable = false;

// Search state management like ripgrep extension
interface SearchState {
    isSearching: boolean;
    currentSearchId: string | null;
    lastQuery: string;
}

let searchState: SearchState = {
    isSearching: false,
    currentSearchId: null,
    lastQuery: ''
};

// File list cache for telescope-style approach
interface FileCache {
    files: string[];
    lastUpdated: number;
    workspaceHash: string;
}

let fileCache: FileCache | null = null;

/**
 * Interface for fd JSON output (when supported)
 */
interface FdJsonResult {
    type: 'match';
    data: {
        path: {
            text: string;
        };
    };
}

/**
 * Try to parse fd JSON output, fallback to plain text
 */
function tryParseJsonLine(line: string): { path: string; isJson: boolean } {
    try {
        const parsed = JSON.parse(line) as FdJsonResult;
        if (parsed.type === 'match' && parsed.data?.path?.text) {
            return { path: parsed.data.path.text, isJson: true };
        }
    } catch {
        // Not JSON or invalid format, treat as plain text
    }
    return { path: line, isJson: false };
}

/**
 * Enhanced process cancellation with better cleanup and logging
 */
function cancelOngoingFdSearches() {
    if (fdSpawnRegistry.length === 0) {
        return;
    }
    
    console.log(`Cancelling ${fdSpawnRegistry.length} ongoing fd searches`);
    
    fdSpawnRegistry.forEach(({ process: proc, id }) => {
        try {
            if (!proc.killed) {
                // Properly destroy streams before killing process
                if (proc.stdout && !proc.stdout.destroyed) {
                    proc.stdout.destroy();
                }
                if (proc.stderr && !proc.stderr.destroyed) {
                    proc.stderr.destroy();
                }
                
                // Kill the process
                proc.kill('SIGTERM');
                
                // Force kill if still running after timeout
                setTimeout(() => {
                    if (!proc.killed) {
                        proc.kill('SIGKILL');
                    }
                }, 1000);
            }
        } catch (error) {
            console.error(`Error killing fd process ${id}:`, error);
        }
    });
    
    // Clear the registry
    fdSpawnRegistry = [];
}

async function ensureFdAvailable(): Promise<void> {
    if (fdAvailabilityChecked) {
        if (!fdIsAvailable) {
            throw new Error('fd executable not found in PATH. Please install fd (https://github.com/sharkdp/fd).');
        }
        return;
    }

    await new Promise<void>((resolve) => {
        try {
            const proc = spawn('fd', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
            proc.on('error', () => {
                fdAvailabilityChecked = true;
                fdIsAvailable = false;
                resolve();
            });
            proc.on('exit', (code: number) => {
                fdAvailabilityChecked = true;
                fdIsAvailable = code === 0;
                resolve();
            });
        } catch {
            fdAvailabilityChecked = true;
            fdIsAvailable = false;
            resolve();
        }
    });

    if (!fdIsAvailable) {
        throw new Error('fd executable not found in PATH. Please install fd (https://github.com/sharkdp/fd).');
    }
}

/**
 * Convert file URIs to SearchQuickPickItems
 */

/**
 * Legacy function - replaced by enhanced cancelOngoingFdSearches
 * @deprecated Use cancelOngoingFdSearches instead
 */
export function checkKillProcess(spawnRegistry: any[]) {
    // For backwards compatibility, delegate to the new function
    cancelOngoingFdSearches();
    return [];
}

/**
 * Perform an in-memory fuzzy search on the provided URIs using fuzzysort.
 * Replaces previous external fzf-based filtering.
 */
export async function fuzzySearchFiles(files: vscode.Uri[], searchText: string): Promise<{ uri: vscode.Uri }[]> {
    const trimmed = (searchText || '').trim();
    const filteredFiles = files.filter(file => !SettingsManager.shouldExcludeFile(file.fsPath));
    if (!trimmed) {
        return filteredFiles.map(uri => ({ uri }));
    }

    const pathToUriMap = new Map<string, vscode.Uri>();
    const filePaths = filteredFiles.map(file => {
        const rel = vscode.workspace.asRelativePath(file.fsPath);
        pathToUriMap.set(rel, file);
        return rel;
    });

    const results = fuzzysort.go(trimmed, filePaths, {
        limit: SettingsManager.getMaxResults() * 3,
        threshold: -Infinity
    });

    return results
        .map(r => r.target as string)
        .map(rel => ({ uri: pathToUriMap.get(rel)! }))
        .filter(item => !!item.uri);
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFuzzyRegexFromQuery(query: string): string {
    const trimmed = query.trim();
    if (!trimmed) { return ''; }
    const tokens = trimmed.split(/\s+/).map(token => escapeRegex(token));
    return tokens.join('.*');
}

/**
 * Generate a workspace hash for cache invalidation
 */
function generateWorkspaceHash(): string {
    const folders = vscode.workspace.workspaceFolders || [];
    return folders.map(f => f.uri.fsPath).sort().join('|');
}

/**
 * Get all files from workspace using fd (telescope-style approach)
 */
async function getAllFilesFromFd(): Promise<string[]> {
    const config = SettingsManager.getFdConfig();
    const workspaceHash = generateWorkspaceHash();
    
    // Check if we have a valid cache
    if (fileCache && 
        fileCache.workspaceHash === workspaceHash &&
        (Date.now() - fileCache.lastUpdated) < config.cacheTimeout) {
        console.log(`Using cached file list with ${fileCache.files.length} files (age: ${Date.now() - fileCache.lastUpdated}ms)`);
        return fileCache.files;
    }
    
    console.log('Fetching complete file list from fd...');
    const startTime = Date.now();
    
    // Optimized fd command for listing all files (no regex, no limits)
    const fdArgs = [
        '--color', 'never',
        '--type', 'f',
        '--absolute-path',
        '--hidden', // Include hidden files
        '--follow', // Follow symlinks
        ...config.fdOptions
    ];
    
    // Add exclusions
    config.excludeDirectories.forEach(dir => {
        fdArgs.push('--exclude', dir);
    });
    config.excludePatterns.forEach(pat => {
        fdArgs.push('--exclude', pat);
    });
    
    const allFiles: string[] = [];
    const processes: Promise<void>[] = [];
    
    // Run fd in each workspace folder
    for (const [index, folder] of (vscode.workspace.workspaceFolders || []).entries()) {
        const processPromise = new Promise<void>((resolve, reject) => {
            const processId = `fd_list_${Date.now()}_${index}`;
            const proc = spawn(config.fdPath, fdArgs, {
                cwd: folder.uri.fsPath,
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: config.timeout
            });
            
            fdSpawnRegistry.push({
                process: proc,
                id: processId,
                timestamp: Date.now(),
                searchQuery: 'file_list'
            });
            
            let stdout = '';
            proc.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });
            
            proc.stderr.on('data', (data: Buffer) => {
                console.error(`fd stderr: ${data.toString()}`);
            });
            
            proc.on('exit', (code) => {
                if (code === 0) {
                    const files = stdout.split('\n').filter(Boolean);
                    allFiles.push(...files);
                    console.log(`fd process ${processId} found ${files.length} files`);
                } else if (code !== 1) { // 1 = no results, which is fine
                    console.error(`fd process ${processId} exited with code ${code}`);
                }
                resolve();
            });
            
            proc.on('error', (error) => {
                console.error(`fd process ${processId} error:`, error);
                if (error.message.includes('ENOENT')) {
                    reject(new Error('fd executable not found in PATH'));
                } else {
                    resolve(); // Don't fail the whole operation
                }
            });
        });
        
        processes.push(processPromise);
    }
    
    await Promise.all(processes);
    
    // Clean up registry
    fdSpawnRegistry = fdSpawnRegistry.filter(({ process: proc }) => !proc.killed && proc.exitCode === null);
    
    // Filter out excluded files
    const filteredFiles = allFiles.filter(file => !SettingsManager.shouldExcludeFile(file));
    
    // Update cache
    fileCache = {
        files: filteredFiles,
        lastUpdated: Date.now(),
        workspaceHash
    };
    
    const duration = Date.now() - startTime;
    console.log(`File list fetched in ${duration}ms: ${filteredFiles.length} files total`);
    
    return filteredFiles;
}

/**
 * Telescope-style fuzzy search: get all files, then rank in-memory
 */
export async function searchWorkspaceWithFd(searchText: string): Promise<{ uri: vscode.Uri }[]> {
    const startTime = Date.now();
    const query = (searchText || '').trim();
    
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        return [];
    }

    // Cancel any ongoing file list fetches
    if (searchState.isSearching) {
        console.log('Cancelling ongoing file list fetch...');
        cancelOngoingFdSearches();
    }
    
    // Update search state
    searchState.isSearching = true;
    searchState.currentSearchId = `search_${Date.now()}`;
    searchState.lastQuery = query;

    try {
        // Require fd; do not fallback
        await ensureFdAvailable();

        // Get complete file list (cached if available)
        const allFiles = await getAllFilesFromFd();
        
        // Convert to relative paths for better fuzzy matching
        const pathToUriMap = new Map<string, vscode.Uri>();
        const relativePaths: string[] = allFiles.map(absPath => {
            let rel = absPath;
            for (const folder of vscode.workspace.workspaceFolders!) {
                const root = folder.uri.fsPath;
                if (absPath.startsWith(root + '/') || absPath.startsWith(root + '\\')) {
                    rel = absPath.slice(root.length + 1);
                    break;
                }
            }
            const uri = vscode.Uri.file(absPath);
            pathToUriMap.set(rel, uri);
            return rel;
        });

        // Reset search state
        searchState.isSearching = false;
        searchState.currentSearchId = null;

        // If no query, return first N files (like telescope)
        if (!query) {
            const config = SettingsManager.getFdConfig();
            const maxResults = Math.min(config.maxResults, relativePaths.length);
            return relativePaths.slice(0, maxResults).map(rel => ({ uri: pathToUriMap.get(rel)! }));
        }

        // Telescope-style fuzzy ranking with fuzzysort
        const fuzzyStartTime = Date.now();
        const ranked = fuzzysort.go(query, relativePaths, {
            limit: SettingsManager.getFdConfig().maxResults,
            threshold: -10000, // More lenient threshold for better nested directory matching
        });
        
        const fuzzyTime = Date.now() - fuzzyStartTime;
        const totalTime = Date.now() - startTime;
        
        const finalResults = ranked
            .map(r => r.target as string)
            .map(rel => ({ uri: pathToUriMap.get(rel)! }))
            .filter(item => !!item.uri);
            
        console.log(`Telescope-style search completed in ${totalTime}ms (fuzzy: ${fuzzyTime}ms) for "${query}": ${allFiles.length} total files → ${finalResults.length} results`);
        return finalResults;
        
    } catch (error) {
        // Reset search state on error
        searchState.isSearching = false;
        searchState.currentSearchId = null;
        
        // Enhanced error reporting
        console.error(`Telescope-style search failed for query "${query}":`, error);
        
        if (error instanceof Error) {
            if (error.message.includes('ENOENT') || error.message.includes('not found')) {
                throw new Error('fd executable not found in PATH. Please install fd: https://github.com/sharkdp/fd');
            }
        }
        
        throw error;
    }
}

/**
 * Cancel all ongoing fd searches - exposed for external control
 */
export function cancelFdSearches(): void {
    cancelOngoingFdSearches();
}

/**
 * Check if a search is currently in progress
 */
export function isSearchInProgress(): boolean {
    return searchState.isSearching;
}

/**
 * Get the current search state for debugging
 */
export function getSearchState(): Readonly<SearchState> {
    return { ...searchState };
}

/**
 * Get active process count for monitoring
 */
export function getActiveProcessCount(): number {
    return fdSpawnRegistry.length;
}

/**
 * Invalidate the file cache (useful when files are created/deleted)
 */
export function invalidateFileCache(): void {
    fileCache = null;
    console.log('File cache invalidated');
}

/**
 * Get cache statistics for debugging
 */
export function getCacheStats(): { cached: boolean; fileCount: number; age: number } {
    if (!fileCache) {
        return { cached: false, fileCount: 0, age: 0 };
    }
    
    return {
        cached: true,
        fileCount: fileCache.files.length,
        age: Date.now() - fileCache.lastUpdated
    };
}
