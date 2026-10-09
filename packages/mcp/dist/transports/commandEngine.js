"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERFILES_VENDOR = void 0;
exports.detectarVendorPorPrompt = detectarVendorPorPrompt;
exports.resolverVendor = resolverVendor;
exports.detectarPrompt = detectarPrompt;
exports.sanearSalida = sanearSalida;
exports.recortarSalida = recortarSalida;
exports.ejecutarComandos = ejecutarComandos;
exports.notaVendorConservador = notaVendorConservador;
const EnvConfig_1 = require("../config/EnvConfig.js");
const Logger_1 = require("../utils/Logger.js");
const PROMPT_MAX_CHARS = 120;
function limpiar(linea) {
    return String(linea ?? "")
        .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
        .replace(/\r/g, "")
        .trim();
}
function parecePrompt(linea) {
    const texto = limpiar(linea);
    return texto.length > 0 && texto.length <= PROMPT_MAX_CHARS;
}
const CISCO = {
    id: "cisco",
    label: "Cisco IOS",
    esSubModo: (linea) => /\)#$/.test(limpiar(linea)),
    esPrompt: (linea) => {
        const texto = limpiar(linea);
        return parecePrompt(texto) && /[#>]\s*$/.test(texto);
    },
    transiciones: {
        aUsuario: "disable",
        aPrivilegiado: "enable",
        aConfig: "configure terminal",
        guardarConfig: "write memory",
        salirDeConfig: "exit",
    },
    preambulo: { sinPaginacion: "terminal length 0" },
    paginador: [/--More--/, /\(END\)/],
};
const HUAWEI_VISTA = /^\[[^\]]*\]\s*$/;
const HUAWEI = {
    id: "huawei",
    label: "Huawei VRP",
    esSubModo: (linea) => /^\[[^\]]*[-/][^\]]*\]\s*$/.test(limpiar(linea)),
    esPrompt: (linea) => {
        const texto = limpiar(linea);
        if (!parecePrompt(texto))
            return false;
        return HUAWEI_VISTA.test(texto) || /^<[^<>]+>\s*$/.test(texto);
    },
    transiciones: {
        aUsuario: "quit",
        aPrivilegiado: null,
        aConfig: "system-view",
        guardarConfig: "save",
        salirDeConfig: "quit",
    },
    preambulo: { sinPaginacion: "screen-length 0 temporary" },
    paginador: [/----\s*More\s*----/, /\(END\)/],
};
const MIKROTIK_RAIZ = /^\[[^\]]*@[^\]]*\]\s*[>\/]?\s*$/;
const MIKROTIK_MENU = /^\[[^\]]*@[^\]]*\]\s*\/\S+/;
const MIKROTIK_RUTA_MENU = /^\[[^\]]*@[^\]]*\]\s*\/\S[^>]*>\s*$/;
const MIKROTIK = {
    id: "mikrotik",
    label: "MikroTik RouterOS",
    esSubModo: (linea) => MIKROTIK_MENU.test(limpiar(linea)),
    esPrompt: (linea) => {
        const texto = limpiar(linea);
        return parecePrompt(texto) && (MIKROTIK_RAIZ.test(texto) || MIKROTIK_MENU.test(texto));
    },
    transiciones: {
        aUsuario: "/exit",
        aPrivilegiado: null,
        aConfig: null,
        guardarConfig: null,
        salirDeConfig: "..",
    },
    preambulo: { sinPaginacion: null },
    paginador: [/\[Q\s*\|\s*quit\]/, /\(END\)/],
};
const ARUBA_PROMPT = /^\([^()]*\)(\s+\([^()]*\))*\s*[#>]\s*$/;
const ARUBA = {
    id: "aruba",
    label: "ArubaOS",
    esSubModo: (linea) => {
        const texto = limpiar(linea);
        if (!ARUBA_PROMPT.test(texto))
            return false;
        const grupos = texto.match(/\([^()]*\)/g) ?? [];
        return grupos.length >= 2 || /\(\s*config[^()]*\)/i.test(texto);
    },
    esPrompt: (linea) => {
        const texto = limpiar(linea);
        return parecePrompt(texto) && ARUBA_PROMPT.test(texto);
    },
    transiciones: {
        aUsuario: "exit",
        aPrivilegiado: "enable",
        aConfig: "configure terminal",
        guardarConfig: null,
        salirDeConfig: "exit",
    },
    preambulo: { sinPaginacion: null },
    paginador: [/--More--/, /\(END\)/],
};
const JUNOS_PROMPT = /^\S+@\S+[>#]\s*$/;
const JUNOS_HOST_PROMPT = /^\S+@\S*[A-Za-z0-9][>#]\s*$/;
const JUNOS_SUBMODO = /^\s*\[(?:edit|configure|top)[^\]]*\]\s*$/;
const JUNOS = {
    id: "junos",
    label: "Juniper JunOS",
    esSubModo: (linea) => JUNOS_SUBMODO.test(limpiar(linea)),
    esPrompt: (linea) => {
        const texto = limpiar(linea);
        return parecePrompt(texto) && JUNOS_PROMPT.test(texto);
    },
    transiciones: {
        aUsuario: "exit",
        aPrivilegiado: null,
        aConfig: "configure",
        guardarConfig: "commit",
        salirDeConfig: "exit",
    },
    preambulo: { sinPaginacion: "set cli screen-length 0" },
    paginador: [/--More--/, /-{2,}\s*\(\s*more\s*\)\s*-{2,}/, /\(END\)/],
};
const GENERICO_PROMPT = /[#>]\s*$/;
const GENERICO_PROMPT_ANIDADO = /\([^()]*\)\s*[#>]\s*$|^\s*\[[^\]]+\]\s*$/;
const CONSERVADOR = {
    id: "conservative",
    label: "Genérico (fabricante no identificado)",
    esSubModo: (linea) => {
        const texto = limpiar(linea);
        if (!parecePrompt(texto))
            return false;
        if (/^\[[^\]]*@[^\]]*\]\s*\/\S+/.test(texto))
            return true;
        if (/^\[(?!.*@)[^\]]+\]\s*[>#]?\s*$/.test(texto))
            return true;
        return false;
    },
    esPrompt: (linea) => {
        const texto = limpiar(linea);
        if (!parecePrompt(texto))
            return false;
        if (/^\[[^\]]*@[^\]]*\]\s*\/\S+/.test(texto))
            return true;
        if (/[#>\]]$/.test(texto))
            return true;
        const ultimo = texto.split(/\s+/).pop() ?? "";
        return /[$%>]$/.test(ultimo);
    },
    transiciones: {
        aUsuario: null,
        aPrivilegiado: null,
        aConfig: null,
        guardarConfig: null,
        salirDeConfig: null,
    },
    preambulo: { sinPaginacion: null },
    paginador: [/--More--/, /----\s*More\s*----/, /\(END\)/],
};
exports.PERFILES_VENDOR = {
    cisco: CISCO,
    huawei: HUAWEI,
    mikrotik: MIKROTIK,
    aruba: ARUBA,
    junos: JUNOS,
    conservative: CONSERVADOR,
};
function detectarVendorPorPrompt(prompt) {
    const texto = limpiar(prompt);
    if (!parecePrompt(texto))
        return null;
    if (MIKROTIK_RAIZ.test(texto) || MIKROTIK_MENU.test(texto))
        return "mikrotik";
    if (JUNOS_SUBMODO.test(texto) || JUNOS_HOST_PROMPT.test(texto))
        return "junos";
    if (HUAWEI_VISTA.test(texto) || /^<[^<>]+>\s*$/.test(texto))
        return "huawei";
    if (ARUBA_PROMPT.test(texto))
        return "aruba";
    if (/\(config[^)]*\)#\s*$/.test(texto))
        return "cisco";
    return null;
}
function resolverVendor(input) {
    const declarado = String(input.typeDevice ?? "").trim().toUpperCase();
    if (declarado === "CISCO" ||
        declarado === "HUAWEI" ||
        declarado === "ARUBA" ||
        declarado === "MIKROTIK" ||
        declarado === "JUNOS") {
        return exports.PERFILES_VENDOR[declarado.toLowerCase()];
    }
    const detectado = detectarVendorPorPrompt(input.prompt);
    return detectado ? exports.PERFILES_VENDOR[detectado] : CONSERVADOR;
}
const COMANDOS_DE_CIERRE = /^(exit|quit|logout|disconnect|close)$/i;
function detectarPrompt(salida, esPrompt) {
    const lineas = String(salida ?? "").split(/\r?\n/);
    for (let i = lineas.length - 1; i >= 0; i--) {
        const linea = limpiar(lineas[i]);
        if (!linea)
            continue;
        return esPrompt(linea) ? linea : null;
    }
    return null;
}
function sanearSalida(texto) {
    return String(texto ?? "")
        .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
        .replace(/\x1b\][^\x07]*\x07/g, "")
        .replace(/[^\n]\x08/g, "")
        .replace(/\r(?!\n)/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
function recortarSalida(texto) {
    const maximo = EnvConfig_1.envConfig.MCP_MAX_OUTPUT_CHARS;
    if (texto.length <= maximo)
        return texto;
    return `${texto.slice(0, maximo)}\n\n[...salida recortada: ${texto.length - maximo} caracteres omitidos. Usa un comando más específico para ver el resto.]`;
}
async function ejecutarComandos(transporte, comandos, contexto, opciones = {}) {
    const inicio = Date.now();
    const idleMs = opciones.idleMs ?? EnvConfig_1.envConfig.MCP_TERMINAL_IDLE_MS;
    const maxMs = opciones.maxMs ?? EnvConfig_1.envConfig.MCP_TERMINAL_MAX_MS;
    await transporte.connect();
    const salidaInicial = await transporte.readOutput({ idleMs: 300, maxMs: 3000 });
    let perfil = opciones.vendorIdForzado
        ? exports.PERFILES_VENDOR[opciones.vendorIdForzado] ?? CONSERVADOR
        : resolverVendor({ typeDevice: contexto.typeDevice, prompt: salidaInicial });
    const promptInicial = detectarPrompt(salidaInicial, perfil.esPrompt);
    let vendorDetectadoEnEstaLlamada = !opciones.vendorIdForzado && Boolean(promptInicial);
    if (!opciones.vendorIdForzado && perfil.id === "conservative" && !promptInicial) {
        const segundaLectura = await transporte.readOutput({ idleMs: 500, maxMs: 4000 });
        const promptTardio = detectarPrompt(segundaLectura, (l) => /[#>\]$]/.test(l));
        if (promptTardio) {
            perfil = resolverVendor({ typeDevice: contexto.typeDevice, prompt: promptTardio });
            vendorDetectadoEnEstaLlamada = perfil.id !== "conservative";
        }
    }
    Logger_1.Logger.debug(`Transporte ${transporte.protocol}: fabricante resuelto como '${perfil.id}' (${perfil.label}).`);
    const salidas = [];
    if (!opciones.sinPreambulo && perfil.preambulo.sinPaginacion) {
        try {
            await transporte.sendCommand(perfil.preambulo.sinPaginacion);
            await transporte.readOutput({ idleMs, maxMs: 5000 });
        }
        catch (error) {
            Logger_1.Logger.debug(`El preámbulo '${perfil.preambulo.sinPaginacion}' falló: ${String(error)}`);
        }
    }
    const descartados = [];
    for (const crudo of comandos) {
        for (const linea of String(crudo).split(/\r?\n/)) {
            const comando = linea.trim();
            if (!comando)
                continue;
            if (COMANDOS_DE_CIERRE.test(comando)) {
                descartados.push(comando);
                continue;
            }
            await transporte.sendCommand(comando);
            const salida = await transporte.readOutput({ idleMs, maxMs });
            salidas.push(`$ ${comando}\n${sanearSalida(salida)}`.trim());
        }
    }
    const salidaFinal = await transporte.readOutput({ idleMs: 200, maxMs: 2000 });
    const promptFinal = detectarPrompt(salidaFinal, perfil.esPrompt) ?? promptInicial;
    const avisos = [];
    if (descartados.length > 0) {
        avisos.push(`Se descartaron ${descartados.length} comando(s) de cierre de sesión (${descartados.join(", ")}): ` +
            `cerrar la consola dejaría fuera al usuario.`);
    }
    const output = [
        salidas.join("\n\n"),
        avisos.length > 0 ? `\nAVISO: ${avisos.join(" ")}` : "",
    ]
        .filter(Boolean)
        .join("");
    return {
        output: recortarSalida(output),
        prompt: promptFinal,
        vendorId: perfil.id,
        vendorLabel: perfil.label,
        vendorDetectado: vendorDetectadoEnEstaLlamada,
        duracionMs: Date.now() - inicio,
    };
}
function notaVendorConservador(resultado) {
    if (resultado.vendorId !== "conservative")
        return "";
    return ("\n\nNOTA: no se pudo identificar el fabricante del equipo por su prompt, así que se usó el perfil genérico. " +
        "Significa que se enviaron los comandos tal cual, SIN preámbulo (paginación) y SIN transiciones de modo. " +
        "Si conoces la marca, indícala en 'typeDevice' al configurar el dispositivo para que se use su sintaxis.");
}
//# sourceMappingURL=commandEngine.js.map