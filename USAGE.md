# Usage Examples

This document provides practical examples of using the Copilot Context Executor extension.

## Basic Usage

### 1. Analyzing a New Codebase

**Scenario**: You've cloned a new repository and want to understand its architecture.

1. Open VS Code
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
3. Type and select: `Execute Copilot Prompt with Context`
4. Select the cloned repository directory
5. Enter prompt: `Explain the architecture of this codebase and identify the main components`

### 2. Finding Security Issues

**Scenario**: You want to audit your code for security vulnerabilities.

1. Open Command Palette
2. Select: `Execute Copilot Prompt with Context`
3. Choose your project directory
4. Enter prompt: `Analyze this codebase for security vulnerabilities, focusing on authentication, input validation, and data handling`

### 3. Code Quality Assessment

**Scenario**: Preparing for a code review and want to identify areas for improvement.

1. Execute the command
2. Select your codebase
3. Enter prompt: `Review this code and suggest improvements for:
   - Code quality and maintainability
   - Performance optimization opportunities
   - Best practices adherence
   - Test coverage gaps`

### 4. Documentation Generation

**Scenario**: Need to create or update project documentation.

1. Execute the command
2. Select your project directory
3. Enter prompt: `Generate comprehensive API documentation for this project, including:
   - Public interfaces and their usage
   - Configuration options
   - Integration examples
   - Common use cases`

### 5. Refactoring Suggestions

**Scenario**: Legacy codebase that needs modernization.

1. Execute the command
2. Select the codebase directory
3. Enter prompt: `Analyze this codebase and provide specific refactoring suggestions to:
   - Improve code modularity
   - Reduce code duplication
   - Apply modern JavaScript/TypeScript patterns
   - Enhance error handling`

### 6. Migration Planning

**Scenario**: Planning to migrate from one technology to another.

1. Execute the command
2. Select your current codebase
3. Enter prompt: `Analyze this Express.js application and create a migration plan to Fastify, including:
   - Key differences to address
   - Step-by-step migration approach
   - Potential challenges and solutions
   - Testing strategy`

## Advanced Examples

### Multi-part Analysis

For complex analysis tasks, you can:

1. Run an initial broad analysis
2. Based on results, run focused follow-up analyses on specific areas

**Example**:
- First prompt: `Provide an overview of this codebase structure`
- Follow-up: `Deep dive into the authentication module and suggest improvements`

### Custom Workflows

Create a workflow for regular code audits:

1. **Weekly Security Audit**
   - Prompt: `Scan for security issues introduced in the last week`

2. **Performance Review**
   - Prompt: `Identify performance bottlenecks in the application`

3. **Technical Debt Assessment**
   - Prompt: `List technical debt items with priority rankings`

## Tips

- **Be Specific**: More detailed prompts yield better results
- **Context Matters**: The extension passes full workspace context, so Copilot has complete visibility
- **Iterative Approach**: Start broad, then narrow down based on initial findings
- **Save Useful Prompts**: Keep a list of prompts that work well for your workflow

## Integration with Development Workflow

### During Code Review
Use the extension to get AI-assisted code review feedback before submitting PRs.

### During Onboarding
New team members can use it to understand the codebase faster.

### During Debugging
Ask for help identifying root causes of bugs with full context awareness.

### During Planning
Use it to estimate complexity and identify dependencies before starting new features.
