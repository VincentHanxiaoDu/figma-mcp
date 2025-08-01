#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("./server/server");
(0, server_1.main)().catch(() => {
    process.exit(1);
});
