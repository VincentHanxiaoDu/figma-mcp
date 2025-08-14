import { MongoClient } from "mongodb";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { curryRegisterMongo } from "./register";
import http from "http";
import { ServerEnv } from "../utils/envHandler";

async function getMongoClient(env: ServerEnv) {
  console.info(`Getting MongoDB client for ${env.mongoUri}`);
  try {
    const mongoUri = env.mongoUri!;
    console.info(`Connecting to MongoDB at ${mongoUri}`);
    return await new MongoClient(mongoUri).connect();
  } catch (e: any) {
    console.warn("Failed to connect to MongoDB, using memory cache");
    return null;
  }
}

export async function startMcpServer(
  serverEnv: ServerEnv
): Promise<void> {

  const app = express();
  app.use(express.json());

  // Map to store transports by session ID
  const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};
  const mongoClient = serverEnv.disableCache ? null : await getMongoClient(serverEnv);

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
        name: "figma-mcp-server",
        version: "1.0.0"
      });
      const registerMongo = await curryRegisterMongo(server, serverEnv);
      await registerMongo(mongoClient);

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

  const port = serverEnv.port!;
  const server = http.createServer(app);
  const host = serverEnv.host!;
  server.listen(port, host, () => {
    console.info(`Server is running on http://${host}:${port}`);
  });
}
