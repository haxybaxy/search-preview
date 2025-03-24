import * as path from 'path';

// Define an enum or type for the icon theme
type IconTheme = 'codicon' | 'material';

/**
 * Get the file icon based on extension and theme
 */
export function getFileIcon(filePath: string, theme: IconTheme = 'codicon'): string {
	const ext = path.extname(filePath).toLowerCase();
	
	if (theme === 'material') {
		// Material icons use different syntax
		switch (ext) {
			case '.js':
				return 'javascript';
			case '.jsx':
				return 'react';
			case '.ts':
				return 'typescript';
			case '.tsx':
				return 'react_ts';
			case '.json':
				return 'json';
			case '.md':
				return 'markdown';
			case '.css':
				return 'css';
			case '.scss':
			case '.sass':
				return 'css';
			case '.html':
				return 'html';
			case '.vue':
				return 'vue';
			case '.py':
				return 'python';
			case '.java':
				return 'java';
			case '.go':
				return 'go';
			case '.php':
				return 'php';
			case '.c':
			case '.cpp':
			case '.h':
				return 'cpp';
			case '.cs':
				return 'csharp';
			case '.rb':
				return 'ruby';
			case '.rs':
				return 'rust';
			case '.sh':
			case '.bash':
				return 'terminal';
			// binary file icons
			case '.jpg':
			case '.jpeg':
			case '.png':
			case '.gif':
			case '.svg':
				return 'file-media';
			case '.pdf':
				return 'pdf';
			case '.zip':
			case '.tar':
			case '.gz':
			case '.rar':
				return 'zip';
			default:
				const basename = path.basename(filePath).toLowerCase();
				if (basename === 'package.json') {
					return 'package';
				}
				if (basename === 'dockerfile') {
					return 'docker';
				}
				if (basename.includes('.vscode')) {
					return 'settings-gear';
				}
				if (basename === '.gitignore' || basename === '.git') {
					return 'git-branch';
				}
				return 'file';
		}
	}
	
	// Original Codicon implementation
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
		// binary file icons
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
