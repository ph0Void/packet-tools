/**
 * Dominio `@plan` / `@execute`: planificación y ejecución de tareas de red.
 *
 * POR QUÉ SON TOOLS Y NO "COMANDOS"
 * Un servidor MCP sobre stdio solo puede exponer `tools`, `resources` y
 * `prompts`; no existe un canal para que el usuario escriba `@plan` y el
 * servidor lo intercepte (eso lo decide el cliente). Así que `@plan` y `@execute`
 * se implementan como dos tools que el modelo invoca, y el cliente los activa
 * cuando el usuario escribe esa mención.
 *
 * EL FLUJO QUE HABILITAN
 *   1. `plan_task`: el modelo razona qué herramientas harían falta, en qué orden
 *      y con qué parámetros, y deja un checklist en markdown EN DISCO.
 *   2. El usuario revisa y edita ese markdown.
 *   3. `plan_execute`: se parsea el checklist y se ejecutan los pasos.
 *
 * SOBRE `plan_execute` Y LA SEGURIDAD: esta tool NO ejecuta las herramientas por
 * su cuenta. Devuelve al modelo el plan parseado, paso a paso, para que sea él
 * quien llame a cada herramienta y marque el progreso con `plan_mark_step`.
 * Se hace así por dos razones: (a) el servidor MCP no tiene forma de invocar sus
 * propias tools sin pasar por el cliente, y (b) así el modelo ve el resultado de
 * cada paso y puede parar ante un error, que es exactamente lo que se pide.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { definirTool } from "@/core/ToolRegistry";
import type { ModuloDominio, DefinicionToolGenerica } from "@/core/ToolRegistry";
import { envConfig } from "@/config/EnvConfig";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";
import { McpToolError, errorDeValidacion } from "@/core/errors";

/** Estado de un paso del checklist. */
type EstadoPaso = "pendiente" | "hecho" | "fallido";

/** Un paso del checklist. */
interface PasoPlan {
  /** Número del paso, tal como aparece en el markdown. */
  numero: number;
  /** Estado según la casilla. */
  estado: EstadoPaso;
  /** Texto de la acción (por ejemplo `packet_tracer_add_device(...)`). */
  texto: string;
  /** Mensaje de error, cuando el paso falló. */
  error?: string;
  /** Línea original del markdown (para reescribirla sin perder formato). */
  lineaOriginal: string;
}

/**
 * Asegura que el directorio de planes existe y devuelve su ruta.
 */
async function asegurarCarpetaPlanes(): Promise<string> {
  await fs.mkdir(envConfig.MCP_PLANS_DIR, { recursive: true });
  return envConfig.MCP_PLANS_DIR;
}

/**
 * Convierte el objetivo en un nombre de archivo seguro.
 *
 * Solo se usan letras, números y guiones: un objetivo con `/` o `..` no puede
 * escapar de la carpeta de planes.
 */
function slugDelObjetivo(objetivo: string): string {
  const limpio = objetivo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return limpio || "plan";
}

/**
 * Marca de tiempo legible y ordenable para el nombre del archivo.
 */
