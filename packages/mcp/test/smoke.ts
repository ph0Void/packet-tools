
import fs from "node:fs/promises";
import path from "node:path";
import { toolRegistry } from "../src/core/ToolRegistry";
import { registrarDominios } from "../src/domains/registro";
import { construirServidor } from "../src/core/McpServer";
import { listarPuertosSerie } from "../src/transports/adapters";
import {
  detectarVendorPorPrompt,
  resolverVendor,
} from "../src/transports/commandEngine";
import { envConfig } from "../src/config/EnvConfig";


let fallos = 0;


function comprobar(descripcion: string, condicion: boolean, detalle?: unknown): void {
  if (condicion) {
    console.log(`  OK   ${descripcion}`);
  } else {
    fallos++;
    console.log(`  FALLO ${descripcion}${detalle !== undefined ? ` → ${JSON.stringify(detalle)}` : ""}`);
  }
}


async function llamarTool(nombre: string, input: Record<string, unknown> = {}): Promise<unknown> {
  const tool = toolRegistry.obtenerTools().find((t) => t.name === nombre);
  if (!tool) throw new Error(`No existe la tool '${nombre}'.`);
  return tool.handler(input as never);
}

async function main(): Promise<void> {
  console.log("\n=== 1. Registro de dominios y herramientas ===");
  registrarDominios();

  const modulos = toolRegistry.obtenerModulos();
  comprobar("Se registran los 7 dominios", modulos.length === 7, {
    obtenidos: modulos.map((m) => m.id),
  });

  const tools = toolRegistry.obtenerTools();
  comprobar("Hay herramientas registradas", tools.length > 0, { total: tools.length });

  
  
  const malPrefijadas = modulos.flatMap((modulo) =>
    modulo.tools.filter((t) => !t.name.startsWith(modulo.prefix)).map((t) => t.name),
  );
  comprobar("Todas las herramientas llevan el prefijo de su dominio", malPrefijadas.length === 0, {
    malPrefijadas,
  });

  const nombres = tools.map((t) => t.name);
  const duplicados = nombres.filter((n, i) => nombres.indexOf(n) !== i);
  comprobar("No hay nombres de herramienta duplicados", duplicados.length === 0, { duplicados });

  console.log("\n  Herramientas por dominio:");
  for (const modulo of modulos) {
    console.log(`    ${modulo.prefix.padEnd(16)} ${String(modulo.tools.length).padStart(3)}  (${modulo.id})`);
  }
  console.log(`    ${"TOTAL".padEnd(16)} ${String(tools.length).padStart(3)}`);

  console.log("\n=== 2. Construcción del servidor MCP ===");
  const server = construirServidor();
  comprobar("El servidor MCP se construye sin errores", Boolean(server));

  console.log("\n=== 3. Detección de fabricante (datos puros) ===");
  
  
  const casos: Array<[string, string]> = [
    ["Router>", "conservative"], 
    ["R1(config)#", "cisco"],
    ["<Huawei>", "huawei"],
    ["[Huawei-GigabitEthernet0/0/1]", "huawei"],
    ["[admin@MikroTik] >", "mikrotik"],
    ["(host) (config) #", "aruba"],
    ["[edit interfaces]", "junos"],
  ];
  for (const [prompt, esperado] of casos) {
    const obtenido = detectarVendorPorPrompt(prompt);
    comprobar(
      `Prompt '${prompt}' → ${esperado}`,
      (obtenido ?? "conservative") === esperado,
      { obtenido },
    );
  }

  
  const declarado = resolverVendor({ typeDevice: "HUAWEI", prompt: "R1#" });
  comprobar("El typeDevice declarado tiene prioridad sobre el prompt", declarado.id === "huawei", {
    obtenido: declarado.id,
  });
  
  const conservador = resolverVendor({});
  comprobar(
    "Sin datos se usa el perfil conservador (sin transiciones inventadas)",
    conservador.id === "conservative" && conservador.transiciones.aConfig === null,
  );

  console.log("\n=== 4. Enumeración de puertos serie (toca el sistema) ===");
  try {
    const puertos = await listarPuertosSerie();
    comprobar("SerialPort.list() responde", Array.isArray(puertos), { total: puertos.length });
    console.log(`       ${puertos.length} puerto(s) detectado(s): ${puertos.map((p) => p.path).join(", ") || "(ninguno)"}`);
  } catch (error) {
    
    console.log(`  AVISO  No se pudieron enumerar los puertos serie: ${String(error)}`);
  }

  console.log("\n=== 5. Ciclo de planificación (@plan → @execute) ===");
  const objetivo = `smoke-test-${Date.now()}`;
  const creado = (await llamarTool("plan_task", {
    objective: objetivo,
    steps: ['packet_tracer_add_device(name="R1", model="2911", x=100, y=100)'],
    openQuestions: ["¿Qué direccionamiento IP uso?"],
  })) as { archivo: string; markdown: string; pasos: number };

  comprobar("plan_task crea el archivo", Boolean(creado.archivo));
  comprobar("El plan nace con un paso", creado.pasos === 1);
  comprobar(
    "El checklist usa el formato '- [ ] N. acción'",
    /- \[ \] 1\. packet_tracer_add_device/.test(creado.markdown),
  );
  comprobar("Las preguntas pendientes quedan registradas", creado.markdown.includes("¿Qué direccionamiento IP uso?"));

  const existe = await fs
    .stat(creado.archivo)
    .then(() => true)
    .catch(() => false);
  comprobar("El archivo existe en disco", existe, { archivo: creado.archivo });

  const listado = (await llamarTool("plan_execute", {
    planPath: path.basename(creado.archivo),
  })) as { pasosPendientes: Array<{ numero: number }>; resumen: { pendientes: number } };
  comprobar("plan_execute devuelve el paso pendiente", listado.pasosPendientes.length === 1);
  comprobar("El resumen cuadra", listado.resumen.pendientes === 1, listado.resumen);

  await llamarTool("plan_mark_step", {
    planPath: path.basename(creado.archivo),
    step: 1,
    success: true,
    notes: "verificado por la prueba de humo",
  });

  const contenido = await fs.readFile(creado.archivo, "utf8");
  comprobar("plan_mark_step marca la casilla como completada", contenido.includes("- [x] 1."));
  comprobar("La nota queda registrada en el markdown", contenido.includes("verificado por la prueba de humo"));

  const trasMarcar = (await llamarTool("plan_execute", {
    planPath: path.basename(creado.archivo),
  })) as { resumen: { pendientes: number; hechos: number } };
  comprobar("Ya no quedan pasos pendientes", trasMarcar.resumen.pendientes === 0, trasMarcar.resumen);
  comprobar("El paso figura como hecho", trasMarcar.resumen.hechos === 1);

  
  const sinMotivo = await llamarTool("plan_mark_step", {
    planPath: path.basename(creado.archivo),
    step: 1,
    success: false,
  })
    .then(() => false)
    .catch(() => true);
  comprobar("Marcar un fallo sin motivo se rechaza", sinMotivo);

  console.log("\n=== 6. Skills ===");
  const skills = (await llamarTool("skills_list", {})) as { total: number; skills: Array<{ slug: string }> };
  comprobar(
    "skills_list encuentra la skill de ejemplo de disco",
    skills.skills.some((s) => s.slug === "convencion-nombres"),
    { encontradas: skills.skills.map((s) => s.slug) },
  );

  const leida = (await llamarTool("skills_read", { slug: "convencion-nombres" })) as { contenido: string };
  comprobar("skills_read devuelve el contenido", leida.contenido.includes("Routers"));

  
  await fs.unlink(creado.archivo).catch(() => undefined);

  console.log("\n=== 7. Rutas de configuración ===");
  console.log(`  Carpeta de planes:  ${envConfig.MCP_PLANS_DIR}`);
  console.log(`  Carpeta de skills:  ${envConfig.MCP_SKILLS_DIR}`);
  console.log(
    `  Bridge PT (propio):  http://${envConfig.MCP_BRIDGE_HOST}:${envConfig.MCP_BRIDGE_PORT}` +
      ` (habilitado: ${envConfig.MCP_BRIDGE_ENABLED})`,
  );

  console.log(
    fallos === 0
      ? "\n✅ Todas las comprobaciones pasaron.\n"
      : `\n❌ ${fallos} comprobación(es) fallaron.\n`,
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n❌ La prueba de humo falló con una excepción:", error);
  process.exit(1);
});
