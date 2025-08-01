#!/usr/bin/env node
import { main } from "./server/server";

main().catch(() => {
  process.exit(1);
});