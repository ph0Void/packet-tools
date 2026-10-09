/**
 * Registro central de herramientas MCP.
 *
 * OBJETIVO DE DISEÑO: agregar un dominio nuevo (por ejemplo `@snmp` en el
 * futuro) debe ser **crear su módulo y registrarlo**, sin tocar el núcleo del
 * servidor. Por eso este registro es una lista de módulos y no un `switch`.
 *
 * Cada módulo de dominio declara sus tools con nombre ya prefijado
 * (`packet_tracer_add_device`, `gns3_create_node`, `serial_list_ports`), de modo
 * que el modelo entiende el dominio solo con leer el nombre, además de que la
 * descripción lo repita.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Logger } from "@/utils/Logger";

/**
 * Definición de una tool del MCP.
 *
 * El `inputSchema` es un objeto de zod "en crudo" (no un `z.object`) porque así
 * lo espera `McpServer.registerTool`: el SDK lo convierte a JSON Schema para el
 * cliente. Los `.describe()` de zod son los que documentan cada parámetro ante el
 * modelo, así que ahí se explica el formato esperado.
 *
 * SOBRE EL TIPADO DE `handler`: se deriva del esquema con `z.infer<z.ZodObject<Esquema>>`,
 * que es lo que hace que dentro del handler los argumentos lleguen ya tipados
 * (y que un parámetro mal escrito sea un error de compilación en vez de un
 * `undefined` en tiempo de ejecución).
 */
export interface DefinicionTool<Esquema extends z.ZodRawShape = z.ZodRawShape> {
  /** Nombre real de la tool, con el prefijo del dominio. */
  name: string;
  /** Descripción para el modelo: qué hace y cuándo usarla. */
  description: string;
  /** Esquema de entrada en zod. */
  inputSchema: Esquema;
  /**
   * Handler. Recibe el input YA validado y devuelve texto (o un objeto, que se
   * serializa). Puede lanzar `McpToolError` para dar un error accionable.
   */
  handler: (args: z.infer<z.ZodObject<Esquema>>) => Promise<unknown>;
}

/**
 * Alias de una tool con el esquema ya "olvidado".
 *
 * Hace falta porque el registro guarda tools HETEROGÉNEAS (cada una con su
 * esquema) y `DefinicionTool<Esquema>` no es asignable entre esquemas distintos.
 *
 * OJO CON EL `any`: si se usara `DefinicionTool<any>` para DECLARAR las tools,
 * `z.infer<z.ZodObject<any>>` colapsaría a `any`/`unknown` y se perdería todo el
 * tipado de los handlers (los argumentos llegarían como `unknown` y habría que
 * castear en cada uno). Por eso las tools se declaran con el helper `definirTool`
 * —que conserva la inferencia del esquema— y este alias se usa SOLO como tipo
 * del array del registro.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DefinicionToolGenerica = DefinicionTool<any>;

/**
 * Declara una tool conservando la inferencia de su esquema.
 *
 * Es la pieza que hace que dentro del `handler` los argumentos estén tipados de
 * verdad (derivados de `inputSchema`) sin renunciar a que el array del módulo
 * admita tools de esquemas distintos. Sin este helper habría que elegir entre
 * tipado y heterogeneidad.
 */
export function definirTool<Esquema extends z.ZodRawShape>(
  tool: DefinicionTool<Esquema>,
): DefinicionTool<Esquema> {
  return tool;
}

/**
 * Módulo de dominio: agrupa las tools de un namespace.
 *
 * `prefix` se usa para las etiquetas de log y para validar que los nombres de
 * las tools empiezan por donde deben (una tool mal nombrada rompe la promesa de
 * que el modelo deduzca el dominio por el nombre).
 */
export interface ModuloDominio {
  /** Identificador del dominio: `packet-tracer`, `gns3`, `serial`, `telnet`, `ssh`, `plan`, `skills`. */
  id: string;
  /** Prefijo que deben llevar TODAS las tools del módulo. */
  prefix: string;
  /** Descripción del dominio, para logs y documentación. */
  description: string;
  /** Las tools que expone. */
  tools: DefinicionToolGenerica[];
}

/** Registro con los módulos ya cargados. */
class ToolRegistry {
  private readonly modulos: ModuloDominio[] = [];
  private readonly nombresRegistrados = new Set<string>();

  /**
   * Registra un módulo de dominio.
   *
   * Valida tres cosas que, si se cuelan, dan problemas difíciles de diagnosticar
   * en el cliente MCP: nombres duplicados (el SDK sobreescribiría una tool en
   * silencio), nombres sin el prefijo del dominio y módulos vacíos.
   */
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

  /** Todos los módulos registrados, en orden de carga. */
  obtenerModulos(): readonly ModuloDominio[] {
    return this.modulos;
  }

  /** Todas las tools, aplanadas. */
  obtenerTools(): DefinicionToolGenerica[] {
    return this.modulos.flatMap((modulo) => modulo.tools);
  }

  /** Cuántas tools hay registradas en total. */
  contarTools(): number {
    return this.nombresRegistrados.size;
  }

  /**
   * Conecta cada tool declarada al servidor MCP real.
   *
   * Aquí es donde el registro deja de ser una estructura de datos y pasa a ser
   * el servidor: se recorre todo y se llama a `registerTool`. El envoltorio que
   * se pasa como callback es el ÚNICO punto por el que entran las llamadas del
   * modelo, así que la traza y el manejo de errores se hacen una sola vez, aquí.
   */
  conectarAServidor(server: McpServer): void {
    for (const tool of this.obtenerTools()) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
        // El SDK tipa el callback con el esquema declarado; se relaja a `any`
        // porque el registro es heterogéneo (cada tool tiene su propio esquema)
        // y el tipado fino aquí no aporta nada que no garantice la validación de
        // zod en tiempo de ejecución.
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
            // Se devuelve como resultado con isError (no se relanza): así el
            // modelo RECIBE el mensaje y puede corregir, en vez de que el
            // cliente lo trate como un fallo de transporte del servidor.
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

/**
 * Normaliza lo que devuelve un handler a la forma que espera el SDK de MCP.
 *
 * Los handlers devuelven cualquier cosa (string, objeto, array); el protocolo
 * solo entiende bloques de contenido. Se centraliza aquí para que ningún
 * dominio tenga que conocer el formato del protocolo.
 */
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
    // `isError` solo se pone cuando es true: el SDK lo trata como opcional y
    // enviarlo en false ensucia el payload sin aportar nada.
    ...(isError ? { isError: true } : {}),
  };
}

/** Instancia única del registro. */
export const toolRegistry = new ToolRegistry();
