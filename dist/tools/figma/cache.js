"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FigmaFileMemoryCache = exports.FigmaFileMongoCache = void 0;
const mongodb_1 = require("mongodb");
class FigmaFileMongoCache {
    constructor(mongoClient) {
        const dbName = "figma_file_cache";
        const bucketName = "figma_file_bucket";
        const collectionName = "figma_file_bucket.files";
        const db = mongoClient.db(dbName);
        this.figmaFileCacheCollection = db.collection(collectionName);
        this.figmaFileCacheBucket = new mongodb_1.GridFSBucket(db, { bucketName: bucketName });
        this.figmaFileCacheCollection.createIndex({ 'metadata.fileKey': 1, 'metadata.fileVersion': 1 });
    }
    async readFigmaFileCache(fileKey, fileVersion) {
        const fileDoc = await this.figmaFileCacheCollection.findOne({ 'metadata.fileKey': fileKey, 'metadata.fileVersion': fileVersion });
        if (!fileDoc) {
            return null;
        }
        console.info(`Cache hit: ${fileDoc.metadata.fileKey}@${fileDoc.metadata.fileVersion}`);
        const downloadStream = this.figmaFileCacheBucket.openDownloadStream(fileDoc._id);
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
    async writeFigmaFileCache(jsonObj, fileKey, fileVersion) {
        const cachePath = `${fileKey}_${fileVersion}.json`;
        console.info(`Writing cache to ${cachePath}`);
        const exists = await this.figmaFileCacheCollection.findOne({ 'metadata.fileKey': fileKey, 'metadata.fileVersion': fileVersion });
        if (exists) {
            console.info(`[SKIP] ${fileKey}@${fileVersion} already exists.`);
            return;
        }
        const jsonString = JSON.stringify(jsonObj);
        return new Promise((resolve, reject) => {
            const uploadStream = this.figmaFileCacheBucket.openUploadStream(cachePath, {
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
}
exports.FigmaFileMongoCache = FigmaFileMongoCache;
class FigmaFileMemoryCache {
    constructor() {
        this.figmaFileCache = new Map();
    }
    async readFigmaFileCache(fileKey, fileVersion) {
        return this.figmaFileCache.get({ fileKey, fileVersion }) ?? null;
    }
    async writeFigmaFileCache(jsonObj, fileKey, fileVersion) {
        this.figmaFileCache.set({ fileKey, fileVersion }, jsonObj);
    }
}
exports.FigmaFileMemoryCache = FigmaFileMemoryCache;
