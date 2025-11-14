# Copilot Context Executor

A VS Code extension that enables you to execute GitHub Copilot prompts with full workspace context. This extension simplifies the process of analyzing codebases by automatically opening a directory and passing your prompt to GitHub Copilot Chat with complete workspace context.

## Features

- **Minimal Input Required**: Only requires two inputs:
  - Code Directory: The workspace/repository path to analyze
  - AI Prompt Payload: Your instruction or query for GitHub Copilot

- **Automatic Workflow**: The extension automatically:
  - Opens the specified codebase in VS Code
  - Passes the entire workspace context to GitHub Copilot Chat
  - Executes your prompt against the full directory

## Requirements

- VS Code version 1.85.0 or higher
- GitHub Copilot Chat extension (recommended for full functionality)

## Installation

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run compile` to build the extension
4. Press F5 to open a new VS Code window with the extension loaded

## Usage

1. Open the Command Palette (Ctrl+Shift+P or Cmd+Shift+P)
2. Type and select: `Execute Copilot Prompt with Context`
3. Select the code directory you want to analyze
4. Enter your AI prompt/instruction
5. The extension will:
   - Open the selected workspace
   - Launch GitHub Copilot Chat
   - Execute your prompt with full workspace context

### Example Prompts

- "Analyze this codebase and suggest improvements"
- "Find all security vulnerabilities in this project"
- "Generate comprehensive documentation for this API"
- "Refactor this code to follow best practices"
- "Find all TODO comments and create a prioritized list"

## How It Works

The extension accepts a minimal context object:

```typescript
interface CopilotContext {
    codeDirectory: string;    // The workspace/repository path
    aiPromptPayload: string;  // The instruction or query for Copilot
}
```

It then:
1. Opens the specified directory as a VS Code workspace
2. Activates GitHub Copilot Chat with full workspace awareness
3. Sends your prompt to Copilot Chat for execution

## Development

### Building

```bash
npm run compile
```

### Linting

```bash
npm run lint
```

### Testing

```bash
npm test
```

## Architecture

- `src/extension.ts`: Main extension entry point with activation, command registration, and core functionality
- TypeScript compilation outputs to `out/` directory
- Extension follows VS Code extension development best practices

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.