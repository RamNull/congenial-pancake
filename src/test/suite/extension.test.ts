import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('undefined_publisher.copilot-context-executor'));
    });

    test('Should register executePrompt command', async () => {
        const commands = await vscode.commands.getCommands();
        assert.ok(commands.includes('copilot-context-executor.executePrompt'));
    });
});
