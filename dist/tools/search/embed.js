"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MongoCacheableEmbeddings = exports.AzureEmbeddings = void 0;
const openai_1 = require("openai");
const console_1 = require("console");
class AzureEmbeddings {
    constructor(batchSize) {
        (0, console_1.assert)(Number.isInteger(batchSize), "batchSize must be an integer");
        this.batchSize = batchSize;
        this.client = new openai_1.AzureOpenAI({
            endpoint: process.env.AZURE_AI_SERVICE_ENDPOINT,
            apiKey: process.env.AZURE_AI_SERVICE_API_KEY,
            apiVersion: "2024-12-01-preview",
            deployment: "text-embedding-3-large",
        });
    }
    async *getEmbeddings(texts) {
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
}
exports.AzureEmbeddings = AzureEmbeddings;
class MongoCacheableEmbeddings {
    constructor(embeddings, mongoClient, cacheCollectionName) {
        this.embeddingsCacheDB = mongoClient.db(process.env.MONGODB_EMBEDDING_CACHE_DB || "embedding-cache");
        this.cacheCollection = this.embeddingsCacheDB.collection(cacheCollectionName);
        this.cacheCollection.createIndex({ text: 1 });
        this.embeddings = embeddings;
    }
    async *embed(texts) {
        const cacheMap = new Map();
        const cachedDocs = await this.cacheCollection.find({ text: { $in: texts } }).toArray();
        for (const doc of cachedDocs) {
            cacheMap.set(doc.text, doc.embedding);
        }
        const notCachedTexts = [...new Set(texts)].filter(text => !cacheMap.has(text));
        const embeddingIterator = this.embeddings.getEmbeddings(notCachedTexts);
        for (const text of notCachedTexts) {
            const { value: embedding, done } = await embeddingIterator.next();
            if (done || !embedding)
                throw new Error(`Embedding missing for text: "${text}"`);
            cacheMap.set(text, embedding);
            await this.cacheCollection.insertOne({ text, embedding });
        }
        yield* texts.map(text => cacheMap.get(text));
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
        if (next.done)
            throw new Error(`No embedding found for query: "${query}"`);
        return next.value;
    }
}
exports.MongoCacheableEmbeddings = MongoCacheableEmbeddings;
