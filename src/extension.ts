import * as vscode from 'vscode';

/**
 * Context object containing the minimal required information
 */
interface CopilotContext {
    codeDirectory: string;
    aiPromptPayload: string;
}

/**
 * View Provider for the Copilot Context sidebar
 */
class CopilotContextViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'copilotContextView';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        console.log('CopilotContextViewProvider: resolveWebviewView called');
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        console.log('CopilotContextViewProvider: HTML set');

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            console.log('CopilotContextViewProvider: received message', data.type);
            switch (data.type) {
                case 'browseDirectory': {
                    const directory = await this._selectDirectory();
                    if (directory && this._view) {
                        this._view.webview.postMessage({ 
                            type: 'setDirectory', 
                            path: directory 
                        });
                    }
                    break;
                }
                case 'executePrompt': {
                    await this._executeWithContext(data.directory, data.payload);
                    break;
                }
            }
        });
    }

    private async _selectDirectory(): Promise<string | undefined> {
        const options: vscode.OpenDialogOptions = {
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Code Directory',
            title: 'Select the codebase directory to analyze'
        };

        const fileUri = await vscode.window.showOpenDialog(options);
        return fileUri?.[0]?.fsPath;
    }

    private async _executeWithContext(directory: string, payload: string): Promise<void> {
        try {
            const folderUri = vscode.Uri.file(directory);
            const currentWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            
            // Check if the directory is already open
            if (currentWorkspace === directory) {
                // Directory is already open, execute prompt directly
                try {
                    await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    await vscode.commands.executeCommand('workbench.action.chat.open', {
                        query: payload
                    });
                    vscode.window.showInformationMessage('Prompt sent to GitHub Copilot Chat!');
                } catch {
                    vscode.window.showInformationMessage(
                        `Copy this prompt to Copilot Chat: ${payload}`,
                        'Copy Prompt'
                    ).then(selection => {
                        if (selection === 'Copy Prompt') {
                            vscode.env.clipboard.writeText(payload);
                            vscode.window.showInformationMessage('Prompt copied to clipboard!');
                        }
                    });
                }
            } else {
                // Different directory, need to open it
                // Save the payload to execute after reload
                await vscode.workspace.getConfiguration().update(
                    'copilotContextExecutor.pendingPrompt', 
                    payload, 
                    vscode.ConfigurationTarget.Global
                );
                
                // Open the folder in the current window
                await vscode.commands.executeCommand('vscode.openFolder', folderUri, false);
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                `Error: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Copilot Context Executor</title>
    <style>
        body {
            padding: 15px;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
        }
        h3 {
            margin-top: 0;
            margin-bottom: 20px;
        }
        .input-group {
            margin-bottom: 15px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-size: 0.9em;
            font-weight: 600;
        }
        input[type="text"], textarea {
            width: 100%;
            padding: 8px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            box-sizing: border-box;
        }
        textarea {
            min-height: 80px;
            resize: vertical;
            font-family: var(--vscode-font-family);
        }
        input[type="text"]:focus, textarea:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        button {
            width: 100%;
            padding: 10px;
            margin-top: 10px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
            border-radius: 2px;
            font-weight: 600;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .browse-btn {
            padding: 6px 10px;
            margin-top: 5px;
            width: auto;
            font-size: 0.85em;
        }
    </style>
</head>
<body>
    <h3>Copilot Context Executor</h3>
    
    <div class="input-group">
        <label for="codeDirectory">Code Directory</label>
        <input type="text" id="codeDirectory" placeholder="Select code directory..." readonly />
        <button class="browse-btn" onclick="browseDirectory()">📁 Browse</button>
    </div>
    
    <div class="input-group">
        <label for="payload">AI Prompt Payload</label>
        <textarea id="payload" placeholder="Enter your prompt for GitHub Copilot..."></textarea>
    </div>
    
    <button onclick="executePrompt()" id="sendBtn">
        ▶ Send to Copilot
    </button>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function browseDirectory() {
            vscode.postMessage({ type: 'browseDirectory' });
        }
        
        function executePrompt() {
            const directory = document.getElementById('codeDirectory').value;
            const payload = document.getElementById('payload').value;
            
            if (!directory) {
                alert('Please select a code directory');
                return;
            }
            
            if (!payload.trim()) {
                alert('Please enter a prompt');
                return;
            }
            
            vscode.postMessage({ 
                type: 'executePrompt',
                directory: directory,
                payload: payload
            });
        }
        
        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'setDirectory') {
                document.getElementById('codeDirectory').value = message.path;
            }
        });
    </script>
</body>
</html>`;
    }
}

/**
 * Activates the extension
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('Copilot Context Executor extension is now active');
    console.log('Extension URI:', context.extensionUri.toString());

    // Check if there's a pending prompt to execute
    const pendingPrompt = vscode.workspace.getConfiguration().get<string>('copilotContextExecutor.pendingPrompt');
    if (pendingPrompt) {
        // Clear the pending prompt
        vscode.workspace.getConfiguration().update(
            'copilotContextExecutor.pendingPrompt', 
            undefined, 
            vscode.ConfigurationTarget.Global
        );
        
        // Execute the prompt after a short delay to ensure workspace is fully loaded
        setTimeout(async () => {
            try {
                await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
                await new Promise(resolve => setTimeout(resolve, 500));
                
                await vscode.commands.executeCommand('workbench.action.chat.open', {
                    query: pendingPrompt
                });
                vscode.window.showInformationMessage('Prompt sent to GitHub Copilot Chat!');
            } catch {
                vscode.window.showInformationMessage(
                    `Workspace opened. Copy this prompt to Copilot Chat: ${pendingPrompt}`,
                    'Copy Prompt'
                ).then(selection => {
                    if (selection === 'Copy Prompt') {
                        vscode.env.clipboard.writeText(pendingPrompt);
                        vscode.window.showInformationMessage('Prompt copied to clipboard!');
                    }
                });
            }
        }, 2000);
    }

    // Register the webview view provider
    const provider = new CopilotContextViewProvider(context.extensionUri);
    console.log('Registering webview view provider for: copilotContextView');
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'copilotContextView',
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );
    
    console.log('Webview view provider registered successfully');

    // Register the command
    const disposable = vscode.commands.registerCommand(
        'copilot-context-executor.executePrompt',
        async () => {
            await executePromptWithContext();
        }
    );

    context.subscriptions.push(disposable);
    console.log('Extension activation complete');
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
