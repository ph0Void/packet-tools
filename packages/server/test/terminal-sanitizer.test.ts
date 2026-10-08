

import { describe, expect, it } from "vitest";
import { sanitizarConsola } from "@/utils/TerminalSanitizer";


const PROMPT = "\x1b[36m[admin@MikroTik] >\x1b[0m";

describe("sanitizarConsola", () => {
  it("elimina secuencias ANSI de color y borrado de línea (\\x1b[K)", () => {
    const raw = `${PROMPT}\x1b[K\r\n\x1b[36mshow system resource\x1b[0m\r\n`;
    const limpio = sanitizarConsola(raw, { maxLines: 10, maxChars: 4000 });

    expect(limpio).not.toContain("\x1b");
    expect(limpio).toContain("show system resource");
  });

  it("resuelve los redibujos con \\r quedándose con el último segmento", () => {
    const raw = `${PROMPT} /s\r${PROMPT} /sy\r${PROMPT} /system\r${PROMPT} /system jh\r\n`;
    const limpio = sanitizarConsola(raw, { maxLines: 10, maxChars: 4000 });

    expect(limpio).toBe("[admin@MikroTik] > /system jh");
  });

  it("aplica backspaces como borrado del carácter anterior", () => {
    const limpio = sanitizarConsola("aabbcc\b\bcc\n", {
      maxLines: 5,
      maxChars: 100,
    });
    expect(limpio).toBe("aabbcc");
  });

  it("colapsa la escalera de eco tecla a tecla (/system j → /system jh)", () => {
    const raw = "/system j\n/system jh\n";
    const limpio = sanitizarConsola(raw, { maxLines: 10, maxChars: 1000 });

    expect(limpio).toBe("/system jh");
  });

  it("elimina OSC de título de ventana", () => {
    const limpio = sanitizarConsola("\x1b]0;admin@MikroTik\x07R1# \n", {
      maxLines: 5,
      maxChars: 100,
    });
    expect(limpio).toBe("R1#");
  });

  it("conserva limpio el bloque de TAB con los comandos de MikroTik", () => {
    const blockTab = [
      "\x1b[36m[admin@MikroTik] >\x1b[0m /system ",
      "\x1b[36m  accounting    backup       boot         disable      reboot      ",
      "  run         system       license      scheduler   ",
    ].join("\r\n");
    const limpio = sanitizarConsola(blockTab, { maxLines: 10, maxChars: 4000 });

    expect(limpio).toContain("accounting");
    expect(limpio).toContain("scheduler");
    expect(limpio).not.toContain("\x1b");
  });

  it("descarta líneas consecutivas duplicadas (keepalive/prompt repetido)", () => {
    const limpio = sanitizarConsola("R1#\nR1#\nR1#\nshow version\n", {
      maxLines: 10,
      maxChars: 1000,
    });
    expect(limpio).toBe("R1#\nshow version");
  });

  it("recorta a las últimas N líneas lógicas", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `linea-${i + 1}`);
    const limpio = sanitizarConsola(lines.join("\n"), {
      maxLines: 5,
      maxChars: 4000,
    });

    expect(limpio.split("\n")).toHaveLength(5);
    expect(limpio).toContain("linea-20");
    expect(limpio).not.toContain("linea-15");
  });

  it("aplica el tope duro de caracteres conservando el final", () => {
    const raw = "x".repeat(100) + "\n" + "y".repeat(100);
    const limpio = sanitizarConsola(raw, { maxLines: 10, maxChars: 120 });

    expect(limpio.length).toBeLessThanOrEqual(120);
    expect(limpio.endsWith("y".repeat(100))).toBe(true);
  });

  it("maxLineas 0 devuelve cadena vacía", () => {
    expect(
      sanitizarConsola("cualquier cosa\n", { maxLines: 0, maxChars: 4000 }),
    ).toBe("");
  });

  it("salida realista completa: eco escalera + colores + redibujo + TAB", () => {
    const raw = [
      `\x1b]0;admin@MikroTik\x07`,
      `${PROMPT} /s\r${PROMPT} /sy\r${PROMPT} /system\r${PROMPT} /system j\r${PROMPT} /system jh\r`,
      `${PROMPT} /system j`,
      `${PROMPT} /system jh`,
      `${PROMPT} `,
      `\x1b[36m  accounting    backup       boot         disable      reboot\x1b[0m`,
      `${PROMPT} `,
    ].join("\r\n");

    const limpio = sanitizarConsola(raw, { maxLines: 10, maxChars: 4000 });

    expect(limpio).not.toContain("\x1b");
    expect(limpio).not.toContain("\r");
    expect(limpio).not.toContain("/system j\n");
    expect(limpio).toContain("/system jh");
    expect(limpio).toContain("accounting");
  });
});
