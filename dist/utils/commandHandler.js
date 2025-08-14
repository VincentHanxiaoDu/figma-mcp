"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandHandler = void 0;
const yargs_1 = __importDefault(require("yargs/yargs"));
const helpers_1 = require("yargs/helpers");
const loginFigma_1 = require("./auth/loginFigma");
const server_1 = require("../server/server");
const envHandler_1 = require("./envHandler");
class CommandHandler {
    constructor() { }
    static getHandler() {
        if (!CommandHandler.instance) {
            CommandHandler.instance = new CommandHandler();
        }
        return CommandHandler.instance;
    }
    async getCommandCallback(args) {
        switch (args.tool) {
            case "get-figma-cookies":
                return async () => {
                    const { figmaUsername, figmaPasswordB64 } = await (0, loginFigma_1.askFigmaCreds)({
                        username: args.figmaUsername,
                        passwordB64: args.figmaPasswordB64,
                    });
                    return (0, loginFigma_1.loginFigma)(figmaUsername, figmaPasswordB64);
                };
            case undefined:
                return async () => {
                    const serverEnvs = await envHandler_1.EnvHandler.resolveServerEnvs(args);
                    return (0, server_1.startMcpServer)(serverEnvs);
                };
            default:
                throw new Error(`Unknown tool: ${args.tool}`);
        }
    }
    async parseArgs(argv) {
        return await (0, yargs_1.default)((0, helpers_1.hideBin)(argv))
            .scriptName("figma-mcp")
            .usage("$0 [options]")
            .option("env", {
            alias: "e",
            type: "string",
            description: "Path to .env file",
        })
            .option("host", {
            type: "string",
            description: "Host to run the server on",
        })
            .option("port", {
            type: "number",
            description: "Port to run the server on",
        })
            .option("tool", {
            type: "string",
            choices: ["get-figma-cookies"],
            description: "Tool to run (default runs server)",
        })
            .option("figma-username", {
            alias: "u",
            type: "string",
            description: "Figma username",
        })
            .option("figma-password-b64", {
            alias: "p",
            type: "string",
            description: "Figma password in base64",
        })
            .option("figma-token", {
            alias: "t",
            type: "string",
            description: "Figma token",
        })
            .option("mongo-uri", {
            alias: "m",
            type: "string",
            description: "MongoDB URI",
        })
            .option("figma-cookies", {
            alias: "c",
            type: "string",
            description: "Figma cookies (JSON string)",
        })
            .option("disable-cache", {
            alias: "d",
            type: "boolean",
            description: "Disable cache",
        })
            .example("$0 -T get-figma-cookies -u alice -p BASE64PWD", "Login and print cookies")
            .example("$0 --host 0.0.0.0 --port 3000", "Start MCP server")
            .alias("h", "help")
            .help("help")
            .version()
            .strictOptions()
            .showHelpOnFail(true)
            .wrap(process.stdout.columns ?? 120)
            .parse();
    }
}
exports.CommandHandler = CommandHandler;
CommandHandler.instance = null;
