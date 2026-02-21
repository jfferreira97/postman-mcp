import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios from "axios";
import { z } from "zod";

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
  name: "pmcp",
  version: "1.0.0",
});

server.tool("list_collections", "List all Postman collections in your workspace", async () => {
  const { data } = await postman.get("/collections");
  return {
    content: [{ type: "text", text: JSON.stringify(data.collections, null, 2) }],
  };
});

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
