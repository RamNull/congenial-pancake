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
                case 'createUnitTests': {
                    await this._createUnitTests(data.directory, data.issueKey);
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

    private async _createUnitTests(directory: string, issueKey: string): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration().get<JiraConfig>('copilotContextExecutor.jiraConfig');
            if (!config) {
                vscode.window.showWarningMessage('Jira not configured');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Creating unit tests for ${issueKey}...`,
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Staging changes...' });
                await this._stageGitChanges(directory);
                
                progress.report({ message: 'Getting changeset...' });
                const changeset = await this._getGitChangeset(directory);
                
                if (!changeset || changeset.trim().length === 0) {
                    vscode.window.showWarningMessage('No changes detected. Please make code changes first.');
                    return;
                }
                
                progress.report({ message: 'Preparing unit test prompt...' });
                const unitTestPrompt = this._buildUnitTestPrompt(issueKey, changeset);
                
                progress.report({ message: 'Opening Copilot Chat...' });
                await this._sendToCopilotWithAttachments(unitTestPrompt, []);
                
                // Show success message with next steps
                vscode.window.showInformationMessage(
                    `Unit test prompt sent to Copilot! After tests are created, click "Run & Fix Tests".`
                );
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async _stageGitChanges(directory: string): Promise<void> {
        try {
            const { execSync } = await import('node:child_process');
            
            // Stage all changes
            execSync('git add .', { cwd: directory });
            
            console.log('Changes staged successfully');
        } catch (error) {
            console.error('Error staging changes:', error);
            throw new Error('Failed to stage changes. Make sure you have Git initialized.');
        }
    }

    private async _getGitChangeset(directory: string): Promise<string> {
        try {
            const { execSync } = await import('node:child_process');
            
            // Get the diff of staged changes (what will be committed)
            const diff = execSync('git diff --cached', { cwd: directory, encoding: 'utf-8' });
            
            if (!diff || diff.trim().length === 0) {
                // No staged changes, check for unstaged changes
                const unstagedDiff = execSync('git diff', { cwd: directory, encoding: 'utf-8' });
                
                if (!unstagedDiff || unstagedDiff.trim().length === 0) {
                    return '';
                }
                
                return unstagedDiff;
            }
            
            return diff;
        } catch (error) {
            console.error('Error getting git changeset:', error);
            return '';
        }
    }

    private _buildUnitTestPrompt(issueKey: string, changeset: string): string {
        return `# Unit Test Generation for ${issueKey}

## Instructions
You are reviewing the code changes for Jira issue ${issueKey}. The developer has completed their implementation and validated the code.

**Your task**: Generate comprehensive unit tests ONLY for the changed code in this changeset, then run and fix any test failures.

## Requirements

### 1. Analyze the Git Diff
Identify:
- New functions/methods that need testing
- Modified functions/methods that need updated tests
- Edge cases and error conditions
- Changed file locations and paths

### 2. Follow Project Test Folder Structure **STRICTLY**
**CRITICAL**: You MUST follow the existing test folder structure:

- **Examine the project** for existing test directories (e.g., \`test/\`, \`tests/\`, \`__tests__/\`, \`src/test/\`, etc.)
- **Check for unit test subdirectory**: Look for \`test/unit/\`, \`tests/unit/\`, \`__tests__/unit/\` patterns
- **Mirror the source structure**: If source is at \`src/services/cart.ts\`, test should be at \`test/unit/services/cart.test.ts\`
- **Use correct naming convention**: Check existing test files for naming patterns:
  - \`.test.ts\`, \`.spec.ts\`, \`_test.py\`, \`Test.java\`, etc.
- **Respect directory hierarchy**: Match the exact folder structure of source files
- **Check for test configuration**: Look for test config files (jest.config.js, pytest.ini, etc.) that define test paths

**Example Structures**:
- Java: \`src/main/java/com/example/Service.java\` → \`src/test/java/com/example/ServiceTest.java\`
- Python: \`src/services/cart.py\` → \`tests/unit/services/test_cart.py\`
- TypeScript/Node: \`src/services/cart.ts\` → \`test/unit/services/cart.test.ts\`
- TypeScript Alt: \`src/services/cart.ts\` → \`__tests__/unit/services/cart.spec.ts\`
- Node.js: \`lib/utils/helper.js\` → \`test/unit/utils/helper.test.js\`

**Common Patterns**:
- \`test/unit/\` for unit tests, \`test/integration/\` for integration tests
- \`tests/unit/\` and \`tests/integration/\` separation
- \`__tests__/unit/\` in some JavaScript/TypeScript projects

### 3. Create Quality Unit Tests
- Test all new functionality
- Cover happy path and edge cases
- Test error handling
- Follow the project's existing test patterns
- Have clear, descriptive test names
- Include necessary imports and setup/teardown

## Changeset (Git Diff)

\`\`\`diff
${changeset}
\`\`\`

## Action Items
1. **FIRST**: Examine the project structure to identify the test folder pattern (especially check for \`test/unit/\` or \`tests/unit/\`)
2. Review the changes above
3. Generate unit test files in the **CORRECT test directory structure** (including the \`unit\` subdirectory if it exists)
4. **RUN the tests** using the project's test command (npm test, pytest, mvn test, etc.)
5. **Fix any failing tests** - analyze failures and correct the test code
6. **Re-run tests** until all tests pass
7. Report the test results (number of tests, pass/fail status, file locations)

**IMPORTANT**: 
- You must follow the exact test folder structure of the project (including \`unit/\` subdirectory)
- You must run the tests and fix any failures
- Do not just generate test code - execute and validate it!

Please generate and run the unit tests now.`;
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
                title: `Starting work on ${issueKey}...`,
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Transitioning status to In Progress...' });
                await this._transitionIssueToInProgress(config, issueKey);
                
                progress.report({ message: 'Loading issue details...' });
                const result = await this._fetchFullIssueDetailsWithAttachments(config, issueKey);
                
                // Add instruction about unit tests
                const contextWithInstructions = result.context + 
                    `\n\n---\n**IMPORTANT INSTRUCTIONS:**\n` +
                    `1. Implement the required changes for this issue\n` +
                    `2. Validate your implementation if its running or not just by running the basic health check\n` +
                    `3. **DO NOT create unit tests yet** - unit tests will be created in a separate step after you validate the code\n` +
                    `4. Once you've validated the code changes, click the "Create Unit Tests" button to generate tests for your changeset\n` +
                    `5. The unit test generation will analyze only the files you've changed\n`;
                
                progress.report({ message: 'Setting up Git repository...' });
                const issueType = await this._getIssueType(config, issueKey);
                await this._setupGitBranch(directory, issueKey, issueType, progress);
                
                progress.report({ message: 'Opening workspace...' });
                await this._executeWithContextAndFiles(directory, contextWithInstructions, result.attachmentFiles, issueKey, issueType);
                
                // Refresh the issue list to update button states
                progress.report({ message: 'Refreshing issue list...' });
                await this._fetchJiraIssues();
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async _getIssueType(config: JiraConfig, issueKey: string): Promise<string> {
        try {
            const authHeader = config.type === 'cloud'
                ? 'Basic ' + Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')
                : 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');

            const baseUrl = config.url.endsWith('/') ? config.url.slice(0, -1) : config.url;
            const apiPath = config.type === 'cloud' ? '/rest/api/3/issue/' : '/rest/api/2/issue/';
            const url = `${baseUrl}${apiPath}${issueKey}?fields=issuetype,labels`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': authHeader,
                    'Accept': 'application/json'
                }
            });

            if (response.ok) {
                const issue = await response.json() as any;
                const issueTypeName = issue.fields.issuetype.name.toLowerCase();
                const labels = (issue.fields.labels || []).map((l: string) => l.toLowerCase());
                
                // Check labels first for bug indicator
                if (labels.some((l: string) => l.includes('bug') || l.includes('defect') || l.includes('fix'))) {
                    return 'bug';
                }
                
                // Check issue type
                if (issueTypeName.includes('bug') || issueTypeName.includes('defect')) {
                    return 'bug';
                }
                
                return 'feature';
            }
        } catch (error) {
            console.log('Could not determine issue type, defaulting to feature:', error);
        }
        
        return 'feature';
    }

    private async _setupGitBranch(directory: string, issueKey: string, issueType: string, progress: vscode.Progress<{ message?: string }>): Promise<void> {
        try {
            const { execSync } = await import('node:child_process');
            
            // Check if directory is a git repository
            try {
                execSync('git rev-parse --git-dir', { cwd: directory, stdio: 'pipe' });
            } catch {
                // Not a git repo, initialize it
                progress.report({ message: 'Initializing Git repository...' });
                execSync('git init', { cwd: directory });
                execSync('git add .', { cwd: directory });
                execSync('git commit -m "Initial commit"', { cwd: directory });
                execSync('git branch -M main', { cwd: directory });
                vscode.window.showInformationMessage('Git repository initialized with main branch');
            }
            
            // Get current branch
            const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: directory }).toString().trim();
            
            // Ensure we have a main branch
            progress.report({ message: 'Checking main branch...' });
            const branches = execSync('git branch', { cwd: directory }).toString();
            
            if (!branches.includes('main')) {
                // Create main branch from current branch
                execSync('git branch main', { cwd: directory });
            }
            
            // Switch to main and pull latest (if remote exists)
            if (currentBranch !== 'main') {
                progress.report({ message: 'Switching to main branch...' });
                execSync('git checkout main', { cwd: directory });
            }
            
            // Try to pull latest from remote
            try {
                progress.report({ message: 'Pulling latest from remote...' });
                execSync('git pull origin main', { cwd: directory, stdio: 'pipe' });
            } catch {
                console.log('No remote or pull failed, continuing with local main');
            }
            
            // Create new branch based on issue type
            const branchPrefix = issueType === 'bug' ? 'bug' : 'feature';
            const branchName = `${branchPrefix}/${issueKey.toLowerCase()}`;
            
            progress.report({ message: `Creating branch ${branchName}...` });
            
            // Check if branch already exists
            try {
                execSync(`git checkout ${branchName}`, { cwd: directory, stdio: 'pipe' });
                vscode.window.showInformationMessage(`Switched to existing branch: ${branchName}`);
            } catch {
                // Branch doesn't exist, create it
                execSync(`git checkout -b ${branchName}`, { cwd: directory });
                vscode.window.showInformationMessage(`Created and switched to new branch: ${branchName}`);
            }
            
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error('Git setup error:', errorMsg);
            vscode.window.showWarningMessage(
                `Git setup failed: ${errorMsg}. Continuing without Git setup.`
            );
            // Don't throw - allow workflow to continue
        }
    }

    private async _transitionIssueToInProgress(config: JiraConfig, issueKey: string): Promise<void> {
        try {
            const authHeader = config.type === 'cloud'
                ? 'Basic ' + Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')
                : 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');

            const baseUrl = config.url.endsWith('/') ? config.url.slice(0, -1) : config.url;
            const apiPath = config.type === 'cloud' ? '/rest/api/3/issue/' : '/rest/api/2/issue/';

            // First, get available transitions for this issue
            const transitionsUrl = `${baseUrl}${apiPath}${issueKey}/transitions`;
            const transitionsResponse = await fetch(transitionsUrl, {
                method: 'GET',
                headers: {
                    'Authorization': authHeader,
                    'Accept': 'application/json'
                }
            });

            if (!transitionsResponse.ok) {
                throw new Error(`Failed to get transitions for ${issueKey}: ${transitionsResponse.status}`);
            }

            const transitionsData = await transitionsResponse.json() as any;
            const transitions = transitionsData.transitions || [];

            // Find the "In Progress" transition (may have different names)
            const inProgressTransition = transitions.find((t: any) => 
                t.name.toLowerCase().includes('in progress') || 
                t.name.toLowerCase().includes('start') ||
                t.to.name.toLowerCase().includes('in progress')
            );

            if (!inProgressTransition) {
                // If no "In Progress" transition found, check if already in progress
                const issueUrl = `${baseUrl}${apiPath}${issueKey}?fields=status`;
                const issueResponse = await fetch(issueUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': authHeader,
                        'Accept': 'application/json'
                    }
                });

                if (issueResponse.ok) {
                    const issueData = await issueResponse.json() as any;
                    const currentStatus = issueData.fields.status.name.toLowerCase();
                    
                    if (currentStatus.includes('in progress') || currentStatus.includes('active')) {
                        vscode.window.showInformationMessage(`${issueKey} is already in progress`);
                        return;
                    }
                }

                console.warn(`No "In Progress" transition available for ${issueKey}. Available transitions:`, 
                    transitions.map((t: any) => t.name).join(', '));
                vscode.window.showWarningMessage(
                    `Could not auto-transition ${issueKey} to "In Progress". Current workflow may not support this transition.`
                );
                return;
            }

            // Transition the issue to "In Progress"
            const transitionUrl = `${baseUrl}${apiPath}${issueKey}/transitions`;
            const transitionResponse = await fetch(transitionUrl, {
                method: 'POST',
                headers: {
                    'Authorization': authHeader,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    transition: {
                        id: inProgressTransition.id
                    }
                })
            });

            if (!transitionResponse.ok) {
                const errorText = await transitionResponse.text();
                throw new Error(`Failed to transition ${issueKey}: ${transitionResponse.status} - ${errorText}`);
            }

            vscode.window.showInformationMessage(`${issueKey} transitioned to "In Progress"`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error('Error transitioning issue:', errorMsg);
            vscode.window.showWarningMessage(
                `Could not update status to "In Progress": ${errorMsg}`
            );
            // Don't throw - allow the workflow to continue even if transition fails
        }
    }

    private async _fetchFullIssueDetailsWithAttachments(config: JiraConfig, issueKey: string): Promise<{ context: string; attachmentFiles: string[] }> {
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
        const attachmentFiles: string[] = [];

        // Build comprehensive context
        let context = await this._buildIssueContext(issue, authHeader, attachmentFiles);

        return { context, attachmentFiles };
    }

    private async _buildIssueContext(issue: any, authHeader: string, attachmentFiles: string[]): Promise<string> {
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
            if (typeof issue.fields.description === 'string') {
                context += issue.fields.description;
            } else if (issue.fields.description.content) {
                context += this._extractTextFromADF(issue.fields.description);
            } else {
                context += JSON.stringify(issue.fields.description, null, 2);
            }
        } else {
            context += 'No description provided.';
        }

        // Comments
        if (issue.fields.comment && issue.fields.comment.comments && issue.fields.comment.comments.length > 0) {
            context += `\n\n## Comments (${issue.fields.comment.total})\n`;
            issue.fields.comment.comments.forEach((comment: any, index: number) => {
                context += `\n### Comment ${index + 1} by ${comment.author.displayName} (${comment.created})\n`;
                
                let commentText = '';
                if (typeof comment.body === 'string') {
                    commentText = comment.body;
                } else if (comment.body && comment.body.content) {
                    commentText = this._extractTextFromADF(comment.body);
                } else {
                    commentText = JSON.stringify(comment.body, null, 2);
                }
                
                context += commentText + '\n';
            });
        }

        // Attachments - Download to workspace .jira-context folder
        if (issue.fields.attachment && issue.fields.attachment.length > 0) {
            context += `\n## Attachments (${issue.fields.attachment.length})\n`;
            context += `*Note: Attachment files have been downloaded to .jira-context/${issue.key}/ and opened in the editor for Copilot to reference.*\n\n`;
            
            const fs = await import('node:fs');
            const path = await import('node:path');
            
            // Get workspace folder - will be created in the target directory
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                context += `  ⚠ No workspace open - attachments cannot be downloaded\n`;
                return context;
            }
            
            // Create .jira-context directory for attachments
            const jiraContextDir = path.join(workspaceRoot, '.jira-context', issue.key);
            if (!fs.existsSync(jiraContextDir)) {
                fs.mkdirSync(jiraContextDir, { recursive: true });
            }
            
            for (const att of issue.fields.attachment) {
                context += `- **${att.filename}** (${Math.round(att.size / 1024)} KB) - ${att.mimeType}\n`;
                
                // Download attachments that are useful for Copilot (< 5MB)
                const maxSize = 5 * 1024 * 1024;
                
                if (att.size < maxSize) {
                    try {
                        const attachmentResponse = await fetch(att.content, {
                            method: 'GET',
                            headers: {
                                'Authorization': authHeader,
                                'Accept': '*/*'
                            }
                        });
                        
                        if (attachmentResponse.ok) {
                            const buffer = Buffer.from(await attachmentResponse.arrayBuffer());
                            const filePath = path.join(jiraContextDir, att.filename);
                            fs.writeFileSync(filePath, buffer);
                            attachmentFiles.push(filePath);
                            context += `  ✓ Downloaded to .jira-context/${issue.key}/${att.filename}\n`;
                        }
                    } catch (downloadError) {
                        context += `  ⚠ Could not download (URL: ${att.content})\n`;
                    }
                } else {
                    context += `  ⚠ Too large to include (${Math.round(att.size / 1024 / 1024)} MB)\n`;
                }
            }
            context += '\n';
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

        // Add explicit instruction to use the attachment files
        if (attachmentFiles.length > 0) {
            context += `\n\n---\n**Attachment Files Context:**\nThe following files from the Jira issue have been downloaded and are now in the workspace:\n`;
            for (const filePath of attachmentFiles) {
                const fileName = filePath.split(/[\\/]/).pop() || filePath;
                context += `- ${fileName}\n`;
            }
            context += `\nPlease review these files as they contain important context for this task.\n`;
        }
        
        context += `\n**Task:** Analyze this codebase and the attached files to provide guidance on implementing this Jira issue. Suggest an implementation approach and identify relevant files that need to be modified.`;

        return context;
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
            if (typeof issue.fields.description === 'string') {
                context += issue.fields.description;
            } else if (issue.fields.description.content) {
                // Parse Jira's ADF (Atlassian Document Format)
                context += this._extractTextFromADF(issue.fields.description);
            } else {
                context += JSON.stringify(issue.fields.description, null, 2);
            }
        } else {
            context += 'No description provided.';
        }

        // Comments
        if (issue.fields.comment && issue.fields.comment.comments && issue.fields.comment.comments.length > 0) {
            context += `\n\n## Comments (${issue.fields.comment.total})\n`;
            issue.fields.comment.comments.forEach((comment: any, index: number) => {
                context += `\n### Comment ${index + 1} by ${comment.author.displayName} (${comment.created})\n`;
                
                // Extract text from Jira's structured comment format
                let commentText = '';
                if (typeof comment.body === 'string') {
                    commentText = comment.body;
                } else if (comment.body && comment.body.content) {
                    // Parse Jira's ADF (Atlassian Document Format)
                    commentText = this._extractTextFromADF(comment.body);
                } else {
                    commentText = JSON.stringify(comment.body, null, 2);
                }
                
                context += commentText + '\n';
            });
        }

        // Attachments
        if (issue.fields.attachment && issue.fields.attachment.length > 0) {
            context += `\n## Attachments (${issue.fields.attachment.length})\n`;
            
            for (const att of issue.fields.attachment) {
                context += `\n### ${att.filename} (${Math.round(att.size / 1024)} KB)\n`;
                context += `- **Type:** ${att.mimeType}\n`;
                context += `- **URL:** ${att.content}\n`;
                
                // Download and include attachment content for text files, images, and documents
                const isTextFile = att.mimeType?.includes('text/') || 
                                   att.mimeType?.includes('application/json') ||
                                   att.mimeType?.includes('application/yaml') ||
                                   att.mimeType?.includes('application/yml') ||
                                   att.filename?.endsWith('.md') ||
                                   att.filename?.endsWith('.txt') ||
                                   att.filename?.endsWith('.json') ||
                                   att.filename?.endsWith('.yaml') ||
                                   att.filename?.endsWith('.yml') ||
                                   att.filename?.endsWith('.xml');
                
                const isImage = att.mimeType?.startsWith('image/');
                const isDocument = att.mimeType?.includes('application/pdf') ||
                                   att.mimeType?.includes('application/msword') ||
                                   att.mimeType?.includes('application/vnd.openxmlformats');
                
                // Only download if file is reasonably sized (< 5MB for text, < 2MB for images/docs)
                const maxSize = isTextFile ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
                
                if ((isTextFile || isImage || isDocument) && att.size < maxSize) {
                    try {
                        const attachmentResponse = await fetch(att.content, {
                            method: 'GET',
                            headers: {
                                'Authorization': authHeader,
                                'Accept': '*/*'
                            }
                        });
                        
                        if (attachmentResponse.ok) {
                            if (isTextFile) {
                                // Include text content directly
                                const textContent = await attachmentResponse.text();
                                context += `\n**Content:**\n\`\`\`\n${textContent}\n\`\`\`\n`;
                            } else if (isImage) {
                                // For images, note that they're available (Copilot can access via URL)
                                context += `\n**Note:** Image file available at the URL above. Copilot can reference this image.\n`;
                            } else if (isDocument) {
                                // For documents, note availability
                                context += `\n**Note:** Document file available at the URL above.\n`;
                            }
                        }
                    } catch (downloadError) {
                        context += `\n**Note:** Could not download attachment content. File available at URL above.\n`;
                    }
                } else if (att.size >= maxSize) {
                    context += `\n**Note:** File too large to include in context (${Math.round(att.size / 1024 / 1024)} MB). URL provided above.\n`;
                }
                
                context += '\n';
            }
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

    /**
     * Extract readable text from Jira's Atlassian Document Format (ADF)
     */
    private _extractTextFromADF(adf: any): string {
        if (!adf || !adf.content) {
            return '';
        }

        let text = '';
        
        const processNode = (node: any): string => {
            let result = '';
            
            if (node.type === 'text') {
                result += node.text;
            } else if (node.type === 'hardBreak') {
                result += '\n';
            } else if (node.type === 'paragraph') {
                if (node.content) {
                    node.content.forEach((child: any) => {
                        result += processNode(child);
                    });
                }
                result += '\n\n';
            } else if (node.type === 'heading') {
                const level = node.attrs?.level || 1;
                const prefix = '#'.repeat(level);
                if (node.content) {
                    result += prefix + ' ';
                    node.content.forEach((child: any) => {
                        result += processNode(child);
                    });
                }
                result += '\n\n';
            } else if (node.type === 'bulletList' || node.type === 'orderedList') {
                if (node.content) {
                    node.content.forEach((item: any, index: number) => {
                        const bullet = node.type === 'bulletList' ? '- ' : `${index + 1}. `;
                        result += bullet + processNode(item).trim() + '\n';
                    });
                }
                result += '\n';
            } else if (node.type === 'listItem') {
                if (node.content) {
                    node.content.forEach((child: any) => {
                        result += processNode(child).trim() + ' ';
                    });
                }
            } else if (node.type === 'codeBlock') {
                result += '```\n';
                if (node.content) {
                    node.content.forEach((child: any) => {
                        result += processNode(child);
                    });
                }
                result += '\n```\n\n';
            } else if (node.type === 'inlineCard' || node.type === 'blockCard') {
                const url = node.attrs?.url || '';
                result += url ? `[${url}](${url})` : '';
            } else if (node.content) {
                // Generic handler for nodes with content
                node.content.forEach((child: any) => {
                    result += processNode(child);
                });
            }
            
            return result;
        };

        adf.content.forEach((node: any) => {
            text += processNode(node);
        });

        return text.trim();
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

    private async _executeWithContextAndFiles(directory: string, payload: string, attachmentFiles: string[], issueKey?: string, issueType?: string): Promise<void> {
        try {
            const folderUri = vscode.Uri.file(directory);
            const currentWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            
            // Check if the directory is already open
            if (currentWorkspace === directory) {
                // Directory is already open, execute prompt with attachments
                await this._sendToCopilotWithAttachments(payload, attachmentFiles);
            } else {
                // Different directory, need to open it
                // Save the payload and attachments to execute after reload
                await vscode.workspace.getConfiguration().update(
                    'copilotContextExecutor.pendingPrompt', 
                    payload, 
                    vscode.ConfigurationTarget.Global
                );
                
                await vscode.workspace.getConfiguration().update(
                    'copilotContextExecutor.pendingAttachments', 
                    attachmentFiles, 
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

    private async _sendToCopilotWithAttachments(payload: string, attachmentFiles: string[]): Promise<void> {
        // Open attachment files in editor tabs so Copilot can access them
        if (attachmentFiles.length > 0) {
            for (const filePath of attachmentFiles) {
                const uri = vscode.Uri.file(filePath);
                await vscode.window.showTextDocument(uri, { preview: false, preserveFocus: true });
            }
            // Small delay to ensure files are loaded
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Try to send prompt to Copilot Chat using the working method
        try {
            await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
            await new Promise(resolve => setTimeout(resolve, 500));

            await vscode.commands.executeCommand('workbench.action.chat.open', {
                query: payload
            });
            
            const attachmentCount = attachmentFiles.length;
            if (attachmentCount > 0) {
                const fileNames = attachmentFiles.map(f => f.split(/[\\/]/).pop()).join(', ');
                vscode.window.showInformationMessage(
                    `Prompt sent to Copilot Chat! ${attachmentCount} file(s) opened: ${fileNames}`
                );
            } else {
                vscode.window.showInformationMessage('Prompt sent to Copilot Chat!');
            }
        } catch (error) {
            console.log('Failed to send prompt automatically:', error);
            // Fallback: copy to clipboard
            const attachmentCount = attachmentFiles.length;
            let attachmentMsg = '';
            
            if (attachmentCount > 0) {
                const fileNames = attachmentFiles.map(f => f.split(/[\\/]/).pop()).join(', ');
                attachmentMsg = `\n\nAttachments opened: ${fileNames}`;
            }
            
            vscode.window.showInformationMessage(
                `Copy this prompt to Copilot Chat: ${payload}${attachmentMsg}`,
                'Copy Prompt'
            ).then(selection => {
                if (selection === 'Copy Prompt') {
                    vscode.env.clipboard.writeText(payload);
                    vscode.window.showInformationMessage('Prompt copied to clipboard!');
                }
            });
        }
    }

    private async _executeWithContext(directory: string, payload: string): Promise<void> {
        await this._executeWithContextAndFiles(directory, payload, []);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Copilot Context Executor</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            padding: 0;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
        }
        .section {
            padding: 12px 16px;
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
        }
        .section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .section-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            color: var(--vscode-sideBarTitle-foreground);
            letter-spacing: 0.5px;
        }
        .input-field {
            width: 100%;
            padding: 4px 8px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            font-size: 13px;
            font-family: var(--vscode-font-family);
        }
        .input-field:focus {
            outline: 1px solid var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder);
        }
        .input-field:read-only {
            color: var(--vscode-input-placeholderForeground);
        }
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 4px 12px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
            font-size: 13px;
            font-family: var(--vscode-font-family);
            font-weight: 400;
            white-space: nowrap;
        }
        .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .btn:active {
            background-color: var(--vscode-button-background);
            opacity: 0.9;
        }
        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .btn-icon {
            padding: 4px 8px;
            font-size: 11px;
        }
        .button-group {
            display: flex;
            gap: 8px;
            margin-top: 8px;
        }
        .issues-container {
            max-height: calc(100vh - 300px);
            overflow-y: auto;
            margin-top: 8px;
        }
        .issue-card {
            padding: 12px;
            margin-bottom: 8px;
            background-color: var(--vscode-list-inactiveSelectionBackground);
            border-left: 3px solid var(--vscode-textLink-foreground);
            cursor: pointer;
            transition: background-color 0.1s;
        }
        .issue-card:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .issue-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
        }
        .issue-key {
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
            font-family: var(--vscode-editor-font-family);
        }
        .issue-type-badge {
            font-size: 10px;
            padding: 2px 6px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 2px;
            text-transform: uppercase;
            font-weight: 600;
        }
        .issue-title {
            font-size: 13px;
            font-weight: 500;
            color: var(--vscode-foreground);
            margin-bottom: 8px;
            line-height: 1.4;
        }
        .issue-description {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
            line-height: 1.5;
            max-height: 60px;
            overflow: hidden;
            text-overflow: ellipsis;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
        }
        .issue-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
        }
        .meta-item {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .meta-label {
            opacity: 0.7;
        }
        .meta-value {
            font-weight: 500;
        }
        .status-badge {
            padding: 2px 6px;
            border-radius: 2px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .status-todo {
            background-color: rgba(100, 100, 100, 0.2);
            color: var(--vscode-foreground);
        }
        .status-inprogress {
            background-color: rgba(33, 150, 243, 0.2);
            color: #2196F3;
        }
        .status-done {
            background-color: rgba(76, 175, 80, 0.2);
            color: #4CAF50;
        }
        .priority-high {
            color: #f44336;
        }
        .priority-medium {
            color: #ff9800;
        }
        .priority-low {
            color: #4caf50;
        }
        .issue-actions {
            display: flex;
            gap: 8px;
            margin-top: 8px;
        }
        .btn-start {
            flex: 1;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-weight: 500;
        }
        .btn-start:hover:not(:disabled) {
            background-color: var(--vscode-button-hoverBackground);
        }
        .btn-start:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            background-color: var(--vscode-button-secondaryBackground);
        }
        .btn-test {
            flex: 1;
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            font-weight: 500;
        }
        .btn-test:hover:not(:disabled) {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .btn-test:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .empty-state {
            text-align: center;
            padding: 32px 16px;
            color: var(--vscode-descriptionForeground);
        }
        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 12px;
            opacity: 0.3;
        }
        .empty-state-text {
            font-size: 13px;
            margin-bottom: 16px;
        }
        .status-bar {
            padding: 8px 16px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            background-color: var(--vscode-sideBar-background);
            border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
        }
        ::-webkit-scrollbar {
            width: 10px;
        }
        ::-webkit-scrollbar-track {
            background: var(--vscode-scrollbarSlider-background);
        }
        ::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-hoverBackground);
        }
        ::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-activeBackground);
        }
    </style>
