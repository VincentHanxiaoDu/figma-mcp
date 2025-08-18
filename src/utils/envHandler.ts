import dotenv from "dotenv";
import assert from "node:assert";
import yargs from "yargs";

export type ServerEnv = {
  host?: string;
  port?: number;
  figmaUsername?: string;
  figmaPasswordB64?: string;
  figmaToken?: string;
  figmaCookies?: string;
  mongoUri?: string;
  disableCache?: boolean;
}

export class EnvHandler {
  private static parsePort(port: string | number): number | undefined {
    const portNum = Number(port);
    if (Number.isNaN(portNum)) {
      return undefined;
    }
    return portNum;
  }

  private constructor() {}
  protected static async loadEnvVars(confPath?: string): Promise<ServerEnv> {
    const res = confPath ? dotenv.config({ path: confPath }) : dotenv.config();
    if (confPath && res.error) {
      throw new Error(`Failed to load env file ${confPath}: ${res.error.message}`);
    }
    return {
      host: process.env.HOST,
      port: EnvHandler.parsePort(process.env.PORT as string),
      figmaUsername: process.env.FIGMA_USERNAME,
      figmaPasswordB64: process.env.FIGMA_PASSWORD_B64,
      figmaToken: process.env.FIGMA_TOKEN,
      figmaCookies: process.env.FIGMA_COOKIES,
      mongoUri: process.env.MONGODB_URI,
      disableCache: process.env.DISABLE_CACHE === "true",
    }
  }

  private static removeUndefined<T extends object>(obj: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(obj).filter(([, v]) => v !== undefined)
    ) as Partial<T>;
  }

  static async resolveServerEnvs(args: yargs.Arguments): Promise<ServerEnv> {
    const argEnv = EnvHandler.removeUndefined<ServerEnv>({
      host: args.host as string,
      port: EnvHandler.parsePort(args.port as string),
      figmaUsername: args.figmaUsername as string,
      figmaPasswordB64: args.figmaPasswordB64 as string,
      figmaToken: args.figmaToken as string,
      figmaCookies: args.figmaCookies as string,
      mongoUri: args.mongoUri as string,
      disableCache: args.disableCache as boolean,
    });
    const procEnv = EnvHandler.removeUndefined<ServerEnv>(await EnvHandler.loadEnvVars(args.env as string));
    const defaultEnv = {
      host: "0.0.0.0",
      port: 3000,
      mongoUri: "mongodb://mongodb:27017",
      disableCache: false,
    }
    // prefer args over env vars.
    const env = { ...defaultEnv, ...procEnv, ...argEnv };
    return env;
  }
}