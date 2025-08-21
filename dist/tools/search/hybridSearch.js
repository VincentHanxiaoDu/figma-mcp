"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileContentHybridSearch = fileContentHybridSearch;
exports.fileNameHybridSearch = fileNameHybridSearch;
const dotenv_1 = __importDefault(require("dotenv"));
const memory_1 = require("langchain/vectorstores/memory");
dotenv_1.default.config();
const DEFAULT_CONFIG = {
    k: 60,
    lengthPenaltyBase: 1.5,
    topK: 10
};
function lengthPenalty(length, base = 1.5) {
    if (!length || length <= 0)
        return 1;
    return 1 / Math.pow(base, Math.log2(length + 1));
}
function rrfScore(rank, k = 60) {
    return 1 / (k + rank);
}
function rerankScore(rank, config, length) {
    const baseScore = rrfScore(rank, config.k);
    return baseScore * lengthPenalty(length, config.lengthPenaltyBase);
}
function lexicalSearch(documents, query, topK) {
    if (!query.trim() || documents.length === 0)
        return [];
    const terms = query.toLowerCase().trim().split(/\s+/).filter(term => term.length > 0);
    if (terms.length === 0)
        return [];
    const scored = documents.map(doc => {
        const content = doc.pageContent.toLowerCase();
        let score = 0;
        for (const term of terms) {
            const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
            const matches = content.match(regex);
            if (matches) {
                score += matches.length;
            }
        }
        if (score > 0) {
            const termCoverage = terms.filter(term => {
                const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
                return regex.test(content);
            }).length / terms.length;
            score *= termCoverage;
        }
        return { doc, score };
    });
    return scored
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map(item => item.doc);
}
async function performHybridSearch(query, documents, embeddings, config = DEFAULT_CONFIG, includeLengthPenalty = false) {
    if (!query.trim() || documents.length === 0) {
        return [];
    }
    try {
        const filteredDocuments = documents.filter(doc => doc.pageContent.trim().length > 0);
        const vectorStore = await memory_1.MemoryVectorStore.fromDocuments(filteredDocuments, embeddings);
        const [similarityResults, lexicalResults] = await Promise.all([
            vectorStore.similaritySearch(query, config.topK),
            Promise.resolve(lexicalSearch(documents, query, config.topK))
        ]);
        const combined = new Map();
        similarityResults.forEach((doc, i) => {
            const key = doc.pageContent;
            if (!combined.has(key)) {
                combined.set(key, { doc, score: 0 });
            }
            const length = includeLengthPenalty ? doc.metadata?.ids?.length : undefined;
            combined.get(key).score += rerankScore(i, config, length);
        });
        lexicalResults.forEach((doc, i) => {
            const key = doc.pageContent;
            if (!combined.has(key)) {
                combined.set(key, { doc, score: 0 });
            }
            const length = includeLengthPenalty ? doc.metadata?.ids?.length : undefined;
            combined.get(key).score += rerankScore(i, config, length);
        });
        return Array.from(combined.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, config.topK);
    }
    catch (error) {
        console.error('Error performing hybrid search:', error);
        throw new Error(`Hybrid search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
async function fileContentHybridSearch(query, topK, documents, embeddings, config) {
    const searchConfig = { ...DEFAULT_CONFIG, topK, ...config };
    const results = await performHybridSearch(query, documents, embeddings, searchConfig, true);
    return results.map(({ doc }) => doc);
}
async function fileNameHybridSearch(query, topK, documents, embeddings, config) {
    const searchConfig = { ...DEFAULT_CONFIG, topK, ...config };
    const results = await performHybridSearch(query, documents, embeddings, searchConfig, false);
    return results.map(({ doc }) => doc);
}
