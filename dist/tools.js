"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFigmaFileNode = getFigmaFileNode;
exports.getFigmaFileRoot = getFigmaFileRoot;
exports.queryFigmaFileNode = queryFigmaFileNode;
exports.getFigmaImages = getFigmaImages;
const axios_1 = __importDefault(require("axios"));
const document_1 = require("langchain/document");
const assert_1 = __importDefault(require("assert"));
const openai_1 = require("openai");
const dotenv_1 = __importDefault(require("dotenv"));
const memory_1 = require("langchain/vectorstores/memory");
const mongodb_1 = require("mongodb");
dotenv_1.default.config();
const mongoClient = new mongodb_1.MongoClient(process.env.MONGODB_URI);
const embeddingsCacheDB = mongoClient.db("embeddings_cache");
const embeddingsCacheCollection = embeddingsCacheDB.collection("text-embedding-3-large");
embeddingsCacheCollection.createIndex({ text: 1 });
const figmaFileCacheDB = mongoClient.db("figma_file_cache");
const figmaFileCacheBucket = new mongodb_1.GridFSBucket(figmaFileCacheDB, { bucketName: 'figma_file_bucket' });
const figmaFileCacheCollection = figmaFileCacheDB.collection('figma_file_bucket.files');
figmaFileCacheCollection.createIndex({ 'metadata.fileKey': 1, 'metadata.fileVersion': 1 });
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
class AzureEmbeddings {
    constructor(batchSize) {
        (0, assert_1.default)(Number.isInteger(batchSize), "batchSize must be an integer");
        this.batchSize = batchSize;
        this.client = new openai_1.AzureOpenAI({
            endpoint: process.env.AZURE_AI_SERVICE_ENDPOINT,
            apiKey: process.env.AZURE_AI_SERVICE_API_KEY,
            apiVersion: "2024-12-01-preview",
            deployment: "text-embedding-3-large",
        });
    }
    async *requestEmbeddings(texts) {
        for (let i = 0; i < texts.length; i += this.batchSize) {
            const batch = texts.slice(i, i + this.batchSize);
            const response = await this.client.embeddings.create({
                model: "text-embedding-3-large",
                input: batch,
            });
            for (const item of response.data) {
                yield item.embedding;
            }
        }
    }
    async *embed(texts) {
        const cacheMap = new Map();
        const cachedDocs = await embeddingsCacheCollection.find({ text: { $in: texts } }).toArray();
        for (const doc of cachedDocs) {
            cacheMap.set(doc.text, doc.embedding);
        }
        const notCachedTexts = [...new Set(texts)].filter(text => !cacheMap.has(text));
        const embeddingIterator = this.requestEmbeddings(notCachedTexts);
        for (const text of notCachedTexts) {
            const { value: embedding, done } = await embeddingIterator.next();
            if (done || !embedding)
                throw new Error(`Embedding missing for text: "${text}"`);
            cacheMap.set(text, embedding);
            await embeddingsCacheCollection.insertOne({ text, embedding });
        }
        for (const text of texts) {
            const embedding = cacheMap.get(text);
            if (!embedding)
                throw new Error(`Missing embedding for text: "${text}"`);
            yield embedding;
        }
    }
    async embedDocuments(texts) {
        const embeddings = [];
        for await (const embedding of this.embed(texts)) {
            embeddings.push(embedding);
        }
        return embeddings;
    }
    async embedQuery(query) {
        const embeddingsIterator = this.embed([query]);
        const next = await embeddingsIterator.next();
        (0, assert_1.default)(!next.done, "No embedding found for query");
        return next.value;
    }
}
async function getFigmaFileMetaData(fileKey, figmaToken) {
    const response = await axios_1.default.get(`https://api.figma.com/v1/files/${fileKey}/meta`, {
        headers: {
            "X-Figma-Token": figmaToken,
        },
    });
    return response.data;
}
async function readFigmaFileCache(fileKey, fileVersion) {
    const fileDoc = await figmaFileCacheCollection.findOne({ 'metadata.fileKey': fileKey, 'metadata.fileVersion': fileVersion });
    if (!fileDoc) {
        return null;
    }
    console.info(`Cache hit: ${fileDoc.metadata.fileKey}@${fileDoc.metadata.fileVersion}`);
    const downloadStream = figmaFileCacheBucket.openDownloadStream(fileDoc._id);
    const chunks = [];
    return new Promise((resolve, reject) => {
        downloadStream.on('data', (chunk) => chunks.push(chunk));
        downloadStream.on('end', () => {
            const buffer = Buffer.concat(chunks);
            try {
                const json = JSON.parse(buffer.toString());
                resolve(json);
            }
            catch (e) {
                reject(`Failed to parse JSON: ${e}`);
            }
        });
        downloadStream.on('error', reject);
    });
}
async function writeFigmaFileCache(jsonObj, fileKey, fileVersion) {
    const cachePath = `${fileKey}_${fileVersion}.json`;
    console.info(`Writing cache to ${cachePath}`);
    const exists = await figmaFileCacheCollection.findOne({ 'metadata.fileKey': fileKey, 'metadata.fileVersion': fileVersion });
    if (exists) {
        console.info(`[SKIP] ${fileKey}@${fileVersion} already exists.`);
        return;
    }
    const jsonString = JSON.stringify(jsonObj);
    return new Promise((resolve, reject) => {
        const uploadStream = figmaFileCacheBucket.openUploadStream(cachePath, {
            metadata: { fileKey, fileVersion }
        });
        uploadStream
            .on('error', reject)
            .on('finish', () => {
            console.info(`Uploaded ${cachePath}`);
            resolve();
        });
        uploadStream.end(Buffer.from(jsonString));
    });
}
async function getFigmaFile(fileKey, fileVersion, figmaToken) {
    const fileDoc = await readFigmaFileCache(fileKey, fileVersion);
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
        await writeFigmaFileCache(resJson, fileKey, fileVersion);
    }
    return resJson;
}
function lengthPenalty(length, base = 1.5) {
    return 1 / Math.pow(base, Math.log2(length + 1));
}
function rrfScore(rank, k = 60) {
    return 1 / (k + rank);
}
function rerankScore(rank, k = 60, length, base = 1.5) {
    // RRF score with length penalty.
    return rrfScore(rank, k) * lengthPenalty(length, base);
}
async function hybridSearch(query, topK, documents) {
    const vectorStore = await memory_1.MemoryVectorStore.fromDocuments(documents, new AzureEmbeddings(1000));
    const similarityResults = await vectorStore.similaritySearch(query, topK);
    const lexicalResults = documents
        .filter(doc => doc.pageContent.toLowerCase().includes(query.toLowerCase()))
        .slice(0, topK);
    const combined = new Map();
    similarityResults.forEach((doc, i) => {
        const key = doc.pageContent;
        if (!combined.has(key))
            combined.set(key, { doc, score: 0 });
        combined.get(key).score += rerankScore(i, 60, doc.metadata.ids.length);
    });
    lexicalResults.forEach((doc, i) => {
        const key = doc.pageContent;
        if (!combined.has(key))
            combined.set(key, { doc, score: 0 });
        combined.get(key).score += rerankScore(i, 60, doc.metadata.ids.length);
    });
    const sorted = Array.from(combined.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    const result = sorted.map(({ doc }) => ({
        name: doc.pageContent,
        ids: doc.metadata.ids,
    }));
    return result;
}
async function queryFigmaFileNode(fileKey, query, topK, figmaToken) {
    const fileMeta = await getFigmaFileMetaData(fileKey, figmaToken);
    const resJson = await getFigmaFile(fileKey, fileMeta.file.version, figmaToken);
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
    return await hybridSearch(query, topK, documents);
}
async function downloadImageAsBase64(url) {
    const response = await axios_1.default.get(url, { responseType: "arraybuffer" });
    return Buffer.from(response.data, "binary").toString("base64");
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
    // const results = await Promise.all(
    //   Object.entries(response.data.images).map(async ([id, url]) => {
    //     const base64 = await downloadImageAsBase64(url as string);
    //     return { id, url: url as string, base64 };
    //   }),
    // );
    // return results;
}
