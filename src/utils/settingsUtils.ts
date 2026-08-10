import * as vscode from 'vscode';

const CONFIG_SECTION = 'searchPreview.search';

const DEFAULT_EXCLUDE_DIRECTORIES = ['node_modules', '.git', 'venv', 'env', 'dist', 'build'];
const DEFAULT_EXCLUDE_PATTERNS = ['**/*.min.js', '**/*.log', '**/*.lock', '**/package-lock.json'];
const DEFAULT_MAX_RESULTS = 100;

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
        .replace(/\\\*/g, '[^/]*');     // *   -> any chars except '/'

    return new RegExp(regexStr);
}

interface ExcludeMatchers {
    directories: RegExp[];
    patterns: RegExp[];
}

/**
 * Compiled exclude matchers, rebuilt lazily. Invalidated by
 * `registerSettingsInvalidation` so edited settings take effect immediately.
 */
let excludeMatchers: ExcludeMatchers | undefined;

function getExcludeMatchers(): ExcludeMatchers {
    if (!excludeMatchers) {
        excludeMatchers = {
            // Directory matchers just look for '/<dir>/' anywhere in the path.
            directories: SettingsManager.getExcludeDirectories()
                .map(dir => new RegExp(`/${escapeRegex(dir)}/`)),
            patterns: SettingsManager.getExcludePatterns().map(globToRegExp)
        };
    }
    return excludeMatchers;
}

/**
 * Drop the compiled matchers whenever the user edits our settings.
 *
 * Without this the caches are built once per window and never rebuilt, so
 * changing an exclude list did nothing until the window was reloaded - which
 * is confusing given the extension ships an "Open Search Settings" command.
 */
export function registerSettingsInvalidation(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(CONFIG_SECTION)) {
                excludeMatchers = undefined;
            }
        })
    );
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
            .getConfiguration(CONFIG_SECTION)
            .get<string[]>('excludeDirectories', DEFAULT_EXCLUDE_DIRECTORIES);
    }

    /**
     * Get file patterns to exclude from search
     */
    public static getExcludePatterns(): string[] {
        return vscode.workspace
            .getConfiguration(CONFIG_SECTION)
            .get<string[]>('excludePatterns', DEFAULT_EXCLUDE_PATTERNS);
    }

    /**
     * Get maximum number of search results to display
     */
    public static getMaxResults(): number {
        return vscode.workspace
            .getConfiguration(CONFIG_SECTION)
            .get<number>('maxResults', DEFAULT_MAX_RESULTS);
    }

    /**
     * Build the exclude glob for `workspace.findFiles`.
     *
     * findFiles takes a single pattern, so multiple exclusions have to be
     * combined with brace syntax - `{a,b}`. A bare comma-joined list is matched
     * literally and therefore excludes nothing, which previously left the whole
     * workspace (node_modules included) to be filtered in-process.
     *
     * Braces need at least two alternatives: `{a}` is not expanded, so a single
     * exclusion is returned on its own.
     */
    public static getGlobExcludePattern(): string | undefined {
        const parts = [
            ...this.getExcludeDirectories().map(dir => `**/${dir}/**`),
            ...this.getExcludePatterns()
        ].filter(Boolean);

        if (parts.length === 0) {
            return undefined;
        }
        return parts.length === 1 ? parts[0] : `{${parts.join(',')}}`;
    }

    /**
     * Check if a file path should be excluded based on settings
     */
    public static shouldExcludeFile(filePath: string): boolean {
        const normalizedPath = filePath.replace(/\\/g, '/');
        const { directories, patterns } = getExcludeMatchers();

        return directories.some(regex => regex.test(normalizedPath))
            || patterns.some(regex => regex.test(normalizedPath));
    }
}
