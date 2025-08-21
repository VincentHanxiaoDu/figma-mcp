import dotenv from "dotenv";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from 'langchain/document';
import { EmbeddingsInterface } from "@langchain/core/embeddings";

dotenv.config();

interface HybridSearchConfig {
  k: number;
  lengthPenaltyBase: number;
  topK: number;
}

interface SearchResult {
  name: string;
  ids: string[];
}

interface ScoredDocument {
  doc: Document;
  score: number;
}

const DEFAULT_CONFIG: HybridSearchConfig = {
  k: 60,
  lengthPenaltyBase: 1.5,
  topK: 10
};

export { HybridSearchConfig };

function lengthPenalty(length?: number, base = 1.5): number {
  if (!length || length <= 0) return 1;
  return 1 / Math.pow(base, Math.log2(length + 1));
}

function rrfScore(rank: number, k = 60): number {
  return 1 / (k + rank);
}

function rerankScore(rank: number, config: HybridSearchConfig, length?: number): number {
  const baseScore = rrfScore(rank, config.k);
  return baseScore * lengthPenalty(length, config.lengthPenaltyBase);
}

function lexicalSearch(documents: Document[], query: string, topK: number): Document[] {
  if (!query.trim() || documents.length === 0) return [];
  
  const terms = query.toLowerCase().trim().split(/\s+/).filter(term => term.length > 0);
  if (terms.length === 0) return [];

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

async function performHybridSearch(
  query: string,
  documents: Document[],
  embeddings: EmbeddingsInterface,
  config: HybridSearchConfig = DEFAULT_CONFIG,
  includeLengthPenalty = false
): Promise<ScoredDocument[]> {
  if (!query.trim() || documents.length === 0) {
    return [];
  }

  try {
    const filteredDocuments = documents.filter(doc => doc.pageContent.trim().length > 0);
    const vectorStore = await MemoryVectorStore.fromDocuments(filteredDocuments, embeddings);
    const [similarityResults, lexicalResults] = await Promise.all([
      vectorStore.similaritySearch(query, config.topK),
      Promise.resolve(lexicalSearch(documents, query, config.topK))
    ]);
    
    const combined = new Map<string, ScoredDocument>();
    
    similarityResults.forEach((doc, i) => {
      const key = doc.pageContent;
      if (!combined.has(key)) {
        combined.set(key, { doc, score: 0 });
      }
      const length = includeLengthPenalty ? doc.metadata?.ids?.length : undefined;
      combined.get(key)!.score += rerankScore(i, config, length);
    });

    lexicalResults.forEach((doc, i) => {
      const key = doc.pageContent;
      if (!combined.has(key)) {
        combined.set(key, { doc, score: 0 });
      }
      const length = includeLengthPenalty ? doc.metadata?.ids?.length : undefined;
      combined.get(key)!.score += rerankScore(i, config, length);
    });

    return Array.from(combined.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, config.topK);
  } catch (error) {
    console.error('Error performing hybrid search:', error);
    throw new Error(`Hybrid search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function fileContentHybridSearch(
  query: string,
  topK: number,
  documents: Document[],
  embeddings: EmbeddingsInterface,
  config?: Partial<HybridSearchConfig>
): Promise<Document[]> {
  const searchConfig = { ...DEFAULT_CONFIG, topK, ...config };
  const results = await performHybridSearch(query, documents, embeddings, searchConfig, true);
  
  return results.map(({ doc }) => doc);
}

export async function fileNameHybridSearch(
  query: string,
  topK: number,
  documents: Document[],
  embeddings: EmbeddingsInterface,
  config?: Partial<HybridSearchConfig>
): Promise<Document[]> {
  const searchConfig = { ...DEFAULT_CONFIG, topK, ...config };
  const results = await performHybridSearch(query, documents, embeddings, searchConfig, false);
  
  return results.map(({ doc }) => doc);
}
