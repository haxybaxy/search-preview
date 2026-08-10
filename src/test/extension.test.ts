import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'zaidalsaheb.search-preview';

suite('Extension', () => {

    test('activates without throwing', async () => {
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `extension ${EXTENSION_ID} was not found`);

        await extension.activate();
        assert.strictEqual(extension.isActive, true);
    });

    test('registers its commands', async () => {
        await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
        const commands = await vscode.commands.getCommands(true);

        for (const command of [
            'search-preview.quickOpenWithPreview',
            'search-preview.showAllEditorsByMostRecentlyUsed',
            'search-preview.openSearchSettings'
        ]) {
            assert.ok(commands.includes(command), `${command} was not registered`);
        }
    });
});
