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
 * Helper class to read extension settings
 */
export class SettingsManager {
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