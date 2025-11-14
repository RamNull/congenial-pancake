import * as vscode from 'vscode';

/**
 * Context object containing the minimal required information
 */
interface CopilotContext {
    codeDirectory: string;
    aiPromptPayload: string;
}

interface JiraConfig {
    type: 'cloud' | 'datacenter';
    url: string;
    email?: string; // For cloud
    apiToken?: string; // For cloud
    username?: string; // For datacenter
    password?: string; // For datacenter
}

interface JiraIssue {
    key: string;
    summary: string;
    description: string;
    status: string;
    priority: string;
}

/**
 * View Provider for the Copilot Context sidebar
 */
class CopilotContextViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'copilotContextView';
    private _view?: vscode.WebviewView;
    private readonly _context: vscode.ExtensionContext;

    constructor(private readonly _extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._context = context;
    }

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
                case 'configureJira': {
                    await this._configureJira();
                    break;
                }
                case 'fetchJiraIssues': {
                    await this._fetchJiraIssues();
                    break;
                }
                case 'executePrompt': {
                    await this._executeWithJiraIssue(data.directory, data.issueKey);
                    break;
                }
                case 'startWork': {
                    await this._startWorkOnIssue(data.directory, data.issueKey);
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

    private async _configureJira(): Promise<void> {
        // Get saved partial configuration if exists
        const partialConfig = this._context.globalState.get<Partial<JiraConfig>>('jiraPartialConfig') || {};

        // Step 1: Jira type
        const jiraType = await vscode.window.showQuickPick(['Cloud', 'Data Center'], {
            placeHolder: 'Select your Jira instance type',
            ignoreFocusOut: true
        });

        if (!jiraType) {
            return;
        }

        const type = jiraType.toLowerCase() as 'cloud' | 'datacenter';
        partialConfig.type = type;
        await this._context.globalState.update('jiraPartialConfig', partialConfig);

        // Step 2: Jira URL
        const url = await vscode.window.showInputBox({
            prompt: 'Enter your Jira URL (Step 2/4)',
            value: partialConfig.url || '',
            placeHolder: type === 'cloud' ? 'https://your-domain.atlassian.net' : 'https://jira.your-company.com',
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value.startsWith('http://') && !value.startsWith('https://')) {
                    return 'URL must start with http:// or https://';
                }
                return null;
            }
        });

        if (!url) {
            return;
        }

        partialConfig.url = url;
        await this._context.globalState.update('jiraPartialConfig', partialConfig);

        let config: JiraConfig;

        if (type === 'cloud') {
            // Step 3: Email
            const email = await vscode.window.showInputBox({
                prompt: 'Enter your Jira email (Step 3/4)',
                value: partialConfig.email || '',
                placeHolder: 'your-email@example.com',
                ignoreFocusOut: true
            });

            if (!email) {
                return;
            }

            partialConfig.email = email;
            await this._context.globalState.update('jiraPartialConfig', partialConfig);

            // Step 4: API Token
            const apiToken = await vscode.window.showInputBox({
                prompt: 'Enter your Jira API token (Step 4/4) - Create at: https://id.atlassian.com/manage-profile/security/api-tokens',
                value: partialConfig.apiToken || '',
                password: true,
                ignoreFocusOut: true
            });

            if (!apiToken) {
                return;
            }

            config = { type, url, email, apiToken };
        } else {
            // Step 3: Username
            const username = await vscode.window.showInputBox({
                prompt: 'Enter your Jira username (Step 3/4)',
                value: partialConfig.username || '',
                ignoreFocusOut: true
            });

            if (!username) {
                return;
            }

            partialConfig.username = username;
            await this._context.globalState.update('jiraPartialConfig', partialConfig);

            // Step 4: Password
            const password = await vscode.window.showInputBox({
                prompt: 'Enter your Jira password (Step 4/4)',
                value: partialConfig.password || '',
                password: true,
                ignoreFocusOut: true
            });

            if (!password) {
                return;
            }

            config = { type, url, username, password };
        }

        // Clear partial config after successful completion
        await this._context.globalState.update('jiraPartialConfig', undefined);

        // Store complete configuration
        await vscode.workspace.getConfiguration().update(
            'copilotContextExecutor.jiraConfig',
            config,
            vscode.ConfigurationTarget.Global
        );

        vscode.window.showInformationMessage('Jira configuration saved successfully!');
        
        // Auto-fetch issues after configuration
        await this._fetchJiraIssues();
    }

    private async _fetchJiraIssues(): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration().get<JiraConfig>('copilotContextExecutor.jiraConfig');

            if (!config) {
                vscode.window.showWarningMessage('Please configure Jira first');
                return;
            }

            if (this._view) {
                this._view.webview.postMessage({ type: 'setStatus', status: 'Checking projects...' });
            }

            // First check if user has any projects
            const projects = await this._getJiraProjects(config);
            
            if (projects.length === 0) {
                const selection = await vscode.window.showWarningMessage(
                    'No Jira projects found. You need to create a project first.',
                    'Open Jira',
                    'Learn How'
                );
                
                if (selection === 'Open Jira') {
                    vscode.env.openExternal(vscode.Uri.parse(`${config.url}/jira/projects/create`));
                } else if (selection === 'Learn How') {
                    vscode.env.openExternal(vscode.Uri.parse('https://support.atlassian.com/jira-software-cloud/docs/create-a-new-project/'));
                }
                
                if (this._view) {
                    this._view.webview.postMessage({ 
                        type: 'setStatus', 
                        status: 'No projects found. Create a project first.' 
                    });
                }
                return;
            }

            if (this._view) {
                this._view.webview.postMessage({ type: 'setStatus', status: 'Fetching issues...' });
            }

            const issues = await this._callJiraAPI(config);

            if (issues.length === 0) {
                const selection = await vscode.window.showInformationMessage(
                    `Found ${projects.length} project(s) but no issues assigned to you. Create some issues to get started.`,
                    'Open Jira'
                );
                
                if (selection === 'Open Jira') {
                    vscode.env.openExternal(vscode.Uri.parse(`${config.url}/jira/software/projects`));
                }
                
                if (this._view) {
                    this._view.webview.postMessage({ 
                        type: 'setStatus', 
                        status: `${projects.length} project(s), 0 issues` 
                    });
                }
                return;
            }

            if (this._view) {
                this._view.webview.postMessage({ 
                    type: 'setIssues', 
                    issues: issues 
                });
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            
            // Provide helpful message for common errors
            if (errorMsg.includes('410')) {
                vscode.window.showWarningMessage(
                    'Jira search API unavailable. This often happens with new accounts. Try creating a project and some issues first.',
                    'Open Jira'
                ).then(selection => {
                    if (selection === 'Open Jira') {
                        const config = vscode.workspace.getConfiguration().get<JiraConfig>('copilotContextExecutor.jiraConfig');
                        if (config) {
                            vscode.env.openExternal(vscode.Uri.parse(`${config.url}/jira/projects`));
                        }
                    }
                });
            } else {
                vscode.window.showErrorMessage(`Failed to fetch Jira issues: ${errorMsg}`);
            }
            
            if (this._view) {
                this._view.webview.postMessage({ type: 'setStatus', status: 'Error fetching issues' });
            }
        }
    }

    private async _getJiraProjects(config: JiraConfig): Promise<any[]> {
        const authHeader = config.type === 'cloud'
            ? 'Basic ' + Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')
            : 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');

        const apiPath = config.type === 'cloud' 
            ? '/rest/api/3/project' 
            : '/rest/api/2/project';

        const baseUrl = config.url.endsWith('/') ? config.url.slice(0, -1) : config.url;
        const url = `${baseUrl}${apiPath}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch projects: ${response.status} ${response.statusText}`);
        }

        return await response.json() as any[];
    }

    private async _callJiraAPI(config: JiraConfig): Promise<JiraIssue[]> {
        const authHeader = config.type === 'cloud'
            ? 'Basic ' + Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')
            : 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');

        const baseUrl = config.url.endsWith('/') ? config.url.slice(0, -1) : config.url;

        // For team-managed projects, try Agile API first as search API often returns 410
        try {
            // Get boards first
            const boardsUrl = `${baseUrl}/rest/agile/1.0/board`;
            const boardsResponse = await fetch(boardsUrl, {
                method: 'GET',
                headers: {
                    'Authorization': authHeader,
                    'Accept': 'application/json'
                }
            });

            if (boardsResponse.ok) {
                const boardsData = await boardsResponse.json() as any;
                
                if (boardsData.values && boardsData.values.length > 0) {
                    // Get issues from the first board
                    const boardId = boardsData.values[0].id;
                    const issuesUrl = `${baseUrl}/rest/agile/1.0/board/${boardId}/issue?maxResults=50&fields=summary,description,status,priority,assignee`;
                    
                    const issuesResponse = await fetch(issuesUrl, {
                        method: 'GET',
                        headers: {
                            'Authorization': authHeader,
                            'Accept': 'application/json'
                        }
                    });

                    if (issuesResponse.ok) {
                        const issuesData = await issuesResponse.json() as any;
                        
                        if (issuesData.issues && Array.isArray(issuesData.issues)) {
                            // Filter for issues assigned to current user if needed
                            return issuesData.issues.map((issue: any) => ({
                                key: issue.key,
                                summary: issue.fields.summary,
                                description: issue.fields.description || '',
                                status: issue.fields.status.name,
                                priority: issue.fields.priority?.name || 'None'
                            }));
                        }
                    }
                }
            }
        } catch (agileError) {
            console.log('Agile API failed, falling back to search API:', agileError);
        }

        // Fallback to standard search API (for company-managed projects)
        const jql = 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';
        const apiPath = config.type === 'cloud' 
            ? '/rest/api/3/search' 
            : '/rest/api/2/search';

        const url = `${baseUrl}${apiPath}?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,description,status,priority`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Jira API Error Response:', errorText);
            throw new Error(`Jira API returned ${response.status}: ${response.statusText}. This may be a team-managed project with limited API access.`);
        }

        const data = await response.json() as any;

        if (!data.issues || !Array.isArray(data.issues)) {
            throw new Error('Invalid response from Jira API');
        }

        return data.issues.map((issue: any) => ({
            key: issue.key,
            summary: issue.fields.summary,
            description: issue.fields.description || '',
            status: issue.fields.status.name,
            priority: issue.fields.priority?.name || 'None'
        }));
    }

    private async _startWorkOnIssue(directory: string, issueKey: string): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration().get<JiraConfig>('copilotContextExecutor.jiraConfig');
            if (!config) {
                vscode.window.showWarningMessage('Jira not configured');
                return;
            }

            // Show progress
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Fetching full details for ${issueKey}...`,
                cancellable: false
            }, async () => {
                const fullIssueData = await this._fetchFullIssueDetails(config, issueKey);
                await this._executeWithContext(directory, fullIssueData);
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async _fetchFullIssueDetails(config: JiraConfig, issueKey: string): Promise<string> {
        const authHeader = config.type === 'cloud'
            ? 'Basic ' + Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')
            : 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');

        const apiPath = config.type === 'cloud' 
            ? '/rest/api/3/issue/' 
            : '/rest/api/2/issue/';

        const baseUrl = config.url.endsWith('/') ? config.url.slice(0, -1) : config.url;
        const url = `${baseUrl}${apiPath}${issueKey}?fields=*all&expand=renderedFields`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch issue ${issueKey}: ${response.status} ${response.statusText}`);
        }

        const issue = await response.json() as any;

        // Build comprehensive context
        let context = `# Jira Issue: ${issue.key} - ${issue.fields.summary}\n\n`;
        
        // Metadata
        context += `## Metadata\n`;
        context += `- **Status:** ${issue.fields.status.name}\n`;
        context += `- **Priority:** ${issue.fields.priority?.name || 'None'}\n`;
        context += `- **Type:** ${issue.fields.issuetype.name}\n`;
        context += `- **Assignee:** ${issue.fields.assignee?.displayName || 'Unassigned'}\n`;
        context += `- **Reporter:** ${issue.fields.reporter?.displayName || 'Unknown'}\n`;
        context += `- **Created:** ${issue.fields.created}\n`;
        context += `- **Updated:** ${issue.fields.updated}\n`;
        
        if (issue.fields.labels && issue.fields.labels.length > 0) {
            context += `- **Labels:** ${issue.fields.labels.join(', ')}\n`;
        }

        // Description
        context += `\n## Description\n`;
        if (issue.fields.description) {
            // Jira descriptions can be in various formats
            context += typeof issue.fields.description === 'string' 
                ? issue.fields.description 
                : JSON.stringify(issue.fields.description, null, 2);
        } else {
            context += 'No description provided.';
        }

        // Comments
        if (issue.fields.comment && issue.fields.comment.comments && issue.fields.comment.comments.length > 0) {
            context += `\n\n## Comments (${issue.fields.comment.total})\n`;
            issue.fields.comment.comments.forEach((comment: any, index: number) => {
                context += `\n### Comment ${index + 1} by ${comment.author.displayName} (${comment.created})\n`;
                context += typeof comment.body === 'string' 
                    ? comment.body 
                    : JSON.stringify(comment.body, null, 2);
                context += '\n';
            });
        }

        // Attachments
        if (issue.fields.attachment && issue.fields.attachment.length > 0) {
            context += `\n## Attachments (${issue.fields.attachment.length})\n`;
            issue.fields.attachment.forEach((att: any) => {
                context += `- **${att.filename}** (${Math.round(att.size / 1024)} KB) - ${att.mimeType}\n`;
                context += `  URL: ${att.content}\n`;
            });
        }

        // Subtasks
        if (issue.fields.subtasks && issue.fields.subtasks.length > 0) {
            context += `\n## Subtasks (${issue.fields.subtasks.length})\n`;
            issue.fields.subtasks.forEach((subtask: any) => {
                context += `- ${subtask.key}: ${subtask.fields.summary} [${subtask.fields.status.name}]\n`;
            });
        }

        // Issue Links
        if (issue.fields.issuelinks && issue.fields.issuelinks.length > 0) {
            context += `\n## Linked Issues\n`;
            issue.fields.issuelinks.forEach((link: any) => {
                if (link.outwardIssue) {
                    context += `- ${link.type.outward}: ${link.outwardIssue.key} - ${link.outwardIssue.fields.summary}\n`;
                } else if (link.inwardIssue) {
                    context += `- ${link.type.inward}: ${link.inwardIssue.key} - ${link.inwardIssue.fields.summary}\n`;
                }
            });
        }

        context += `\n\n---\n**Task:** Please analyze this codebase in the context of implementing this Jira issue. Provide guidance, suggest implementation approach, and identify relevant files that need to be modified.`;

        return context;
    }

    private async _executeWithJiraIssue(directory: string, issueKey: string): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration().get<JiraConfig>('copilotContextExecutor.jiraConfig');
            if (!config) {
                vscode.window.showWarningMessage('Jira not configured');
                return;
            }

            // Fetch the specific issue details
            const authHeader = config.type === 'cloud'
                ? 'Basic ' + Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')
                : 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');

            const apiPath = config.type === 'cloud' 
                ? '/rest/api/3/issue/' 
                : '/rest/api/2/issue/';

            // Ensure URL doesn't have trailing slash
            const baseUrl = config.url.endsWith('/') ? config.url.slice(0, -1) : config.url;
            const url = `${baseUrl}${apiPath}${issueKey}?fields=summary,description,status,priority`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': authHeader,
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Jira API Error:', errorText);
                throw new Error(`Failed to fetch issue ${issueKey}: ${response.status} ${response.statusText}`);
            }

            const issue = await response.json() as any;

            // Create prompt from Jira issue
            const payload = `Jira Issue: ${issue.key} - ${issue.fields.summary}\n\nDescription:\n${issue.fields.description || 'No description'}\n\nStatus: ${issue.fields.status.name}\nPriority: ${issue.fields.priority?.name || 'None'}\n\nPlease analyze this codebase and provide guidance for implementing this Jira issue.`;

            await this._executeWithContext(directory, payload);
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
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
        input[type="text"], textarea, select {
            width: 100%;
            padding: 8px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            box-sizing: border-box;
        }
        select {
            cursor: pointer;
        }
        textarea {
            min-height: 80px;
            resize: vertical;
            font-family: var(--vscode-font-family);
        }
        input[type="text"]:focus, textarea:focus, select:focus {
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
        .browse-btn, .small-btn {
            padding: 6px 10px;
            margin-top: 5px;
            width: auto;
            font-size: 0.85em;
        }
        .status {
            font-size: 0.85em;
            margin-top: 5px;
            opacity: 0.8;
        }
        .hidden { display: none; }
        .issue-item {
            padding: 10px;
            margin: 5px 0;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .issue-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .issue-info {
            flex: 1;
        }
        .issue-key {
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
        }
        .issue-summary {
            font-size: 0.9em;
            margin-top: 2px;
        }
        .issue-status {
            font-size: 0.8em;
            opacity: 0.7;
            margin-top: 2px;
        }
        .work-btn {
            padding: 6px 12px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
            border-radius: 2px;
            font-size: 0.85em;
            font-weight: 600;
        }
        .work-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
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
        <label>Jira Issues</label>
        <div id="issuesList" style="max-height: 300px; overflow-y: auto; border: 1px solid var(--vscode-input-border); border-radius: 2px; padding: 5px;">
            <div style="text-align: center; padding: 20px; opacity: 0.6;">No issues loaded. Click "Refresh Issues" below.</div>
        </div>
        <button class="small-btn" onclick="configureJira()">⚙️ Configure Jira</button>
        <button class="small-btn" onclick="fetchIssues()">🔄 Refresh Issues</button>
        <div class="status" id="jiraStatus"></div>
    </div>
    
    <button onclick="executePrompt()" id="sendBtn">
        ▶ Send to Copilot
    </button>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function browseDirectory() {
            vscode.postMessage({ type: 'browseDirectory' });
        }
        
        function configureJira() {
            vscode.postMessage({ type: 'configureJira' });
        }
        
        function fetchIssues() {
            document.getElementById('jiraStatus').textContent = 'Fetching issues...';
            vscode.postMessage({ type: 'fetchJiraIssues' });
        }
        
        function startWork(issueKey) {
            const directory = document.getElementById('codeDirectory').value;
            
            if (!directory) {
                alert('Please select a code directory first');
                return;
            }
            
            vscode.postMessage({ 
                type: 'startWork',
                directory: directory,
                issueKey: issueKey
            });
        }
        
        function executePrompt() {
            alert('Please use the "Start Work" button on an issue instead');
        }
        
        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'setDirectory') {
                document.getElementById('codeDirectory').value = message.path;
            } else if (message.type === 'setIssues') {
                const issuesList = document.getElementById('issuesList');
                issuesList.innerHTML = '';
                
                if (message.issues.length === 0) {
                    issuesList.innerHTML = '<div style="text-align: center; padding: 20px; opacity: 0.6;">No issues found</div>';
                } else {
                    message.issues.forEach(issue => {
                        const issueDiv = document.createElement('div');
                        issueDiv.className = 'issue-item';
                        
                        const infoDiv = document.createElement('div');
                        infoDiv.className = 'issue-info';
                        infoDiv.innerHTML = '<div class="issue-key">' + issue.key + '</div>' +
                                           '<div class="issue-summary">' + issue.summary + '</div>' +
                                           '<div class="issue-status">Status: ' + issue.status + ' | Priority: ' + issue.priority + '</div>';
                        
                        const btn = document.createElement('button');
                        btn.className = 'work-btn';
                        btn.textContent = '▶ Start Work';
                        btn.onclick = function() { startWork(issue.key); };
                        
                        issueDiv.appendChild(infoDiv);
                        issueDiv.appendChild(btn);
                        issuesList.appendChild(issueDiv);
                    });
                }
                
                document.getElementById('jiraStatus').textContent = 'Found ' + message.issues.length + ' issue(s)';
            } else if (message.type === 'setStatus') {
                document.getElementById('jiraStatus').textContent = message.status;
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
    const provider = new CopilotContextViewProvider(context.extensionUri, context);
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
