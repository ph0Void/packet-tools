#!/usr/bin/env node

import { arrancarServidor } from "@/core/McpServer";
import { Logger } from "@/utils/Logger";

arrancarServidor().catch((error) => {
  
  
  
  Logger.error("No se pudo arrancar el servidor MCP.", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
