#!/usr/bin/env node
import { CommandHandler } from "./utils/commandHandler";


async function main() {
  const commandHandler = CommandHandler.getHandler();
  const args = await commandHandler.parseArgs(process.argv);
  const entry = await commandHandler.getCommandCallback(args);
  await entry();
}

main().catch(() => {
  process.exit(1);
});