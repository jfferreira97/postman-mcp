import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios from "axios";
import { z } from "zod";
import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";

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

function renderScripts(events: any[], pad: string, scope: "folder" | "request"): string[] {
  if (!events?.length) return [];
  const lines: string[] = [];
  for (const ev of events) {
    const exec: string[] = ev?.script?.exec ?? [];
    const code = exec.join("\n").trim();
    if (!code) continue;
    const type = ev.listen === "prerequest" ? "pre-request" : "post-response";
    const label = `${scope}-scoped ${type} script`;
    lines.push(`${pad}[${label}]:\n${exec.map((l: string) => `${pad}  ${l}`).join("\n")}`);
  }
  return lines;
}

function renderTree(items: any[], indent = 0): string {
  return items.map((item: any) => {
    const prefix = "  ".repeat(indent) + "└─ ";
    const pad    = "  ".repeat(indent + 1) + "  ";

    if (item.item) {
      const idTag = item.id ? `  (id: ${item.id})` : "";
      const authLine = item.auth ? `\n${pad}${renderAuth(item.auth, "folder-scoped-auth")}` : "";
      const scriptLines = renderScripts(item.event, pad, "folder");
      const scriptBlock = scriptLines.length ? "\n" + scriptLines.join("\n") : "";
      return `${prefix}[folder] ${item.name}${idTag}${authLine}${scriptBlock}\n${renderTree(item.item, indent + 1)}`;
    }

    const req    = item.request;
    const method = req?.method ?? "?";
    const url    = req?.url?.raw ?? req?.url ?? "";
    const idTag  = item.id ? `  (id: ${item.id})` : "";

    const lines: string[] = [];

    const auth = renderAuth(req?.auth, "request-scoped-auth");
    if (auth) lines.push(`${pad}${auth}`);

    const headers = (req?.header ?? []).filter((h: any) => !SKIP_HEADERS.has(h.key?.toLowerCase()));
    if (headers.length) lines.push(`${pad}headers: ${headers.map((h: any) => `${h.key}: ${h.value}`).join(" | ")}`);

    const body = renderBody(req?.body);
    if (body) lines.push(`${pad}body: ${body}`);

    lines.push(...renderScripts(item.event, pad, "request"));

    return [`${prefix}[${method}] ${item.name}${idTag}  →  ${url}`, ...lines].join("\n");
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
  "Nuclear option — replaces the entire collection in one PUT. Use only for bulk/structural changes that cannot be done atomically (e.g. reordering, schema-wide renames). For adding items use add_items; for editing a single item use update_item. Accepts either 'collection' (inline JSON) or 'filepath' (path to local JSON file — preferred for large collections to avoid token limits).",
  {
    uid: z.string().describe("The collection UID"),
    collection: z.record(z.string(), z.unknown()).optional().describe("The full collection JSON object (omit if using filepath)"),
    filepath: z.string().optional().describe("Absolute path to a local JSON file containing the collection (preferred for large collections)"),
  },
  async ({ uid, collection, filepath }) => {
    let payload: any;
    if (filepath) {
      payload = JSON.parse(fs.readFileSync(filepath, "utf-8"));
    } else if (collection) {
      payload = collection;
    } else {
      throw new Error("Provide either 'collection' or 'filepath'");
    }
    const { data } = await postman.put(`/collections/${uid}`, { collection: payload });
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

// Traverse items by slash-separated folder path ("" = root). Returns the items array to insert into.
function findTargetItems(root: any[], folderPath: string): any[] {
  if (!folderPath) return root;
  const parts = folderPath.split("/").filter(Boolean);
  let current = root;
  for (const part of parts) {
    const folder = current.find((i: any) => i.item && i.name === part);
    if (!folder) throw new Error(`Folder not found: "${part}" in path "${folderPath}"`);
    current = folder.item;
  }
  return current;
}

// Recursively find an item by id. Returns [item, parentArray] so the caller can mutate in place.
function findItemById(items: any[], id: string): [any, any[]] | null {
  for (const item of items) {
    if (item.id === id) return [item, items];
    if (item.item) {
      const found = findItemById(item.item, id);
      if (found) return found;
    }
  }
  return null;
}

const AddEntrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("folder"),
    name: z.string().describe("Folder name"),
    parent_path: z.string().optional().describe("Slash-separated path to parent folder. Omit for root."),
    position: z.number().int().min(0).optional().describe("0-based insert position within the parent. Omits = append."),
  }),
  z.object({
    type: z.literal("request"),
    parent_path: z.string().optional().describe("Slash-separated path to target folder. Omit for root."),
    position: z.number().int().min(0).optional().describe("0-based insert position within the folder. Omit = append."),
    item: z.record(z.string(), z.unknown()).describe("Full Postman item object: { name, request: { method, url: { raw }, header?, body? } }"),
  }),
]);

