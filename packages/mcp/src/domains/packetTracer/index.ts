
import { z } from "zod";
import { definirTool } from "@/core/ToolRegistry";
import type { ModuloDominio, DefinicionToolGenerica } from "@/core/ToolRegistry";
import { Logger } from "@/utils/Logger";
import { envConfig } from "@/config/EnvConfig";
import { llamarPacketTracer, operacionOk } from "./PacketTracerBridge";
import { estadoBridge } from "./PacketTracerBridgeServer";


async function simple(
  herramienta: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const resultado = await llamarPacketTracer(herramienta, input);
  return resultado ?? { success: false, error: "La extensión no devolvió datos." };
}


async function leerCatalogoDeModelos(): Promise<string[]> {
  const bruto = (await llamarPacketTracer("listDeviceModels", {})) as Record<
    string,
    unknown
  >;
  if (!bruto || bruto.success === false || bruto.error) return [];

  const catalogo = (bruto.models ??
    (bruto.data as Record<string, unknown>)?.models ??
    bruto.data) as unknown;
  if (!Array.isArray(catalogo)) return [];

  const ids: string[] = [];
  for (const entrada of catalogo) {
    if (typeof entrada === "string" || typeof entrada === "number") {
      ids.push(String(entrada).trim());
      continue;
    }

    const id = (entrada as { id?: unknown })?.id;
    if (typeof id === "string" && id.trim()) ids.push(id.trim());
  }
  return Array.from(new Set(ids.filter(Boolean)));
}


function modelosParecidos(pedido: string, catalogo: string[]): string[] {
  const termino = pedido.trim().toLowerCase();
  if (!termino) return [];
  return catalogo
    .map((candidato) => {
      const modelo = candidato.toLowerCase();
      let comunes = 0;
      while (
        comunes < termino.length &&
        comunes < modelo.length &&
        termino[comunes] === modelo[comunes]
      ) {
        comunes++;
      }

      const contiene = modelo.includes(termino) || termino.includes(modelo);

      const puntos = comunes < 2 && !contiene ? 0 : comunes * 2 + (contiene ? 1 : 0);
      return { candidato, puntos };
    })
    .filter((entrada) => entrada.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos || a.candidato.length - b.candidato.length)
    .slice(0, 5)
    .map((entrada) => entrada.candidato);
}


const TIPOS_ENLACE = ["straight", "cross", "fiber", "serial", "auto"] as const;


const MODOS_SIMULACION = ["realtime", "simulation"] as const;




