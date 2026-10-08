
import fs from "fs";
import path from "path";
import { CISCO_PACKET_TRACER_TOOLS_ADMIN } from "@/agent/ciscoPacketTracer/Tool";

export type Status = "OK" | "FALLO" | "SKIP";

export interface Result {
  status: Status;
  tool: string;
  detail: string;
}


export const results: Result[] = [];


export const NOTICE_SIM =
  "puede abrir un diálogo modal en Packet Tracer y dejar la extensión muda (habrá que reiniciar PT)";


export function simActive(): boolean {
  return process.env.PT_SIM === "1";
}


export const PHASES = [
  "topologia",
  "lecturas",
  "snapshots",
  "importacion",
  "sesion",
  "simulacion",
] as const;

export type Phase = (typeof PHASES)[number];


export function phasesRequested(): string[] {
  return (process.env.PT_FASE ?? "")
    .split(",")
    .map((f) => f.trim().toLowerCase())
    .filter((f) => f.length > 0);
}


export function hasPhasesRequested(): boolean {
  return phasesRequested().length > 0;
}


export function phaseRequested(phase: Phase): boolean {
  const requested = phasesRequested();
  return requested.length === 0 || requested.includes(phase);
}


export function onlyPhase(phase: Phase): boolean {
  const requested = phasesRequested();
  return requested.length === 1 && requested[0] === phase;
}


export function phasesDesconocidas(): string[] {
  return phasesRequested().filter((f) => !(PHASES as readonly string[]).includes(f));
}


export class ExtensionMudaError extends Error {
  constructor(tool: string) {
    super(
      `Extensión muda: 2 timeouts consecutivos (última tool: ${tool}). ` +
        "Reinicia Packet Tracer, comprueba que el backend sigue en SERVER_PORT=7531 " +
        "y vuelve a lanzar la suite.",
    );
    this.name = "ExtensionMudaError";
  }
}

const MAX_TIMEOUTS_CONSECUTIVOS = 2;
let timeoutsConsecutivos = 0;



export function isTimeout(r: any): boolean {
  return /timeout de \d+(\.\d+)?\s*s\b/i.test(String(r?.error ?? r?.message ?? ""));
}



export function desenvolver(value: any): any {
  let v = value;
  while (v && typeof v === "object" && v.code && "result" in v) v = v.result;
  return v;
}



export function list(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object" && typeof v.length === "number") {
    const out: any[] = [];
    for (let i = 0; i < v.length; i++) if (i in v) out.push(v[i]);
    return out;
  }
  return [];
}


function controlarTimeout(r: any, name: string): void {
  if (isTimeout(r)) {
    timeoutsConsecutivos += 1;
    if (timeoutsConsecutivos >= MAX_TIMEOUTS_CONSECUTIVOS) {
      timeoutsConsecutivos = 0;
      throw new ExtensionMudaError(name);
    }
    return;
  }

  timeoutsConsecutivos = 0;
}



export async function invocar(
  name: string,
  input: Record<string, unknown> = {},
): Promise<any> {
  const tool: any = CISCO_PACKET_TRACER_TOOLS_ADMIN.find(
    (t: any) => t.name === name,
  );
  if (!tool) return { error: `tool inexistente: ${name}` };

  let r: any;
  try {
    const output = await tool.invoke(input);
    if (typeof output !== "string") {
      r = desenvolver(output);
    } else {
      try {
        r = desenvolver(JSON.parse(output));
      } catch {

        r = output;
      }
    }
  } catch (e: any) {
    r = { error: String(e?.message ?? e) };
  }
  controlarTimeout(r, name);
  return r;
}


export async function vida(): Promise<boolean> {
  try {
    const r = await invocar("listDeviceModels", {});
    return !isTimeout(r) && !r?.error;
  } catch {

    return false;
  }
}



