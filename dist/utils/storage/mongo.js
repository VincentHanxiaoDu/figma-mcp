"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.figmaFileCacheCollection = exports.figmaFileCacheBucket = exports.figmaFileCacheDB = exports.embeddingsCacheCollection = exports.embeddingsCacheDB = exports.mongoClient = void 0;
exports.readFigmaFileCache = readFigmaFileCache;
exports.writeFigmaFileCache = writeFigmaFileCache;
const mongodb_1 = require("mongodb");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Embeddings cache.
exports.mongoClient = new mongodb_1.MongoClient(process.env.MONGODB_URI);
exports.embeddingsCacheDB = exports.mongoClient.db(process.env.MONGODB_EMBEDDING_CACHE_DB);
exports.embeddingsCacheCollection = exports.embeddingsCacheDB.collection("text-embedding-3-large");
exports.embeddingsCacheCollection.createIndex({ text: 1 });
// Figma file cache.
exports.figmaFileCacheDB = exports.mongoClient.db("figma_file_cache");
exports.figmaFileCacheBucket = new mongodb_1.GridFSBucket(exports.figmaFileCacheDB, { bucketName: 'figma_file_bucket' });
exports.figmaFileCacheCollection = exports.figmaFileCacheDB.collection('figma_file_bucket.files');
exports.figmaFileCacheCollection.createIndex({ 'metadata.fileKey': 1, 'metadata.fileVersion': 1 });
async function readFigmaFileCache(fileKey, fileVersion) {
    const fileDoc = await exports.figmaFileCacheCollection.findOne({ 'metadata.fileKey': fileKey, 'metadata.fileVersion': fileVersion });
    if (!fileDoc) {
        return null;
    }
    console.info(`Cache hit: ${fileDoc.metadata.fileKey}@${fileDoc.metadata.fileVersion}`);
    const downloadStream = exports.figmaFileCacheBucket.openDownloadStream(fileDoc._id);
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
    const exists = await exports.figmaFileCacheCollection.findOne({ 'metadata.fileKey': fileKey, 'metadata.fileVersion': fileVersion });
    if (exists) {
        console.info(`[SKIP] ${fileKey}@${fileVersion} already exists.`);
        return;
    }
    const jsonString = JSON.stringify(jsonObj);
    return new Promise((resolve, reject) => {
        const uploadStream = exports.figmaFileCacheBucket.openUploadStream(cachePath, {
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