const herramientas: DefinicionToolGenerica[] = [
  
  
  
  definirTool({
    name: "packet_tracer_list_device_models",
    description:
      "Lista el catálogo REAL de modelos de dispositivo que acepta esta instalación de Packet Tracer. " +
      "Úsala antes de agregar un equipo si no estás seguro del identificador exacto del modelo: el catálogo lo decide el motor, " +
      "no esta herramienta, y la comparación distingue mayúsculas y minúsculas.",
    inputSchema: {},
    handler: async () => simple("listDeviceModels", {}),
  }),
  definirTool({
    name: "packet_tracer_get_network",
    description:
      "Devuelve la topología actual de Packet Tracer: dispositivos con sus interfaces (nombre, si están en uso, IP) y los enlaces entre ellos. " +
      "Es la lectura principal para saber qué hay en el lienzo antes de modificar nada.",
    inputSchema: {},
    handler: async () => simple("getNetwork", {}),
  }),
  definirTool({
    name: "packet_tracer_get_device_info",
    description:
      "Devuelve la ficha de un dispositivo concreto (modelo, tipo, sus interfaces y sus enlaces). " +
      "Úsala cuando necesites puertos libres para cablear o confirmar que un equipo existe.",
    inputSchema: {
      deviceName: z.string().describe("Nombre exacto del dispositivo en el lienzo, por ejemplo 'R1' o 'PC1'"),
    },
    handler: async ({ deviceName }) => simple("getDeviceInfo", { deviceName }),
  }),
  definirTool({
    name: "packet_tracer_list_device_modules",
    description:
      "Lista los módulos de expansión que admite un dispositivo concreto (por ejemplo tarjetas seriales HWIC-2T). " +
      "Úsala antes de instalar un módulo para conocer el modelo correcto.",
    inputSchema: {
      deviceName: z.string().describe("Nombre del dispositivo existente"),
    },
    handler: async ({ deviceName }) => simple("listDeviceModules", { deviceName }),
  }),
  definirTool({
    name: "packet_tracer_get_device_config_snapshot",
    description:
      "Lee la configuración completa de un dispositivo IOS (running-config, startup-config y su XML interno). " +
      "Úsala para VERIFICAR que una configuración se aplicó de verdad, en vez de darla por buena.",
    inputSchema: {
      deviceName: z.string().describe("Nombre del dispositivo IOS del que leer la configuración"),
    },
    handler: async ({ deviceName }) => simple("getDeviceConfigSnapshot", { deviceName }),
  }),
  definirTool({
    name: "packet_tracer_read_console",
    description:
      "Lee las últimas líneas de la consola de un dispositivo (equivale a mirar la pantalla de la CLI). " +
      "Úsala para comprobar el estado de un equipo o ver el resultado de un comando sin enviar nada.",
    inputSchema: {
      deviceName: z.string().describe("Nombre del dispositivo"),
      lines: z
        .number()
        .int()
        .min(1)
        .max(5000)
        .optional()
        .describe("Cuántas líneas leer (por defecto 40, máximo 5000)"),
    },
    handler: async ({ deviceName, lines }) =>
      simple("readDeviceConsole", { deviceName, lines }),
  }),
  definirTool({
    name: "packet_tracer_get_command_log",
    description:
      "Devuelve el historial de comandos ejecutados en un dispositivo, con la hora y el prompt en que se ejecutaron. " +
      "Úsala para auditar qué se ha enviado a un equipo.",
    inputSchema: {
      deviceName: z.string().describe("Nombre del dispositivo"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Número máximo de entradas a devolver (por defecto 50, máximo 500)"),
    },
    handler: async ({ deviceName, limit }) => simple("getCommandLog", { deviceName, limit }),
  }),
  definirTool({
    name: "packet_tracer_get_routing_table",
    description:
      "Devuelve la tabla de rutas de un dispositivo IOS (equivalente a 'show ip route'). " +
      "Úsala para comprobar que el enrutamiento quedó bien configurado.",
    inputSchema: {
      deviceName: z.string().describe("Nombre del router o switch multicapa"),
    },
    handler: async ({ deviceName }) => simple("getRoutingTable", { deviceName }),
  }),
  definirTool({
    name: "packet_tracer_get_vlan_configuration",
    description:
      "Devuelve la configuración de VLANs de un switch (VLANs definidas y salida de la CLI). " +
      "Solo funciona sobre switches; en otros tipos de equipo el motor lo rechaza.",
    inputSchema: {
      switchName: z.string().describe("Nombre del switch"),
    },
    handler: async ({ switchName }) => simple("getVlanConfiguration", { switchName }),
  }),
  definirTool({
    name: "packet_tracer_get_device_metrics",
    description:
      "Devuelve métricas de un dispositivo: estado de encendido, estado de cada interfaz y métricas extendidas. " +
      "Úsala para diagnosticar por qué un enlace no levanta.",
    inputSchema: {
      deviceName: z.string().describe("Nombre del dispositivo"),
    },
    handler: async ({ deviceName }) => simple("getDeviceMetrics", { deviceName }),
  }),
  definirTool({
    name: "packet_tracer_validate_security_config",
    description:
      "Revisa la postura de seguridad de un dispositivo IOS: si tiene contraseñas, si SSH está habilitado y si Telnet está deshabilitado. " +
      "Devuelve además una lista de avisos. Úsala para auditar un equipo ya configurado.",
    inputSchema: {
      deviceName: z.string().describe("Nombre del dispositivo IOS a auditar"),
    },
    handler: async ({ deviceName }) => simple("validateSecurityConfig", { deviceName }),
  }),
  definirTool({
    name: "packet_tracer_validate_topology",
    description:
      "Analiza la topología completa y devuelve errores, avisos, equipos huérfanos, bucles y enlaces sin resolver. " +
      "Úsala como comprobación de calidad después de montar una topología.",
    inputSchema: {},
    handler: async () => simple("validateTopology", {}),
  }),
  definirTool({
    name: "packet_tracer_generate_network_report",
    description:
      "Genera un informe legible de la topología actual: inventario de equipos, direccionamiento y enlaces. " +
      "Úsala para resumir el estado de la red al usuario.",
    inputSchema: {},
    handler: async () => {
      
      
      
      const red = (await llamarPacketTracer("getNetwork", {})) as {
        result?: {
          deviceCount?: number;
          connectionCount?: number;
          devices?: Array<Record<string, unknown>>;
          connections?: Array<Record<string, unknown>>;
        };
      };

      const validacion = (await llamarPacketTracer("validateTopology", {})) as Record<
        string,
        unknown
      >;

      const datos = red?.result ?? {};

      const dispositivos = datos.devices ?? [];

      const porTipo = dispositivos.reduce<Record<string, number>>((acc, equipo) => {
        const modelo = String(equipo?.model ?? "desconocido");
        acc[modelo] = (acc[modelo] ?? 0) + 1;
        return acc;
      }, {});
      return {
        success: true,
        resumen: {
          dispositivos: datos.deviceCount ?? dispositivos.length,
          enlaces: datos.connectionCount ?? (datos.connections ?? []).length,
          modelos: porTipo,
        },
        dispositivos,
        enlaces: datos.connections ?? [],
        validacion: {
          errores: validacion?.errors ?? [],
          avisos: validacion?.warnings ?? [],
          huerfanos: validacion?.orphans ?? [],
          bucles: validacion?.loops ?? [],
        },
      };
    },
  }),
  
  
  
  definirTool({
    name: "packet_tracer_add_device",
    description:
      "Coloca un dispositivo nuevo en el lienzo de Packet Tracer en las coordenadas indicadas. " +
      "El nombre debe ser único y el modelo tiene que ser un identificador REAL del catálogo de Packet Tracer " +
      "(por ejemplo '2911', '2960-24TT', 'Router-PT', 'PC-PT'): esta herramienta contrasta el modelo contra el catálogo del motor " +
      "y, si no existe, devuelve los más parecidos en vez de fallar de forma opaca. " +
      "Usa coordenadas separadas entre equipos para que no se solapen.",
    inputSchema: {
      deviceName: z.string().describe("Nombre único del equipo, por ejemplo 'R1' o 'PC1'"),
      deviceModel: z
        .string()
        .min(1)
        .describe("Identificador exacto del modelo ('2911', '2960-24TT', 'Router-PT', 'PC-PT', 'Server-PT'...)"),
      x: z.number().describe("Coordenada X en el lienzo"),
      y: z.number().describe("Coordenada Y en el lienzo"),
    },
    handler: async ({ deviceName, deviceModel, x, y }) => {
      const catalogo = await leerCatalogoDeModelos();
      if (catalogo.length === 0) {
        return {
          success: false,
          error:
            `No se pudo leer el catálogo de modelos de Packet Tracer, así que no se puede confirmar que '${deviceModel}' exista ` +
            `y NO se ha colocado ningún equipo. Comprueba que Packet Tracer está abierto con la extensión conectada y ` +
            `llama a packet_tracer_list_device_models.`,
        };
      }

      const pedido = deviceModel.trim();
      if (!catalogo.includes(pedido)) {
        const sugerencias = modelosParecidos(pedido, catalogo);
        return {
          success: false,
          error:
            `'${pedido}' no es un modelo de dispositivo de Packet Tracer.` +
            (sugerencias.length > 0
              ? ` Los modelos del catálogo más parecidos son: ${sugerencias.join(", ")}.`
              : ""),
          sugerencias,
          modelosDisponibles: catalogo.length,
        };
      }
      return simple("addDevice", { deviceName, deviceModel: pedido, x, y });
    },
  }),
  definirTool({
    name: "packet_tracer_add_module",
    description:
      "Instala un módulo físico de expansión en una ranura de un dispositivo (por ejemplo una tarjeta serial HWIC-2T). " +
      "El equipo se apaga y se vuelve a encender al hacerlo. Úsala cuando se acaben los puertos disponibles.",
    inputSchema: {
      deviceName: z.string().describe("Nombre de un dispositivo existente"),
      slot: z.number().int().min(0).max(3).describe("Número de ranura de expansión (0-3)"),
      model: z.string().describe("Modelo del módulo, por ejemplo 'HWIC-2T' (serial) o 'NM-4E' (ethernet)"),
    },
    handler: async ({ deviceName, slot, model }) =>
      simple("addModule", { deviceName, slot, model }),
  }),
  definirTool({
    name: "packet_tracer_add_link",
    description:
      "Conecta dos dispositivos con un cable. Ambos puertos deben estar libres. " +
      "Reutiliza los datos de puertos que ya hayas leído en este turno con packet_tracer_get_network o packet_tracer_get_device_info; " +
      "vuelve a leer solo si un puerto fue rechazado o la topología cambió.",
    inputSchema: {
      device1Name: z.string().describe("Nombre del primer dispositivo"),
      device1Interface: z.string().describe("Interfaz libre del primer dispositivo, por ejemplo 'GigabitEthernet0/0'"),
      device2Name: z.string().describe("Nombre del segundo dispositivo"),
      device2Interface: z.string().describe("Interfaz libre del segundo dispositivo"),
      linkType: z
        .enum(TIPOS_ENLACE)
        .describe("'straight' para LAN, 'cross' para PC-PC, 'serial' para WAN, 'fiber' o 'auto'"),
    },
    handler: async (args) => simple("addLink", args),
  }),
  definirTool({
    name: "packet_tracer_remove_device",
    description:
      "Elimina uno o varios dispositivos del lienzo. Operación destructiva: el equipo y sus enlaces desaparecen. " +
      "Devuelve el detalle por equipo, así que en un borrado en lote puedes ver cuáles fallaron.",
    inputSchema: {
      deviceNames: z.array(z.string()).min(1).describe("Nombres de los dispositivos a eliminar"),
    },
    handler: async ({ deviceNames }) => simple("removeDevice", { deviceNames }),
  }),
  definirTool({
    name: "packet_tracer_remove_link",
    description:
      "Retira uno o varios cables. Cada entrada identifica un extremo del enlace por equipo y puerto.",
    inputSchema: {
      links: z
        .array(
          z.object({
            device: z.string().describe("Nombre del equipo en un extremo del enlace"),
            port: z.string().describe("Interfaz de ese extremo, por ejemplo 'FastEthernet0/1'"),
          }),
        )
        .min(1)
        .describe("Extremos de los enlaces a retirar (equipo + puerto)"),
    },
    handler: async ({ links }) => simple("removeLink", { links }),
  }),
  definirTool({
    name: "packet_tracer_move_device",
    description: "Mueve un dispositivo a otras coordenadas del lienzo. Solo cambia su posición visual, no su configuración.",
    inputSchema: {
      deviceName: z.string().describe("Nombre del dispositivo a mover"),
      x: z.number().describe("Nueva coordenada X"),
      y: z.number().describe("Nueva coordenada Y"),
    },
    handler: async ({ deviceName, x, y }) => simple("moveDevice", { deviceName, x, y }),
  }),
  definirTool({
    name: "packet_tracer_rename_device",
    description: "Cambia el nombre de un dispositivo en el lienzo. Afecta a cómo se le referencian el resto de herramientas.",
    inputSchema: {
      deviceName: z.string().describe("Nombre actual del dispositivo"),
      newName: z.string().describe("Nombre nuevo (debe ser único)"),
    },
    handler: async ({ deviceName, newName }) => simple("renameDevice", { deviceName, newName }),
  }),
  definirTool({
    name: "packet_tracer_set_power",
    description: "Enciende o apaga un dispositivo. Apagar y encender un router fuerza su reinicio (útil para ver el arranque).",
    inputSchema: {
      deviceName: z.string().describe("Nombre del dispositivo"),
      power: z.boolean().describe("true para encender, false para apagar"),
    },
    handler: async ({ deviceName, power }) => simple("setPower", { deviceName, power }),
  }),
  
  
  
  definirTool({
    name: "packet_tracer_configure_pc_ip",
    description:
      "Configura el direccionamiento IP de un equipo final (PC, portátil, servidor o impresora), estático o por DHCP. " +
      "Solo configura el puerto FastEthernet0 (la tarjeta principal). " +
      "Con dhcpEnabled=false DEBES enviar ipaddress y subnetMask: sin ambos, Packet Tracer responde éxito sin aplicar nada.",
    inputSchema: {
      deviceName: z.string().describe("Nombre del equipo final"),
      dhcpEnabled: z.boolean().describe("true = DHCP; false = IP estática (entonces ipaddress y subnetMask son obligatorios)"),
      ipaddress: z.string().optional().describe("IP estática para FastEthernet0 (obligatoria con dhcpEnabled=false)"),
      subnetMask: z.string().optional().describe("Máscara de subred (obligatoria con dhcpEnabled=false)"),
      defaultGateway: z.string().optional().describe("Puerta de enlace por defecto"),
      dnsServer: z.string().optional().describe("Servidor DNS"),
    },
    handler: async (args) => {
      
      
      if (args.dhcpEnabled === false) {
        const faltan: string[] = [];
        if (!args.ipaddress?.trim()) faltan.push("ipaddress");
        if (!args.subnetMask?.trim()) faltan.push("subnetMask");
        if (faltan.length > 0) {
          return {
            success: false,
            error:
              `Con dhcpEnabled=false hay que enviar ${faltan.join(" y ")}. ` +
              `Sin IP y máscara, Packet Tracer responde éxito sin configurar nada, así que la llamada se rechaza aquí.`,
          };
        }
      }
      return simple("configurePcIp", args);
    },
  }),
  
  
  
  definirTool({
    name: "packet_tracer_run_device_commands",
    description:
      "Envía uno o varios comandos CLI a un dispositivo y devuelve la salida de cada uno. " +
      "Es la vía síncrona (espera por línea) y la adecuada para LECTURAS ('show ...') o lotes cortos; " +
      "si necesitas un resultado fiable en un lote largo, usa packet_tracer_configure_ios_device.",
    inputSchema: {
      deviceName: z.string().describe("Nombre del dispositivo"),
      commands: z
        .array(z.string())
        .min(1)
        .describe("Comandos a enviar, uno por elemento (también se acepta una sola cadena con saltos de línea)"),
      mode: z
        .enum(["", "user", "enable", "global"])
        .optional()
        .describe("Modo de la CLI en el que ejecutar; vacío u omitido usa el modo por defecto del equipo"),
      waitMs: z.number().int().min(0).optional().describe("Espera por comando en milisegundos (por defecto 250)"),
      maxChars: z.number().int().min(1).optional().describe("Máximo de caracteres de salida por comando (por defecto 8000)"),
    },
    handler: async ({ deviceName, commands, mode, waitMs, maxChars }) => {
      const opciones: Record<string, unknown> = {};
      if (mode !== undefined) opciones.mode = mode;
      if (waitMs !== undefined) opciones.waitMs = waitMs;
      if (maxChars !== undefined) opciones.maxChars = maxChars;
      return simple("runDeviceCommands", {
        deviceName,
        commands,
        ...(Object.keys(opciones).length > 0 ? { options: opciones } : {}),
      });
    },
  }),
  definirTool({
    name: "packet_tracer_configure_ios_device",
    description:
      "Aplica un lote de configuración IOS a un dispositivo por CLI, de forma fiable y verificable. " +
      "Internamente lanza el lote en el motor de dos fases (runCommandAsync + pollCommandResult) en modo configuración global " +
      "y después CONTRASTA el resultado contra la configuración real del equipo. " +
      "Es la vía recomendada para configurar routers y switches: envía las líneas una por línea, " +
      "y termina el lote con 'do write memory' para guardar en NVRAM. Máximo 120 líneas por llamada.",
    inputSchema: {
      deviceName: z.string().describe("Nombre del dispositivo IOS a configurar"),
      commands: z
        .array(z.string())
        .min(1)
        .describe(
          "Líneas de configuración, una por elemento (por ejemplo ['hostname R1', 'interface Gi0/0', 'ip address 10.0.0.1 255.255.255.0', 'no shutdown'])",
        ),
      guardarEnNvram: z
        .boolean()
        .optional()
        .describe("Añade 'do write memory' al final del lote (por defecto true). Pon false solo si el equipo no lo admite."),
    },
    handler: async ({ deviceName, commands, guardarEnNvram }) => {
      const lineas = commands
        .flatMap((linea) => String(linea).split(/\r?\n/))
        .map((linea) => linea.trim())
        .filter(Boolean);
      if (lineas.length === 0) {
        return { success: false, error: "No se envió ninguna línea de configuración." };
      }
      if (lineas.length > 120) {
        return {
          success: false,
          error:
            `El lote tiene ${lineas.length} líneas y el máximo por llamada es 120. ` +
            `Divídelo en varias llamadas más cortas.`,
        };
      }

      const guardar = guardarEnNvram !== false;

      const lote = guardar && !lineas.includes("do write memory") ? [...lineas, "do write memory"] : lineas;
      return ejecutarLoteConVerificacion(deviceName, lote);
    },
  }),
  definirTool({
    name: "packet_tracer_apply_device_config",
    description:
      "Aplica un bloque de configuración completo (texto multilínea) a un dispositivo IOS. " +
      "Es la vía del motor antiguo: más simple pero MENOS fiable en lotes largos (espera ciega por línea). " +
      "Para configuración fiable usa packet_tracer_configure_ios_device. Ignora líneas vacías y comentarios que empiecen por '!'.",
    inputSchema: {
      deviceName: z.string().describe("Nombre del dispositivo IOS"),
      configText: z.string().min(1).describe("Bloque de configuración en texto, una línea por comando"),
    },
    handler: async ({ deviceName, configText }) => simple("applyDeviceConfig", { deviceName, configText }),
  }),
  definirTool({
    name: "packet_tracer_run_command_async",
    description:
      "Lanza un lote de comandos en el motor de DOS FASES y devuelve un identificador pendiente de inmediato, sin esperar el resultado. " +
      "Úsala solo si necesitas control manual del ciclo; para el caso normal usa packet_tracer_configure_ios_device. " +
      "Después hay que sondear con packet_tracer_poll_command_result.",
    inputSchema: {
      deviceName: z.string().describe("Nombre del dispositivo"),
      commands: z.array(z.string()).min(1).describe("Comandos a enviar"),
      mode: z.enum(["", "user", "enable", "global"]).optional().describe("Modo de la CLI"),
    },
    handler: async ({ deviceName, commands, mode }) =>
      simple("runCommandAsync", {
        deviceName,
        commands,
        ...(mode !== undefined ? { options: { mode } } : {}),
      }),
  }),
  definirTool({
    name: "packet_tracer_poll_command_result",
    description:
      "Sondea el resultado de un lote lanzado con packet_tracer_run_command_async. " +
      "Devuelve si sigue en curso o si terminó, con la salida de cada comando y el aviso de recorte si lo hubo.",
    inputSchema: {
      pendienteId: z.string().describe("Identificador devuelto por packet_tracer_run_command_async"),
      esperarMs: z.number().int().min(0).max(3000).optional().describe("Cuánto esperar antes de responder (máximo 3000 ms)"),
    },
    handler: async ({ pendienteId, esperarMs }) =>
      simple("pollCommandResult", {
        pendienteId,
        ...(esperarMs !== undefined ? { options: { esperarMs } } : {}),
      }),
  }),
  
  
  
  definirTool({
    name: "packet_tracer_get_simulation_status",
    description: "Devuelve el estado de la simulación: modo (tiempo real o simulación), tiempo actual e información de fotogramas.",
    inputSchema: {},
    handler: async () => simple("getSimulationStatus", {}),
  }),
  definirTool({
    name: "packet_tracer_set_simulation_mode",
    description:
      "Cambia entre modo tiempo real ('realtime') y modo simulación ('simulation'). " +
      "OJO: es un cambio GLOBAL del escenario compartido, visible para los demás usuarios.",
    inputSchema: {
      toSimMode: z.enum(MODOS_SIMULACION).describe("'realtime' o 'simulation'"),
    },
    handler: async ({ toSimMode }) => simple("setSimulationMode", { toSimMode }),
  }),
  definirTool({
    name: "packet_tracer_step_simulation",
    description:
      "Avanza la simulación. Con direction='reset' se BORRAN los fotogramas capturados y no se recuperan: es destructivo. " +
      "Los demás sentidos avanzan un paso o un segundo.",
    inputSchema: {
      direction: z
        .enum(["forward", "backward", "reset", "play", "pause"])
        .describe("Sentido del avance; 'reset' borra los fotogramas capturados"),
      steps: z.number().int().min(1).max(100).optional().describe("Cuántos pasos avanzar (máximo 100)"),
    },
    handler: async ({ direction, steps }) => simple("stepSimulation", { direction, steps }),
  }),
  definirTool({
    name: "packet_tracer_send_pdu",
    description:
      "Inyecta un paquete (PDU) desde un equipo origen a uno destino y devuelve el resultado de la simulación. " +
      "Es la forma de comprobar conectividad extremo a extremo en el escenario.",
    inputSchema: {
      sourceDevice: z.string().describe("Nombre del equipo origen"),
      destinationDevice: z.string().describe("Nombre del equipo destino"),
    },
    handler: async ({ sourceDevice, destinationDevice }) =>
      simple("sendPdu", { sourceDevice, destinationDevice }),
  }),
  definirTool({
    name: "packet_tracer_get_pdu_results",
    description:
      "Devuelve los fotogramas capturados en el simulador de eventos con su estado (aceptado, descartado...). " +
      "Úsala para entender POR QUÉ un paquete no llegó.",
    inputSchema: {
      types: z
        .array(z.string())
        .optional()
        .describe("Filtra por tipo de tráfico; omitir para no filtrar"),
      limit: z.number().int().min(1).max(500).optional().describe("Máximo de fotogramas (por defecto 50, máximo 500)"),
    },
    handler: async ({ types, limit }) =>
      simple("getPduResults", {
        types,
        ...(limit !== undefined ? { options: { limit } } : {}),
      }),
  }),
  definirTool({
    name: "packet_tracer_ping",
    description:
      "Comprueba conectividad entre dos equipos (equivalente a un ping). " +
      "Intenta primero con una PDU y, si no sirve, con la CLI; el campo 'metodo' del resultado dice cuál se usó. " +
      "Úsala para verificar que una configuración de red funciona de verdad.",
    inputSchema: {
      sourceName: z.string().describe("Nombre del equipo origen"),
      targetName: z.string().describe("Nombre del equipo destino"),
    },
    handler: async ({ sourceName, targetName }) => simple("pingDevices", { sourceName, targetName }),
  }),
  definirTool({
    name: "packet_tracer_reachability_matrix",
    description:
      "Comprueba la conectividad de un origen contra varios destinos de una vez (máximo 10). " +
      "Es mucho más eficiente que encadenar pings cuando quieres validar una topología entera.",
    inputSchema: {
      sourceName: z.string().describe("Nombre del equipo origen"),
      targetNames: z.array(z.string()).min(1).max(10).describe("Nombres de los destinos (máximo 10)"),
    },
    handler: async ({ sourceName, targetNames }) =>
      simple("reachabilityMatrix", { sourceName, targetNames }),
  }),
  definirTool({
    name: "packet_tracer_simulate_link_failure",
    description:
      "Simula la caída de un enlace apagando su interfaz, para probar la tolerancia a fallos de la topología. " +
      "Deshazlo después con packet_tracer_restore_link.",
    inputSchema: {
      deviceName: z.string().describe("Nombre del dispositivo"),
      interfaceName: z.string().describe("Interfaz a apagar, por ejemplo 'GigabitEthernet0/0'"),
      durationSeconds: z.number().int().min(1).optional().describe("Duración sugerida en segundos (el motor lo acepta pero no lo aplica)"),
    },
    handler: async ({ deviceName, interfaceName, durationSeconds }) =>
      simple("simulateLinkFailure", { deviceName, interfaceName, durationSeconds }),
  }),
  definirTool({
    name: "packet_tracer_restore_link",
    description: "Restaura un enlace previamente caído, volviendo a levantar la interfaz.",
    inputSchema: {
      deviceName: z.string().describe("Nombre del dispositivo"),
      interfaceName: z.string().describe("Interfaz a levantar"),
    },
    handler: async ({ deviceName, interfaceName }) =>
      simple("restoreLink", { deviceName, interfaceName }),
  }),
  
  
  
  definirTool({
    name: "packet_tracer_clear_workspace",
    description:
      "ELIMINA TODOS los dispositivos y enlaces del lienzo. Es irreversible y no pide confirmación: " +
      "confírmalo con el usuario antes de llamarla, salvo que él lo haya pedido explícitamente.",
    inputSchema: {},
    handler: async () => simple("clearWorkspace", {}),
  }),
  definirTool({
    name: "packet_tracer_export_workspace",
    description:
      "Exporta el workspace actual a un archivo .pkt. Si el motor puede escribir en disco devuelve la ruta; " +
      "si no, devuelve el contenido en base64 para que se guarde desde fuera.",
    inputSchema: {
      filename: z.string().optional().describe("Nombre del archivo (por defecto 'topologia.pkt')"),
      targetDir: z.string().optional().describe("Carpeta destino en la máquina donde corre Packet Tracer"),
    },
    handler: async ({ filename, targetDir }) => simple("exportWorkspace", { filename, targetDir }),
  }),
  definirTool({
    name: "packet_tracer_import_workspace",
    description:
      "Carga un workspace .pkt, REEMPLAZANDO el contenido actual del lienzo. " +
      "Acepta una ruta en la máquina de Packet Tracer o el contenido en base64.",
    inputSchema: {
      filename: z.string().describe("Nombre del archivo .pkt a cargar"),
      sourcePath: z.string().optional().describe("Ruta del archivo en la máquina donde corre Packet Tracer"),
      base64: z.string().optional().describe("Contenido del .pkt en base64 (alternativa a sourcePath)"),
    },
    handler: async ({ filename, sourcePath, base64 }) =>
      simple("importWorkspace", { filename, sourcePath, base64 }),
  }),
];





async function ejecutarLoteConVerificacion(
  deviceName: string,
  lineas: string[],
): Promise<unknown> {
  
  const info = (await llamarPacketTracer("getDeviceInfo", { deviceName })) as Record<
    string,
    unknown
  >;
  if (info?.success === false || info?.error) {
    return {
      success: false,
      error:
        `No se pudo leer el equipo '${deviceName}': ${String(info?.error ?? "no está en la topología")}. ` +
        `No se ha enviado el lote. Comprueba el nombre con packet_tracer_get_network.`,
    };
  }
  
  const lanzamiento = (await llamarPacketTracer("runCommandAsync", {
    deviceName,
    commands: lineas,
    options: { mode: "global" },
  })) as Record<string, unknown>;
  if (lanzamiento?.success === false || lanzamiento?.error) {
    return {
      success: false,
      error:
        `El motor no aceptó el lote para '${deviceName}': ${String(lanzamiento?.error ?? "sin detalle")}.`,
      lote: lineas,
    };
  }

  const pendienteId = lanzamiento?.pendienteId;
  if (typeof pendienteId !== "string") {
    return {
      success: false,
      error:
        `Packet Tracer no devolvió un identificador de comando pendiente para '${deviceName}', ` +
        `así que no se puede seguir el resultado. Salida del motor: ${JSON.stringify(lanzamiento).slice(0, 300)}`,
    };
  }
  
  
  const PRESUPUESTO_MS = 25_000;

  const inicio = Date.now();
  let ultimo: Record<string, unknown> = {};
  while (Date.now() - inicio < PRESUPUESTO_MS) {
    ultimo = (await llamarPacketTracer("pollCommandResult", {
      pendienteId,
      options: { esperarMs: 1000 },
    })) as Record<string, unknown>;
    if (ultimo?.done === true || ultimo?.success === false) break;
    
    
  }
  
  const verificacion = await verificarLote(deviceName, lineas, ultimo);

  const completado = ultimo?.done === true;
  return {
    success: completado && verificacion.ok !== false,
    deviceName,
    lote: lineas,
    estado: completado ? "terminado" : "en_curso_o_agotado",
    fuente: ultimo?.fuente ?? null,
    results: ultimo?.results ?? null,
    summary: ultimo?.summary ?? null,
    verificacion,
    ...(ultimo?.warning ? { warning: ultimo.warning } : {}),
    ...(!completado
      ? {
          aviso:
            "El lote se lanzó pero no se pudo confirmar que terminara dentro del presupuesto. " +
            "Comprueba el estado con packet_tracer_read_console antes de repetir la configuración.",
        }
      : {}),
  };
}


async function verificarLote(
  deviceName: string,
  lineas: string[],
  resultado: Record<string, unknown>,
): Promise<{
  realizada: boolean;
  ok: boolean | null;
  datos: Array<{ esperado: string; encontrado: string; ok: boolean }>;
  motivo?: string;
}> {
  const esperadoHostname = lineas
    .map((linea) => /^hostname\s+(\S+)\s*$/i.exec(linea))
    .find(Boolean)?.[1];

  const esperadasIps = lineas
    .map((linea) => /^ip\s+address\s+(\d{1,3}(?:\.\d{1,3}){3})(?:\s+(\S+))?\s*$/i.exec(linea))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => ({ ip: m[1], mascara: m[2] ?? "" }));
  if (!esperadoHostname && esperadasIps.length === 0) {
    return {
      realizada: false,
      ok: null,
      datos: [],
      motivo:
        "El lote no incluía 'hostname' ni 'ip address', así que no hay nada que se pueda contrastar contra la configuración del equipo.",
    };
  }

  const snapshot = (await llamarPacketTracer("getDeviceConfigSnapshot", { deviceName })) as Record<
    string,
    unknown
  >;

  const config = String(
    snapshot?.runningConfig ?? snapshot?.config ?? snapshot?.result ?? "",
  );
  if (!config.trim()) {
    return {
      realizada: false,
      ok: null,
      datos: [],
      motivo:
        `Packet Tracer no devolvió la configuración de '${deviceName}', así que no se puede afirmar qué se aplicó. ` +
        `El lote SÍ se envió: comprueba el resultado con packet_tracer_read_console.`,
    };
  }

  const datos: Array<{ esperado: string; encontrado: string; ok: boolean }> = [];
  if (esperadoHostname) {
    const encontrado = /^\s*hostname\s+(\S+)\s*$/im.exec(config)?.[1] ?? null;
    datos.push({
      esperado: `hostname ${esperadoHostname}`,
      encontrado: encontrado ? `hostname ${encontrado}` : "(no aparece ningún hostname en la configuración)",
      ok: encontrado !== null && encontrado.toLowerCase() === esperadoHostname.toLowerCase(),
    });
  }
  for (const { ip, mascara } of esperadasIps) {
    const linea = config
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => {
        const m = /^ip\s+address\s+(\d{1,3}(?:\.\d{1,3}){3})(?:\s+(\S+))?/i.exec(l);
        if (!m || m[1] !== ip) return false;
        return mascara ? m[2] === mascara : true;
      });
    datos.push({
      esperado: `ip address ${ip}${mascara ? ` ${mascara}` : ""}`,
      encontrado: linea ?? "(no aparece esa dirección en la configuración)",
      ok: Boolean(linea),
    });
  }
  return { realizada: true, ok: datos.every((d) => d.ok), datos };
}





