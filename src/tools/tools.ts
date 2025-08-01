import axios from 'axios';
import { Document } from 'langchain/document';
import { readFigmaFileCache, writeFigmaFileCache } from '../utils/storage/mongo';
import { hybridSearch } from '../utils/search/hybridSearch';

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
}