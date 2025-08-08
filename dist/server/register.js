"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.curryRegisterMongo = curryRegisterMongo;
const zod_1 = require("zod");
const figmaTools_1 = require("../tools/figma/figmaTools");
const embed_1 = require("../tools/search/embed");
const cache_1 = require("../tools/figma/cache");
const getFigmaToken = (extra) => {
    const figmaToken = extra.requestInfo?.headers["x-figma-token"] ?? process.env.FIGMA_TOKEN;
    if (!figmaToken) {
        throw new Error("Missing Figma token in request header");
    }
    return figmaToken;
};
async function curryRegisterMongo(server) {
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
        const res = await (0, figmaTools_1.getFigmaFileNode)(args.fileKey, args.nodeIds, args.depth, args.geometry, figmaToken);
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
        const res = await (0, figmaTools_1.getFigmaFileRoot)(args.fileKey, args.depth, args.geometry, figmaToken);
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
        const res = (0, figmaTools_1.parseFigmaUrl)(args.url);
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
        const res = await (0, figmaTools_1.getFigmaImages)(args.fileKey, args.ids, args.scale, args.contents_only, figmaToken);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(res, null, 0)
                }
            ]
        };
    });
    // register the tool that uses the mongo client.
    return async (mongoClient) => {
        const figmaFileCache = mongoClient ? new cache_1.FigmaFileMongoCache(mongoClient) : new cache_1.FigmaFileMemoryCache();
        const azureEmbeddings = new embed_1.AzureEmbeddings(1000);
        const embeddings = mongoClient ? new embed_1.MongoCacheableEmbeddings(azureEmbeddings, mongoClient, "azure-embeddings-cache") : new embed_1.MemoryCacheableEmbeddings(azureEmbeddings);
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
            // enable caching of embeddings.
            const res = await (0, figmaTools_1.queryFigmaFileNode)(figmaFileCache, args.fileKey, args.query, args.topK, figmaToken, embeddings);
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify(res, null, 0)
                    }]
            };
        });
    };
}
