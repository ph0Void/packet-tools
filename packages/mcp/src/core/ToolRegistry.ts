
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Logger } from "@/utils/Logger";


export interface DefinicionTool<Esquema extends z.ZodRawShape = z.ZodRawShape> {
  
  name: string;
  
  description: string;
  
  inputSchema: Esquema;
  
  handler: (args: z.infer<z.ZodObject<Esquema>>) => Promise<unknown>;
}



export type DefinicionToolGenerica = DefinicionTool<any>;


export function definirTool<Esquema extends z.ZodRawShape>(
  tool: DefinicionTool<Esquema>,
): DefinicionTool<Esquema> {
  return tool;
}


export interface ModuloDominio {
  
  id: string;
  
  prefix: string;
  
  description: string;
  
  tools: DefinicionToolGenerica[];
}


class ToolRegistry {
  private readonly modulos: ModuloDominio[] = [];
  private readonly nombresRegistrados = new Set<string>();

  
  registrar(modulo: ModuloDominio): void {
    if (modulo.tools.length === 0) {
      throw new Error(
        `El dominio '${modulo.id}' no expone ninguna tool: revisa que el módulo las esté declarando.`,
      );
    }

    for (const tool of modulo.tools) {
      if (!tool.name.startsWith(modulo.prefix)) {
        throw new Error(
          `La tool '${tool.name}' del dominio '${modulo.id}' no empieza por su prefijo '${modulo.prefix}'. ` +
            `El prefijo no es decorativo: es lo que permite al modelo saber de qué dominio es la herramienta.`,
        );
      }
      if (this.nombresRegistrados.has(tool.name)) {
        throw new Error(
          `La tool '${tool.name}' ya está registrada por otro dominio. Los nombres deben ser únicos en todo el servidor.`,
        );
      }
      this.nombresRegistrados.add(tool.name);
    }

    this.modulos.push(modulo);
    Logger.debug(
      `Dominio registrado: ${modulo.id} (${modulo.tools.length} herramientas)`,
    );
  }

  
  obtenerModulos(): readonly ModuloDominio[] {
    return this.modulos;
  }

  
  obtenerTools(): DefinicionToolGenerica[] {
    return this.modulos.flatMap((modulo) => modulo.tools);
  }

  
  contarTools(): number {
    return this.nombresRegistrados.size;
  }

  
  conectarAServidor(server: McpServer): void {
    for (const tool of this.obtenerTools()) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
        
        
        
        
        (async (args: Record<string, unknown>) => {
          const inicio = Date.now();
          Logger.traza(`→ ${tool.name}`, args);

          try {
            const resultado = await tool.handler(args as never);
            Logger.traza(`← ${tool.name} OK (${Date.now() - inicio} ms)`);
            return aRespuestaMcp(resultado);
          } catch (error) {
            const mensaje = error instanceof Error ? error.message : String(error);
            Logger.warning(`← ${tool.name} FALLÓ (${Date.now() - inicio} ms): ${mensaje}`);
            
            
            
            return aRespuestaMcp(
              error && typeof error === "object" && "toModelMessage" in error
                ? (error as { toModelMessage(): string }).toModelMessage()
                : `Error inesperado en '${tool.name}': ${mensaje}`,
              true,
            );
          }
        }) as never,
      );
    }
  }
}


function aRespuestaMcp(
  valor: unknown,
  isError = false,
): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  const texto =
    typeof valor === "string" ? valor : JSON.stringify(valor ?? null, null, 2);

  return {
    content: [{ type: "text" as const, text: texto }],
    
    
    ...(isError ? { isError: true } : {}),
  };
}


export const toolRegistry = new ToolRegistry();
