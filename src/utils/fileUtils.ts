import * as vscode from 'vscode';
import { SearchQuickPickItem } from '../types';

/**
 * Quick pick properties that render the file's icon from the active file icon theme.
 *
 * `ThemeIcon.File` acts as a sentinel rather than a literal icon: when an item also
 * carries a `resourceUri`, VS Code resolves the concrete icon from the current file
 * icon theme instead of drawing the generic file codicon. Requires VS Code 1.108+.
 *
 * `label` and `description` are deliberately left to the caller - VS Code only derives
 * those from `resourceUri` when they are undefined, so the explicit values every item
 * sets (including empty descriptions) are preserved.
 */
function fileIconProps(uri: vscode.Uri): Pick<vscode.QuickPickItem, 'resourceUri' | 'iconPath'> {
    return {
        resourceUri: uri,
        iconPath: vscode.ThemeIcon.File
    };
}

/**
 * Build the quick pick entry for a file.
 *
 * The label is the full workspace-relative path on purpose: VS Code applies its
 * own filter to whatever items we hand it, so a bare filename here would hide
 * results whenever the user types a multi-segment query like `utils/file`.
 *
 * `description` is set explicitly (see `fileIconProps`) - leaving it undefined
 * would make VS Code derive one from `resourceUri`, duplicating the label.
 */
export function toQuickPickItem(uri: vscode.Uri, linePos = 0, colPos = 0): SearchQuickPickItem {
    return {
        label: vscode.workspace.asRelativePath(uri.fsPath),
        description: '',
        ...fileIconProps(uri),
        data: {
            filePath: uri.fsPath,
            linePos,
            colPos
        }
    };
}

/**
 * Set cursor position in a text editor
 */
export function setCursorPosition(editor: vscode.TextEditor, line: number, column: number): void {
    const position = new vscode.Position(line, column);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
    );
}
