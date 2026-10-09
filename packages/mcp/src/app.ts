#!/usr/bin/env node
/**
 * Punto de entrada del servidor MCP de Packet Tools.
 *
 * Arranca sobre **stdio**, que es el transporte estándar de MCP y el que
 * consumen Claude Code/Desktop, Codex CLI, OpenCode, GitHub Copilot (VS Code) y
 * LM Studio. No requiere ninguna configuración específica por cliente: el
 * protocolo ya es agnóstico.
 *
 * IMPORTANTE: nada puede escribir en stdout salvo el propio protocolo. El Logger
 * del proyecto escribe en stderr justo por eso (ver utils/Logger.ts).
 */
import { arrancarServidor } from "@/core/McpServer";
import { Logger } from "@/utils/Logger";

arrancarServidor().catch((error) => {
  // Un fallo aquí significa que el servidor ni siquiera pudo conectarse al
  // transporte, así que se informa por stderr (stdout podría estar a medias) y
  // se sale con código distinto de cero para que el cliente lo note.
  Logger.error("No se pudo arrancar el servidor MCP.", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
