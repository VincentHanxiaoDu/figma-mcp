import yargsFactory from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import yargs from "yargs";

import { loginFigma, askFigmaCreds } from "./auth/loginFigma";
import { startMcpServer } from "../server/server";
import { EnvHandler } from "./envHandler";


export class CommandHandler {
  private static instance: CommandHandler | null = null;

  private constructor() {}

  static getHandler(): CommandHandler {
    if (!CommandHandler.instance) {
      CommandHandler.instance = new CommandHandler();
    }
    return CommandHandler.instance;
  }

  async getCommandCallback(args: yargs.ArgumentsCamelCase): Promise<() => Promise<any>> {
    switch (args.tool) {
      case "get-figma-cookies":
        return async () => {
          const { figmaUsername, figmaPasswordB64 } = await askFigmaCreds({
            username: args.figmaUsername as string,
            passwordB64: args.figmaPasswordB64 as string,
          });
          return loginFigma(figmaUsername, figmaPasswordB64);  
        }
      case undefined:
        return async () => {
          const serverEnvs = await EnvHandler.resolveServerEnvs(args);
          return startMcpServer(serverEnvs);
        }
      default:
        throw new Error(`Unknown tool: ${args.tool}`);
    }
  }

  async parseArgs(argv: string[]): Promise<yargs.ArgumentsCamelCase> {
    return await yargsFactory(hideBin(argv))
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
