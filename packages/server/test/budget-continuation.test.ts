

import { describe, expect, it } from "vitest";
import {
  AVISO_PRESUPUESTO,
  LIMITE_RESUMEN_CONTINUACION,
  anexarAvisoPresupuesto,
  anexarAvisoPresupuestoSegmento,
  codigoDeErrorStream,
  construirMensajeContinuacion,
  esPresupuestoAgotado,
  insertarSegmentoPlan,
  type PasoPlan,
} from "@/api/router/continuation";
import {
  cerrarSegmentosPendientes,
  type SegmentoStream,
} from "@/api/router/ChatsRouter";

describe("detección de presupuesto agotado", () => {
  it("reconoce lc_error_code === GRAPH_RECURSION_LIMIT", () => {
    expect(esPresupuestoAgotado({ lc_error_code: "GRAPH_RECURSION_LIMIT" })).toBe(true);
    expect(codigoDeErrorStream({ lc_error_code: "GRAPH_RECURSION_LIMIT" })).toBe(
      "budget_exhausted",
    );
  });

  it("reconoce 'recursion limit' en el mensaje (cualquier mayúsculas)", () => {
    expect(
      esPresupuestoAgotado(
        new Error("GraphRecursionError: Recursion limit of 15 reached"),
      ),
    ).toBe(true);
    expect(codigoDeErrorStream(new Error("recursion limit alcanzado"))).toBe(
      "budget_exhausted",
    );
  });

  it("sigue la cadena de causas del error", () => {
    const envuelto = {
      message: "fallo genérico del stream",
      cause: new Error("Recursion limit of 15 reached"),
    };
    expect(esPresupuestoAgotado(envuelto)).toBe(true);
  });

  it("otros errores no son budget_exhausted (código aditivo 'agent_error')", () => {
    expect(esPresupuestoAgotado(new Error("API Key inválida (401)"))).toBe(false);
    expect(codigoDeErrorStream(new Error("API Key inválida (401)"))).toBe("agent_error");
    expect(esPresupuestoAgotado(null)).toBe(false);
    expect(esPresupuestoAgotado(undefined)).toBe(false);
    expect(esPresupuestoAgotado({})).toBe(false);
    expect(esPresupuestoAgotado("texto sin relación")).toBe(false);
  });
});

