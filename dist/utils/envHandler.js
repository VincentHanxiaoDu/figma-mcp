"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnvHandler = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
class EnvHandler {
    constructor() { }
    static async loadEnvVars(confPath) {
        const res = confPath ? dotenv_1.default.config({ path: confPath }) : dotenv_1.default.config();
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
        };
    }
    static removeUndefined(obj) {
        return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
    }
    static async resolveServerEnvs(args) {
        const argEnv = EnvHandler.removeUndefined({
            host: args.host,
            port: args.port,
            figmaUsername: args.figmaUsername,
            figmaPasswordB64: args.figmaPasswordB64,
            figmaToken: args.figmaToken,
            figmaCookies: args.figmaCookies,
            mongoUri: args.mongoUri,
            disableCache: args.disableCache,
        });
        const procEnv = EnvHandler.removeUndefined(await EnvHandler.loadEnvVars(args.env));
        const defaultEnv = {
            host: "0.0.0.0",
            port: 3000,
            mongoUri: "mongodb://mongodb:27017",
            disableCache: false,
        };
        // prefer args over env vars.
        return { ...defaultEnv, ...procEnv, ...argEnv };
    }
}
exports.EnvHandler = EnvHandler;
