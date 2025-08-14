import * as vscode from 'vscode';

/**
 * Utility to escape regex metacharacters in a string.
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert a simple glob pattern (limited ** and *) to a RegExp.
 * This is NOT a full glob implementation but covers the common cases we use
 * in the default config and keeps it fast.
 */
function globToRegExp(glob: string): RegExp {
    // Normalise path separators so we only handle '/'
    const normalised = glob.replace(/\\/g, '/');

    // First escape all regex metacharacters
    let regexStr = escapeRegex(normalised);

    // Replace escaped glob tokens with regex equivalents
    regexStr = regexStr
        .replace(/\\\*\\\*/g, '.*')     // **  -> .*
        .replace(/\\\*/g, '[^/]*');        // *   -> any chars except '/'

    return new RegExp(regexStr);
}

// ----------------------------------------------------------------------------------
// Cached, pre-compiled exclude matchers
// ----------------------------------------------------------------------------------

let compiledDirRegexes: RegExp[] | null = null;
let compiledPatternRegexes: RegExp[] | null = null;

function buildExcludeRegexCaches() {
    // Compile directory matchers: we just look for '/<dir>/' anywhere in the path
    compiledDirRegexes = SettingsManager.getExcludeDirectories().map(dir => {
        const escaped = escapeRegex(dir);
        return new RegExp(`/${escaped}/`);
    });

    // Compile file pattern matchers
    compiledPatternRegexes = SettingsManager.getExcludePatterns().map(glob => globToRegExp(glob));
}

/**
 * Configuration interface for fd search parameters
 */
export interface FdConfig {
    fdPath: string;
    fdOptions: string[];
    excludeDirectories: string[];
    excludePatterns: string[];
    maxResults: number;
    timeout: number;
    enableJsonOutput: boolean;
    cacheTimeout: number;
    enableFileWatcher: boolean;
}

/**
 * Helper class to read extension settings with dynamic configuration support
 */
export class SettingsManager {
    private static cachedConfig: FdConfig | null = null;
    private static lastConfigUpdate = 0;
    private static readonly CONFIG_CACHE_TTL = 5000; // 5 seconds
    
    /**
     * Get the current fd configuration with caching for performance
     */
    public static getFdConfig(): FdConfig {
        const now = Date.now();
        
        // Return cached config if still valid
        if (this.cachedConfig && (now - this.lastConfigUpdate) < this.CONFIG_CACHE_TTL) {
            return this.cachedConfig;
        }
        
        // Rebuild config
        const config = vscode.workspace.getConfiguration('searchPreview.search');
        
        this.cachedConfig = {
            fdPath: this.getFdPath(),
            fdOptions: config.get<string[]>('fdOptions', []),
            excludeDirectories: this.getExcludeDirectories(),
            excludePatterns: this.getExcludePatterns(),
            maxResults: this.getMaxResults(),
            timeout: config.get<number>('timeout', 30000),
            enableJsonOutput: config.get<boolean>('enableJsonOutput', false),
            cacheTimeout: config.get<number>('cacheTimeout', 30000),
            enableFileWatcher: config.get<boolean>('enableFileWatcher', true)
        };
        
        this.lastConfigUpdate = now;
        return this.cachedConfig;
    }
    
    /**
     * Clear configuration cache to force reload
     */
    public static clearConfigCache(): void {
        this.cachedConfig = null;
        this.lastConfigUpdate = 0;
    }
    
    /**
     * Get the fd executable path
     */
    public static getFdPath(): string {
        return vscode.workspace
            .getConfiguration('searchPreview.search')
            .get<string>('fdPath', 'fd');
    }
    /**
     * Get directories to exclude from search
     */
    public static getExcludeDirectories(): string[] {
        return vscode.workspace
            .getConfiguration('searchPreview.search')
            .get<string[]>('excludeDirectories', [
                'node_modules', '.git', 'venv', 'env', 'dist', 'build'
            ]);
    }
    
    /**
     * Get file patterns to exclude from search
     */
    public static getExcludePatterns(): string[] {
        return vscode.workspace
            .getConfiguration('searchPreview.search')
            .get<string[]>('excludePatterns', [
                '**/*.min.js', '**/*.log', '**/*.lock', '**/package-lock.json'
            ]);
    }
    
    /**
     * Get maximum number of search results to display
     */
    public static getMaxResults(): number {
        return vscode.workspace
            .getConfiguration('searchPreview.search')
            .get<number>('maxResults', 100);
    }
    
    
    /**
     * Generate a glob pattern for excluded files to use with workspace.findFiles
     */
    public static getGlobExcludePattern(): string {
        const excludeDirectories = this.getExcludeDirectories();
        const excludePatterns = this.getExcludePatterns();
        
        // Combine all directory exclusions with OR
        const dirExclusions = excludeDirectories
            .map(dir => `**/${dir}/**`)
            .join(',');
            
        // Combine all pattern exclusions with OR  
        const patternExclusions = excludePatterns.join(',');
        
        // Combine both types of exclusions with OR
        return [dirExclusions, patternExclusions].filter(Boolean).join(',');
    }
    
    /**
     * Check if a file path should be excluded based on settings
     */
    public static shouldExcludeFile(filePath: string): boolean {
        const normalizedPath = filePath.replace(/\\/g, '/');
        // Lazily build caches on first use
        if (!compiledDirRegexes || !compiledPatternRegexes) {
            buildExcludeRegexCaches();
        }

        // Directory based exclusions
        for (const dirRegex of compiledDirRegexes!) {
            if (dirRegex.test(normalizedPath)) {
                return true;
            }
        }

        // Glob/pattern based exclusions
        for (const patRegex of compiledPatternRegexes!) {
            if (patRegex.test(normalizedPath)) {
                return true;
            }
        }

        return false;
    }
} 