export function routeUserFunctions(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i += 1) {
    const candidata = path.resolve(dir, "extension-packetracer", "userfunctions.js");
    if (fs.existsSync(candidata)) return candidata;
    const padre = path.dirname(dir);
    if (padre === dir) break;
    dir = padre;
  }
  return path.resolve(__dirname, "../../extension-packetracer/userfunctions.js");
}


export function isoLocal(fecha: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}` +
    `T${p(fecha.getHours())}:${p(fecha.getMinutes())}:${p(fecha.getSeconds())}`
  );
}



export interface CheckBuild {
  status: Status;
  detail: string;
}

export async function comprobarBuild(): Promise<CheckBuild> {
  const route = routeUserFunctions();
  let repo = "";
  try {
    repo = isoLocal(fs.statSync(route).mtime);
  } catch {
    repo = "";
  }

  let build = "";
  try {
    const r = await invocar("listDeviceModels", {});
    build = String(r?.build ?? r?.result?.build ?? "");
  } catch {

    build = "";
  }

  if (build && repo && build === repo) {
    return { status: "OK", detail: `extensión sincronizada (build ${build})` };
  }

  const enPt = build || "desconocido";
  const enRepo = repo || "desconocido (userfunctions.js no está en el repo)";
  return {
    status: "FALLO",
    detail:
      `«EXTENSIÓN DESACTUALIZADA: Packet Tracer corre el build ${enPt} pero el ` +
      `repo tiene ${enRepo}. Regenera el .pts desde extension-packetracer/ y ` +
      `recarga/reinicia Packet Tracer antes de volver a lanzar la suite.»`,
  };
}

export function truncate(v: unknown, max = 420): string {
  const t =
    typeof v === "string" ? v : JSON.stringify(v, null, 1) ?? String(v);
  return t.length > max ? t.slice(0, max) + `… [${t.length} chars]` : t;
}


export function record(status: Status, tool: string, detail: string): void {
  results.push({ status, tool, detail });
  console.log(`[${status}] ${tool}`);
  if (status !== "OK") console.log("       " + truncate(detail));
}


export function skip(tool: string, detail: string): void {
  record("SKIP", tool, detail);
}



export async function probar(
  tool: string,
  input: Record<string, unknown>,
  validador: (r: any) => ValidacionTrial,
): Promise<any> {
  const r = await invocar(tool, input);
  let status: Status = "OK";
  let detail = "";
  try {
    const v = validador(r);
    if (v.skip) {
      status = "SKIP";
      detail = [v.skip, v.detail].filter(Boolean).join(" · ");
    } else {
      status = v.ok ? "OK" : "FALLO";
      detail = v.detail;
    }
  } catch (e: any) {
    status = "FALLO";
    detail = `validador: ${e?.message ?? e}`;
  }
  record(status, tool, detail);
  return r;
}



export async function probarSim(
  tool: string,
  input: Record<string, unknown>,
  validador: (r: any) => { ok: boolean; detail: string },
): Promise<any> {
  if (!simActive()) {
    skip(
      tool,
      `deshabilitada: requiere PT_SIM=1; además ${NOTICE_SIM}`,
    );
    return undefined;
  }
  console.log(`       aviso: ${NOTICE_SIM}`);
  return probar(tool, input, validador);
}


export function withoutFailure(r: any) {
  return {
    ok: !!r && r.success !== false && !r.error,
    detail: truncate(r),
  };
}


export function isWithoutSession(r: any): boolean {
  const t = JSON.stringify(r ?? {});
  return /sesi|contexto de usuario|no autorizado/i.test(t);
}


export function outputCommands(r: any): string {
  return list(r?.results)
    .map((x: any) => x.output ?? "")
    .join("\n");
}




export interface ValidacionTrial {
  ok: boolean;
  detail: string;
  skip?: string;
}

interface MarkerMockConsole {
  
  patron: RegExp;
  
  reason: string;
  
  explicacion: string;
}



const MARKERS_MOCKCONSOLE_SUCIA: MarkerMockConsole[] = [
  {
    patron: /initial configuration dialog/i,
    reason: "diálogo de configuración inicial",
    explicacion:
      "el equipo quedó en el diálogo de configuración inicial y el comando no llegó a ejecutarse",
  },
  {
    patron: /please answer 'yes' or 'no'/i,
    reason: "respuesta yes/no pendiente en el diálogo de configuración inicial",
    explicacion:
      "la consola sigue esperando una respuesta yes/no en el diálogo de configuración inicial y el comando no llegó a ejecutarse",
  },
  {
    patron: /press return to get started/i,
    reason: "pantalla de arranque (Press RETURN)",
    explicacion:
      "la consola está en la pantalla de arranque y el comando no llegó a ejecutarse",
  },
  {
    patron: /--more--/i,
    reason: "salida paginada sin resolver (--More--)",
    explicacion:
      "la salida se quedó paginada: falta la parte final del comando",
  },
];


function textParaInspeccion(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 1) ?? String(value);
  } catch {

    return String(value);
  }
}



export function contieneBasuraOfMockConsole(value: unknown): string | null {
  const text = textParaInspeccion(value);
  if (!text) return null;
  const marker = MARKERS_MOCKCONSOLE_SUCIA.find((m) => m.patron.test(text));
  return marker ? marker.reason : null;
}


function lineWithMarker(text: string, patron: RegExp): string {
  const bruta = text.split(/\r?\n/).find((l) => patron.test(l)) ?? "";
  return bruta
    .trim()
    .replace(/^\s*"[^"]*"\s*:\s*/, "") // en payloads: `"output": "..."`

    .replace(/^"(.*)"$/, "$1")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}


export function failureMockConsoleSucia(
  team: string,
  value: unknown,
): ValidacionTrial | null {
  const reason = contieneBasuraOfMockConsole(value);
  if (!reason) return null;
  const marker = MARKERS_MOCKCONSOLE_SUCIA.find((m) => m.reason === reason);
  const line = marker ? lineWithMarker(textParaInspeccion(value), marker.patron) : "";
  return {
    ok: false,
    detail:
      `«consola sucia en ${team}: "${line || reason}" — ` +
      `${marker?.explicacion ?? "el comando no llegó a ejecutarse"}»`,
  };
}

export async function principalesInterfaces(deviceName: string): Promise<string[]> {
  const r = await invocar("getDeviceInfo", { deviceName });
  const dev = r?.result?.device ?? r?.device ?? r?.result ?? r;
  const ints = list(dev?.interfaces);
  return ints.map((i: any) => String(i.name));
}


export async function libre(deviceName: string, prefix: RegExp): Promise<string> {
  const names = await principalesInterfaces(deviceName);
  const usados = new Set<string>();
  const network = await invocar("getNetwork");
  const net = network?.result ?? network;
  for (const c of list(net?.connections)) {
    if (c.from === deviceName) usados.add(String(c.fromInterface));
    if (c.to === deviceName) usados.add(String(c.toInterface));
  }
  const libreReal = names.find((n) => prefix.test(n) && !usados.has(n));
  return libreReal ?? "";
}

export function hasFailures(): boolean {
  return results.some((r) => r.status === "FALLO");
}


export function cuentaDevices(net: any): number {
  const d = net?.devices;
  if (Array.isArray(d)) return d.length;
  if (d && typeof d === "object" && typeof d.length === "number") return d.length;
  return -1;
}


export function summary(): { ok: number; failures: Result[]; skips: Result[] } {
  const ok = results.filter((r) => r.status === "OK").length;
  const failures = results.filter((r) => r.status === "FALLO");
  const skips = results.filter((r) => r.status === "SKIP");
  console.log("\n=== RESUMEN ===");
  console.log(`OK: ${ok}   FALLOS: ${failures.length}   SKIP: ${skips.length}`);
  for (const f of failures) {
    console.log(`  [FALLO] ${f.tool} → ${truncate(f.detail, 300)}`);
  }
  for (const s of skips) {
    console.log(`  [SKIP]  ${s.tool} → ${s.detail}`);
  }
  return { ok, failures, skips };
}