function marcaDeTiempo(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * Resuelve la ruta de un plan y COMPRUEBA que está dentro de la carpeta de planes.
 *
 * Es una defensa deliberada: el modelo podría pedir `plan_execute` con
 * `../../.env` y leer un archivo que no le corresponde. La comprobación es sobre
 * la ruta YA resuelta (no sobre el texto), que es la única forma fiable de
 * detectar un escape.
 */
function resolverRutaDePlan(rutaPedida: string): string {
  const absoluta = path.isAbsolute(rutaPedida)
    ? rutaPedida
    : path.join(envConfig.MCP_PLANS_DIR, path.basename(rutaPedida));
  const raizPlanes = path.resolve(envConfig.MCP_PLANS_DIR);
  const resuelta = path.resolve(absoluta);

  if (resuelta !== raizPlanes && !resuelta.startsWith(raizPlanes + path.sep)) {
    throw errorDeValidacion(
      `La ruta '${rutaPedida}' queda fuera de la carpeta de planes.`,
      `Solo se pueden ejecutar planes de '${envConfig.MCP_PLANS_DIR}'. Usa el nombre del archivo (por ejemplo 'plan-2026-01-01.md') o llama a plan_list sin argumentos para ver el último.`,
    );
  }

  return resuelta;
}

/**
 * Parsea el checklist de un markdown de plan.
 *
 * Reconoce las tres formas de casilla que escribe este servidor:
 *   - `- [ ] 1. acción`  → pendiente
 *   - `- [x] 1. acción`  → hecha
 *   - `- [!] 1. acción`  → fallida (con el error al final, tras `error:`)
 */
function parsearChecklist(contenido: string): PasoPlan[] {
  const pasos: PasoPlan[] = [];
  const lineas = contenido.split(/\r?\n/);

  for (const linea of lineas) {
    const coincidencia = /^\s*-\s*\[([ x!X])\]\s*(\d+)\.\s*(.+)$/.exec(linea);
    if (!coincidencia) continue;

    const marca = coincidencia[1].toLowerCase();
    const estado: EstadoPaso = marca === "x" ? "hecho" : marca === "!" ? "fallido" : "pendiente";
    let texto = coincidencia[3].trim();
    let error: string | undefined;

    // El error se anota al final de la misma línea, tras 'error:'.
    const separadorError = texto.lastIndexOf(" — error:");
    if (separadorError !== -1) {
      error = texto.slice(separadorError + " — error:".length).trim();
      texto = texto.slice(0, separadorError).trim();
    }

    pasos.push({
      numero: Number(coincidencia[2]),
      estado,
      texto,
      error,
      lineaOriginal: linea,
    });
  }

  return pasos;
}

/**
 * Lee un plan de disco.
 */
async function leerPlan(ruta: string): Promise<string> {
  try {
    return await fs.readFile(ruta, "utf8");
  } catch {
    throw new McpToolError("NO_ENCONTRADO", `No existe el archivo de plan '${ruta}'.`, {
      sugerencia:
        "Llama a plan_list para ver los planes disponibles, o crea uno nuevo con plan_task.",
    });
  }
}

/**
 * Devuelve el plan más reciente de la carpeta.
 */
async function planMasReciente(): Promise<{ ruta: string; contenido: string }> {
  const carpeta = await asegurarCarpetaPlanes();
  const archivos = (await fs.readdir(carpeta))
    .filter((nombre) => nombre.endsWith(".md"))
    .sort()
    .reverse();

  if (archivos.length === 0) {
    throw new McpToolError("NO_ENCONTRADO", "Todavía no hay ningún plan guardado.", {
      sugerencia:
        "Crea uno con plan_task indicando el objetivo (por ejemplo 'topología con 2 routers y 3 PCs con OSPF').",
    });
  }

  const ruta = path.join(carpeta, archivos[0]);

  return { ruta, contenido: await fs.readFile(ruta, "utf8") };
}

// ---------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------

const herramientas: DefinicionToolGenerica[] = [
  definirTool({
    name: "plan_task",
    description:
      "MODO PLANIFICACIÓN. NO ejecuta nada: razona y escribe un plan en markdown con un checklist de los pasos a seguir " +
      "y lo guarda en disco. Úsala cuando el usuario escriba '@plan <objetivo>' o pida algo de varios pasos que convenga acordar antes. " +
      "REGLAS: si falta información crítica (modelos de equipo, direccionamiento IP, nombres, protocolo de enrutamiento) NO la inventes: " +
      "haz las preguntas al usuario ANTES de cerrar el plan. Si detectas algo ambiguo o destructivo (borrar el workspace, sobrescribir una configuración) " +
      "señálalo explícitamente como riesgo en el plan. " +
      "Pasa en 'steps' la lista ordenada de pasos; cada paso debe ser una llamada concreta a una herramienta con sus parámetros.",
    inputSchema: {
      objective: z.string().describe("Objetivo tal cual lo pidió el usuario"),
      steps: z
        .array(z.string())
        .min(1)
        .describe(
          "Pasos ordenados. Cada uno debe ser una llamada concreta, por ejemplo: \"packet_tracer_add_device(name=\\\"R1\\\", model=\\\"2911\\\", x=100, y=100)\"",
        ),
      openQuestions: z
        .array(z.string())
        .optional()
        .describe("Preguntas que hay que resolver con el usuario antes de ejecutar"),
      risks: z
        .array(z.string())
        .optional()
        .describe("Riesgos o acciones destructivas detectadas (borrados, sobreescrituras...)"),
    },
    handler: async ({ objective, steps, openQuestions, risks }) => {
      const carpeta = await asegurarCarpetaPlanes();
      const nombre = `plan-${marcaDeTiempo()}-${slugDelObjetivo(objective)}.md`;
      const ruta = path.join(carpeta, nombre);
      const markdown = construirMarkdownDePlan({
        objective,
        steps,
        openQuestions: openQuestions ?? [],
        risks: risks ?? [],
        nombre,
      });

      await fs.writeFile(ruta, markdown, "utf8");

      // Se registra en la BD propia para poder encontrar "el último plan" sin
      // listar y parsear todo el directorio.
      const registro = await prismaClient.planRecordMcp.create({
        data: {
          objective,
          filePath: nombre,
          status: "PENDING",
          totalSteps: steps.length,
        },
      });

      Logger.info(`Plan creado: ${nombre} (${steps.length} pasos).`);

      return {
        success: true,
        planId: registro.id,
        archivo: ruta,
        pasos: steps.length,
        pendienteDeConfirmacion: (openQuestions?.length ?? 0) > 0,
        markdown,
        mensaje:
          (openQuestions?.length ?? 0) > 0
            ? "Plan guardado, pero hay preguntas sin resolver: HAZLAS al usuario antes de pasar a la ejecución. Cuando las responda, vuelve a llamar a plan_task con el plan completo."
            : "Plan guardado. Muéstralo al usuario y espera su confirmación antes de ejecutarlo con plan_execute.",
      };
    },
  }),
  definirTool({
    name: "plan_execute",
    description:
      "MODO EJECUCIÓN. Lee un plan guardado y devuelve sus pasos PENDIENTES en orden, para que los ejecutes tú llamando a las herramientas correspondientes. " +
      "Úsala cuando el usuario escriba '@execute'. Sin argumentos usa el plan más reciente de la sesión. " +
      "IMPORTANTE: tras cada paso, llama a plan_mark_step con el resultado. Si un paso FALLA, detente y pregunta al usuario si reintentar, " +
      "saltar el paso o abortar: nunca repitas el mismo comando en bucle sin cambiar nada. " +
      "Esto NO ejecuta las herramientas por sí sola: es el servidor dándote el guion y el estado real del plan.",
    inputSchema: {
      planPath: z
        .string()
        .optional()
        .describe("Nombre o ruta del plan a ejecutar; omítelo para usar el más reciente"),
    },
    handler: async ({ planPath }) => {
      const { ruta, contenido } = planPath
        ? { ruta: resolverRutaDePlan(planPath), contenido: await leerPlan(resolverRutaDePlan(planPath)) }
        : await planMasReciente();
      const pasos = parsearChecklist(contenido);

      if (pasos.length === 0) {
        return {
          success: false,
          archivo: ruta,
          error:
            "El plan no contiene ningún paso reconocible. Se esperan líneas con el formato '- [ ] 1. acción'.",
          sugerencia: "Crea el plan con plan_task, que genera ese formato automáticamente.",
        };
      }

      const pendientes = pasos.filter((paso) => paso.estado === "pendiente");
      const fallidos = pasos.filter((paso) => paso.estado === "fallido");
      const hechos = pasos.filter((paso) => paso.estado === "hecho");

      // Actualiza el estado del plan en la BD (best-effort: si falla, el
      // markdown sigue siendo la fuente de verdad).
      if (pendientes.length > 0) {
        await prismaClient.planRecordMcp
          .updateMany({
            where: { filePath: path.basename(ruta) },
            data: {
              status: pendientes.length === pasos.length ? "RUNNING" : "RUNNING",
              completedSteps: hechos.length,
              failedSteps: fallidos.length,
            },
          })
          .catch(() => undefined);
      }

      return {
        success: true,
        archivo: ruta,
        planPath: path.basename(ruta),
        resumen: {
          total: pasos.length,
          hechos: hechos.length,
          fallidos: fallidos.length,
          pendientes: pendientes.length,
        },
        pasosPendientes: pendientes.map((paso) => ({
          numero: paso.numero,
          accion: paso.texto,
        })),
        ...(fallidos.length > 0
          ? {
              pasosFallidos: fallidos.map((paso) => ({
                numero: paso.numero,
                accion: paso.texto,
                error: paso.error ?? "(sin detalle)",
              })),
              aviso:
                "Hay pasos que fallaron en una ejecución anterior. Pregunta al usuario si quiere reintentarlos, saltarlos o abortar antes de continuar.",
            }
          : {}),
        instrucciones:
          pendientes.length === 0
            ? "No quedan pasos pendientes: el plan está terminado. Comprueba el estado real con las herramientas de lectura antes de dar el trabajo por bueno."
            : "Ejecuta los pasos PENDIENTES en orden. Después de cada uno, llama a plan_mark_step indicando el número de paso y si tuvo éxito. " +
              "Si un paso falla, PARA y pregunta al usuario: no reintentes el mismo comando sin cambiar nada.",
      };
    },
  }),
  definirTool({
    name: "plan_mark_step",
    description:
      "Marca un paso del plan como completado o fallido, reescribiendo el checklist en el mismo archivo markdown. " +
      "Deja un registro auditable de qué se hizo. Llámala después de CADA paso de plan_execute.",
    inputSchema: {
      planPath: z.string().describe("Nombre del plan (el campo 'planPath' que devolvió plan_execute)"),
      step: z.number().int().positive().describe("Número del paso, tal como aparece en el plan"),
      success: z.boolean().describe("true si el paso salió bien; false si falló"),
      error: z.string().optional().describe("Mensaje de error, obligatorio si success es false"),
      notes: z.string().optional().describe("Nota adicional que se añade al paso"),
    },
    handler: async ({ planPath, step, success, error, notes }) => {
      const ruta = resolverRutaDePlan(planPath);
      let contenido = await leerPlan(ruta);
      const pasos = parsearChecklist(contenido);
      const objetivo = pasos.find((paso) => paso.numero === step);

      if (!objetivo) {
        throw new McpToolError(
          "NO_ENCONTRADO",
          `El plan no tiene ningún paso con el número ${step}.`,
          {
            sugerencia: `Los pasos del plan son: ${pasos.map((p) => p.numero).join(", ")}. Usa uno de esos números.`,
          },
        );
      }

      if (!success && !error?.trim()) {
        throw errorDeValidacion(
          "Se marcó el paso como fallido pero no se indicó el mensaje de error.",
          "Repite la llamada con el parámetro 'error' explicando qué falló: es lo que queda registrado en el plan.",
        );
      }

      // Se reescribe SOLO la línea del paso, para no tocar el resto del markdown
      // (el modelo o el usuario pueden haber añadido notas propias).
      const marca = success ? "x" : "!";
      const sufijo = [
        error?.trim() ? ` — error: ${error.trim()}` : "",
        notes?.trim() ? ` — nota: ${notes.trim()}` : "",
      ].join("");
      const lineaNueva = `- [${marca}] ${step}. ${objetivo.texto}${sufijo}`;

      // Se comparan por número de paso y no por texto: el usuario puede haber
      // editado la redacción del paso a mano.
      contenido = contenido
        .split(/\r?\n/)
        .map((linea) => {
          const coincidencia = /^\s*-\s*\[[ x!X]\]\s*(\d+)\./.exec(linea);

          return coincidencia && Number(coincidencia[1]) === step ? lineaNueva : linea;
        })
        .join("\n");

      await fs.writeFile(ruta, contenido, "utf8");

      // Estado agregado, para el registro de la BD.
      const actualizados = parsearChecklist(contenido);
      const hechos = actualizados.filter((p) => p.estado === "hecho").length;
      const fallidos = actualizados.filter((p) => p.estado === "fallido").length;
      const pendientes = actualizados.filter((p) => p.estado === "pendiente").length;
      const todoHecho = pendientes === 0 && fallidos === 0;
      const hayFallo = fallidos > 0;

      await prismaClient.planRecordMcp
        .updateMany({
          where: { filePath: path.basename(ruta) },
          data: {
            status: todoHecho ? "DONE" : hayFallo ? "FAILED" : "RUNNING",
            completedSteps: hechos,
            failedSteps: fallidos,
            lastError: error?.trim() || null,
          },
        })
        .catch(() => undefined);

      return {
        success: true,
        archivo: ruta,
        paso: step,
        estado: success ? "hecho" : "fallido",
        progreso: { total: actualizados.length, hechos, fallidos, pendientes },
        mensaje: todoHecho
          ? "Todos los pasos del plan están completados."
          : hayFallo
            ? "Hay pasos fallidos en el plan. Pregunta al usuario si reintentar, saltar o abortar."
            : `Quedan ${pendientes} paso(s) pendiente(s): continúa con el siguiente.`,
      };
    },
  }),
  definirTool({
    name: "plan_list",
    description:
      "Lista los planes guardados y sus pasos. Sin argumentos devuelve el plan más reciente con su checklist; " +
      "con 'all' en true, el resumen de todos. Úsala para retomar un plan anterior o para mostrar el estado al usuario.",
    inputSchema: {
      all: z.boolean().optional().describe("true para devolver el resumen de todos los planes, no solo el último"),
      planPath: z.string().optional().describe("Nombre de un plan concreto a mostrar"),
    },
    handler: async ({ all, planPath }) => {
      if (planPath) {
        const ruta = resolverRutaDePlan(planPath);
        const contenido = await leerPlan(ruta);

        return {
          success: true,
          archivo: ruta,
          pasos: parsearChecklist(contenido).map((p) => ({
            numero: p.numero,
            estado: p.estado,
            accion: p.texto,
            ...(p.error ? { error: p.error } : {}),
          })),
          markdown: contenido,
        };
      }

      const carpeta = await asegurarCarpetaPlanes();

      if (all) {
        const archivos = (await fs.readdir(carpeta)).filter((n) => n.endsWith(".md")).sort().reverse();
        const resumenes = await Promise.all(
          archivos.map(async (nombre) => {
            const contenido = await fs.readFile(path.join(carpeta, nombre), "utf8");
            const pasos = parsearChecklist(contenido);

            return {
              archivo: nombre,
              total: pasos.length,
              hechos: pasos.filter((p) => p.estado === "hecho").length,
              fallidos: pasos.filter((p) => p.estado === "fallido").length,
              pendientes: pasos.filter((p) => p.estado === "pendiente").length,
            };
          }),
        );

        return { success: true, total: resumenes.length, planes: resumenes };
      }

      const { ruta, contenido } = await planMasReciente();

      return {
        success: true,
        archivo: ruta,
        pasos: parsearChecklist(contenido).map((p) => ({
          numero: p.numero,
          estado: p.estado,
          accion: p.texto,
          ...(p.error ? { error: p.error } : {}),
        })),
        markdown: contenido,
      };
    },
  }),
];

/**
 * Construye el markdown del plan con su checklist.
 */
function construirMarkdownDePlan(args: {
  objective: string;
  steps: string[];
  openQuestions: string[];
  risks: string[];
  nombre: string;
}): string {
  const lineas: string[] = [];

  lineas.push(`# Plan: ${args.objective}`);
  lineas.push("");
  lineas.push(`- **Archivo**: \`${args.nombre}\``);
  lineas.push(`- **Creado**: ${new Date().toISOString()}`);
  lineas.push(`- **Pasos**: ${args.steps.length}`);
  lineas.push("");

  if (args.openQuestions.length > 0) {
    lineas.push("## Preguntas pendientes (RESPONDER ANTES DE EJECUTAR)");
    lineas.push("");
    lineas.push(
      "> Hay información crítica sin resolver. No ejecutes el plan hasta que el usuario responda.",
    );
    lineas.push("");

    for (const pregunta of args.openQuestions) {
      lineas.push(`- ${pregunta}`);
    }

    lineas.push("");
  }

  if (args.risks.length > 0) {
    lineas.push("## Riesgos detectados");
    lineas.push("");
    lineas.push("> Estas acciones son destructivas o ambiguas. Confírmalas con el usuario.");
    lineas.push("");

    for (const riesgo of args.risks) {
      lineas.push(`- ⚠️ ${riesgo}`);
    }

    lineas.push("");
  }

  lineas.push("## Pasos");
  lineas.push("");

  args.steps.forEach((paso, indice) => {
    lineas.push(`- [ ] ${indice + 1}. ${paso}`);
  });

  lineas.push("");
  lineas.push("---");
  lineas.push("");
  lineas.push(
    "_Las casillas las marca `plan_mark_step`: `[x]` completado, `[!]` fallido con su error._",
  );
  lineas.push("");

  return lineas.join("\n");
}

export const moduloPlanes: ModuloDominio = {
  id: "plan",
  prefix: "plan_",
  description:
    "Planificación y ejecución de tareas de varios pasos: crear un plan en markdown con checklist, ejecutarlo paso a paso y dejar registro auditable.",
  tools: herramientas,
};