server.tool(
  "add_items",
  "Atomically add one or more folders and/or requests to a collection in a single GET+PUT round trip. All entries are processed before pushing, so batching multiple adds here costs one permission prompt instead of one per call. position is 0-based insert index (inserts without overwriting — existing items shift down); omit to append. UUIDs are generated automatically.",
  { uid: z.string().describe("The collection UID"), entries: z.array(AddEntrySchema).min(1) },
  async ({ uid, entries }) => {
    const { data } = await postman.get(`/collections/${uid}`);
    const col = data.collection;
    const results: string[] = [];

    for (const entry of entries) {
      const target = findTargetItems(col.item ?? [], entry.parent_path ?? "");
      if (entry.type === "folder") {
        const newFolder = { id: randomUUID(), name: entry.name, item: [] };
        entry.position !== undefined
          ? target.splice(entry.position, 0, newFolder)
          : target.push(newFolder);
        results.push(`folder "${entry.name}" (id: ${newFolder.id})`);
      } else {
        const newItem: any = { id: randomUUID(), ...entry.item };
        entry.position !== undefined
          ? target.splice(entry.position, 0, newItem)
          : target.push(newItem);
        results.push(`request "${newItem.name ?? "(unnamed)"}" (id: ${newItem.id})`);
      }
    }

    await postman.put(`/collections/${uid}`, { collection: col });
    return { content: [{ type: "text", text: `Added:\n${results.map(r => `  • ${r}`).join("\n")}` }] };
  }
);

server.tool(
  "update_item",
  "Atomically update a single folder or request by its ID — finds the item anywhere in the tree regardless of nesting depth and overwrites the fields you provide. IMPORTANT: merge is shallow, so if you include 'request' you must include the full request object (method + url + header + body + auth) — partial sub-objects will overwrite and lose the fields you omit. Always call get_collection first to read the current state of the item before constructing the patch. Does NOT touch the item's children (item[] array) — to add children use add_items targeting that folder's path.",
  {
    uid: z.string().describe("The collection UID"),
    id: z.string().describe("The item ID (visible in get_collection / get_collection_structure output)"),
    patch: z.record(z.string(), z.unknown()).describe("Fields to overwrite on the item. Merge is SHALLOW — nested objects are replaced wholesale, not merged. Always pass the FULL sub-object for any nested field you touch. For requests: { name?, request: { method, url: { raw }, header: [], body: {...}, auth: {...} } } — if you include 'request', include ALL its fields or the missing ones will be lost. For folders: { name?, auth?, description? }."),
  },
  async ({ uid, id, patch }) => {
    const { data } = await postman.get(`/collections/${uid}`);
    const col = data.collection;
    const found = findItemById(col.item ?? [], id);
    if (!found) throw new Error(`No item with id "${id}" found in collection`);
    const [item] = found;
    Object.assign(item, patch);
    await postman.put(`/collections/${uid}`, { collection: col });
    return { content: [{ type: "text", text: `Updated item "${item.name ?? id}"` }] };
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
