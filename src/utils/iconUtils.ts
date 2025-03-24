import * as path from 'path';

/**
 * Get the file icon based on extension
 */
export function getFileIcon(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	
	// Map of extensions to VSCode codicons
	// https://microsoft.github.io/vscode-codicons/dist/codicon.html
	switch (ext) {
		case '.json':
			return '$(json)';
		case '.md':
			return '$(markdown)';
		case '.css':
			return '$(sparkle)';
		case '.scss':
		case '.sass':
			return '$(sparkle)';
		case '.html':
			return '$(code)';
		case '.vue':
			return '$(preview)';
		case '.py':
			return '$(python)';
		case '.sh':
		case '.bash':
			return '$(terminal)';

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
			const basename = path.basename(filePath).toLowerCase();
			if (basename === 'package.json') {
				return '$(package)';
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
