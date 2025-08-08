import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { getFigmaFileNode, getFigmaFileRoot, queryFigmaFileNode, getFigmaImages, parseFigmaUrl } from "../tools/figma/figmaTools";
import { MongoCacheableEmbeddings, MemoryCacheableEmbeddings, AzureEmbeddings } from "../tools/search/embed";
import { MongoClient } from "mongodb";
import { FigmaFileCache, FigmaFileMemoryCache, FigmaFileMongoCache } from "../tools/figma/cache";

const getFigmaToken = (extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
  const figmaToken = extra.requestInfo?.headers["x-figma-token"] as string ?? process.env.FIGMA_TOKEN as string | undefined;
  if (!figmaToken) {
    throw new Error("Missing Figma token in request header");
  }
  return figmaToken;
}

export async function curryRegisterMongo(server: McpServer): Promise<(mongoClient: MongoClient | null) => Promise<void>> {
  server.registerTool(
    "get-figma-nodes",
    {
      title: "get-figma-nodes",
      description: "Get the nodes from a Figma file by node IDs",
      inputSchema: {
        fileKey: z.string().describe("The key of the Figma file"),
        nodeIds: z.array(z.string()).describe("A array of Figma node ID to retrieve and convert."),
        depth: z.number().int().gte(0).lte(3).describe("Integer representing how deep into the node tree to traverse. For example, setting this to 1 will return only the children directly underneath the desired nodes. Not setting this parameter returns all nodes."),
        geometry: z.boolean().default(true).describe("Whether to include geometry (vector) data in the response."),
      }
    },
    async (args: { fileKey: string, nodeIds: string[], depth: number, geometry: boolean }, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      const figmaToken = getFigmaToken(extra);
      const res = await getFigmaFileNode(args.fileKey, args.nodeIds, args.depth, args.geometry, figmaToken);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(res.nodes, null, 0)
        }]
      };
    }
  );

  server.registerTool(
    "get-figma-file-root",
    {
      title: "get-figma-file-root",
      description: "Get the root node of a Figma file",
      inputSchema: {
        fileKey: z.string().describe("The key of the Figma file"),
        depth: z.number().int().gte(0).lte(3).describe("Integer representing how deep into the node tree to traverse. For example, setting this to 1 will return only the children directly underneath the desired nodes. Not setting this parameter returns all nodes."),
        geometry: z.boolean().default(true).describe("Whether to include geometry (vector) data in the response."),
      }
    },
    async (args: { fileKey: string, depth: number, geometry: boolean }, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      const figmaToken = getFigmaToken(extra);
      const res = await getFigmaFileRoot(args.fileKey, args.depth, args.geometry, figmaToken);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(res, null, 0)
        }]
      };
    }
  );

  server.registerTool(
    "parse-figma-url",
    {
      title: "parse-figma-url",
      description: "Parse the Figma URL and return the file key and query params.",
      inputSchema: {
        url: z.string().describe("The Figma URL to parse."),
      }
    },
    async (args: { url: string }, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      const res = parseFigmaUrl(args.url);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(res, null, 0)
        }]
      };
    }
  );

  server.registerTool(
    "get-figma-node-image-png-url",
    {
      title: "get-figma-node-image-png-url",
      description: "Fetches PNG images URLs of specified Figma file nodes.",
      inputSchema: {
        fileKey: z.string().describe("The Figma file key."),
        ids: z.array(z.string()).describe("A array of Figma node ID to retrieve and convert."),
        scale: z.number().min(0.01).max(4).default(1).describe("Scale of the image."),
        contents_only: z.boolean().default(false).describe("Exclude overlapping content when rendering."),
      }
    },
    async (args: { fileKey: string, ids: string[], scale: number, contents_only: boolean }, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      const figmaToken = getFigmaToken(extra);
      const res = await getFigmaImages(args.fileKey, args.ids, args.scale, args.contents_only, figmaToken);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(res, null, 0)
          }
        ]
      }
    }
  );

  // register the tool that uses the mongo client.
  return async (mongoClient: MongoClient | null) => {
    const figmaFileCache: FigmaFileCache = mongoClient ? new FigmaFileMongoCache(mongoClient) : new FigmaFileMemoryCache();
    const azureEmbeddings = new AzureEmbeddings(1000);
    const embeddings = mongoClient ? new MongoCacheableEmbeddings(
      azureEmbeddings,
      mongoClient,
      "azure-embeddings-cache"
    ) : new MemoryCacheableEmbeddings(
      azureEmbeddings
    );
    server.registerTool(
      "query-figma-file-node",
      {
        title: "query-figma-file-node",
        description: "Query the figma file node by name similarity search.",
        inputSchema: {
          fileKey: z.string().describe("The Figma file key."),
          query: z.string().describe("The query to search for."),
          topK: z.number().int().gte(1).lte(100).default(30).describe("The number of results to return."),
        }
      },
      async (args: { fileKey: string, query: string, topK: number }, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
        const figmaToken = getFigmaToken(extra);
        // enable caching of embeddings.
        const res = await queryFigmaFileNode(figmaFileCache, args.fileKey, args.query, args.topK, figmaToken, embeddings);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(res, null, 0)
          }]
        };
      }
    );
  }
}