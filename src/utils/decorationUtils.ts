import * as vscode from 'vscode';

export class DecorationManager {
    private lastHighlightDecoration?: vscode.TextEditorDecorationType;

    /**
     * Clear all applied decorations
     */
    public clearDecorations(): void {
        if (this.lastHighlightDecoration) {
            this.lastHighlightDecoration.dispose();
            this.lastHighlightDecoration = undefined;
        }
    }

    /**
     * Highlight a specific line in the editor
     */
    public highlightLine(editor: vscode.TextEditor, lineNumber: number): void {
        const lineRange = editor.document.lineAt(lineNumber).range;
        this.lastHighlightDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.selectionBackground'),
            isWholeLine: true
        });
        editor.setDecorations(this.lastHighlightDecoration, [lineRange]);
    }
} 