import { MongoClient, GridFSBucket } from 'mongodb';
import dotenv from "dotenv";

dotenv.config();

// Embeddings cache.
export const mongoClient = new MongoClient(process.env.MONGODB_URI!);
export const embeddingsCacheDB = mongoClient.db(process.env.MONGODB_EMBEDDING_CACHE_DB!);
export const embeddingsCacheCollection = embeddingsCacheDB.collection("text-embedding-3-large");
embeddingsCacheCollection.createIndex({ text: 1 });

// Figma file cache.
export const figmaFileCacheDB = mongoClient.db("figma_file_cache");
export const figmaFileCacheBucket = new GridFSBucket(figmaFileCacheDB, { bucketName: 'figma_file_bucket' });
export const figmaFileCacheCollection = figmaFileCacheDB.collection('figma_file_bucket.files');
figmaFileCacheCollection.createIndex({ 'metadata.fileKey': 1, 'metadata.fileVersion': 1 });


export async function readFigmaFileCache(fileKey: string, fileVersion: string): Promise<any> {
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


export async function writeFigmaFileCache(jsonObj: any, fileKey: string, fileVersion: string): Promise<void> {
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