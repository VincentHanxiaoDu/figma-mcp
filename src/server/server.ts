import yargs from "yargs";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { curryRegisterMongo } from "./register";
import { loginFigma } from "../utils/auth/loginFigma";

async function parseArgs() {
  const argv = await yargs(process.argv.slice(2)).option("env", {
    type: "string",
    description: "Path to .env file",
  }).option("port", {
    type: "number",
    description: "Port to run the server on",
  }).option("login-figma", {
    description: "Login to Figma and get cookies",
  }).parse();

  return argv;
}

async function loadEnv(argv: yargs.Arguments) {
  if (argv.env) {
    console.info(`Loading env from ${argv.env}`);
    dotenv.config({ path: argv.env as string });
  } else {
    dotenv.config();
  }
  if (argv.port) {
    process.env.PORT = argv.port.toString();
  }
}

async function getMongoClient() {
  try {
    const mongoUri = process.env.MONGODB_URI!;

    console.info(`Connecting to MongoDB at ${mongoUri}`);
    return await new MongoClient(mongoUri).connect();
  } catch (e: any) {
    console.warn("Failed to connect to MongoDB, using memory cache");
    return null;
  }
}

async function startMcpServer(
  mongoClient: MongoClient | null,
  curryRegisterMongo: (server: McpServer) => Promise<(mongoClient: MongoClient | null) => Promise<void>>
): Promise<void> {

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

      const registerMongo = await curryRegisterMongo(server);
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

  const port = process.env.PORT || "3000";
  app.listen(port, () => {
    console.info(`Server is running on port ${port}`);
  });
}

export async function main() {
  const argv = await parseArgs();
  if (argv["login-figma"]) {
    const figmaEmails = process.env.FIGMA_EMAILS! as string;
    const figmaPasswords = process.env.FIGMA_PASS_B64! as string;
    await loginFigma(figmaEmails, figmaPasswords); 
    process.exit(0);
  }
  await loadEnv(argv);
  const mongoClient = await getMongoClient();
  await startMcpServer(mongoClient, curryRegisterMongo);
}