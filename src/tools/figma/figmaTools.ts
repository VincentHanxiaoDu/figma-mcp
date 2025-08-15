import axios, { AxiosError, AxiosResponse } from 'axios';
import { Document } from 'langchain/document';
import { fileContentHybridSearch, fileNameHybridSearch } from '../search/hybridSearch';
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
  const hybridSearchResults = await fileContentHybridSearch(query, topK, documents, embeddings);
  return hybridSearchResults.map((doc) => ({
    name: doc.pageContent,
    ids: doc.metadata?.ids || [],
  }));
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

type FigmaPlan = {
  planId: string;
  planName: string;
}

type FigmaTeam = {
  teamId: string;
  teamName: string;
}

type FigmaFolder = {
  folderId: string;
  folderPath: string;
  folderDescription: string;
}

type FigmaFile = {
  fileKey: string;
  fileName: string;
  fileDescription: string;
}

type FigmaFileInfo = {
  plan: FigmaPlan;
  team: FigmaTeam;
  folder: FigmaFolder;
  file: FigmaFile;
}

export async function getFigmaPlans(figmaCookies: string, compact: boolean = true): Promise<FigmaPlan[]> {
  const response = await axios.get(
    `https://www.figma.com/api/user/plans`,
    {
      headers: {
        "Cookie": figmaCookies,
      }
    }
  )

  if (compact) {
    return response.data.meta.plans.map((plan: Record<string, any>) => ({
      planId: plan.plan_id,
      planName: plan.plan_name,
    }));
  } else {
    return response.data;
  }
}

export async function getFigmaTeams(planId: string, figmaCookies: string, compact: boolean = true): Promise<FigmaTeam[]> {
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
  if (compact) {
    return response.data.meta.map((team: Record<string, any>) => ({
      teamId: team.id,
      teamName: team.name,
    }));
  } else {
    return response.data;
  }
}


export async function getFigmaFolders(teamsId: string, figmaCookies: string, compact: boolean = true): Promise<FigmaFolder[]> {
  const response = await axios.get(
    `https://www.figma.com/api/teams/${teamsId}/folders`,
    {
      headers: {
        "Cookie": figmaCookies,
      },
    }
  );

  if (compact) {
    return response.data.meta.folder_rows.map((folderRow: Record<string, any>) => ({
      folderId: folderRow.id,
      folderPath: folderRow.path,
      folderDescription: folderRow.description
    }));
  } else {
    return response.data;
  }
}

async function getFigmaFilesPaginated(subPath: string, figmaCookies: string, compact: boolean = true, acc: FigmaFile[] = []) {
  const response = await axios.get(
    `https://www.figma.com${subPath}`,
    {
      headers: {
        "Cookie": figmaCookies,
      },
    }
  )
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

export async function getFigmaFiles(folderId: string, figmaCookies: string, compact: boolean = true): Promise<FigmaFile[]> {
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
  const nextPage = response.data.pagination.next_page;
  const pagePayload = compact ? response.data.meta.files.map((file: Record<string, any>) => ({
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

async function assembleFigmaFileInfo(figmaCookies: string): Promise<FigmaFileInfo[]> {
  const plans = await getFigmaPlans(figmaCookies).catch(() => []);
  const planResults = await Promise.all(
    plans.map(async (plan) => {
      const teams = await getFigmaTeams(plan.planId, figmaCookies).catch(() => []);
      const teamResults = await Promise.all(
        teams.map(async (team) => {
          const folders = await getFigmaFolders(team.teamId, figmaCookies).catch(() => []);
          const folderResults = await Promise.all(
            folders.map(async (folder) => {
              const files = await getFigmaFiles(folder.folderId, figmaCookies).catch(() => []);
              return files.map((file) => ({ plan, team, folder, file }));
            })
          );
          return folderResults.flat();
        })
      );
      return teamResults.flat();
    })
  );
  return planResults.flat();
}

export async function queryFigmaFiles(figmaCookies: string, query: string, topK: number, embeddings: EmbeddingsInterface) {
  const fileInfo = await assembleFigmaFileInfo(figmaCookies);

  const documents = fileInfo.map((file) => {
    return new Document({
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
  const fileNameSearchResults = await fileNameHybridSearch(query, topK, documents, embeddings);
  return fileNameSearchResults.map((doc) => doc.metadata);
}