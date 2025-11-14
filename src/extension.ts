import * as vscode from 'vscode';

/**
 * Context object containing the minimal required information
 */
interface CopilotContext {
    codeDirectory: string;
    aiPromptPayload: string;
}

/**
 * Activates the extension
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('Copilot Context Executor extension is now active');

    const disposable = vscode.commands.registerCommand(
        'copilot-context-executor.executePrompt',
        async () => {
            await executePromptWithContext();
        }
    );

    context.subscriptions.push(disposable);
}

/**
 * Main function to execute prompt with context
 */
async function executePromptWithContext() {
    try {
        // Get the code directory from user
        const codeDirectory = await getCodeDirectory();
        if (!codeDirectory) {
            vscode.window.showErrorMessage('No directory selected');
            return;
        }

        // Get the AI prompt payload from user
        const aiPromptPayload = await getPromptPayload();
        if (!aiPromptPayload) {
            vscode.window.showErrorMessage('No prompt provided');
            return;
        }

        const context: CopilotContext = {
            codeDirectory,
            aiPromptPayload
        };

        // Execute the prompt with the full workspace context
        await executeCopilotPrompt(context);

    } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Get the code directory from user input or file picker
 */
async function getCodeDirectory(): Promise<string | undefined> {
    const options: vscode.OpenDialogOptions = {
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Code Directory',
        title: 'Select the codebase directory to analyze'
    };

    const fileUri = await vscode.window.showOpenDialog(options);
    if (fileUri && fileUri[0]) {
        return fileUri[0].fsPath;
    }

    return undefined;
}

/**
 * Get the prompt payload from user
 */
async function getPromptPayload(): Promise<string | undefined> {
    const prompt = await vscode.window.showInputBox({
        prompt: 'Enter your AI prompt/instruction',
        placeHolder: 'e.g., Analyze this codebase and suggest improvements',
        ignoreFocusOut: true,
        validateInput: (value: string) => {
            return value.trim().length === 0 ? 'Prompt cannot be empty' : null;
        }
    });

    return prompt?.trim();
}

/**
 * Execute the Copilot prompt with the full workspace context
 */
async function executeCopilotPrompt(context: CopilotContext): Promise<void> {
    // Open the specified codebase in VS Code
    const folderUri = vscode.Uri.file(context.codeDirectory);
    await vscode.commands.executeCommand('vscode.openFolder', folderUri, { forceNewWindow: false });

    // Wait a bit for the workspace to load
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check if GitHub Copilot Chat is available
    const copilotChatAvailable = await checkCopilotChatAvailability();
    
    if (!copilotChatAvailable) {
        vscode.window.showWarningMessage(
            'GitHub Copilot Chat extension is not available. Please install and enable it.'
        );
        // Still show the prompt in a notification
        vscode.window.showInformationMessage(
            `Workspace opened. Your prompt: "${context.aiPromptPayload}"`
        );
        return;
    }

    // Try to open Copilot Chat and execute the prompt
    try {
        // Open Copilot Chat view
        await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
        
        // Wait for chat to open
        await new Promise(resolve => setTimeout(resolve, 500));

        // Try to send the prompt to Copilot Chat
        // Note: This uses workspace context automatically when chat is opened in a workspace
        await sendPromptToCopilotChat(context.aiPromptPayload);

        vscode.window.showInformationMessage(
            'Prompt sent to GitHub Copilot Chat with full workspace context'
        );
    } catch (error) {
        // If direct API is not available, provide instructions
        vscode.window.showInformationMessage(
            `Workspace opened with context. Please paste this prompt in Copilot Chat:\n\n${context.aiPromptPayload}`
        );
    }
}

/**
 * Check if GitHub Copilot Chat extension is available
 */
async function checkCopilotChatAvailability(): Promise<boolean> {
    const extension = vscode.extensions.getExtension('GitHub.copilot-chat');
    return extension !== undefined && extension.isActive;
}

/**
 * Send prompt to Copilot Chat
 * Note: This is a simplified implementation. The actual API may vary.
 */
async function sendPromptToCopilotChat(prompt: string): Promise<void> {
    // Try to use the Copilot Chat API if available
    // This is a placeholder for the actual implementation
    // as the Copilot Chat API is not publicly documented
    
    // Attempt to execute chat command with prompt
    try {
        await vscode.commands.executeCommand('workbench.action.chat.open', {
            query: prompt
        });
    } catch (error) {
        // If command doesn't work, fall back to showing the prompt
        console.log('Could not directly send prompt to Copilot Chat:', error);
        throw error;
    }
}

/**
 * Deactivates the extension
 */
export function deactivate() {
    console.log('Copilot Context Executor extension is now deactivated');
}
