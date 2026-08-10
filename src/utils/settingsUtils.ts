import * as vscode from 'vscode';
import { PathMatcher, compileDirectoryExclude, compileGlob, normalizePath } from './glob';

const CONFIG_SECTION = 'searchPreview.search';

const DEFAULT_EXCLUDE_DIRECTORIES = ['node_modules', '.git', 'venv', 'env', 'dist', 'build'];
const DEFAULT_EXCLUDE_PATTERNS = ['**/*.min.js', '**/*.log', '**/*.lock', '**/package-lock.json'];
const DEFAULT_MAX_RESULTS = 100;

/**
 * Compiled exclude matchers, rebuilt lazily and dropped whenever the settings
 * change. Compiling is cheap; running these is not, which is why the matchers
 * come from `glob.ts` rather than a regex built here.
 */
let excludeMatchers: PathMatcher[] | undefined;

function getExcludeMatchers(): PathMatcher[] {
    if (!excludeMatchers) {
        excludeMatchers = [
            ...SettingsManager.getExcludeDirectories().map(compileDirectoryExclude),
            ...SettingsManager.getExcludePatterns().map(glob => compileGlob(glob))
        ];
    }
    return excludeMatchers;
}

/**
 * Drop the compiled matchers whenever the user edits our settings, and let the
 * caller invalidate anything derived from them.
 *
 * Without this the matchers are built once per window and never rebuilt, so
 * changing an exclude list did nothing until the window was reloaded - which is
 * confusing given the extension ships an "Open Search Settings" command.
 */
export function registerSettingsInvalidation(
    context: vscode.ExtensionContext,
    onChange?: () => void
): void {
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(CONFIG_SECTION)) {
                excludeMatchers = undefined;
                onChange?.();
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
     * Whether a workspace-relative path is excluded by the user's settings.
     *
     * Takes a relative path, not an absolute one: exclude globs are written
     * relative (`**` + `/*.min.js`), and this has to agree with the pattern
     * handed to findFiles by `getGlobExcludePattern`.
     */
    public static shouldExclude(relativePath: string): boolean {
        const normalized = normalizePath(relativePath);
        return getExcludeMatchers().some(match => match(normalized));
    }
}
