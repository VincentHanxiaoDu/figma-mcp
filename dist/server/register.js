"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.curryRegisterMongo = curryRegisterMongo;
const zod_1 = require("zod");
const figmaTools = __importStar(require("../tools/figma/figmaTools"));
const embed_1 = require("../tools/search/embed");
const cache_1 = require("../tools/figma/cache");
const loginFigma_1 = require("../utils/auth/loginFigma");
class SessionState {
}
class SessionStore {
    constructor(sessions = new Map()) {
        this.sessions = sessions;
    }
    ;
    getSessionState(sessionId) {
        return this.sessions.get(sessionId) ?? new SessionState();
    }
    setSessionState(sessionId, state) {
        this.sessions.set(sessionId, state);
    }
}
async function curryRegisterMongo(server, serverEnv) {
    const sessionStore = new SessionStore();
    const getFigmaToken = async (extra) => {
        const figmaToken = extra.requestInfo?.headers["x-figma-token"] ?? serverEnv.figmaToken;
        const sessionId = extra.sessionId;
        if (!figmaToken) {
            if (sessionId && sessionStore.getSessionState(sessionId).figmaToken) {
                return sessionStore.getSessionState(sessionId).figmaToken;
            }
        }
        if (!figmaToken) {
            throw new Error("Missing Figma token in request header or environment variable");
        }
        else {
            sessionStore.setSessionState(sessionId, { figmaToken });
            return figmaToken;
        }
    };
    const getFigmaCookies = async (extra) => {
        const sessionId = extra.sessionId;
        if (sessionId && sessionStore.getSessionState(sessionId).figmaCookies) {
            return sessionStore.getSessionState(sessionId).figmaCookies;
        }
        const envCookies = serverEnv.figmaCookies;
        if (envCookies) {
            sessionStore.setSessionState(sessionId, { figmaCookies: envCookies });
            return envCookies;
        }
        const headerCookies = extra.requestInfo?.headers["x-figma-cookies"];
        if (headerCookies) {
            sessionStore.setSessionState(sessionId, { figmaCookies: headerCookies });
            return headerCookies;
        }
        const figmaEmails = (extra.requestInfo?.headers["x-figma-username"] ?? serverEnv.figmaUsername);
        const figmaPasswords = (extra.requestInfo?.headers["x-figma-password-b64"] ?? serverEnv.figmaPasswordB64);
        const figmaCookies = await (0, loginFigma_1.loginFigma)(figmaEmails, figmaPasswords);
        if (!figmaCookies) {
            throw new Error("Missing Figma cookies in request header or environment variable");
        }
        sessionStore.setSessionState(sessionId, { figmaCookies });
        return figmaCookies;
    };
    server.registerTool("get-figma-nodes", {
        title: "get-figma-nodes",
        description: "Get the nodes from a Figma file by node IDs",
        inputSchema: {
            fileKey: zod_1.z.string().describe("The key of the Figma file"),
            nodeIds: zod_1.z.array(zod_1.z.string()).describe("A array of Figma node ID to retrieve and convert."),
            depth: zod_1.z.number().int().gte(0).lte(10).default(2).describe("Integer representing how deep into the node tree to traverse."),
            geometry: zod_1.z.boolean().default(false).describe("Whether to include geometry (vector) data in the response."),
            compact: zod_1.z.boolean().default(true).describe("Whether to return a compact response. Use compact mode to reduce the size of the response, always use compact mode when depth is large."),
        }
    }, async (args, extra) => {
        const figmaToken = await getFigmaToken(extra);
        const res = await figmaTools.getFigmaFileNodes(args.fileKey, args.nodeIds, args.depth, args.geometry, figmaToken, args.compact);
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
            depth: zod_1.z.number().int().gte(0).lte(1).default(1).describe("Integer representing how deep into the node tree to traverse."),
            geometry: zod_1.z.boolean().default(false).describe("Whether to include geometry (vector) data in the response."),
            compact: zod_1.z.boolean().default(true).describe("Whether to return a compact response. Use compact mode to reduce the size of the response, always use compact mode when depth is large."),
        }
    }, async (args, extra) => {
        const figmaToken = await getFigmaToken(extra);
        const res = await figmaTools.getFigmaFileRoot(args.fileKey, args.depth, args.geometry, figmaToken, args.compact);
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
        const res = figmaTools.parseFigmaUrl(args.url);
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify(res, null, 0)
                }],
            structuredContent: res
        };
    });
    server.registerTool("get-figma-node-image-png-urls", {
        title: "get-figma-node-image-png-urls",
        description: "Gets PNG images URLs of specified Figma file nodes.",
        inputSchema: {
            fileKey: zod_1.z.string().describe("The Figma file key."),
            ids: zod_1.z.array(zod_1.z.string()).describe("A array of Figma node ID to retrieve and convert."),
            fetch: zod_1.z.boolean().default(true).describe("Whether to fetch the image."),
            scale: zod_1.z.number().min(0.01).max(4).default(1).describe("Scale of the image."),
            contentsOnly: zod_1.z.boolean().default(false).describe("Exclude overlapping content when rendering."),
        },
        outputSchema: {
            images: zod_1.z.array(zod_1.z.object({
                id: zod_1.z.string().describe("The node ID of the image."),
                url: zod_1.z.string().describe("The URL of the image, if the image is not saved to the directory."),
                path: zod_1.z.string().optional().describe("The path of the image, if the image is saved to the directory."),
            })),
        }
    }, async (args, extra) => {
        const figmaToken = await getFigmaToken(extra);
        const res = await figmaTools.getFigmaImages(args.fileKey, args.ids, args.fetch, args.scale, args.contentsOnly, figmaToken);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(res, null, 0)
                }
            ],
            structuredContent: {
                images: res,
            }
        };
    });
    server.registerTool("get-figma-plans", {
        title: "get-figma-plans",
        description: "Fetches Figma plans.",
        inputSchema: {
            compact: zod_1.z.boolean().default(true).describe("Whether to return a compact response."),
        }
    }, async (args, extra) => {
        const figmaCookies = await getFigmaCookies(extra);
        const res = await figmaTools.getFigmaPlans(figmaCookies, args.compact);
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify(res, null, 0)
                }]
        };
    });
    server.registerTool("get-figma-teams", {
        title: "get-figma-teams",
        description: "Fetches Figma teams.",
        inputSchema: {
            planId: zod_1.z.string().describe("The Figma plan ID from `get-figma-plans`."),
            compact: zod_1.z.boolean().default(true).describe("Whether to return a compact response."),
        }
    }, async (args, extra) => {
        const figmaCookies = await getFigmaCookies(extra);
        const res = await figmaTools.getFigmaTeams(args.planId, figmaCookies, args.compact);
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify(res, null, 0)
                }]
        };
    });
    server.registerTool("get-figma-folders", {
        title: "get-figma-folders",
        description: "Fetches Figma folders.",
        inputSchema: {
            teamsId: zod_1.z.string().describe("The Figma team ID from `get-figma-teams`."),
            compact: zod_1.z.boolean().default(true).describe("Whether to return a compact response."),
        }
    }, async (args, extra) => {
        const figmaCookies = await getFigmaCookies(extra);
        const res = await figmaTools.getFigmaFolders(args.teamsId, figmaCookies, args.compact);
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify(res, null, 0)
                }]
        };
    });
    server.registerTool("get-figma-files", {
        title: "get-figma-files",
        description: "Fetches Figma files.",
        inputSchema: {
            folderId: zod_1.z.string().describe("The Figma folder ID from `get-figma-folders`."),
            compact: zod_1.z.boolean().default(true).describe("Whether to return a compact response."),
        }
    }, async (args, extra) => {
        const figmaCookies = await getFigmaCookies(extra);
        const res = await figmaTools.getFigmaFiles(args.folderId, figmaCookies, args.compact);
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify(res, null, 0)
                }]
        };
    });
    const azureEmbeddings = new embed_1.AzureEmbeddings(1000);
    // register the tool that uses the mongo client.
    return async (mongoClient) => {
        const figmaFileCache = serverEnv.disableCache ? null : mongoClient ? new cache_1.FigmaFileMongoCache(mongoClient) : new cache_1.FigmaFileMemoryCache();
        const embeddings = serverEnv.disableCache ? azureEmbeddings : mongoClient ? new embed_1.MongoCacheableEmbeddings(azureEmbeddings, mongoClient, "azure-embeddings-cache") : new embed_1.MemoryCacheableEmbeddings(azureEmbeddings);
        server.registerTool("query-figma-file-node", {
            title: "query-figma-file-node",
            description: "Query the figma file node by name similarity search.",
            inputSchema: {
                fileKey: zod_1.z.string().describe("The Figma file key."),
                query: zod_1.z.string().describe("The query to search for."),
                topK: zod_1.z.number().int().gte(1).lte(100).default(25).describe("The number of results to return."),
            }
        }, async (args, extra) => {
            const figmaToken = await getFigmaToken(extra);
            // enable caching of embeddings.
            const res = await figmaTools.queryFigmaFileNode(figmaFileCache, args.fileKey, args.query, args.topK, figmaToken, embeddings);
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify(res, null, 0)
                    }]
            };
        });
        server.registerTool("query-figma-file-list", {
            title: "query-figma-file-list",
            description: "Query the figma file list by name similarity search.",
            inputSchema: {
                query: zod_1.z.string().describe("The query to search for."),
                topK: zod_1.z.number().int().gte(1).lte(100).default(25).describe("The number of results to return."),
            }
        }, async (args, extra) => {
            const figmaCookies = await getFigmaCookies(extra);
            // enable caching of embeddings.
            const res = await figmaTools.queryFigmaFiles(figmaCookies, args.query, args.topK, embeddings);
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify(res, null, 0)
                    }]
            };
        });
        server.registerTool("get-figma-file-pages", {
            title: "get-figma-file-pages",
            description: "Get the pages of a Figma file.",
            inputSchema: {
                fileKey: zod_1.z.string().describe("The Figma file key."),
            },
            outputSchema: {
                pages: zod_1.z.array(zod_1.z.object({
                    name: zod_1.z.string().describe("The name of the page."),
                    id: zod_1.z.string().describe("The ID of the page."),
                })),
            }
        }, async (args, extra) => {
            const figmaToken = await getFigmaToken(extra);
            const res = await figmaTools.getFigmaFilePages(args.fileKey, figmaToken);
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify(res, null, 0)
                    }],
                structuredContent: { pages: res }
            };
        });
    };
}