describe("aviso durable de presupuesto agotado", () => {
  it("anexa el aviso al final con un doble salto de línea", () => {
    expect(anexarAvisoPresupuesto("Respuesta parcial")).toBe(
      `Respuesta parcial\n\n${AVISO_PRESUPUESTO}`,
    );
  });

  it("recorta los espacios finales para no dejar líneas colgando", () => {
    expect(anexarAvisoPresupuesto("Respuesta parcial  \n")).toBe(
      `Respuesta parcial\n\n${AVISO_PRESUPUESTO}`,
    );
  });

  it("es idempotente: no duplica el aviso si ya está", () => {
    const unaTime = anexarAvisoPresupuesto("Parcial");
    expect(anexarAvisoPresupuesto(unaTime)).toBe(unaTime);
  });

  it("el aviso apunta al botón de continuación y no lleva emojis", () => {
    expect(AVISO_PRESUPUESTO).toContain('pulsa "Continuar tarea"');
    expect(AVISO_PRESUPUESTO).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it("refleja el aviso en el último segmento de texto (lo que renderiza la UI)", () => {
    const segments: SegmentoStream[] = [{ kind: "text", text: "trabajando…" }];
    anexarAvisoPresupuestoSegmento(segments);

    expect(segments).toEqual([
      { kind: "text", text: `trabajando…\n\n${AVISO_PRESUPUESTO}` },
    ]);

    anexarAvisoPresupuestoSegmento(segments);
    expect(segments).toEqual([
      { kind: "text", text: `trabajando…\n\n${AVISO_PRESUPUESTO}` },
    ]);
  });

  it("si el turno terminó en herramienta/plan añade un segmento de texto nuevo", () => {
    const segments: SegmentoStream[] = [
      { kind: "text", text: "previo" },
      { kind: "tool", id: "tool-a", name: "ssh_execute", input: {}, status: "completed" },
    ];
    anexarAvisoPresupuestoSegmento(segments);

    expect(segments).toHaveLength(3);
    expect(segments[2]).toEqual({ kind: "text", text: AVISO_PRESUPUESTO });

    anexarAvisoPresupuestoSegmento(segments);
    expect(segments).toHaveLength(3);
  });
});

describe("inserción del segmento plan", () => {
  const paso: PasoPlan = { id: "todo-0", content: "Configurar OSPF", status: "in_progress" };

  it("añade el plan al final del listado cronológico", () => {
    const origen: PasoPlan = { id: "todo-9", content: "Origen", status: "pending" };
    const segments: SegmentoStream[] = [{ kind: "text", text: "trabajando…" }];
    insertarSegmentoPlan(segments, [origen]);

    expect(segments).toHaveLength(2);
    expect(segments[1]).toEqual({ kind: "plan", todos: [origen] });

    origen.content = "mutado";
    expect(segments[1]).toEqual({
      kind: "plan",
      todos: [{ id: "todo-9", content: "Origen", status: "pending" }],
    });
  });

  it("reemplaza el plan existente en su sitio (sin planes duplicados)", () => {
    const segments: SegmentoStream[] = [
      { kind: "text", text: "inicio" },
      { kind: "plan", todos: [paso] },
      { kind: "text", text: "final" },
    ];
    const second: PasoPlan = { id: "todo-1", content: "Verificar rutas", status: "pending" };

    insertarSegmentoPlan(segments, [second]);

    expect(segments).toHaveLength(3);
    expect(segments[1]).toEqual({ kind: "plan", todos: [second] });
    expect(segments.filter((s) => s.kind === "plan")).toHaveLength(1);
    expect(segments[0]).toEqual({ kind: "text", text: "inicio" });
    expect(segments[2]).toEqual({ kind: "text", text: "final" });
  });

  it("ignora un plan vacío", () => {
    const segments: SegmentoStream[] = [{ kind: "text", text: "solo texto" }];
    insertarSegmentoPlan(segments, []);
    expect(segments).toHaveLength(1);
  });

  it("no estorba al barrido cerrarSegmentosPendientes", () => {
    const segments: SegmentoStream[] = [
      { kind: "plan", todos: [paso] },
      { kind: "tool", id: "tool-a", name: "ssh_execute", input: {}, status: "running" },
    ];
    const events: Array<{ event: string; data: any }> = [];

    cerrarSegmentosPendientes(
      segments,
      (event, data) => events.push({ event, data }),
      [],
    );


    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("tool_call_result");
    expect(segments[0]).toEqual({ kind: "plan", todos: [paso] });
    expect(segments[1].kind === "tool" && segments[1].status).toBe("error");
  });
});

describe("construcción del mensaje de continuación", () => {
  it("arma el mensaje completo: encabezado + resumen + pendientes", () => {
    expect(
      construirMensajeContinuacion({
        summary: " Resumen parcial ",
        pending: ["Paso 1", " Paso 2 ", ""],
      }),
    ).toBe(
      "Continua la tarea anterior.\n\n" +
        "Ya hecho:\n- Resumen parcial\n\n" +
        "Pendiente:\n- Paso 1\n- Paso 2",
    );
  });

  it("sin plan solo lleva el resumen", () => {
    expect(construirMensajeContinuacion({ summary: "Solo texto", pending: [] })).toBe(
      "Continua la tarea anterior.\n\nYa hecho:\n- Solo texto",
    );
  });

  it("sin resumen solo lleva el plan", () => {
    expect(
      construirMensajeContinuacion({ summary: "   ", pending: ["Un paso"] }),
    ).toBe("Continua la tarea anterior.\n\nPendiente:\n- Un paso");
  });

  it("sin datos devuelve solo el encabezado", () => {
    expect(construirMensajeContinuacion({})).toBe("Continua la tarea anterior.");
    expect(
      construirMensajeContinuacion({ summary: null, pending: undefined }),
    ).toBe("Continua la tarea anterior.");
  });

  it(`trunca el resumen a ${LIMITE_RESUMEN_CONTINUACION} chars con marca de corte`, () => {
    const long = "a".repeat(LIMITE_RESUMEN_CONTINUACION + 100);
    const mensaje = construirMensajeContinuacion({ summary: long });
    const lines = mensaje.split("\n");

    expect(lines[3]).toBe(`- ${"a".repeat(LIMITE_RESUMEN_CONTINUACION)}…`);
    expect(LIMITE_RESUMEN_CONTINUACION).toBe(600);
  });
});
