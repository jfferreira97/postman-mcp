# postman-mcp

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

Go to `{yourpostmanuser}.postman.co/settings/me/api-keys` or https://www.postman.co/settings/me/api-keys and click **Generate API Key**.

<!-- screenshot: docs/api-keys.png -->

### 2. Install dependencies

```bash
npm install
```

### 3. Configure your API key

Copy `.env.example` to `.env` and fill in your key:

```bash
cp .env.example .env
```

```env
POSTMAN_API_KEY=your-api-key-here
```

### 4. Enable in Claude Code

The `.mcp.json` in this repo is already configured. Open this folder in VS Code with the Claude Code extension, go to `/mcp` → **postman-mcp** → enable it.

## Usage

Just talk to Claude Code naturally:

> "fetch my M365 collection and add a folder for subsite {subsite} matching the pattern of endpoints we have on other subsite"
> "update collection abc123 with this JSON: ..."
