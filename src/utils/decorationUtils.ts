import * as vscode from 'vscode';

export class DecorationManager implements vscode.Disposable {
    private readonly highlight: vscode.TextEditorDecorationType;
    private decoratedEditor?: vscode.TextEditor;

    constructor() {
        // One decoration type for the extension's lifetime. These are renderer
        // registration handles rather than value objects, so creating and
        // disposing one per preview churns registrations on every arrow key.
        this.highlight = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.selectionBackground'),
            isWholeLine: true
        });
    }

    /**
     * Clear all applied decorations
     */
    public clearDecorations(): void {
        const editor = this.decoratedEditor;
        this.decoratedEditor = undefined;

        if (!editor) {
            return;
        }

        try {
            editor.setDecorations(this.highlight, []);
        } catch {
            // The editor was closed. Its decorations went with it, so there is
            // nothing left to clear.
        }
    }

    /**
     * Highlight a specific line in the editor
     */
    public highlightLine(editor: vscode.TextEditor, lineNumber: number): void {
        // A history entry can point past the end of a file that has since been
        // shortened, and lineAt would then throw on every preview of it.
        const line = Math.min(Math.max(lineNumber, 0), editor.document.lineCount - 1);

        editor.setDecorations(this.highlight, [editor.document.lineAt(line).range]);
        this.decoratedEditor = editor;
    }

    public dispose(): void {
        this.highlight.dispose();
        this.decoratedEditor = undefined;
    }
}
