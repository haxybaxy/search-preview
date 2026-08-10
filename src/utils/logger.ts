import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

/**
 * Create the extension's output channel and tie it to the extension lifetime.
 */
export function initLogger(context: vscode.ExtensionContext): void {
    channel = vscode.window.createOutputChannel('Search Preview');
    context.subscriptions.push(channel);
}

/**
 * Record a diagnostic in the "Search Preview" output channel.
 *
 * Failures used to go to console.error, where nothing short of the extension
 * host devtools would surface them. Anything a user can act on should use
 * `showErrorMessage` instead of this.
 */
export function log(message: string, error?: unknown): void {
    let detail = '';
    if (error instanceof Error) {
        detail = `: ${error.message}`;
    } else if (error !== undefined) {
        detail = `: ${String(error)}`;
    }
    channel?.appendLine(`${message}${detail}`);
}
