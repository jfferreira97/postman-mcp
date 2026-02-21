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

function renderTree(items: any[], indent = 0): string {
  return items.map((item: any) => {
    const prefix = "  ".repeat(indent) + "└─ ";
    if (item.item) {
      return `${prefix}[folder] ${item.name}\n${renderTree(item.item, indent + 1)}`;
    }
    const method = item.request?.method ?? "?";
    return `${prefix}[${method}] ${item.name}`;
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
  "Fetch the full JSON of a Postman collection by its UID",
  { uid: z.string().describe("The collection UID") },
  async ({ uid }) => {
    const { data } = await postman.get(`/collections/${uid}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data.collection, null, 2) }],
    };
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
