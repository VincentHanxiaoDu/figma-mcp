#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commandHandler_1 = require("./utils/commandHandler");
async function main() {
    const commandHandler = commandHandler_1.CommandHandler.getHandler();
    const args = await commandHandler.parseArgs(process.argv);
    const entry = await commandHandler.getCommandCallback(args);
    await entry();
}
main().catch((error) => {
    console.error("Error: ", error);
    process.exit(1);
});
