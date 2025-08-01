import { EmbeddingsInterface } from "@langchain/core/embeddings";
import { AzureOpenAI } from "openai";
import { assert } from "console";
import { embeddingsCacheDB } from "../storage/mongo";

export class AzureEmbeddings implements EmbeddingsInterface {
  static readonly cacheCollection = embeddingsCacheDB.collection("text-embedding-3-large");
  private batchSize: number;
  private client: AzureOpenAI;

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

  async *requestEmbeddings(texts: string[]): AsyncGenerator<number[], void, unknown> {
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

  async *embed(texts: string[]): AsyncGenerator<number[], void, unknown> {
    const cacheMap = new Map<string, number[]>();
    const cachedDocs = await AzureEmbeddings.cacheCollection.find({ text: { $in: texts } }).toArray();
    for (const doc of cachedDocs) {
      cacheMap.set(doc.text, doc.embedding);
    }
    const notCachedTexts = [...new Set(texts)].filter(text => !cacheMap.has(text));
    const embeddingIterator = this.requestEmbeddings(notCachedTexts);

    for (const text of notCachedTexts) {
      const { value: embedding, done } = await embeddingIterator.next();
      if (done || !embedding) throw new Error(`Embedding missing for text: "${text}"`);
      cacheMap.set(text, embedding);
      await AzureEmbeddings.cacheCollection.insertOne({ text, embedding });
    }

    for (const text of texts) {
      const embedding = cacheMap.get(text);
      if (!embedding) throw new Error(`Missing embedding for text: "${text}"`);
      yield embedding;
    }
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