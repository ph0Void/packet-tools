import {
    limpiarAnsi,
    parseSinPrompt,
    type DiagnosticoSinPrompt,
} from "./toolOutput";

export interface EstadoConsola {

    viva: boolean;
    protocolo: string | null;
    dispositivo: string | null;

    prompt: string | null;
    sesion: string | null;

    vendor: string | null;
    sinPrompt: DiagnosticoSinPrompt | null;

    pendiente: string | null;

    lecturas: string | null;
}

const texto = (valor: unknown): string | null =>
    typeof valor === "string" && valor.trim() ? limpiarAnsi(valor).trim() : null;

export function parseEstadoConsola(valor: unknown): EstadoConsola | null {
    if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
    const o = valor as Record<string, unknown>;

    if (typeof o.alive !== "boolean") return null;

    if ("output" in o || "pasos" in o || "plan" in o || "lines" in o) return null;
    if (!("sessionId" in o || "prompt" in o || "protocol" in o)) return null;

    return {
        viva: o.alive,
        protocolo: texto(o.protocol),
        dispositivo: texto(o.deviceName),
        prompt: texto(o.prompt),
        sesion: texto(o.sessionId),
        vendor: texto(o.vendor),
        sinPrompt: parseSinPrompt(o),
        pendiente: texto(o.pendiente),
        lecturas: texto(o.lecturasCanonicas),
    };
}
