#!/usr/bin/env node
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod";
import { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { getFigmaFileNode, getFigmaFileRoot, queryFigmaFileNode, getFigmaImages, parseFigmaUrl } from "./tools/tools";
import dotenv from "dotenv";
import { AzureEmbeddings } from "./utils/search/embed";

dotenv.config();

const app = express();
app.use(express.json());

// Map to store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

// Handle POST requests for client-to-server communication
app.post('/mcp', async (req, res) => {
  // Check for existing session ID
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports[sessionId]) {
    // Reuse existing transport
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // New initialization request
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        // Store the transport by session ID
        transports[sessionId] = transport;
      },
      // DNS rebinding protection is disabled by default for backwards compatibility. If you are running this server
      // locally, make sure to set:
      // enableDnsRebindingProtection: true,
      // allowedHosts: ['127.0.0.1'],
    });

    // Clean up transport when closed
    transport.onclose = () => {
      if (transport.sessionId) {
        delete transports[transport.sessionId];
      }
    };
    const server = new McpServer({
      name: "example-server",
      version: "1.0.0"
    });

    const getFigmaToken = (extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      const figmaToken = extra.requestInfo?.headers["x-figma-token"] as string ?? process.env.FIGMA_TOKEN as string | undefined;
      if (!figmaToken) {
        throw new Error("Missing Figma token in request header");
      }
      return figmaToken;
    }

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

    // TODO: Implement figma files list resource with mock login, not supported by the Figma RESTful API.
    // server.registerResource(
    //   "figma-files-list",
    //   "figma-files://file-list",
    //   {
    //     title: "Figma Files List",
    //     description: "List of Figma files with names and keys."
    //   },
    //   async (uri: URL, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => ({
    //     contents: [
    //       {
    //         uri: uri.toString(),
    //         mimeType: "application/json",
    //         text: JSON.stringify([{name: "Fintech new user design", fileKey: "S20CJ6i5uIpKZqbVMXnTrD"}], null, 0)
    //       }
    //     ]
    //   })
    // );

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
        const embeddings = new AzureEmbeddings(1000);
        const res = await queryFigmaFileNode(args.fileKey, args.query, args.topK, figmaToken, embeddings);
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

    // Connect to the MCP server
    await server.connect(transport);
  } else {
    // Invalid request
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Bad Request: No valid session ID provided',
      },
      id: null,
    });
    return;
  }

  // Handle the request
  await transport.handleRequest(req, res, req.body);
});

// Reusable handler for GET and DELETE requests
const handleSessionRequest = async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  
  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
};

// Handle GET requests for server-to-client notifications via SSE
app.get('/mcp', handleSessionRequest);

// Handle DELETE requests for session termination
app.delete('/mcp', handleSessionRequest);

app.listen(3000, () => {
  console.info("Server is running on port 3000");
});