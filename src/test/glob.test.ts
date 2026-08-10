import * as assert from 'assert';
import { compileDirectoryExclude, compileGlob, normalizePath } from '../utils/glob';

const DEFAULT_PATTERNS = ['**/*.min.js', '**/*.log', '**/*.lock', '**/package-lock.json'];
const DEFAULT_DIRECTORIES = ['node_modules', '.git', 'venv', 'env', 'dist', 'build'];

suite('glob', () => {

    suite('anchoring', () => {
        // The old implementation compiled `**/*.log` to an unanchored
        // `.*\/[^/]*\.log`, which matched anywhere in the path. Both files
        // below were silently unfindable.
        const isLog = compileGlob('**/*.log');

        test('excludes a real .log file', () => {
            assert.strictEqual(isLog('src/app.log'), true);
        });

        test('keeps a file that merely contains .log in its name', () => {
            assert.strictEqual(isLog('src/app.logic.ts'), false);
        });

        test('keeps a file with .log in the middle of its name', () => {
            assert.strictEqual(isLog('src/app.log.txt'), false);
        });

        test('keeps an unrelated file', () => {
            assert.strictEqual(isLog('src/logger.ts'), false);
        });
    });

    suite('globstar matches zero directories', () => {
        // `**/` has to mean "zero or more directories". Compiling it to `.*`
        // plus a literal separator requires at least one, so a file in the
        // workspace root would escape the exclusion.
        const isMinJs = compileGlob('**/*.min.js');

        test('matches in the workspace root', () => {
            assert.strictEqual(isMinJs('bundle.min.js'), true);
        });

        test('matches deep in the tree', () => {
            assert.strictEqual(isMinJs('a/b/c/bundle.min.js'), true);
        });
    });

    suite('patterns without a separator get an implicit globstar', () => {
        const isLog = compileGlob('*.log');

        test('matches nested files, not just the root', () => {
            assert.strictEqual(isLog('deep/nested/x.log'), true);
        });

        test('still matches the root', () => {
            assert.strictEqual(isLog('x.log'), true);
        });

        test('still respects the extension', () => {
            assert.strictEqual(isLog('deep/x.log.txt'), false);
        });
    });

    suite('exact filename patterns', () => {
        const isLockfile = compileGlob('**/package-lock.json');

        test('matches in the root', () => {
            assert.strictEqual(isLockfile('package-lock.json'), true);
        });

        test('matches in a subdirectory', () => {
            assert.strictEqual(isLockfile('packages/ui/package-lock.json'), true);
        });

        test('does not match a longer name with the same suffix', () => {
            assert.strictEqual(isLockfile('my-package-lock.json'), false);
        });
    });

    suite('fast paths agree with the general regex form', () => {
        // The suffix and filename shortcuts must be pure optimisations. If they
        // ever diverge from the compiled regex, exclusion silently changes.
        const corpus = [
            'bundle.min.js', 'a/bundle.min.js', 'a/b/c/vendor.min.js',
            'src/app.log', 'src/app.logic.ts', 'src/app.log.txt', 'app.log',
            'yarn.lock', 'deep/yarn.lock', 'lock', 'a/lock',
            'package-lock.json', 'x/package-lock.json', 'my-package-lock.json',
            'src/index.ts', 'README.md', '.gitignore', 'a.min.js.map',
            'weird/name.with.dots.log', 'trailing/', 'min.js'
        ];

        for (const pattern of DEFAULT_PATTERNS) {
            test(pattern, () => {
                const fast = compileGlob(pattern, true);
                const general = compileGlob(pattern, false);
                for (const path of corpus) {
                    assert.strictEqual(
                        fast(path), general(path),
                        `"${pattern}" disagreed on "${path}": fast=${fast(path)} general=${general(path)}`
                    );
                }
            });
        }
    });

    suite('directory excludes', () => {
        const isExcluded = (path: string) =>
            DEFAULT_DIRECTORIES.map(compileDirectoryExclude).some(match => match(path));

        test('excludes a top-level directory with no leading separator', () => {
            // Paths are workspace-relative, so the old `/node_modules/` form
            // could not match this at all.
            assert.strictEqual(isExcluded('node_modules/lodash/index.js'), true);
        });

        test('excludes a nested directory', () => {
            assert.strictEqual(isExcluded('packages/ui/node_modules/x.js'), true);
        });

        test('excludes dotted directory names literally', () => {
            assert.strictEqual(isExcluded('.git/config'), true);
        });

        test('keeps a file whose name merely starts with the directory name', () => {
            assert.strictEqual(isExcluded('node_modules_backup/x.js'), false);
        });

        test('keeps the directory name as a file', () => {
            assert.strictEqual(isExcluded('src/build'), false);
        });

        test('keeps ordinary source', () => {
            assert.strictEqual(isExcluded('src/utils/glob.ts'), false);
        });
    });

    suite('normalizePath', () => {
        test('converts Windows separators', () => {
            assert.strictEqual(normalizePath('src\\utils\\glob.ts'), 'src/utils/glob.ts');
        });
    });

    suite('regex metacharacters in patterns are literal', () => {
        test('a dot is not a wildcard', () => {
            const matcher = compileGlob('**/a.b');
            assert.strictEqual(matcher('x/a.b'), true);
            assert.strictEqual(matcher('x/axb'), false);
        });

        test('a plus is not a quantifier', () => {
            const matcher = compileGlob('**/c++/*.h');
            assert.strictEqual(matcher('src/c++/thing.h'), true);
            assert.strictEqual(matcher('src/cc/thing.h'), false);
        });
    });
});
