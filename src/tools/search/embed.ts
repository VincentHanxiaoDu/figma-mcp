import { EmbeddingsInterface } from "@langchain/core/embeddings";
import { AzureOpenAI } from "openai";
import { assert } from "console";
import { MongoClient } from "mongodb";

export interface Embeddings {
  getEmbeddings(texts: string[]): AsyncGenerator<number[], void, unknown>;
}

export class AzureEmbeddings implements Embeddings {
  protected batchSize: number;
  protected client: AzureOpenAI;

  constructor(batchSize: number) {
    assert(Number.isInteger(batchSize), "batchSize must be an integer");
    this.batchSize = batchSize;
    this.client = new AzureOpenAI({
      endpoint: process.env.AZURE_AI_SERVICE_ENDPOINT!,
      apiKey: process.env.AZURE_AI_SERVICE_API_KEY!,
      apiVersion: "2024-12-01-preview",
      deployment: "text-embedding-3-large",
    });
  }

  async *getEmbeddings(texts: string[]): AsyncGenerator<number[], void, unknown> {
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);

      const response = await this.client.embeddings.create({
        model: "text-embedding-3-large",
        input: batch,
      });

      for (const item of response.data) {
        yield item.embedding as number[];
      }
    }
  }
}

export class MongoCacheableEmbeddings implements EmbeddingsInterface {
  protected embeddingsCacheDB;
  protected cacheCollection;
  protected embeddings: Embeddings;

  public constructor(embeddings: Embeddings, mongoClient: MongoClient, cacheCollectionName: string) {
    this.embeddingsCacheDB = mongoClient.db(process.env.MONGODB_EMBEDDING_CACHE_DB || "embedding-cache");
    this.cacheCollection = this.embeddingsCacheDB.collection(cacheCollectionName);
    this.cacheCollection.createIndex({ text: 1 });
    this.embeddings = embeddings;
  }

  async *embed(texts: string[]): AsyncGenerator<number[], void, unknown> {
    const cacheMap = new Map<string, number[]>();
    const cachedDocs = await this.cacheCollection.find({ text: { $in: texts } }).toArray();
    for (const doc of cachedDocs) {
      cacheMap.set(doc.text, doc.embedding);
    }
    const notCachedTexts = [...new Set(texts)].filter(text => !cacheMap.has(text));
    const embeddingIterator = this.embeddings.getEmbeddings(notCachedTexts);

    for (const text of notCachedTexts) {
      const { value: embedding, done } = await embeddingIterator.next();
      if (done || !embedding) throw new Error(`Embedding missing for text: "${text}"`);
      cacheMap.set(text, embedding);
      await this.cacheCollection.insertOne({ text, embedding });
    }

    yield* texts.map(text => cacheMap.get(text) as number[]);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for await (const embedding of this.embed(texts)) {
      embeddings.push(embedding);
    }
    return embeddings;
  }

  async embedQuery(query: string): Promise<number[]> {
    const embeddingsIterator = this.embed([query]);
    const next = await embeddingsIterator.next();
    if (next.done) throw new Error(`No embedding found for query: "${query}"`);
    return next.value;
  }
}



export class MemoryCacheableEmbeddings implements EmbeddingsInterface {
  protected embeddingsCache: Map<string, number[]>;
  protected embeddings: Embeddings;

  public constructor(embeddings: Embeddings) {
    this.embeddingsCache = new Map();
    this.embeddings = embeddings;
  }

  async *embed(texts: string[]): AsyncGenerator<number[], void, unknown> {
    const cacheMap = new Map<string, number[]>();
    for (const text of texts) {
      if (this.embeddingsCache.has(text)) {
        cacheMap.set(text, this.embeddingsCache.get(text) as number[]);
      }
    }
    const notCachedTexts = [...new Set(texts)].filter(text => !cacheMap.has(text));
    const embeddingIterator = this.embeddings.getEmbeddings(notCachedTexts);

    for (const text of notCachedTexts) {
      const { value: embedding, done } = await embeddingIterator.next();
      if (done || !embedding) throw new Error(`Embedding missing for text: "${text}"`);
      cacheMap.set(text, embedding);
      this.embeddingsCache.set(text, embedding);
    }

    yield* texts.map(text => cacheMap.get(text) as number[]);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for await (const embedding of this.embed(texts)) {
      embeddings.push(embedding);
    }
    return embeddings;
  }

  async embedQuery(query: string): Promise<number[]> {
    const embeddingsIterator = this.embed([query]);
    const next = await embeddingsIterator.next();
    if (next.done) throw new Error(`No embedding found for query: "${query}"`);
    return next.value;
  }
}