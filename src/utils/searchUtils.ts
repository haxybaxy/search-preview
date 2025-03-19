import * as vscode from 'vscode';
import * as path from 'path';
import { SearchQuickPickItem } from '../types';
import { getFileIcon, getFileLocation, isBinaryFile } from './fileUtils';

/**
 * Convert file URIs to SearchQuickPickItems
 */
export function createFileSearchItems(files: vscode.Uri[], searchText?: string): SearchQuickPickItem[] {
    return files.map(file => {
        const relativePath = vscode.workspace.asRelativePath(file.fsPath);
        const fileIcon = getFileIcon(file.fsPath);
        
        return {
            label: `${fileIcon} ${path.basename(file.fsPath)}`,
            description: getFileLocation(relativePath),
            data: {
                filePath: file.fsPath,
                linePos: 0,
                colPos: 0,
                searchText: searchText,
                type: 'file'
            }
        };
    });
}

/**
 * Search for text within file contents and create QuickPickItems for matches
 */
export async function searchInFileContents(
    files: vscode.Uri[], 
    searchText: string, 
    contentResults: SearchQuickPickItem[]
): Promise<void> {
    for (const file of files) {
        try {
            // Skip binary files
            if (isBinaryFile(file.fsPath)) {
                continue;
            }

            const document = await vscode.workspace.openTextDocument(file);
            const text = document.getText();
            const lines = text.split('\n');
            
            // Find matches in the file content
            lines.forEach((line, lineIndex) => {
                const lineText = line.toLowerCase();
                const valueText = searchText.toLowerCase();
                
                if (lineText.includes(valueText)) {
                    const colPos = lineText.indexOf(valueText);
                    const fileIcon = getFileIcon(file.fsPath);
                    
                    contentResults.push({
                        label: `${fileIcon} ${path.basename(file.fsPath)}:${lineIndex + 1}`,
                        description: getFileLocation(vscode.workspace.asRelativePath(file.fsPath)),
                        detail: line.length > 50 ? `...${line.substring(0, 50)}...` : line,
                        data: {
                            filePath: file.fsPath,
                            linePos: lineIndex,
                            colPos: colPos,
                            searchText: searchText,
                            type: 'content',
                            lineText: line
                        }
                    });
                }
            });
        } catch (error) {
            // Skip files that can't be read
            continue;
        }
        
        // Limit the total number of results
        if (contentResults.length >= 30) {
            break;
        }
    }
} 