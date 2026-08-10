import * as vscode from 'vscode';
import { EditorHistoryManager } from './lib/editorHistory';
import { QuickOpenProvider } from './lib/quickOpenProvider';
import { registerSettingsInvalidation } from './utils/settingsUtils';
import { initLogger } from './utils/logger';

export function activate(context: vscode.ExtensionContext): void {
    initLogger(context);
    registerSettingsInvalidation(context);

    const editorHistoryManager = new EditorHistoryManager(context);
    editorHistoryManager.registerListeners(context);

    const quickOpenProvider = new QuickOpenProvider(editorHistoryManager);

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'search-preview.quickOpenWithPreview',
            () => quickOpenProvider.show('standard')
        ),
        vscode.commands.registerCommand(
            'search-preview.showAllEditorsByMostRecentlyUsed',
            () => quickOpenProvider.show('recent')
        ),
        vscode.commands.registerCommand(
            'search-preview.openSearchSettings',
            () => vscode.commands.executeCommand('workbench.action.openSettings', 'searchPreview.search')
        )
    );
}

export function deactivate(): void {}
