import dotenv from "dotenv";
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

  private constructor() {}
  protected static async loadEnvVars(confPath?: string): Promise<ServerEnv> {
    const res = confPath ? dotenv.config({ path: confPath }) : dotenv.config();
    if (confPath && res.error) {
      throw new Error(`Failed to load env file ${confPath}: ${res.error.message}`);
    }

    const portRaw = process.env.PORT;
    const port = portRaw !== undefined ? Number(portRaw) : undefined;
    if (portRaw !== undefined && Number.isNaN(port)) {
      throw new Error(`Invalid PORT value: ${portRaw}`);
    }

    return {
      host: process.env.HOST,
      port: port,
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
      port: args.port as number,
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
    return { ...defaultEnv, ...procEnv, ...argEnv };
  }
}