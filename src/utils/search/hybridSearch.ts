import dotenv from "dotenv";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { AzureEmbeddings } from './embed';
import { Document } from 'langchain/document';
import { EmbeddingsInterface } from "@langchain/core/embeddings";

dotenv.config();

function lengthPenalty(length: number, base = 1.5): number {
  return 1 / Math.pow(base, Math.log2(length + 1));
}

function rrfScore(rank: number, k = 60): number {
  return 1 / (k + rank);
}

function rerankScore(rank: number, k = 60, length: number, base = 1.5): number {
  // RRF score with length penalty.
  return rrfScore(rank, k) * lengthPenalty(length, base);
}

export async function hybridSearch(query: string, topK: number, documents: Document[], embeddings: EmbeddingsInterface) {
  const vectorStore = await MemoryVectorStore.fromDocuments(documents, embeddings);
  const similarityResults = await vectorStore.similaritySearch(query, topK);
  const lexicalResults = documents
    .filter(doc => doc.pageContent.toLowerCase().includes(query.toLowerCase()))
    .slice(0, topK);
  const combined = new Map<string, { doc: Document, score: number }>();
  similarityResults.forEach((doc, i) => {
    const key = doc.pageContent;
    if (!combined.has(key)) combined.set(key, { doc, score: 0 });
    combined.get(key)!.score += rerankScore(i, 60, doc.metadata.ids.length);
  });

  lexicalResults.forEach((doc, i) => {
    const key = doc.pageContent;
    if (!combined.has(key)) combined.set(key, { doc, score: 0 });
    combined.get(key)!.score += rerankScore(i, 60, doc.metadata.ids.length);
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
