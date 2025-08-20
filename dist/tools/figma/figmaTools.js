"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFigmaUrl = parseFigmaUrl;
exports.getFigmaFileNode = getFigmaFileNode;
exports.getFigmaFileRoot = getFigmaFileRoot;
exports.queryFigmaFileNode = queryFigmaFileNode;
exports.getFigmaFilePages = getFigmaFilePages;
exports.getFigmaImages = getFigmaImages;
exports.getFigmaPlans = getFigmaPlans;
exports.getFigmaTeams = getFigmaTeams;
exports.getFigmaFolders = getFigmaFolders;
exports.getFigmaFiles = getFigmaFiles;
exports.queryFigmaFiles = queryFigmaFiles;
const axios_1 = __importDefault(require("axios"));
const document_1 = require("langchain/document");
const hybridSearch_1 = require("../search/hybridSearch");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
function parseFigmaUrl(url) {
    const figmaUrl = new URL(url);
    if (!figmaUrl.hostname.includes("figma.com")) {
        throw new Error(`Invalid Figma URL: ${url}`);
    }
    const pathMatch = figmaUrl.pathname.match(/^\/design\/([^/]+)/);
    if (!pathMatch) {
        throw new Error(`Invalid Figma URL: ${url}`);
    }
    const fileKey = pathMatch[1];
    const queryParams = {};
    figmaUrl.searchParams.forEach((value, key) => {
        queryParams[key] = value;
    });
    return { fileKey, queryParams };
}
function addOmitMessage(figmaNode, maxDepth) {
    function traverse(node, depth = 0) {
        if (depth >= maxDepth) {
            if (Array.isArray(node.children)) {
                node.children = `<omitted due to depth reached, search for a deeper node (for example, ids='${node.id}' with depth=1) to explore the children>`;
            }
        }
        else {
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
async function getFigmaFileNode(fileKey, ids, depth, geometry, figmaToken) {
    const response = await axios_1.default.get(`https://api.figma.com/v1/files/${fileKey}/nodes`, {
        headers: {
            'X-Figma-Token': figmaToken,
        },
        params: {
            ids: ids.join(","),
            depth: depth,
            geometry: geometry ? "paths" : undefined
        }
    });
    const resJson = response.data;
    for (const [k, v] of Object.entries(resJson.nodes ?? {})) {
        if (v && typeof v === "object" && "document" in v && v.document) {
            v.document = addOmitMessage(v.document, depth);
        }
    }
    return resJson;
}
async function getFigmaFileRoot(fileKey, depth, geometry, figmaToken) {
    const response = await axios_1.default.get(`https://api.figma.com/v1/files/${fileKey}`, {
        headers: {
            'X-Figma-Token': figmaToken,
        },
        params: {
            ids: "0:0",
            depth: depth,
            geometry: geometry ? "paths" : undefined,
        }
    });
    const resJson = response.data;
    resJson.document = addOmitMessage(resJson.document, depth);
    return resJson;
}
function* traverse_node(node, process) {
    yield process(node);
    if (Array.isArray(node.children)) {
        for (const child of node.children) {
            yield* traverse_node(child, process);
        }
    }
}
async function getFigmaFileMetaData(fileKey, figmaToken) {
    const response = await axios_1.default.get(`https://api.figma.com/v1/files/${fileKey}/meta`, {
        headers: {
            "X-Figma-Token": figmaToken,
        },
    });
    if (response.status !== 200) {
        throw new Error(`Failed to get Figma file meta data: ${response.status} ${response.statusText}`);
    }
    return response.data;
}
async function getFigmaFile(figmaFileCache, fileKey, fileVersion, figmaToken) {
    const fileDoc = await figmaFileCache?.readFigmaFileCache(fileKey, fileVersion);
    if (fileDoc) {
        return fileDoc;
    }
    const response = await axios_1.default.get(`https://api.figma.com/v1/files/${fileKey}`, {
        headers: {
            "X-Figma-Token": figmaToken,
        },
        params: {
            "ids": "0:0"
        }
    });
    const resJson = response.data;
    if (response.status !== 200) {
        throw new Error(`Failed to get Figma file: ${response.status} ${response.statusText}`);
    }
    if (resJson) {
        await figmaFileCache?.writeFigmaFileCache(resJson, fileKey, fileVersion);
    }
    return resJson;
}
async function queryFigmaFileNode(figmaFileCache, fileKey, query, topK, figmaToken, embeddings) {
    const fileMeta = await getFigmaFileMetaData(fileKey, figmaToken);
    const resJson = await getFigmaFile(figmaFileCache, fileKey, fileMeta.file.version, figmaToken);
    // Construct mapping of name to ids.
    const groupedMap = Array.from(traverse_node(resJson.document, (node) => [node.name, node.id])).reduce((acc, [name, id]) => {
        if (!acc.has(name)) {
            acc.set(name, []);
        }
        acc.get(name).push(id);
        return acc;
    }, new Map());
    const documents = Array.from(groupedMap.entries()).map(([name, ids]) => {
        return new document_1.Document({
            pageContent: name,
            metadata: {
                ids: ids,
            },
        });
    });
    // Hybrid search.
    const hybridSearchResults = await (0, hybridSearch_1.fileContentHybridSearch)(query, topK, documents, embeddings);
    return hybridSearchResults.map((doc) => ({
        name: doc.pageContent,
        ids: doc.metadata?.ids || [],
    }));
}
async function getFigmaFilePages(fileKey, figmaToken) {
    const fileMeta = await getFigmaFileMetaData(fileKey, figmaToken);
    const figmaFile = await getFigmaFile(null, fileKey, fileMeta.file.version, figmaToken);
    return Array.from(traverse_node(figmaFile.document, (node) => {
        if (node.type === "CANVAS") {
            return {
                name: node.name,
                id: node.id,
            };
        }
        return null;
    })).filter((page) => page !== null);
}
const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const TRAILING = /[ .]+$/;
function toSafeFilename(name) {
    return name.replace(INVALID_CHARS, "_").replace(TRAILING, "");
}
function safeJoin(dir, filename) {
    const safe = toSafeFilename(filename);
    const full = node_path_1.default.resolve(dir, safe);
    const base = node_path_1.default.resolve(dir) + node_path_1.default.sep;
    if (!full.startsWith(base))
        throw new Error("Path traversal detected");
    return full;
}
async function writePNGToFile(id, url, saveDir) {
    await node_fs_1.default.mkdir(saveDir, { recursive: true }, (err) => { if (err)
        throw err; });
    const filename = `${id}.png`;
    const imagePath = safeJoin(saveDir, filename);
    try {
        const resp = await axios_1.default.get(url, { responseType: "arraybuffer" });
        const buf = Buffer.from(resp.data);
        const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
            throw new Error("Downloaded file is not a valid PNG");
        }
        await node_fs_1.default.writeFile(imagePath, buf, (err) => { if (err)
            throw err; });
        return { id, url, path: imagePath };
    }
    catch (error) {
        console.error(`Failed to write image ${id} to ${imagePath}:`, error);
        return { id, url };
    }
}
async function getFigmaImages(fileKey, ids, saveDir, scale, contents_only, figmaToken) {
    const response = await axios_1.default.get(`https://api.figma.com/v1/images/${fileKey}`, {
        headers: {
            "X-Figma-Token": figmaToken,
        },
        params: {
            ids: ids.join(","),
            format: "png",
            scale: scale,
            contents_only: contents_only ? "true" : "false",
        }
    });
    const images = response.data.images;
    if (saveDir) {
        const imageInfo = await Promise.all(Object.entries(images).map(async ([id, url]) => writePNGToFile(id, url, saveDir)));
        return imageInfo;
    }
    return Object.entries(images).map(([id, url]) => ({
        id: id,
        url: url,
    }));
}
async function getFigmaPlans(figmaCookies, compact = true) {
    const response = await axios_1.default.get(`https://www.figma.com/api/user/plans`, {
        headers: {
            "Cookie": figmaCookies,
        }
    });
    if (compact) {
        return response.data.meta.plans.map((plan) => ({
            planId: plan.plan_id,
            planName: plan.plan_name,
        }));
    }
    else {
        return response.data;
    }
}
async function getFigmaTeams(planId, figmaCookies, compact = true) {
    const response = await axios_1.default.get(`https://www.figma.com/api/orgs/${planId}/teams`, {
        params: {
            include_member_count: false,
            include_project_count: false,
            include_top_members: false,
        },
        headers: {
            "Cookie": figmaCookies,
        },
    });
    if (compact) {
        return response.data.meta.map((team) => ({
            teamId: team.id,
            teamName: team.name,
        }));
    }
    else {
        return response.data;
    }
}
async function getFigmaFolders(teamsId, figmaCookies, compact = true) {
    const response = await axios_1.default.get(`https://www.figma.com/api/teams/${teamsId}/folders`, {
        headers: {
            "Cookie": figmaCookies,
        },
    });
    if (compact) {
        return response.data.meta.folder_rows.map((folderRow) => ({
            folderId: folderRow.id,
            folderPath: folderRow.path,
            folderDescription: folderRow.description
        }));
    }
    else {
        return response.data;
    }
}
async function getFigmaFilesPaginated(subPath, figmaCookies, compact = true, acc = []) {
    const response = await axios_1.default.get(`https://www.figma.com${subPath}`, {
        headers: {
            "Cookie": figmaCookies,
        },
    });
    const nextPage = response.data.pagination.next_page;
    const pagePayload = compact ? response.data.meta.files.map((file) => ({
        fileKey: file.key,
        fileName: file.name,
        fileDescription: file.description
    })) : response.data.meta.files;
    if (nextPage) {
        return getFigmaFilesPaginated(nextPage, figmaCookies, compact, [...acc, ...pagePayload]);
    }
    else {
        return [...acc, ...pagePayload];
    }
}
async function getFigmaFiles(folderId, figmaCookies, compact = true) {
    const response = await axios_1.default.get(`https://www.figma.com/api/folders/${folderId}/paginated_files`, {
        headers: {
            "Cookie": figmaCookies,
        },
        params: {
            sort_column: "touched_at",
            sort_order: "desc",
            fetch_only_trashed_with_folder_files: false,
            page_size: 8,
            skip_fetching_repo_branches: true,
            file_type: "figma",
        }
    });
    const nextPage = response.data.pagination.next_page;
    const pagePayload = compact ? response.data.meta.files.map((file) => ({
        fileKey: file.key,
        fileName: file.name,
        fileDescription: file.description
    })) : response.data.meta.files;
    if (nextPage) {
        return getFigmaFilesPaginated(nextPage, figmaCookies, compact, [...pagePayload]);
    }
    else {
        return [...pagePayload];
    }
}
async function assembleFigmaFileInfo(figmaCookies) {
    const plans = await getFigmaPlans(figmaCookies).catch(() => []);
    const planResults = await Promise.all(plans.map(async (plan) => {
        const teams = await getFigmaTeams(plan.planId, figmaCookies).catch(() => []);
        const teamResults = await Promise.all(teams.map(async (team) => {
            const folders = await getFigmaFolders(team.teamId, figmaCookies).catch(() => []);
            const folderResults = await Promise.all(folders.map(async (folder) => {
                const files = await getFigmaFiles(folder.folderId, figmaCookies).catch(() => []);
                return files.map((file) => ({ plan, team, folder, file }));
            }));
            return folderResults.flat();
        }));
        return teamResults.flat();
    }));
    return planResults.flat();
}
async function queryFigmaFiles(figmaCookies, query, topK, embeddings) {
    const fileInfo = await assembleFigmaFileInfo(figmaCookies);
    const documents = fileInfo.map((file) => {
        return new document_1.Document({
            pageContent: (file.file.fileName ?? "") + (file.file.fileDescription ?? ""),
            metadata: {
                fileName: file.file.fileName,
                fileDescription: file.file.fileDescription,
                planName: file.plan.planName,
                teamName: file.team.teamName,
                folderPath: file.folder.folderPath,
                planId: file.plan.planId,
                teamId: file.team.teamId,
                folderId: file.folder.folderId,
                fileKey: file.file.fileKey
            },
        });
    });
    const fileNameSearchResults = await (0, hybridSearch_1.fileNameHybridSearch)(query, topK, documents, embeddings);
    return fileNameSearchResults.map((doc) => doc.metadata);
}
