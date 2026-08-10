/**
 * Glob matching for the exclude settings.
 *
 * Deliberately not a full glob implementation: it covers the `**`, `*` and `?`
 * patterns the settings actually use, and compiles the two most common shapes
 * to plain string comparisons because they dominate the search hot path.
 *
 * No vscode import here on purpose - it keeps this module unit-testable on its
 * own, which matters because it decides which files you can find.
 */

/** Tests one workspace-relative path against one exclude pattern. */
export type PathMatcher = (relativePath: string) => boolean;

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalise a user-authored pattern.
 *
 * A pattern with no separator is treated as though it began with a globstar,
 * the way .gitignore does: `*.log` means "any .log file", not "a .log file in
 * the workspace root". Anchoring would otherwise silently narrow every such
 * pattern to the root.
 */
function normalizeGlob(glob: string): string {
    const slashed = normalizePath(glob);
    return slashed.includes('/') ? slashed : `**/${slashed}`;
}

/**
 * Translate a glob to an anchored regular expression.
 *
 * Both anchors matter. Without `^` the engine restarts the match at every
 * offset in the path and backtracks across it, which is where the old
 * implementation spent 98% of the search budget. Without `$` a pattern like
 * `**` + `/*.log` also matches `app.log.txt`, silently hiding real files.
 *
 * `**\/` becomes an optional group rather than `.*` followed by a literal
 * separator, so it matches zero directories as well as many - otherwise
 * `bundle.min.js` in the workspace root would not match `**\/*.min.js`.
 */
function globToRegExp(pattern: string): RegExp {
    const source = escapeRegex(pattern)
        .replace(/\\\*\\\*\//g, '(?:.*/)?')   // **/  -> zero or more directories
        .replace(/\\\*\\\*/g, '.*')           // **   -> anything
        .replace(/\\\*/g, '[^/]*')            // *    -> anything within a segment
        .replace(/\\\?/g, '[^/]');            // ?    -> one character in a segment

    return new RegExp(`^${source}$`);
}

/**
 * Compile one exclude pattern into a matcher.
 *
 * @param useFastPaths Compile the common shapes to string comparisons. Only
 *   tests pass false, to prove the fast paths agree with the regular form.
 */
export function compileGlob(glob: string, useFastPaths = true): PathMatcher {
    const pattern = normalizeGlob(glob);

    if (useFastPaths) {
        // `**/*.min.js` - every default pattern takes this shape, and it is a
        // plain suffix test rather than a regular expression.
        const suffix = /^\*\*\/\*(\.[^*/?]+)$/.exec(pattern);
        if (suffix) {
            const extension = suffix[1];
            return path => path.endsWith(extension);
        }

        // `**/package-lock.json` - an exact filename anywhere in the tree.
        const filename = /^\*\*\/([^*/?]+)$/.exec(pattern);
        if (filename) {
            const name = filename[1];
            const tail = `/${name}`;
            return path => path === name || path.endsWith(tail);
        }
    }

    const regex = globToRegExp(pattern);
    return path => regex.test(path);
}

/**
 * Compile a directory name into a matcher for "anything beneath this directory".
 *
 * The `(^|/)` alternation is load-bearing: paths are workspace-relative, so a
 * top-level `node_modules/lodash.js` has no leading separator to match against.
 */
export function compileDirectoryExclude(directory: string): PathMatcher {
    const regex = new RegExp(`(^|/)${escapeRegex(directory)}/`);
    return path => regex.test(path);
}

/**
 * Matchers expect '/' separators; Windows paths arrive with '\'.
 */
export function normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
}
