"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hybridSearch = hybridSearch;
const dotenv_1 = __importDefault(require("dotenv"));
const memory_1 = require("langchain/vectorstores/memory");
dotenv_1.default.config();
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
async function hybridSearch(query, topK, documents, embeddings) {
    const vectorStore = await memory_1.MemoryVectorStore.fromDocuments(documents, embeddings);
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
