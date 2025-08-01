import axios from 'axios';
import { Document } from 'langchain/document';
import { type EmbeddingsInterface } from "@langchain/core/embeddings";
import assert from 'assert';
import { AzureOpenAI } from 'openai';
import dotenv from "dotenv";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { MongoClient, GridFSBucket } from 'mongodb';
import path from "path";

dotenv.config();

const mongoClient = new MongoClient(process.env.MONGODB_URI!);
const embeddingsCacheDB = mongoClient.db("embeddings_cache");
const embeddingsCacheCollection = embeddingsCacheDB.collection("text-embedding-3-large");
embeddingsCacheCollection.createIndex({ text: 1 });
const figmaFileCacheDB = mongoClient.db("figma_file_cache");
const figmaFileCacheBucket = new GridFSBucket(figmaFileCacheDB, { bucketName: 'figma_file_bucket' });
const figmaFileCacheCollection = figmaFileCacheDB.collection('figma_file_bucket.files');
figmaFileCacheCollection.createIndex({ 'metadata.fileKey': 1, 'metadata.fileVersion': 1 });

function addOmitMessage(figmaNode: Record<string, any>, maxDepth: number): Record<string, any> {
  function traverse(node: Record<string, any>, depth = 0): void {
    if (depth >= maxDepth) {
      if (Array.isArray(node.children)) {
        node.children = `<omitted due to depth reached, search for a deeper node (for example, ids='${node.id}' with depth=1) to explore the children>`;
      }
    } else {
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

export async function getFigmaFileNode(
  fileKey: string,
  ids: string[],
  depth: number,
  geometry: boolean,
  figmaToken: string,
): Promise<Record<string, any>> {
  const response = await axios.get(
    `https://api.figma.com/v1/files/${fileKey}/nodes`,
    {
      headers: {
        'X-Figma-Token': figmaToken,
      },
      params: {
        ids: ids.join(","),
        depth: depth,
        geometry: geometry ? "paths" : undefined
      }
    }
  );
  const resJson = response.data;
  for (const [k, v] of Object.entries(resJson.nodes ?? {})) {
    if (v && typeof v === "object" && "document" in v && v.document) {
      v.document = addOmitMessage(v.document, depth);
    }
  }
  return resJson;
}

export async function getFigmaFileRoot(
  fileKey: string,
  depth: number,
  geometry: boolean,
  figmaToken: string,
): Promise<Record<string, any>> {
  const response = await axios.get(
    `https://api.figma.com/v1/files/${fileKey}`,
    {
      headers: {
        'X-Figma-Token': figmaToken,
      },
      params: {
        ids: "0:0",
        depth: depth,
        geometry: geometry ? "paths" : undefined,
      }
    }
  );
  const resJson = response.data;
  resJson.document = addOmitMessage(resJson.document, depth);
  return resJson;
}


function* traverse_node(node: Record<string, any>): Generator<[string, string]> {
  yield [node.name, node.id];
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      yield* traverse_node(child);
    }
  }
}

class AzureEmbeddings implements EmbeddingsInterface {
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
    const cachedDocs = await embeddingsCacheCollection.find({ text: { $in: texts } }).toArray();
    for (const doc of cachedDocs) {
      cacheMap.set(doc.text, doc.embedding);
    }
    const notCachedTexts = [...new Set(texts)].filter(text => !cacheMap.has(text));
    const embeddingIterator = this.requestEmbeddings(notCachedTexts);

    for (const text of notCachedTexts) {
      const { value: embedding, done } = await embeddingIterator.next();
      if (done || !embedding) throw new Error(`Embedding missing for text: "${text}"`);
      cacheMap.set(text, embedding);
      await embeddingsCacheCollection.insertOne({ text, embedding });
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
    assert(!next.done, "No embedding found for query");
    return next.value;
  }
}

async function getFigmaFileMetaData(fileKey: string, figmaToken: string) {
  const response = await axios.get(
    `https://api.figma.com/v1/files/${fileKey}/meta`,
    {
      headers: {
        "X-Figma-Token": figmaToken,
      },
    }
  );
  return response.data;
}

async function readFigmaFileCache(fileKey: string, fileVersion: string): Promise<any> {
  const fileDoc = await figmaFileCacheCollection.findOne({ 'metadata.fileKey': fileKey, 'metadata.fileVersion': fileVersion });
  if (!fileDoc) {
    return null;
  }
  console.info(`Cache hit: ${fileDoc.metadata.fileKey}@${fileDoc.metadata.fileVersion}`);

  const downloadStream = figmaFileCacheBucket.openDownloadStream(fileDoc._id);
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    downloadStream.on('data', (chunk) => chunks.push(chunk));
    downloadStream.on('end', () => {
      const buffer = Buffer.concat(chunks);
      try {
        const json = JSON.parse(buffer.toString());
        resolve(json);
      } catch (e) {
        reject(`Failed to parse JSON: ${e}`);
      }
    });
    downloadStream.on('error', reject);
  });
}
async function writeFigmaFileCache(jsonObj: any, fileKey: string, fileVersion: string): Promise<void> {
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

async function getFigmaFile(fileKey: string, fileVersion: string, figmaToken: string) {
  const fileDoc = await readFigmaFileCache(fileKey, fileVersion);
  if (fileDoc) {
    return fileDoc;
  }
  const response = await axios.get(
    `https://api.figma.com/v1/files/${fileKey}`,
    {
      headers: {
        "X-Figma-Token": figmaToken,
      },
      params: {
        "ids": "0:0"
      }
    }
  )
  const resJson = response.data;
  if (response.status !== 200) {
    throw new Error(`Failed to get Figma file: ${response.status} ${response.statusText}`);
  }
  if (resJson) {
    await writeFigmaFileCache(resJson, fileKey, fileVersion);
  }
  return resJson;
}

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

async function hybridSearch(query: string, topK: number, documents: Document[]) {
  const vectorStore = await MemoryVectorStore.fromDocuments(documents, new AzureEmbeddings(1000));
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

export async function queryFigmaFileNode(
  fileKey: string,
  query: string,
  topK: number,
  figmaToken: string,
): Promise<{ name: string, ids: string[] }[]> {
  const fileMeta = await getFigmaFileMetaData(fileKey, figmaToken);
  const resJson = await getFigmaFile(fileKey, fileMeta.file.version, figmaToken);
  // Construct mapping of name to ids.
  const groupedMap = Array.from(traverse_node(resJson.document)).reduce(
    (acc: Map<string, string[]>, [name, id]) => {
      if (!acc.has(name)) {
        acc.set(name, []);
      }
      acc.get(name)!.push(id);
      return acc;
    },
    new Map<string, string[]>()
  );
  const documents = Array.from(groupedMap.entries()).map(([name, ids]) => {
    return new Document({
      pageContent: name,
      metadata: {
        ids: ids,
      },
    });
  });

  // Hybrid search.
  return await hybridSearch(query, topK, documents);
}


async function downloadImageAsBase64(url: string): Promise<string> {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  return Buffer.from(response.data, "binary").toString("base64");
}

export async function getFigmaImages(
  fileKey: string,
  ids: string[],
  scale: number,
  contents_only: boolean,
  figmaToken: string,
): Promise<{ id: string; url: string; base64: string }[]> {
  const response = await axios.get(
    `https://api.figma.com/v1/images/${fileKey}`,
    {
      headers: {
        "X-Figma-Token": figmaToken,
      },
      params: {
        ids: ids.join(","),
        format: "png",
        scale: scale,
        contents_only: contents_only ? "true": "false",
      }
    }
  )
  return response.data.images;

  // const results = await Promise.all(
  //   Object.entries(response.data.images).map(async ([id, url]) => {
  //     const base64 = await downloadImageAsBase64(url as string);
  //     return { id, url: url as string, base64 };
  //   }),
  // );
  // return results;
}