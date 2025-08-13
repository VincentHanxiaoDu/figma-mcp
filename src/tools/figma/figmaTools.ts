import axios from 'axios';
import { Document } from 'langchain/document';
import { hybridSearch } from '../search/hybridSearch';
import { EmbeddingsInterface } from "@langchain/core/embeddings";
import { FigmaFileCache } from './cache';

export function parseFigmaUrl(url: string): {
  fileKey: string;
  queryParams: Record<string, string>;
} {
  const figmaUrl = new URL(url);

  if (!figmaUrl.hostname.includes("figma.com")) {
    throw new Error(`Invalid Figma URL: ${url}`);
  }

  const pathMatch = figmaUrl.pathname.match(/^\/design\/([^/]+)/);
  if (!pathMatch) {
    throw new Error(`Invalid Figma URL: ${url}`);
  }

  const fileKey = pathMatch[1];

  const queryParams: Record<string, string> = {};
  figmaUrl.searchParams.forEach((value, key) => {
    queryParams[key] = value;
  });

  return { fileKey, queryParams };
}


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
  if (response.status !== 200) {
    throw new Error(`Failed to get Figma file meta data: ${response.status} ${response.statusText}`);
  }
  return response.data;
}

async function getFigmaFile(figmaFileCache: FigmaFileCache | null, fileKey: string, fileVersion: string, figmaToken: string) {
  const fileDoc = await figmaFileCache?.readFigmaFileCache(fileKey, fileVersion);
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
    await figmaFileCache?.writeFigmaFileCache(resJson, fileKey, fileVersion);
  }
  return resJson;
}

export async function queryFigmaFileNode(
  figmaFileCache: FigmaFileCache | null,
  fileKey: string,
  query: string,
  topK: number,
  figmaToken: string,
  embeddings: EmbeddingsInterface,
): Promise<{ name: string, ids: string[] }[]> {
  const fileMeta = await getFigmaFileMetaData(fileKey, figmaToken);
  const resJson = await getFigmaFile(figmaFileCache, fileKey, fileMeta.file.version, figmaToken);
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
  return await hybridSearch(query, topK, documents, embeddings);
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
        contents_only: contents_only ? "true" : "false",
      }
    }
  )
  return response.data.images;
}

export async function getFigmaPlans(figmaCookies: string, compact: boolean = true) {
  const response = await axios.get(
    `https://www.figma.com/api/user/plans`,
    {
      headers: {
        "Cookie": figmaCookies,
      },
    }
  )
  if (response.status !== 200 || response.data.error) {
    throw new Error(`Failed to get Figma plans: <${response.status}> ${response.data.error}`);
  }
  if (compact) {
    return response.data.meta.plans.map((plan: any) => ({
      planId: plan.plan_id,
      planName: plan.plan_name,
    }));
  } else {
    return response.data;
  } 
}

export async function getFigmaTeams(planId: string, figmaCookies: string, compact: boolean = true) {
  const response = await axios.get(
    `https://www.figma.com/api/orgs/${planId}/teams`,
    {
      params: {
        include_member_count: false,
        include_project_count: false,
        include_top_members: false,
      },
      headers: {
        "Cookie": figmaCookies,
      },
    }
  )
  if (response.status !== 200 || response.data.error) {
    throw new Error(`Failed to get Figma plans: <${response.status}> ${response.data.error}`);
  }

  if (compact) {
    return response.data.meta.map((team: any) => ({
      teamId: team.id,
      teamName: team.name,
    }));
  } else {
    return response.data;
  }
}


export async function getFigmaFolders(teamsId: string, figmaCookies: string, compact: boolean = true) {
  const response = await axios.get(
    `https://www.figma.com/api/teams/${teamsId}/folders`,
    {
      headers: {
        "Cookie": figmaCookies,
      },
    }
  )
  if (response.status !== 200 || response.data.error) {
    throw new Error(`Failed to get Figma team folders: <${response.status}> ${response.data.error}`);
  }
  
  if (compact) {
    return response.data.meta.folder_rows.map((folderRow: any) => ({
      folderId: folderRow.id,
      folderPath: folderRow.path,
      folderDescription: folderRow.description
    }));
  } else {
    return response.data;
  }
}

async function getFigmaFilesPaginated(subPath: string, figmaCookies: string, compact: boolean = true, acc: any[] = []) {
  const response = await axios.get(
    `https://www.figma.com${subPath}`,
    {
      headers: {
        "Cookie": figmaCookies,
      },
    }
  )
  if (response.status !== 200 || response.data.error) {
    throw new Error(`Failed to get Figma files: <${response.status}> ${response.data.error}`);
  }
  const nextPage = response.data.pagination.next_page;
  const pagePayload = compact ? response.data.meta.files.map((file: any) => ({
    fileKey: file.key,
    fileName: file.name,
    fileDescription: file.description
  })) : response.data.meta.files;
  if (nextPage) {
    return getFigmaFilesPaginated(nextPage, figmaCookies, compact, [...acc, ...pagePayload]);
  } else {
    return [...acc, ...pagePayload];
  }
}

export async function getFigmaFiles(folderId: string, figmaCookies: string, compact: boolean = true) {
  const response = await axios.get(
    `https://www.figma.com/api/folders/${folderId}/paginated_files`,
    {
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
    }
  )
  if (response.status !== 200 || response.data.error) {
    throw new Error(`Failed to get Figma team files: <${response.status}> ${response.data.error}`);
  }
  const nextPage = response.data.pagination.next_page;
  const pagePayload = compact ? response.data.meta.files.map((file: any) => ({
    fileKey: file.key,
    fileName: file.name,
    fileDescription: file.description
  })) : response.data.meta.files;
  if (nextPage) {
    return getFigmaFilesPaginated(nextPage, figmaCookies, compact, [...pagePayload]);
  } else {
    return [...pagePayload];
  }
}