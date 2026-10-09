#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const McpServer_1 = require("./core/McpServer.js");
const Logger_1 = require("./utils/Logger.js");
(0, McpServer_1.arrancarServidor)().catch((error) => {
    Logger_1.Logger.error("No se pudo arrancar el servidor MCP.", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
});
//# sourceMappingURL=app.js.map