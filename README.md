# or_claude

A cloud-based AI coding agent that runs anywhere via OpenRouter - works like Ollama but fully cloud-based. Claude Code-like tool-using terminal assistant.

## Features

- **Cloud-powered AI**: Uses OpenRouter API for AI responses
- **Local fallback**: Automatically falls back to local Ollama if rate limited
- **Tool-using agent**: Can read/write files, search code, run commands, use git
- **AST editing**: Safe code refactoring with AST-based transformations
- **Git integration**: Status, diff, commit, rollback
- **Interactive mode**: REPL-style agent for coding tasks

## Installation

```bash
# Clone the repository
git clone https://github.com/sham435/or_claude_agent.git ~/.or_claude

# Install dependencies
cd ~/.or_claude
npm install

# Add to PATH
echo 'export PATH="$HOME/.or_claude:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

## Configuration

Edit `~/.or_claude/settings.json`:

```json
{
  "ANTHROPIC_BASE_URL": "https://openrouter.ai/api",
  "ANTHROPIC_API_KEY": "your-openrouter-api-key",
  "ANTHROPIC_MODEL": "qwen/qwen3.6-plus-preview:free",
  "OLLAMA_MODEL": "deepseek-r1:8b"
}
```

## Usage

### Quick prompt
```bash
or_claude run "What is 2+2?"
```

### Interactive agent
```bash
or_claude-agent
```

Commands:
- `<prompt>` - Ask AI to do something
- `run:<cmd>` - Execute shell command
- `cd:<dir>` - Change directory
- `read:<file>` - Read file
- `write:<file> <content>` - Write file
- `glob:<pattern>` - Find files
- `grep:<pattern> [path]` - Search code

## Available Tools

- `read_file` - Read file contents
- `write_file` - Write content to file
- `list_files` - List files matching pattern
- `search_code` - Search for code patterns
- `run_command` - Execute shell commands
- `ast_edit` - AST-based safe code editing
- `add_import` - Add imports safely
- `git_status`, `git_diff`, `git_commit`, `git_rollback` - Git operations

## Requirements

- Node.js 18+
- OpenRouter API key (free tier available)
- Optional: Ollama for local fallback

## License

MIT