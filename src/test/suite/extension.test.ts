import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        const ext = vscode.extensions.getExtension('RamNull.copilot-context-executor');
        assert.ok(ext, 'Extension should be installed');
    });

    test('Should register executePrompt command', async () => {
        const commands = await vscode.commands.getCommands();
        assert.ok(
            commands.includes('copilot-context-executor.executePrompt'),
            'executePrompt command should be registered'
        );
    });

    test('Extension should activate', async () => {
        const ext = vscode.extensions.getExtension('RamNull.copilot-context-executor');
        assert.ok(ext, 'Extension should be found');
        
        if (ext && !ext.isActive) {
            await ext.activate();
        }
        
        assert.ok(ext?.isActive, 'Extension should be activated');
    });
});
