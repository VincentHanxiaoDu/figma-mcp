#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const node_crypto_1 = require("node:crypto");
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const zod_1 = require("zod");
const tools_1 = require("./tools/tools");
const dotenv_1 = __importDefault(require("dotenv"));
const embed_1 = require("./utils/search/embed");
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use(express_1.default.json());
// Map to store transports by session ID
const transports = {};
// Handle POST requests for client-to-server communication
app.post('/mcp', async (req, res) => {
    // Check for existing session ID
    const sessionId = req.headers['mcp-session-id'];
    let transport;
    if (sessionId && transports[sessionId]) {
        // Reuse existing transport
        transport = transports[sessionId];
    }
    else if (!sessionId && (0, types_js_1.isInitializeRequest)(req.body)) {
        // New initialization request
        transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
            sessionIdGenerator: () => (0, node_crypto_1.randomUUID)(),
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
        const server = new mcp_js_1.McpServer({
            name: "example-server",
            version: "1.0.0"
        });
        const getFigmaToken = (extra) => {
            const figmaToken = extra.requestInfo?.headers["x-figma-token"] ?? process.env.FIGMA_TOKEN;
            if (!figmaToken) {
                throw new Error("Missing Figma token in request header");
            }
            return figmaToken;
        };
        server.registerTool("get-figma-nodes", {
            title: "get-figma-nodes",
            description: "Get the nodes from a Figma file by node IDs",
            inputSchema: {
                fileKey: zod_1.z.string().describe("The key of the Figma file"),
                nodeIds: zod_1.z.array(zod_1.z.string()).describe("A array of Figma node ID to retrieve and convert."),
                depth: zod_1.z.number().int().gte(0).lte(3).describe("Integer representing how deep into the node tree to traverse. For example, setting this to 1 will return only the children directly underneath the desired nodes. Not setting this parameter returns all nodes."),
                geometry: zod_1.z.boolean().default(true).describe("Whether to include geometry (vector) data in the response."),
            }
        }, async (args, extra) => {
            const figmaToken = getFigmaToken(extra);
            const res = await (0, tools_1.getFigmaFileNode)(args.fileKey, args.nodeIds, args.depth, args.geometry, figmaToken);
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify(res.nodes, null, 0)
                    }]
            };
        });
        server.registerTool("get-figma-file-root", {
            title: "get-figma-file-root",
            description: "Get the root node of a Figma file",
            inputSchema: {
                fileKey: zod_1.z.string().describe("The key of the Figma file"),
                depth: zod_1.z.number().int().gte(0).lte(3).describe("Integer representing how deep into the node tree to traverse. For example, setting this to 1 will return only the children directly underneath the desired nodes. Not setting this parameter returns all nodes."),
                geometry: zod_1.z.boolean().default(true).describe("Whether to include geometry (vector) data in the response."),
            }
        }, async (args, extra) => {
            const figmaToken = getFigmaToken(extra);
            const res = await (0, tools_1.getFigmaFileRoot)(args.fileKey, args.depth, args.geometry, figmaToken);
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify(res, null, 0)
                    }]
            };
        });
        server.registerTool("parse-figma-url", {
            title: "parse-figma-url",
            description: "Parse the Figma URL and return the file key and query params.",
            inputSchema: {
                url: zod_1.z.string().describe("The Figma URL to parse."),
            }
        }, async (args, extra) => {
            const res = (0, tools_1.parseFigmaUrl)(args.url);
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify(res, null, 0)
                    }]
            };
        });
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
        server.registerTool("query-figma-file-node", {
            title: "query-figma-file-node",
            description: "Query the figma file node by name similarity search.",
            inputSchema: {
                fileKey: zod_1.z.string().describe("The Figma file key."),
                query: zod_1.z.string().describe("The query to search for."),
                topK: zod_1.z.number().int().gte(1).lte(100).default(30).describe("The number of results to return."),
            }
        }, async (args, extra) => {
            const figmaToken = getFigmaToken(extra);
            const embeddings = new embed_1.AzureEmbeddings(1000);
            const res = await (0, tools_1.queryFigmaFileNode)(args.fileKey, args.query, args.topK, figmaToken, embeddings);
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify(res, null, 0)
                    }]
            };
        });
        server.registerTool("get-figma-node-image-png-url", {
            title: "get-figma-node-image-png-url",
            description: "Fetches PNG images URLs of specified Figma file nodes.",
            inputSchema: {
                fileKey: zod_1.z.string().describe("The Figma file key."),
                ids: zod_1.z.array(zod_1.z.string()).describe("A array of Figma node ID to retrieve and convert."),
                scale: zod_1.z.number().min(0.01).max(4).default(1).describe("Scale of the image."),
                contents_only: zod_1.z.boolean().default(false).describe("Exclude overlapping content when rendering."),
            }
        }, async (args, extra) => {
            const figmaToken = getFigmaToken(extra);
            const res = await (0, tools_1.getFigmaImages)(args.fileKey, args.ids, args.scale, args.contents_only, figmaToken);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(res, null, 0)
                    }
                ]
            };
        });
        // Connect to the MCP server
        await server.connect(transport);
    }
    else {
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
const handleSessionRequest = async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
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
