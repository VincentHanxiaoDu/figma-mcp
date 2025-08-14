import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import * as figmaTools from "../tools/figma/figmaTools";
import { MongoCacheableEmbeddings, MemoryCacheableEmbeddings, AzureEmbeddings } from "../tools/search/embed";
import { MongoClient } from "mongodb";
import { FigmaFileCache, FigmaFileMemoryCache, FigmaFileMongoCache } from "../tools/figma/cache";
import { loginFigma } from "../utils/auth/loginFigma";
import { ServerEnv } from "../utils/envHandler";


class SessionState {
  figmaToken?: string;
  figmaCookies?: string;
}

class SessionStore {
  constructor(private sessions: Map<string, SessionState> = new Map()) {};

  getSessionState(sessionId: string): SessionState {
    return this.sessions.get(sessionId) ?? new SessionState();
  }

  setSessionState(sessionId: string, state: SessionState) {
    this.sessions.set(sessionId, state);
  }
}

export async function curryRegisterMongo(server: McpServer, serverEnv: ServerEnv): Promise<(mongoClient: MongoClient | null) => Promise<void>> {
  const sessionStore = new SessionStore();

  const getFigmaToken = async (extra: RequestHandlerExtra<ServerRequest, ServerNotification>): Promise<string> => {
    const figmaToken = extra.requestInfo?.headers["x-figma-token"] as string ?? serverEnv.figmaToken;
    const sessionId = extra.sessionId!;
    if (!figmaToken) {
      if (sessionId && sessionStore.getSessionState(sessionId).figmaToken) {
        return sessionStore.getSessionState(sessionId).figmaToken!;
      }
    }
    if (!figmaToken) {
      throw new Error("Missing Figma token in request header or environment variable");
    } else {
      sessionStore.setSessionState(sessionId, { figmaToken });
      return figmaToken;
    }
  }

  const getFigmaCookies = async (extra: RequestHandlerExtra<ServerRequest, ServerNotification>): Promise<string> => {
    const sessionId = extra.sessionId!;
    if (sessionId && sessionStore.getSessionState(sessionId).figmaCookies) {
      return sessionStore.getSessionState(sessionId).figmaCookies!;
    }
    const envCookies = serverEnv.figmaCookies;
    if (envCookies) {
      sessionStore.setSessionState(sessionId, { figmaCookies: envCookies });
      return envCookies;
    }
    const headerCookies = extra.requestInfo?.headers["x-figma-cookies"] as string | undefined;
    if (headerCookies) {
      sessionStore.setSessionState(sessionId, { figmaCookies: headerCookies });
      return headerCookies;
    }
    const figmaEmails = extra.requestInfo?.headers["x-figma-username"] as string ?? serverEnv.figmaUsername!;
    const figmaPasswords = extra.requestInfo?.headers["x-figma-passwords-b64"] as string ?? serverEnv.figmaPasswordB64!;
    const figmaCookies = await loginFigma(figmaEmails, figmaPasswords);
    if (!figmaCookies) {
      throw new Error("Missing Figma cookies in request header or environment variable");
    }
    sessionStore.setSessionState(sessionId, { figmaCookies });
    return figmaCookies;
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
      const figmaToken = await getFigmaToken(extra);
      const res = await figmaTools.getFigmaFileNode(args.fileKey, args.nodeIds, args.depth, args.geometry, figmaToken);
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
      const figmaToken = await getFigmaToken(extra);
      const res = await figmaTools.getFigmaFileRoot(args.fileKey, args.depth, args.geometry, figmaToken);
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
      const res = figmaTools.parseFigmaUrl(args.url);
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
      const figmaToken = await getFigmaToken(extra);
      const res = await figmaTools.getFigmaImages(args.fileKey, args.ids, args.scale, args.contents_only, figmaToken);
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

  server.registerTool(
    "get-figma-plans",
    {
      title: "get-figma-plans",
      description: "Fetches Figma plans.",
      inputSchema: {
        compact: z.boolean().default(true).describe("Whether to return a compact response."),
      }
    },
    async (args: { compact: boolean }, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      const figmaCookies = await getFigmaCookies(extra);
      const res = await figmaTools.getFigmaPlans(figmaCookies, args.compact);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(res, null, 0)
        }]
      };
    }
  );

  server.registerTool(
    "get-figma-teams",
    {
      title: "get-figma-teams",
      description: "Fetches Figma teams.",
      inputSchema: {
        planId: z.string().describe("The Figma plan ID from `get-figma-plans`."),
        compact: z.boolean().default(true).describe("Whether to return a compact response."),
      }
    },
    async (args: { planId: string, compact: boolean }, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      const figmaCookies = await getFigmaCookies(extra);
      const res = await figmaTools.getFigmaTeams(args.planId, figmaCookies, args.compact);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(res, null, 0)
        }]
      };
    }
  );

  server.registerTool(
    "get-figma-folders",
    {
      title: "get-figma-folders",
      description: "Fetches Figma folders.",
      inputSchema: {
        teamsId: z.string().describe("The Figma team ID from `get-figma-teams`."),
        compact: z.boolean().default(true).describe("Whether to return a compact response."),
      }
    },
    async (args: { teamsId: string, compact: boolean }, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      const figmaCookies = await getFigmaCookies(extra);
      const res = await figmaTools.getFigmaFolders(args.teamsId, figmaCookies, args.compact);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(res, null, 0)
        }]
      };
    }
  );

  server.registerTool(
    "get-figma-files",
    {
      title: "get-figma-files",
      description: "Fetches Figma files.",
      inputSchema: {
        folderId: z.string().describe("The Figma folder ID from `get-figma-folders`."),
        compact: z.boolean().default(true).describe("Whether to return a compact response."),
      }
    },
    async (args: { folderId: string, compact: boolean }, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      const figmaCookies = await getFigmaCookies(extra);
      const res = await figmaTools.getFigmaFiles(args.folderId, figmaCookies, args.compact);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(res, null, 0)
        }]
      };
    }
  );

  const azureEmbeddings = new AzureEmbeddings(1000);
  // register the tool that uses the mongo client.
  return async (mongoClient: MongoClient | null) => {
    const figmaFileCache: FigmaFileCache | null = serverEnv.disableCache ? null : mongoClient ? new FigmaFileMongoCache(mongoClient) : new FigmaFileMemoryCache();
    const embeddings = serverEnv.disableCache ? azureEmbeddings : mongoClient ? new MongoCacheableEmbeddings(
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
        const figmaToken = await getFigmaToken(extra);
        // enable caching of embeddings.
        const res = await figmaTools.queryFigmaFileNode(figmaFileCache, args.fileKey, args.query, args.topK, figmaToken, embeddings);
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