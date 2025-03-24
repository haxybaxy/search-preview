import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Format the file location path for display
 */
export function getFileLocation(relativePath: string): string {
	// If it's in a directory, show the directory
	const dirname = path.dirname(relativePath);
	if (dirname !== '.') {
		return dirname;
	}
	return '';
}

/**
 * Set cursor position in a text editor
 */
export function setCursorPosition(editor: vscode.TextEditor, line: number, column: number) {
	const position = new vscode.Position(line, column);
	editor.selection = new vscode.Selection(position, position);
	editor.revealRange(
		new vscode.Range(position, position),
		vscode.TextEditorRevealType.InCenter
	);
}

/**
 * Escape regex special characters in a string
 */
export function escapeRegExp(string: string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
} 