import {
  AIMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { createMiddleware, type AgentMiddleware } from "langchain";
import { envConfig } from "@/config/EnvConfig";

interface RegistroPresupuesto {
  llamadasModelo: number;

  avisoEnviado: boolean;

  fuerzaEnviada: boolean;

  firmas: string[];
}

const VENTANA_FIRMAS = 3;

const registros = new Map<string, RegistroPresupuesto>();

let secuenciaInstancias = 0;

const MAX_REGISTROS = 512;

function nuevoRegistro(): RegistroPresupuesto {
  return { llamadasModelo: 0, avisoEnviado: false, fuerzaEnviada: false, firmas: [] };
}

function claveDe(idInstancia: number, threadId?: string): string {
  return `${idInstancia}::${threadId ?? "sin-hilo"}`;
}

function registroDe(idInstancia: number, threadId?: string): RegistroPresupuesto {
  const clave = claveDe(idInstancia, threadId);
  const existente = registros.get(clave);
  if (existente) return existente;
  while (registros.size >= MAX_REGISTROS) {
    const masAntigua = registros.keys().next().value;
    if (masAntigua === undefined) break;
    registros.delete(masAntigua);
  }
  const nuevo = nuevoRegistro();
  registros.set(clave, nuevo);
  return nuevo;
}

export function resetBudgetCounters(threadId?: string): void {
  if (!threadId) {
    registros.clear();
    return;
  }
  const sufijo = `::${threadId}`;
  for (const clave of Array.from(registros.keys())) {
    if (clave.endsWith(sufijo)) registros.delete(clave);
  }
}

const MARCA_AVISO = "[PRESUPUESTO_PASOS]";
const MARCA_FUERZA = "[PRESUPUESTO_URGENTE]";

function textoAviso(): string {
  const pct = Math.round(envConfig.AGENT_BUDGET_NUDGE_RATIO * 100);
  return `${MARCA_AVISO} Has consumido ~${pct}% del presupuesto de pasos de este turno. Termina YA: (a) resumen de lo ya hecho y (b) lista numerada de los pasos pendientes; no pidas más herramientas salvo estricta necesidad.`;
}

function textoFuerza(): string {
  const pct = Math.round(envConfig.AGENT_BUDGET_FORCE_RATIO * 100);
  return `${MARCA_FUERZA} Presupuesto de pasos al ~${pct}%: esta debe ser tu ÚLTIMA respuesta. Entrega el resumen final y la lista numerada de pasos pendientes; no llames a ninguna herramienta.`;
}

function textoDeAIMessage(mensaje: AIMessage): string {
  if (typeof mensaje.content === "string") return mensaje.content;
  if (Array.isArray(mensaje.content)) {
    return mensaje.content
      .map((bloque) =>
        typeof bloque === "string"
          ? bloque
          : typeof bloque?.text === "string"
            ? bloque.text
            : "",
      )
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function mensajePresupuestoAgotado(mensajes: BaseMessage[], limite: number): string {
  const parcial = [...mensajes]
    .reverse()
    .filter((m): m is AIMessage => AIMessage.isInstance(m))
    .map(textoDeAIMessage)
    .find((texto) => texto.trim().length > 0);
  const cabecera =
    `[PRESUPUESTO AGOTADO] Límite de ${limite} pasos de este turno alcanzado: ` +
    "no se ejecutarán más herramientas. Contesta YA con (a) un resumen de lo " +
    "ya hecho y (b) una lista numerada de los pasos que quedan pendientes.";
  return parcial ? `${cabecera}\n\nÚltima respuesta parcial:\n${parcial}` : cabecera;
}

function ordenarClaves(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenarClaves);
  if (valor && typeof valor === "object") {
    return Object.keys(valor as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acumulador, clave) => {
        acumulador[clave] = ordenarClaves((valor as Record<string, unknown>)[clave]);
        return acumulador;
      }, {});
  }
  return valor;
}

function firmaToolCall(nombre: string, args: unknown): string {
  return `${nombre}:${JSON.stringify(ordenarClaves(args))}`;
}

function registrarFirma(registro: RegistroPresupuesto, firma: string): void {
  registro.firmas.push(firma);
  while (registro.firmas.length > VENTANA_FIRMAS) registro.firmas.shift();
}

function motivoDeBloqueo(firmas: string[], firma: string): string | null {
  if (firmas.length === 0) return null;
  if (firmas[firmas.length - 1] === firma) {
    return "Llamada idéntica repetida; no vuelvas a pedir este resultado, usa el dato que ya tienes";
  }
  if (!firmas.includes(firma)) return null;
  if (new Set(firmas).size === firmas.length) return null;
  return (
    `Bucle de tool-calls detectado: has repetido esta misma llamada en los últimos ` +
    `${VENTANA_FIRMAS} pasos y no ha servido para nada. Cambia de estrategia ` +
    "(usa otro dispositivo, otra herramienta o termina) en lugar de repetirla."
  );
}

export interface AgentBudgetOptions {

  modelLimit?: number;
}

export function agentBudgetMiddleware(
  options: AgentBudgetOptions = {},
): AgentMiddleware {
  const idInstancia = ++secuenciaInstancias;
  const limiteModelo = Math.max(
    1,
    options.modelLimit ?? envConfig.AGENT_SPECIALIST_MODEL_LIMIT,
  );
  const umbralAviso = Math.max(1, Math.floor(envConfig.AGENT_BUDGET_NUDGE_RATIO * limiteModelo));
  const umbralFuerza = Math.max(
    umbralAviso + 1,
    Math.floor(envConfig.AGENT_BUDGET_FORCE_RATIO * limiteModelo),
  );

  return createMiddleware({
    name: "AgentBudget",

    beforeAgent: (state, runtime) => {
      registros.set(claveDe(idInstancia, runtime.configurable?.thread_id), nuevoRegistro());
    },

    beforeModel: {
      canJumpTo: ["end"],
      hook: (state, runtime) => {
        const registro = registroDe(idInstancia, runtime.configurable?.thread_id);
        registro.llamadasModelo += 1;
        if (registro.llamadasModelo <= limiteModelo) return;

        return {
          jumpTo: "end",
          messages: [
            new AIMessage(mensajePresupuestoAgotado(state.messages, limiteModelo)),
          ],
        };
      },
    },

    wrapModelCall: async (request, handler) => {
      const registro = registroDe(idInstancia, request.runtime?.configurable?.thread_id);
      if (!registro.avisoEnviado && registro.llamadasModelo >= umbralAviso) {
        registro.avisoEnviado = true;
      }
      if (!registro.fuerzaEnviada && registro.llamadasModelo >= umbralFuerza) {
        registro.fuerzaEnviada = true;
      }

      const base = request.systemMessage ?? new SystemMessage("");
      let systemMessage = base;
      if (registro.avisoEnviado && !base.text.includes(MARCA_AVISO)) {
        systemMessage = systemMessage.concat("\n\n" + textoAviso());
      }
      if (registro.fuerzaEnviada && !systemMessage.text.includes(MARCA_FUERZA)) {
        systemMessage = systemMessage.concat("\n\n" + textoFuerza());
      }

      if (systemMessage === base) return handler(request);
      return handler({ ...request, systemMessage });
    },

    wrapToolCall: async (request, handler) => {
      const registro = registroDe(idInstancia, request.runtime?.configurable?.thread_id);
      const firma = firmaToolCall(request.toolCall.name, request.toolCall.args);
      const corte = motivoDeBloqueo(registro.firmas, firma);
      if (corte) {

        return new ToolMessage({
          tool_call_id: request.toolCall.id ?? "",
          name: request.toolCall.name,
          status: "error",
          content: corte,
        });
      }
      registrarFirma(registro, firma);
      return handler(request);
    },

    afterAgent: (state, runtime) => {
      registros.delete(claveDe(idInstancia, runtime.configurable?.thread_id));
    },
  });
}
