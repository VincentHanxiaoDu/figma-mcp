"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const yargs_1 = __importDefault(require("yargs"));
const dotenv_1 = __importDefault(require("dotenv"));
const mongodb_1 = require("mongodb");
const express_1 = __importDefault(require("express"));
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const node_crypto_1 = require("node:crypto");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const register_1 = require("./register");
const loginFigma_1 = require("../utils/auth/loginFigma");
async function parseArgs() {
    const argv = await (0, yargs_1.default)(process.argv.slice(2)).option("env", {
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
async function loadEnv(argv) {
    if (argv.env) {
        console.info(`Loading env from ${argv.env}`);
        dotenv_1.default.config({ path: argv.env });
    }
    else {
        dotenv_1.default.config();
    }
    if (argv.port) {
        process.env.PORT = argv.port.toString();
    }
}
async function getMongoClient() {
    try {
        const mongoUri = process.env.MONGODB_URI;
        console.info(`Connecting to MongoDB at ${mongoUri}`);
        return await new mongodb_1.MongoClient(mongoUri).connect();
    }
    catch (e) {
        console.warn("Failed to connect to MongoDB, using memory cache");
        return null;
    }
}
async function startMcpServer(mongoClient, curryRegisterMongo) {
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
            const registerMongo = await curryRegisterMongo(server);
            await registerMongo(mongoClient);
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
    const port = process.env.PORT || "3000";
    app.listen(port, () => {
        console.info(`Server is running on port ${port}`);
    });
}
async function main() {
    const argv = await parseArgs();
    if (argv["login-figma"]) {
        const figmaEmails = process.env.FIGMA_EMAILS;
        const figmaPasswords = process.env.FIGMA_PASS_B64;
        await (0, loginFigma_1.loginFigma)(figmaEmails, figmaPasswords);
        process.exit(0);
    }
    await loadEnv(argv);
    const mongoClient = await getMongoClient();
    await startMcpServer(mongoClient, register_1.curryRegisterMongo);
}
