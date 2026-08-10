import * as vscode from 'vscode';
import { EditorHistoryManager } from './lib/editorHistory';
import { FileIndex } from './lib/fileIndex';
import { QuickOpenProvider } from './lib/quickOpenProvider';
import { registerSettingsInvalidation } from './utils/settingsUtils';
import { initLogger } from './utils/logger';

/** Held so deactivate() can flush the debounced history write. */
let historyManager: EditorHistoryManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
    initLogger(context);

    const fileIndex = new FileIndex();
    context.subscriptions.push(fileIndex);

    // The exclude settings decide what goes into the index, so a settings
    // change has to drop both the compiled matchers and the cached file list.
    registerSettingsInvalidation(context, () => fileIndex.invalidate());

    const editorHistoryManager = new EditorHistoryManager(context);
    editorHistoryManager.registerListeners(context);
    historyManager = editorHistoryManager;

    const quickOpenProvider = new QuickOpenProvider(editorHistoryManager, fileIndex);
    context.subscriptions.push(quickOpenProvider);

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

    // Walk the workspace now, in the background, so that opening the picker is
    // never the thing that waits for it.
    fileIndex.prewarm();
}

export async function deactivate(): Promise<void> {
    await historyManager?.flush();
    historyManager = undefined;
}
