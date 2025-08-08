"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFigmaUrl = parseFigmaUrl;
exports.getFigmaFileNode = getFigmaFileNode;
exports.getFigmaFileRoot = getFigmaFileRoot;
exports.queryFigmaFileNode = queryFigmaFileNode;
exports.getFigmaImages = getFigmaImages;
const axios_1 = __importDefault(require("axios"));
const document_1 = require("langchain/document");
const hybridSearch_1 = require("../search/hybridSearch");
function parseFigmaUrl(url) {
    const figmaUrl = new URL(url);
    if (!figmaUrl.hostname.includes("figma.com")) {
        throw new Error(`Invalid Figma URL: ${url}`);
    }
    const pathMatch = figmaUrl.pathname.match(/^\/design\/([^/]+)/);
    if (!pathMatch) {
        throw new Error(`Invalid Figma URL: ${url}`);
    }
    const fileKey = pathMatch[1];
    const queryParams = {};
    figmaUrl.searchParams.forEach((value, key) => {
        queryParams[key] = value;
    });
    return { fileKey, queryParams };
}
function addOmitMessage(figmaNode, maxDepth) {
    function traverse(node, depth = 0) {
        if (depth >= maxDepth) {
            if (Array.isArray(node.children)) {
                node.children = `<omitted due to depth reached, search for a deeper node (for example, ids='${node.id}' with depth=1) to explore the children>`;
            }
        }
        else {
            if (Array.isArray(node.children)) {
                for (const child of node.children) {
                    traverse(child, depth + 1);
                }
            }
        }
    }
    traverse(figmaNode);
    return figmaNode;
}
async function getFigmaFileNode(fileKey, ids, depth, geometry, figmaToken) {
    const response = await axios_1.default.get(`https://api.figma.com/v1/files/${fileKey}/nodes`, {
        headers: {
            'X-Figma-Token': figmaToken,
        },
        params: {
            ids: ids.join(","),
            depth: depth,
            geometry: geometry ? "paths" : undefined
        }
    });
    const resJson = response.data;
    for (const [k, v] of Object.entries(resJson.nodes ?? {})) {
        if (v && typeof v === "object" && "document" in v && v.document) {
            v.document = addOmitMessage(v.document, depth);
        }
    }
    return resJson;
}
async function getFigmaFileRoot(fileKey, depth, geometry, figmaToken) {
    const response = await axios_1.default.get(`https://api.figma.com/v1/files/${fileKey}`, {
        headers: {
            'X-Figma-Token': figmaToken,
        },
        params: {
            ids: "0:0",
            depth: depth,
            geometry: geometry ? "paths" : undefined,
        }
    });
    const resJson = response.data;
    resJson.document = addOmitMessage(resJson.document, depth);
    return resJson;
}
function* traverse_node(node) {
    yield [node.name, node.id];
    if (Array.isArray(node.children)) {
        for (const child of node.children) {
            yield* traverse_node(child);
        }
    }
}
async function getFigmaFileMetaData(fileKey, figmaToken) {
    const response = await axios_1.default.get(`https://api.figma.com/v1/files/${fileKey}/meta`, {
        headers: {
            "X-Figma-Token": figmaToken,
        },
    });
    if (response.status !== 200) {
        throw new Error(`Failed to get Figma file meta data: ${response.status} ${response.statusText}`);
    }
    return response.data;
}
async function getFigmaFile(figmaFileCache, fileKey, fileVersion, figmaToken) {
    const fileDoc = await figmaFileCache?.readFigmaFileCache(fileKey, fileVersion);
    if (fileDoc) {
        return fileDoc;
    }
    const response = await axios_1.default.get(`https://api.figma.com/v1/files/${fileKey}`, {
        headers: {
            "X-Figma-Token": figmaToken,
        },
        params: {
            "ids": "0:0"
        }
    });
    const resJson = response.data;
    if (response.status !== 200) {
        throw new Error(`Failed to get Figma file: ${response.status} ${response.statusText}`);
    }
    if (resJson) {
        await figmaFileCache?.writeFigmaFileCache(resJson, fileKey, fileVersion);
    }
    return resJson;
}
async function queryFigmaFileNode(figmaFileCache, fileKey, query, topK, figmaToken, embeddings) {
    const fileMeta = await getFigmaFileMetaData(fileKey, figmaToken);
    const resJson = await getFigmaFile(figmaFileCache, fileKey, fileMeta.file.version, figmaToken);
    // Construct mapping of name to ids.
    const groupedMap = Array.from(traverse_node(resJson.document)).reduce((acc, [name, id]) => {
        if (!acc.has(name)) {
            acc.set(name, []);
        }
        acc.get(name).push(id);
        return acc;
    }, new Map());
    const documents = Array.from(groupedMap.entries()).map(([name, ids]) => {
        return new document_1.Document({
            pageContent: name,
            metadata: {
                ids: ids,
            },
        });
    });
    // Hybrid search.
    return await (0, hybridSearch_1.hybridSearch)(query, topK, documents, embeddings);
}
async function getFigmaImages(fileKey, ids, scale, contents_only, figmaToken) {
    const response = await axios_1.default.get(`https://api.figma.com/v1/images/${fileKey}`, {
        headers: {
            "X-Figma-Token": figmaToken,
        },
        params: {
            ids: ids.join(","),
            format: "png",
            scale: scale,
            contents_only: contents_only ? "true" : "false",
        }
    });
    return response.data.images;
}
