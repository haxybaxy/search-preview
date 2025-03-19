import * as vscode from 'vscode';
import { escapeRegExp } from './fileUtils';

export class DecorationManager {
    private lastHighlightDecoration?: vscode.TextEditorDecorationType;
    private contentMatchDecorations?: vscode.TextEditorDecorationType;

    /**
     * Clear all applied decorations
     */
    public clearDecorations(): void {
        if (this.lastHighlightDecoration) {
            this.lastHighlightDecoration.dispose();
            this.lastHighlightDecoration = undefined;
        }
        
        if (this.contentMatchDecorations) {
            this.contentMatchDecorations.dispose();
            this.contentMatchDecorations = undefined;
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

    /**
     * Highlight all matches of a search term in the editor
     */
    public highlightSearchMatches(editor: vscode.TextEditor, searchText: string): void {
        // Find all matches in the file
        const fileText = editor.document.getText();
        const ranges: vscode.Range[] = [];
        const searchRegex = new RegExp(escapeRegExp(searchText), 'gi');
        
        let match;
        while ((match = searchRegex.exec(fileText)) !== null) {
            const startPos = editor.document.positionAt(match.index);
            const endPos = editor.document.positionAt(match.index + match[0].length);
            ranges.push(new vscode.Range(startPos, endPos));
        }
        
        // Add decorations
        this.contentMatchDecorations = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder')
        });
        
        editor.setDecorations(this.contentMatchDecorations, ranges);
    }
} 