async function comprobarBridge(): Promise<unknown> {
  const estado = estadoBridge();

  if (!estado.activo) {
    return {
      success: false,
      conectado: false,
      bridge: estado.url,
      error:
        `El bridge de Packet Tracer de este servidor MCP no está escuchando en ${estado.url}. ` +
        "Suele significar que MCP_BRIDGE_ENABLED está a false o que el puerto ya estaba ocupado al arrancar; " +
        `cambia MCP_BRIDGE_PORT (por defecto ${envConfig.MCP_BRIDGE_PORT}) o libera el puerto y reinicia el servidor MCP.`,
    };
  }

  if (!estado.extensionConectada) {
    return {
      success: false,
      conectado: false,
      bridge: estado.url,
      error:
        `El bridge del servidor MCP escucha en ${estado.url} pero la extensión de Packet Tracer no se ha conectado. ` +
        "Abre Packet Tracer con la extensión cargada y apunta su configuración a ese mismo host y puerto " +
        "(si tiene PT_EXTENSION_SECRET, debe ser el mismo en ambos lados).",
    };
  }

  const red = (await llamarPacketTracer("getNetwork", {}, { timeoutMs: 15_000 })) as Record<
    string,
    unknown
  >;
  if (!operacionOk(red)) {
    return {
      success: false,
      conectado: false,
      bridge: estado.url,
      error:
        `La extensión respondió pero Packet Tracer no dio la topología: ${String(red?.error ?? "sin detalle")}. ` +
        "Comprueba que Packet Tracer está abierto con un workspace cargado y que la extensión no tiene un " +
        "diálogo modal bloqueando la operación.",
    };
  }

  const resultado = (red?.result ?? {}) as Record<string, unknown>;
  return {
    success: true,
    conectado: true,
    bridge: estado.url,
    extension: estado.socketExtension,
    dispositivos: resultado.deviceCount ?? 0,
    enlaces: resultado.connectionCount ?? 0,
  };
}


herramientas.push(
  definirTool({
    name: "packet_tracer_connection_status",
    description:
      "Comprueba el puente de Packet Tracer que aloja este servidor MCP y devuelve si la extensión está conectada, " +
      "más cuántos dispositivos y enlaces hay. Úsala al empezar a trabajar o cuando una herramienta falle, para " +
      "distinguir 'el puente del MCP no está escuchando' / 'la extensión no está conectada' de 'el comando salió mal'. " +
      "No hace falta ningún otro servicio (como el backend de Packet Tools) para que funcione.",
    inputSchema: {},
    handler: async () => comprobarBridge(),
  }),
);

Logger.debug(`Dominio packet-tracer: ${herramientas.length} herramientas preparadas.`);

export const moduloPacketTracer: ModuloDominio = {
  id: "packet-tracer",
  prefix: "packet_tracer_",
  description:
    "Cisco Packet Tracer: crear topologías (dispositivos, enlaces, módulos), configurar equipos IOS por CLI, simular tráfico y exportar/importar workspaces.",
  tools: herramientas,
};
