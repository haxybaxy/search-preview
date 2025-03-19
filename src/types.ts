import * as vscode from 'vscode';

/**
 * Custom quick pick item interface for search results
 */
export interface SearchQuickPickItem extends vscode.QuickPickItem {
	data?: {
		filePath: string;
		linePos: number;
		colPos: number;
		searchText?: string;
		type: 'file' | 'content';
		lineText?: string;
	};
}

/**
 * Interface for editor history tracking
 */
export interface EditorHistoryItem {
	uri: vscode.Uri;
	timestamp: number;
	linePos?: number;
	colPos?: number;
} 