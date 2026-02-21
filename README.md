# pmcp

MCP server that lets Claude Code read and write Postman collections directly via the Postman API. No more manual export/import.

## Tools

| Tool | Description |
|---|---|
| `list_collections` | List all collections in your workspace |
| `get_collection` | Fetch full JSON of a collection by UID |
| `update_collection` | Push updated JSON back to a collection |
| `list_environments` | List all environments |
| `get_environment` | Fetch an environment by UID |

## Setup

### 1. Get your Postman API key

Go to [postman.com](https://postman.com) → Account Settings → API keys → Generate API key.

### 2. Wire into Claude Code

Edit `~/.claude/settings.json` and add:

```json
{
  "mcpServers": {
    "pmcp": {
      "command": "npx",
      "args": ["tsx", "C:/path/to/pmcp/index.ts"],
      "env": {
        "POSTMAN_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Replace `C:/path/to/pmcp` with the actual path to this folder.

### 3. Restart VS Code

Claude Code will pick up the new MCP server automatically.

## Usage

Just talk to Claude Code naturally:

> "list my Postman collections"
> "fetch my Open SharePoint collection and add a folder called Liquidações"
> "update collection abc123 with this JSON: ..."
