import * as vscode from 'vscode';

/**
 * A file in the quick pick list, carrying the cursor position to restore when
 * it is previewed or opened.
 */
export interface SearchQuickPickItem extends vscode.QuickPickItem {
    data?: {
        filePath: string;
        linePos: number;
        colPos: number;
    };
}

/**
 * An entry in the most-recently-used editor history.
 */
export interface EditorHistoryItem {
    uri: vscode.Uri;
    linePos: number;
    colPos: number;
}

/**
 * How an EditorHistoryItem is persisted. workspaceState round-trips through
 * JSON, so the Uri survives only as a string and must be re-parsed on load.
 */
export interface StoredEditorHistoryItem {
    uri: string;
    linePos: number;
    colPos: number;
}
