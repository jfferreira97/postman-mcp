import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios from "axios";
import { z } from "zod";
import fs from "fs";
import path from "path";
import os from "os";

const POSTMAN_API_KEY = process.env.POSTMAN_API_KEY;
if (!POSTMAN_API_KEY) {
  process.stderr.write("POSTMAN_API_KEY env var is required\n");
  process.exit(1);
}

const postman = axios.create({
  baseURL: "https://api.getpostman.com",
  headers: { "X-Api-Key": POSTMAN_API_KEY },
});

const server = new McpServer({
  name: "postman-mcp",
  version: "1.0.0",
});

server.tool("list_collections", "List all Postman collections in your workspace", async () => {
  const { data } = await postman.get("/collections");
  const lines = data.collections.map((c: any) => {
    const d = new Date(c.updatedAt);
    const date = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    return `${c.name}\n- last update: ${date}\n- uid: ${c.uid}`;
  });
  return {
    content: [{ type: "text", text: lines.join("\n\n") }],
  };
});

function renderAuth(auth: any, scope: string): string {
  if (!auth) return "";
  if (auth.type === "noauth") return `[${scope}]: none — explicitly disables any inherited auth`;
  const params = (auth[auth.type] ?? []).map((p: any) => `${p.key}=${p.value}`).join(", ");
  return `[${scope}]: ${auth.type}${params ? ` (${params})` : ""}`;
}

function renderBody(body: any): string {
  if (!body) return "";
  if (body.mode === "raw") {
    const raw = (body.raw ?? "").trim();
    return raw.length > 400 ? raw.slice(0, 400) + "…" : raw;
  }
  if (body.mode === "urlencoded")
    return (body.urlencoded ?? []).map((p: any) => `${p.key}=${p.value}`).join("&");
  if (body.mode === "formdata")
    return (body.formdata ?? []).map((p: any) => `${p.key}=${p.value}`).join(", ");
  return "";
}

const SKIP_HEADERS = new Set(["content-type", "accept", "user-agent"]);

function renderTree(items: any[], indent = 0): string {
  return items.map((item: any) => {
    const prefix = "  ".repeat(indent) + "└─ ";
    const pad    = "  ".repeat(indent + 1) + "  ";

    if (item.item) {
      const authLine = item.auth ? `\n${pad}${renderAuth(item.auth, "folder-scoped-auth")}` : "";
      return `${prefix}[folder] ${item.name}${authLine}\n${renderTree(item.item, indent + 1)}`;
    }

    const req    = item.request;
    const method = req?.method ?? "?";
    const url    = req?.url?.raw ?? req?.url ?? "";

    const lines: string[] = [];

    const auth = renderAuth(req?.auth, "request-scoped-auth");
    if (auth) lines.push(`${pad}${auth}`);

    const headers = (req?.header ?? []).filter((h: any) => !SKIP_HEADERS.has(h.key?.toLowerCase()));
    if (headers.length) lines.push(`${pad}headers: ${headers.map((h: any) => `${h.key}: ${h.value}`).join(" | ")}`);

    const body = renderBody(req?.body);
    if (body) lines.push(`${pad}body: ${body}`);

    return [`${prefix}[${method}] ${item.name}  →  ${url}`, ...lines].join("\n");
  }).join("\n");
}

server.tool(
  "get_collection_structure",
  "Fetch only the folder and request tree of a collection — use this before get_collection to understand the layout without loading the full JSON",
  { uid: z.string().describe("The collection UID") },
  async ({ uid }) => {
    const { data } = await postman.get(`/collections/${uid}`);
    const col = data.collection;
    const tree = renderTree(col.item ?? []);
    return {
      content: [{ type: "text", text: `${col.info.name}\n\n${tree}` }],
    };
  }
);

server.tool(
  "get_collection",
  "Fetch a Postman collection — returns a compact digest with all variables (key=value) and all requests (method + URL), digestible without loading the full raw JSON",
  { uid: z.string().describe("The collection UID") },
  async ({ uid }) => {
    const { data } = await postman.get(`/collections/${uid}`);
    const col = data.collection;

    // Variables section
    const vars: any[] = col.variable ?? [];
    const varsSection = vars.length > 0
      ? vars.map((v: any) => `${v.key} = ${v.value ?? ""}`).join("\n")
      : "(none)";

    // Auth section
    const auth = col.auth;
    const authSection = auth
      ? `type: ${auth.type}\n` + (auth[auth.type] ?? []).map((p: any) => `  ${p.key} = ${p.value}`).join("\n")
      : "(none)";

    // Requests section (tree with URL)
    const tree = renderTree(col.item ?? []);

    const out = `=== ${col.info.name} ===\n\n--- COLLECTION-LEVEL AUTH (inherited by all requests unless overridden at folder/request level) ---\n${authSection}\n\n--- COLLECTION-LEVEL VARIABLES (available everywhere via {{varName}}) ---\n${varsSection}\n\n--- REQUESTS (auth inheritance: collection-level -> folder-scoped-auth overrides collection -> request-scoped-auth overrides folder) ---\n${tree}`;
    return { content: [{ type: "text", text: out }] };
  }
);

server.tool(
  "update_collection",
  "Push updated JSON back to a Postman collection by its UID",
  {
    uid: z.string().describe("The collection UID"),
    collection: z.record(z.string(), z.unknown()).describe("The full collection JSON object"),
  },
  async ({ uid, collection }) => {
    const { data } = await postman.put(`/collections/${uid}`, { collection });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "save_collection",
  "Fetch a Postman collection and save it as a local JSON file for editing",
  {
    uid: z.string().describe("The collection UID"),
    filename: z.string().describe("Local filename to save to, e.g. my-collection.json"),
  },
  async ({ uid, filename }) => {
    const { data } = await postman.get(`/collections/${uid}`);
    const filepath = path.join(os.tmpdir(), filename);
    fs.writeFileSync(filepath, JSON.stringify(data.collection, null, 2));
    return {
      content: [{ type: "text", text: `Saved to ${filepath}` }],
    };
  }
);

server.tool(
  "push_collection",
  "Read a local JSON file and push it back to Postman as a collection update",
  {
    uid: z.string().describe("The collection UID"),
    filename: z.string().describe("Local filename to read from, e.g. my-collection.json"),
  },
  async ({ uid, filename }) => {
    const filepath = path.join(os.tmpdir(), filename);
    const collection = JSON.parse(fs.readFileSync(filepath, "utf-8"));
    const { data } = await postman.put(`/collections/${uid}`, { collection });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool("list_environments", "List all Postman environments in your workspace", async () => {
  const { data } = await postman.get("/environments");
  return {
    content: [{ type: "text", text: JSON.stringify(data.environments, null, 2) }],
  };
});

server.tool(
  "get_environment",
  "Fetch a Postman environment by its UID",
  { uid: z.string().describe("The environment UID") },
  async ({ uid }) => {
    const { data } = await postman.get(`/environments/${uid}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data.environment, null, 2) }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
