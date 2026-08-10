import js from "@eslint/js";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [{
    ignores: ["dist/**", "out/**", "node_modules/**", ".vscode-test/**"],
}, {
    files: ["**/*.ts"],

    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",
        parserOptions: {
            // Type-aware linting, required by no-floating-promises.
            projectService: true,
            tsconfigRootDir: import.meta.dirname,
        },
    },

    rules: {
        ...js.configs.recommended.rules,
        // Turns off base rules that TypeScript already covers.
        ...typescriptEslint.configs["eslint-recommended"].overrides[0].rules,
        ...typescriptEslint.configs.recommended.rules,

        // An unawaited promise here means a search or an editor open silently
        // does nothing, which is how several of the audited bugs stayed hidden.
        "@typescript-eslint/no-floating-promises": "error",

        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    },
}];
