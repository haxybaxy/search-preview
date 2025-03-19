import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Binary file extensions to skip when attempting text operations
export const binaryFileExtensions = new Set([
	'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.webp', '.tiff', '.svg',
	'.pdf', '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
	'.zip', '.tar', '.gz', '.bz2', '.xz', '.rar', '.7z',
	'.mp3', '.mp4', '.avi', '.mov', '.mkv', '.flv', '.webm',
	'.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
	'.class', '.pyc', '.o', '.a'
]);

/**
 * Check if a file is likely binary based on extension or content
 */
export function isBinaryFile(filePath: string): boolean {
	// First check extension
	const ext = path.extname(filePath).toLowerCase();
	if (binaryFileExtensions.has(ext)) {
		return true;
	}

	// For other files, try to check if they're binary by examining the first few bytes
	try {
		// Check file size first (optional)
		const stats = fs.statSync(filePath);
		if (stats.size > 10 * 1024 * 1024) { // Skip files larger than 10MB
			return true;
		}

		// Read the first chunk of the file
		const buffer = Buffer.alloc(4096);
		const fd = fs.openSync(filePath, 'r');
		const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
		fs.closeSync(fd);

		// Check for NULL bytes or other binary indicators
		for (let i = 0; i < bytesRead; i++) {
			// NULL bytes are a good indicator of binary content
			if (buffer[i] === 0) {
				return true;
			}
		}

		return false;
	} catch (error) {
		// If we can't read the file, be conservative and assume it's binary
		return true;
	}
}

/**
 * Get the file icon based on extension
 */
export function getFileIcon(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	
	// Map of extensions to VSCode codicons
	// Using the official VSCode file icons where possible
	switch (ext) {
		case '.js':
			return '$(js)';
		case '.jsx':
			return '$(react)';
		case '.ts':
			return '$(typescript)';
		case '.tsx':
			return '$(react)';
		case '.json':
			return '$(json)';
		case '.md':
			return '$(markdown)';
		case '.css':
			return '$(css)';
		case '.scss':
		case '.sass':
			return '$(css)';
		case '.html':
			return '$(html)';
		case '.vue':
			return '$(preview)';
		case '.py':
			return '$(python)';
		case '.java':
			return '$(java)';
		case '.go':
			return '$(go)';
		case '.php':
			return '$(php)';
		case '.c':
		case '.cpp':
		case '.h':
			return '$(cpp)';
		case '.cs':
			return '$(csharp)';
		case '.rb':
			return '$(ruby)';
		case '.rs':
			return '$(rust)';
		case '.sh':
		case '.bash':
			return '$(terminal)';
		// Add binary file icons
		case '.jpg':
		case '.jpeg':
		case '.png':
		case '.gif':
		case '.svg':
			return '$(file-media)';
		case '.pdf':
			return '$(file-pdf)';
		case '.zip':
		case '.tar':
		case '.gz':
		case '.rar':
			return '$(file-zip)';
		default:
			// Check if it's a special file
			const basename = path.basename(filePath).toLowerCase();
			if (basename === 'package.json') {
				return '$(package)';
			}
			if (basename === 'dockerfile') {
				return '$(docker)';
			}
			if (basename.includes('.vscode')) {
				return '$(settings-gear)';
			}
			if (basename === '.gitignore' || basename === '.git') {
				return '$(git-branch)';
			}
			return '$(file)';
	}
}

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