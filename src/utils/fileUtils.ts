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

// Removed cursor positioning for performance

/**
 * Escape regex special characters in a string
 */
export function escapeRegExp(string: string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
} 