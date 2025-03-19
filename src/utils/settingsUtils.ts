import * as vscode from 'vscode';

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
     * Check if content search is enabled
     */
    public static isContentSearchEnabled(): boolean {
        return vscode.workspace
            .getConfiguration('searchPreview.search')
            .get<boolean>('contentSearchEnabled', true);
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
        const excludeDirectories = this.getExcludeDirectories();
        
        // Check if file is in an excluded directory
        for (const dir of excludeDirectories) {
            if (normalizedPath.includes(`/${dir}/`)) {
                return true;
            }
        }
        
        // Check if file matches an excluded pattern
        // Note: This is a simplified version and won't handle all glob patterns
        // For more complete glob matching, consider using a library like 'minimatch'
        const excludePatterns = this.getExcludePatterns()
            .map(pattern => pattern.replace(/\*\*/g, ''))
            .map(pattern => pattern.replace(/\*/g, ''));
        
        for (const pattern of excludePatterns) {
            if (pattern && normalizedPath.includes(pattern)) {
                return true;
            }
        }
        
        return false;
    }
} 