</head>
<body>
    <div class="section">
        <div class="section-header">
            <div class="section-title">📁 Workspace</div>
        </div>
        <input type="text" id="codeDirectory" class="input-field" placeholder="No directory selected" readonly />
        <div class="button-group">
            <button class="btn btn-secondary" onclick="browseDirectory()">Browse...</button>
        </div>
    </div>
    
    <div class="section">
        <div class="section-header">
            <div class="section-title">🎫 Jira Issues</div>
            <button class="btn-icon btn-secondary" onclick="fetchIssues()" title="Refresh Issues">🔄</button>
        </div>
        <div class="issues-container" id="issuesList">
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <div class="empty-state-text">No issues loaded</div>
                <button class="btn btn-secondary" onclick="fetchIssues()">Load Issues</button>
            </div>
        </div>
        <div class="button-group">
            <button class="btn btn-secondary" onclick="configureJira()">⚙️ Configure Jira</button>
        </div>
    </div>
    
    <div class="status-bar" id="statusBar">Ready</div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function browseDirectory() {
            vscode.postMessage({ type: 'browseDirectory' });
        }
        
        function configureJira() {
            vscode.postMessage({ type: 'configureJira' });
        }
        
        function fetchIssues() {
            updateStatus('Fetching issues...');
            vscode.postMessage({ type: 'fetchJiraIssues' });
        }
        
        function startWork(issueKey) {
            const directory = document.getElementById('codeDirectory').value;
            
            if (!directory || directory === 'No directory selected') {
                updateStatus('⚠️ Please select a workspace directory first');
                return;
            }
            
            updateStatus('Starting work on ' + issueKey + '...');
            vscode.postMessage({ 
                type: 'startWork',
                directory: directory,
                issueKey: issueKey
            });
        }
        
        function createUnitTests(issueKey) {
            const directory = document.getElementById('codeDirectory').value;
            
            if (!directory || directory === 'No directory selected') {
                updateStatus('⚠️ Please select a workspace directory first');
                return;
            }
            
            updateStatus('Creating unit tests for ' + issueKey + '...');
            vscode.postMessage({ 
                type: 'createUnitTests',
                directory: directory,
                issueKey: issueKey
            });
        }
        
        function updateStatus(message) {
            document.getElementById('statusBar').textContent = message;
        }
        
        function getStatusClass(status) {
            const statusLower = status.toLowerCase();
            if (statusLower.includes('done') || statusLower.includes('complete')) return 'status-done';
            if (statusLower.includes('progress') || statusLower.includes('active')) return 'status-inprogress';
            return 'status-todo';
        }
        
        function getPriorityClass(priority) {
            const priorityLower = priority.toLowerCase();
            if (priorityLower.includes('high') || priorityLower.includes('critical')) return 'priority-high';
            if (priorityLower.includes('medium') || priorityLower.includes('normal')) return 'priority-medium';
            return 'priority-low';
        }
        
        function truncateText(text, maxLength) {
            if (!text) return 'No description';
            const plainText = typeof text === 'string' ? text : JSON.stringify(text);
            return plainText.length > maxLength ? plainText.substring(0, maxLength) + '...' : plainText;
        }
        
        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.type === 'setDirectory') {
                document.getElementById('codeDirectory').value = message.path;
                updateStatus('Workspace: ' + message.path.split('\\\\').pop());
            } 
            else if (message.type === 'setIssues') {
                const issuesList = document.getElementById('issuesList');
                issuesList.innerHTML = '';
                
                if (message.issues.length === 0) {
                    issuesList.innerHTML = \`
                        <div class="empty-state">
                            <div class="empty-state-icon">📭</div>
                            <div class="empty-state-text">No issues found</div>
                        </div>
                    \`;
                    updateStatus('No issues found');
                } else {
                    message.issues.forEach(issue => {
                        const issueCard = document.createElement('div');
                        issueCard.className = 'issue-card';
                        
                        const statusClass = getStatusClass(issue.status);
                        const priorityClass = getPriorityClass(issue.priority);
                        const isInProgress = issue.status.toLowerCase().includes('in progress') || 
                                            issue.status.toLowerCase().includes('active');
                        
                        issueCard.innerHTML = \`
                            <div class="issue-header">
                                <span class="issue-key">\${issue.key}</span>
                                <span class="issue-type-badge">Task</span>
                            </div>
                            <div class="issue-title">\${issue.summary}</div>
                            <div class="issue-description">\${truncateText(issue.description, 150)}</div>
                            <div class="issue-meta">
                                <div class="meta-item">
                                    <span class="meta-label">Status:</span>
                                    <span class="status-badge \${statusClass}">\${issue.status}</span>
                                </div>
                                <div class="meta-item">
                                    <span class="meta-label">Priority:</span>
                                    <span class="meta-value \${priorityClass}">\${issue.priority}</span>
                                </div>
                            </div>
                            <div class="issue-actions">
                                <button class="btn btn-start" onclick="startWork('\${issue.key}')" \${isInProgress ? 'disabled' : ''}>▶ Start</button>
                                <button class="btn btn-test" onclick="createUnitTests('\${issue.key}')" \${!isInProgress ? 'disabled' : ''}>🧪 Create Unit Tests</button>
                            </div>
                        \`;
                        
                        issuesList.appendChild(issueCard);
                    });
                    updateStatus('Loaded ' + message.issues.length + ' issue(s)');
                }
            } 
            else if (message.type === 'setStatus') {
                updateStatus(message.status);
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
    const pendingAttachments = vscode.workspace.getConfiguration().get<string[]>('copilotContextExecutor.pendingAttachments');
    
    if (pendingPrompt) {
        // Clear the pending prompt and attachments
        vscode.workspace.getConfiguration().update(
            'copilotContextExecutor.pendingPrompt', 
            undefined, 
            vscode.ConfigurationTarget.Global
        );
        
        vscode.workspace.getConfiguration().update(
            'copilotContextExecutor.pendingAttachments', 
            undefined, 
            vscode.ConfigurationTarget.Global
        );
        
        // Execute the prompt after a short delay to ensure workspace is fully loaded
        setTimeout(async () => {
            try {
                // Open attachment files if available
                if (pendingAttachments && pendingAttachments.length > 0) {
                    for (const filePath of pendingAttachments) {
                        const uri = vscode.Uri.file(filePath);
                        await vscode.window.showTextDocument(uri, { preview: false, preserveFocus: true });
                    }
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
                
                await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
                await new Promise(resolve => setTimeout(resolve, 500));
                
                await vscode.commands.executeCommand('workbench.action.chat.open', {
                    query: pendingPrompt
                });
                
                const attachmentCount = pendingAttachments?.length || 0;
                let attachmentMsg = '';
                
                if (attachmentCount > 0 && pendingAttachments) {
                    const fileNames = pendingAttachments.map(f => f.split(/[\\/]/).pop()).join(', ');
                    attachmentMsg = ` (${attachmentCount} file(s) opened: ${fileNames}. Copilot will analyze them automatically!)`;
                }
                
                vscode.window.showInformationMessage(
                    `Prompt sent to Copilot Chat${attachmentMsg}`
                );
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
