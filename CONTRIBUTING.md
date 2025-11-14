# Development Guide

## Prerequisites

- Node.js (v20.x or higher)
- npm
- Visual Studio Code (v1.85.0 or higher)

## Setup

1. Clone the repository:
```bash
git clone https://github.com/RamNull/congenial-pancake.git
cd congenial-pancake
```

2. Install dependencies:
```bash
npm install
```

3. Compile the TypeScript code:
```bash
npm run compile
```

## Development

### Building

To compile the extension:
```bash
npm run compile
```

To watch for changes and auto-compile:
```bash
npm run watch
```

### Linting

Run ESLint to check code quality:
```bash
npm run lint
```

### Testing

Run the test suite:
```bash
npm test
```

Note: Tests require VS Code to be available and may download it automatically on first run.

## Debugging

1. Open the project in VS Code
2. Press `F5` to launch the Extension Development Host
3. A new VS Code window will open with the extension loaded
4. Test the extension by opening the Command Palette (`Ctrl+Shift+P`) and running `Execute Copilot Prompt with Context`

### Debug Configurations

Two debug configurations are available in `.vscode/launch.json`:

- **Run Extension**: Launches the extension in debug mode
- **Extension Tests**: Runs the test suite in debug mode

## Packaging

To create a `.vsix` package for distribution:

1. Install vsce (if not already installed):
```bash
npm install -g @vscode/vsce
```

2. Package the extension:
```bash
vsce package
```

This will create a `.vsix` file that can be installed in VS Code.

## Publishing

To publish to the VS Code Marketplace:

1. Get a Personal Access Token from Azure DevOps
2. Login with vsce:
```bash
vsce login RamNull
```

3. Publish:
```bash
vsce publish
```

## Project Structure

```
.
├── src/                    # Source TypeScript files
│   ├── extension.ts       # Main extension entry point
│   └── test/              # Test files
│       ├── runTest.ts     # Test runner
│       └── suite/         # Test suites
├── out/                   # Compiled JavaScript (generated)
├── .vscode/               # VS Code configuration
│   ├── launch.json       # Debug configurations
│   └── tasks.json        # Build tasks
├── package.json           # Extension manifest
├── tsconfig.json          # TypeScript configuration
├── .eslintrc.json        # ESLint configuration
├── README.md             # Main documentation
├── USAGE.md              # Usage examples
├── CHANGELOG.md          # Version history
└── LICENSE               # MIT License
```

## Code Quality

The project maintains high code quality through:

- **TypeScript**: Strong typing for better code safety
- **ESLint**: Code style and quality checks
- **Tests**: Automated testing with Mocha
- **Type Safety**: Strict TypeScript configuration

## Making Changes

1. Create a new branch for your feature
2. Make your changes
3. Run `npm run compile` and `npm run lint`
4. Test your changes with `F5`
5. Commit and push your changes
6. Create a pull request

## Common Issues

### TypeScript Version Warning

You may see a warning about TypeScript version compatibility with ESLint. This is expected and doesn't affect functionality.

### Extension Not Loading

If the extension doesn't load in the Extension Development Host:
1. Check the console for errors
2. Ensure `npm run compile` completed successfully
3. Verify `package.json` has correct activation events

### Tests Failing

If tests fail:
1. Ensure VS Code is fully installed
2. Check that dependencies are installed: `npm install`
3. Compile the code: `npm run compile`
4. Try running tests again: `npm test`

## Support

For issues or questions:
- Open an issue on GitHub
- Check the README.md and USAGE.md for documentation
