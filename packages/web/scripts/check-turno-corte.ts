import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  anexarAvisoCorte,
  anexarAvisoCorteSegmento,
  AVISO_PRESUPUESTO,
  AVISO_TURNO_CANCELADO,
  AVISO_TURNO_ERROR,
  conciliarReintento,
  detectarAvisoCorte,
  esErrorDeAbort,
  esIdDeMensajePersistido,
  esReintentable,
  finalDesdeMotivo,
  hayCorteEnCola,
  marcarCorteEnCola,
  mensajeUsuarioReintentable,
  peticionPrecedente,
  quitarAvisoCorte,
  resolverParcialTrasRefresco,
  textoDeSegmentos,
  ultimoMensajeUsuario,
  yaHayAvisoDeCorte,
  type MotivoCorte,
} from "../src/component/chat/turnoCorte";

let failures = 0;
let total = 0;

function check(name: string, condition: boolean, detail?: string): void {
  total += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const RESPONSE =
  "He configurado la interfaz y aplicado el OSPF en R1.\n\nFalta verificar la convergencia.";

section("detectarAvisoCorte · aviso de presupuesto (espejo del backend)");

check(
  "reconoce el aviso de presupuesto solo",
  detectarAvisoCorte(AVISO_PRESUPUESTO)?.motivo === "presupuesto",
);
check(
  "reconoce el aviso de presupuesto tras texto",
  detectarAvisoCorte(`${RESPONSE}\n\n${AVISO_PRESUPUESTO}`)?.motivo ===
    "presupuesto",
);
check(
  "tolera espacios en blanco al final",
  detectarAvisoCorte(`${RESPONSE}\n\n${AVISO_PRESUPUESTO}\n\n`)?.motivo ===
    "presupuesto",
);
check(
  "devuelve el bloque de cita tal cual",
  detectarAvisoCorte(`${RESPONSE}\n\n${AVISO_PRESUPUESTO}`)?.aviso ===
    AVISO_PRESUPUESTO,
);

section("detectarAvisoCorte · turno incompleto (cancelado o fallido)");

check(
  "el aviso de cancelación se atribuye al usuario",
  detectarAvisoCorte(AVISO_TURNO_CANCELADO)?.motivo === "cancelado",
  detectarAvisoCorte(AVISO_TURNO_CANCELADO)?.motivo,
);
check(
  "el aviso de error se atribuye a un fallo",
  detectarAvisoCorte(AVISO_TURNO_ERROR)?.motivo === "error",
  detectarAvisoCorte(AVISO_TURNO_ERROR)?.motivo,
);
check(
  "se reconoce tras texto del agente",
  detectarAvisoCorte(`${RESPONSE}\n\n${AVISO_TURNO_CANCELADO}`)?.motivo ===
    "cancelado",
);
check(
  "una redacción sin acentos (quedo incompleta) también se reconoce",
  detectarAvisoCorte("> Turno cancelado: la respuesta quedo incompleta.")
    ?.motivo === "cancelado",
);
check(
  "sin poder atribuir el motivo degrada a incompleto (reintentable igual)",
  detectarAvisoCorte("> La respuesta quedó interrumpida a mitad.")?.motivo ===
    "incompleto",
);
check(
  "acepta un bloque de cita de varias líneas",
  detectarAvisoCorte(
    `${RESPONSE}\n\n> Turno cancelado.\n> La respuesta quedó incompleta.`,
  )?.motivo === "cancelado",
);

section("detectarAvisoCorte · falsos positivos");

check(
  "una respuesta completa no se marca",
  detectarAvisoCorte(RESPONSE) === null,
);
check(
  "una cita cualquiera al final no es un aviso de corte",
  detectarAvisoCorte(`${RESPONSE}\n\n> Nota: revisa el manual.`) === null,
);
check(
  "un aviso citado en medio del texto no marca la respuesta",
  detectarAvisoCorte(`${AVISO_PRESUPUESTO}\n\n${RESPONSE}`) === null,
);
check("el contenido vacío no se marca", detectarAvisoCorte("") === null);
check(
  "sin argumento no se marca",
  detectarAvisoCorte(null as unknown as string) === null,
);

section("quitarAvisoCorte");

const withNotice = `${RESPONSE}\n\n${AVISO_TURNO_CANCELADO}`;
check(
  "deja la respuesta intacta",
  quitarAvisoCorte(withNotice) === RESPONSE,
  JSON.stringify(quitarAvisoCorte(withNotice)),
);
check(
  "es idempotente",
  quitarAvisoCorte(quitarAvisoCorte(withNotice)) === RESPONSE,
);
check(
  "no toca una respuesta sin aviso",
  quitarAvisoCorte(RESPONSE) === RESPONSE,
);
check(
  "no borra una cita que no es de corte",
  quitarAvisoCorte(`${RESPONSE}\n\n> Nota: revisa el manual.`) ===
    `${RESPONSE}\n\n> Nota: revisa el manual.`,
);
check("contenido vacío devuelve vacío", quitarAvisoCorte("") === "");

section("anexarAvisoCorte (lo que el cliente anexa al parcial local)");

check(
  "anexa el aviso del motivo",
  anexarAvisoCorte(RESPONSE, "cancelado") ===
    `${RESPONSE}\n\n${AVISO_TURNO_CANCELADO}`,
);
check(
  "es idempotente con el mismo motivo",
  anexarAvisoCorte(anexarAvisoCorte(RESPONSE, "cancelado"), "cancelado") ===
    `${RESPONSE}\n\n${AVISO_TURNO_CANCELADO}`,
);
check(
  "no duplica un aviso de otro motivo",
  anexarAvisoCorte(`${RESPONSE}\n\n${AVISO_PRESUPUESTO}`, "error") ===
    `${RESPONSE}\n\n${AVISO_PRESUPUESTO}`,
);
check(
  "un mensaje nunca lleva dos avisos",
  anexarAvisoCorte(anexarAvisoCorte(RESPONSE, "cancelado"), "error") ===
    `${RESPONSE}\n\n${AVISO_TURNO_CANCELADO}`,
);
check(
  "el aviso de error es el del backend",
  anexarAvisoCorte(RESPONSE, "error") ===
    `${RESPONSE}\n\n${AVISO_TURNO_ERROR}`,
);
check(
  "el aviso elegido depende del motivo",
  anexarAvisoCorte("", "presupuesto") === AVISO_PRESUPUESTO,
);
check(
  "con presupuesto agotado se anexa su aviso",
  anexarAvisoCorte("texto", "presupuesto") === `texto\n\n${AVISO_PRESUPUESTO}`,
);

section("yaHayAvisoDeCorte (un mensaje nunca lleva dos avisos)");

check("una respuesta normal no tiene aviso", !yaHayAvisoDeCorte(RESPONSE));
check(
  "el aviso de presupuesto se reconoce",
  yaHayAvisoDeCorte(`${RESPONSE}\n\n${AVISO_PRESUPUESTO}`),
);
check(
  "el aviso de cancelación se reconoce",
  yaHayAvisoDeCorte(AVISO_TURNO_CANCELADO),
);
check(
  "una cita que no es de aviso no cuenta",
  !yaHayAvisoDeCorte(`${RESPONSE}\n\n> Nota: revisa el manual.`),
);

section("anexarAvisoCorteSegmento (espejo del backend)");

const textSegs = [
  { kind: "text", text: "Primero" },
  { kind: "text", text: "Segundo" },
];
anexarAvisoCorteSegmento(textSegs, "cancelado");
check(
  "anexa al último segmento de texto",
  textSegs[1].text === `Segundo\n\n${AVISO_TURNO_CANCELADO}`,
  JSON.stringify(textSegs),
);
check(
  "la concatenación sigue coincidiendo con content",
  textSegs.map((seg) => seg.text ?? "").join("") ===
    `Primero${anexarAvisoCorte("Segundo", "cancelado")}`,
);
anexarAvisoCorteSegmento(textSegs, "error");
check("no vuelve a anexar", textSegs.length === 2);

const toolSegs = [
  { kind: "text", text: "Antes" },
  { kind: "tool" },
];
anexarAvisoCorteSegmento(toolSegs, "presupuesto");
check(
  "si el turno terminó en tool, añade un segmento de texto nuevo",
  toolSegs.length === 3 &&
    toolSegs[2].kind === "text" &&
    toolSegs[2].text === AVISO_PRESUPUESTO,
  JSON.stringify(toolSegs),
);

check(
  "textoDeSegmentos solo junta los de texto",
  textoDeSegmentos([
    { kind: "text", text: "Uno" },
    { kind: "tool" },
    { kind: "text", text: "Dos" },
  ]) === "Uno\n\nDos",
);
check("textoDeSegmentos de una lista vacía", textoDeSegmentos([]) === "");

section("finales de turno");

check("sin corte, completo", finalDesdeMotivo(null) === "completo");
check(
  "cancelación, cancelado",
  finalDesdeMotivo("cancelado") === "cancelado",
);
check(
  "presupuesto, errorado",
  finalDesdeMotivo("presupuesto") === "erroreado",
);
check("error, errorado", finalDesdeMotivo("error") === "erroreado");

section("esReintentable (Reintentar nunca en presupuesto)");

check("cancelado es reintentable", esReintentable("cancelado"));
check("error es reintentable", esReintentable("error"));
check(
  "incompleto (tras recargar) es reintentable",
  esReintentable("incompleto"),
);
check(
  "presupuesto NO es reintentable (ahi es Continuar tarea)",
  !esReintentable("presupuesto"),
);
check(
  "un turno completo (o un fallo de red) no ofrece reintento",
  !esReintentable(null),
);

section("marcarCorteEnCola");

type Msg = { id: string; role: string; turnoCorte?: MotivoCorte };
const queue: Msg[] = [
  { id: "u1", role: "user" },
  { id: "a1", role: "assistant", turnoCorte: "presupuesto" },
  { id: "u2", role: "user" },
  { id: "a2", role: "assistant" },
];
const marked = marcarCorteEnCola(queue, "cancelado");
check("marca la última respuesta", marked[3].turnoCorte === "cancelado");
check(
  "no toca el resto",
  marked.slice(0, 3).every((msg, index) => msg === queue[index]),
);
check("no muta el array original", queue[3].turnoCorte === undefined);
check(
  "re-marcar con el mismo motivo devuelve el mismo array (sin re-render)",
  marcarCorteEnCola(marked, "cancelado") === marked,
);
check(
  "si el corte cambia de motivo, se actualiza",
  marcarCorteEnCola(marked, "error")[3].turnoCorte === "error",
);
const userQueue: Msg[] = [{ id: "u1", role: "user" }];
check(
  "si la cola es un mensaje del usuario, no marca nada",
  marcarCorteEnCola(userQueue, "cancelado") === userQueue,
);
check("lista vacía", marcarCorteEnCola([], "error").length === 0);
check("detecta el corte de la cola", hayCorteEnCola(marked));
check("una cola sin corte", !hayCorteEnCola(queue));

section("resolverParcialTrasRefresco (carrera del corte con el refresco)");

const partial: Msg = { id: "local-1", role: "assistant", turnoCorte: "cancelado" };
const alreadyPersisted: Msg[] = [
  { id: "u1", role: "user" },
  { id: "a1", role: "assistant" },
];
const withBackendRecord = resolverParcialTrasRefresco(
  alreadyPersisted,
  partial,
  "cancelado",
);
check(
  "si el backend ya persistió la cola, se usa su registro (no se duplica)",
  withBackendRecord.length === 2 &&
    withBackendRecord[1].id === "a1" &&
    withBackendRecord[1].turnoCorte === "cancelado",
  JSON.stringify(withBackendRecord),
);
const userOnly: Msg[] = [{ id: "u1", role: "user" }];
const withPartial = resolverParcialTrasRefresco(userOnly, partial, "cancelado");
check(
  "si el refresco llega antes de que el backend persista, se conserva el parcial local",
  withPartial.length === 2 && withPartial[1].id === "local-1",
  JSON.stringify(withPartial),
);
check(
  "sin parcial local no se inventa nada",
  resolverParcialTrasRefresco(userOnly, null, "cancelado").length === 1,
);
check(
  "el parcial añadido queda marcado",
  resolverParcialTrasRefresco(userOnly, { id: "l", role: "assistant" }, "error")[1]
    .turnoCorte === "error",
);

section("peticionPrecedente / ultimoMensajeUsuario");

const messages = [
  { id: "u1", role: "user", content: "configura R1" },
  { id: "a1", role: "assistant", content: "hecho" },
  { id: "u2", role: "user", content: "verifica OSPF" },
  { id: "a2", role: "assistant", content: "parcial" },
];
check(
  "el reintento relanza la petición que precedió al corte",
  peticionPrecedente(messages, "a2")?.content === "verifica OSPF",
);
check(
  "también funciona con un corte antiguo del historial",
  peticionPrecedente(messages, "a1")?.content === "configura R1",
);
check(
  "sin petición previa devuelve null",
  peticionPrecedente([{ id: "a1", role: "assistant", content: "x" }], "a1") ===
    null,
);
check(
  "un id inexistente devuelve null",
  peticionPrecedente(messages, "nope") === null,
);
check(
  "el último mensaje del usuario es el reenviable por defecto",
  ultimoMensajeUsuario(messages)?.id === "u2",
);
check("sin mensajes de usuario", ultimoMensajeUsuario([]) === null);

section("esIdDeMensajePersistido (el endpoint de reintento busca en la base)");

check(
  "un id de la base sirve para reintentar",
  esIdDeMensajePersistido("cld123abc"),
);
check(
  "el parcial local NO sirve (no existe en la base: el backend daría 404)",
  !esIdDeMensajePersistido("local-parcial-1730000000000"),
);
check(
  "el assistant local de un `complete` sin id tampoco",
  !esIdDeMensajePersistido("local-1730000000000"),
);
check("un id vacío no", !esIdDeMensajePersistido(""));
check("undefined no", !esIdDeMensajePersistido(undefined));
check("null no", !esIdDeMensajePersistido(null));

section("mensajeUsuarioReintentable (el reintento va sobre el mensaje de USUARIO)");

check(
  "el reintento apunta al mensaje de usuario, no al assistant cortado",
  mensajeUsuarioReintentable(messages, "a2")?.id === "u2",
  mensajeUsuarioReintentable(messages, "a2")?.id,
);
check(
  "funciona también con un corte antiguo del historial",
  mensajeUsuarioReintentable(messages, "a1")?.id === "u1",
);
check(
  "con un mensaje de usuario local NO hay reintento real (se cae al reenvío)",
  mensajeUsuarioReintentable(
    [
      { id: "local-parcial-1", role: "user", content: "configura R1" },
      { id: "a1", role: "assistant", content: "hecho" },
    ],
    "a1",
  ) === null,
);
check(
  "sin petición previa no hay reintento real",
  mensajeUsuarioReintentable([{ id: "a1", role: "assistant", content: "x" }], "a1") ===
    null,
);
check(
  "con un id inexistente tampoco",
  mensajeUsuarioReintentable(messages, "nope") === null,
);

section("conciliarReintento (409 YA_REINTENTADO: no se duplica nada)");

const queueWithPartial: Msg[] = [
  { id: "u1", role: "user" },
  { id: "local-parcial-1", role: "assistant", turnoCorte: "cancelado" },
];
const withResponse = conciliarReintento(queueWithPartial, "a2");
check(
  "no añade el mensaje assistant que el backend señaló (no está en la cola)",
  withResponse.mensajes.length === 1,
  JSON.stringify(withResponse.mensajes),
);
check(
  "dice que la respuesta aún no estaba en la cola (trae el refresco)",
  !withResponse.yaEsta && withResponse.cambio,
);
check(
  "el parcial local se retira: era una red de seguridad, ya no hace falta",
  withResponse.mensajes.every((msg) => msg.id !== "local-parcial-1"),
);
check(
  "sin assistantMessageId tampoco se añade nada (solo se retira el parcial local)",
  conciliarReintento(queueWithPartial, null).mensajes.length === 1,
);
const cleanQueue: Msg[] = [
  { id: "u1", role: "user" },
  { id: "a1", role: "assistant" },
];
const alreadyInQueue = conciliarReintento(cleanQueue, "a1");
check(
  "si la respuesta ya está en la cola, no se toca nada",
  alreadyInQueue.mensajes === cleanQueue && alreadyInQueue.yaEsta && !alreadyInQueue.cambio,
);
check(
  "sin assistantMessageId tampoco se toca nada (cola ya sin parciales)",
  conciliarReintento(cleanQueue, null).mensajes === cleanQueue,
  "la respuesta señalada no está en la cola pero el array no cambia",
);
check(
  "una cola vacía se concilia sin romperse",
  conciliarReintento([], "a1").mensajes.length === 0,
);

section("esErrorDeAbort");

check(
  "DOMException AbortError es cancelación",
  esErrorDeAbort(new DOMException("aborted", "AbortError")),
);
check(
  "una Error normal con name AbortError tambien",
  esErrorDeAbort(Object.assign(new Error("aborted"), { name: "AbortError" })),
);
check(
  "el codigo ABORT_ERR de undici tambien",
  esErrorDeAbort(Object.assign(new Error("aborted"), { code: "ABORT_ERR" })),
);
check(
  "el 20 heredado de DOMException tambien",
  esErrorDeAbort(Object.assign(new Error("aborted"), { code: 20 })),
);
check("una Error de red no", !esErrorDeAbort(new TypeError("fetch failed")));
check("null no", !esErrorDeAbort(null));
check("un string no", !esErrorDeAbort("AbortError"));

section("espejo del backend (continuation.ts)");

const backendPath = resolve(
  process.cwd(),
  "../server/src/api/router/continuation.ts",
);
if (!existsSync(backendPath)) {
  console.log("  skip  continuation.ts no esta a la vista (se omite el espejo)");
} else {
  const source = readFileSync(backendPath, "utf8");
  check(
    "AVISO_PRESUPUESTO coincide con el del backend",
    source.includes(AVISO_PRESUPUESTO),
  );
  check(
    "AVISO_TURNO_CANCELADO coincide con el del backend",
    source.includes(AVISO_TURNO_CANCELADO),
  );
  check(
    "AVISO_TURNO_ERROR coincide con el del backend",
    source.includes(AVISO_TURNO_ERROR),
  );
  check(
    "el backend conoce el code cancelled del evento error",
    /"cancelled"/.test(source),
  );
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} · ${total - failures}/${total} checks en verde`,
);
process.exit(failures === 0 ? 0 : 1);
