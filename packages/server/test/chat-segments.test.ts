import { describe, expect, it } from "vitest";
import {
  cerrarSegmentosPendientes,
  type SegmentoStream,
  type ToolExecution,
} from "@/api/router/ChatsRouter";



describe("cerrarSegmentosPendientes", () => {
  it("cierra running como error y waiting_approval como rejected, emitiendo tool_call_result", () => {
    const segments: SegmentoStream[] = [
      { kind: "text", text: "texto previo" },
      { kind: "tool", id: "tool-a", name: "ssh_execute", input: { commands: ["show ip int brief"] }, status: "running" },
      { kind: "tool", id: "tool-b", name: "gns3_manage", input: {}, status: "waiting_approval" },
      { kind: "tool", id: "tool-c", name: "list_devices", input: {}, output: "ok", status: "completed" },
    ];
    const events: Array<{ event: string; data: any }> = [];
    const ejecuciones: ToolExecution[] = [
      { id: "tool-c", name: "list_devices", input: {}, output: "ok", status: "completed" },
    ];

    cerrarSegmentosPendientes(segments, (event, data) => events.push({ event, data }), ejecuciones);

    
    expect(events.map((item) => item.event)).toEqual(["tool_call_result", "tool_call_result"]);
    expect(events[0].data).toMatchObject({
      id: "tool-a",
      name: "ssh_execute",
      status: "error",
      output: "[TURNO_INTERRUMPIDO] La herramienta no reportó resultado antes de finalizar el turno.",
    });
    expect(events[1].data).toMatchObject({
      id: "tool-b",
      name: "gns3_manage",
      status: "rejected",
      output: "[APROBACION_CANCELADA] El turno finalizó sin respuesta de aprobación.",
    });

    
    const abiertos = segments.filter(
      (segment) => segment.kind === "tool" && segment.status === "running",
    );
    expect(abiertos).toHaveLength(0);
    const segA = segments.find((segment) => segment.kind === "tool" && segment.id === "tool-a");
    expect(segA?.kind === "tool" && segA.status).toBe("error");
    const segB = segments.find((segment) => segment.kind === "tool" && segment.id === "tool-b");
    expect(segB?.kind === "tool" && segB.output).toBe(
      "[APROBACION_CANCELADA] El turno finalizó sin respuesta de aprobación.",
    );
    
    const segC = segments.find((segment) => segment.kind === "tool" && segment.id === "tool-c");
    expect(segC?.kind === "tool" && segC.status).toBe("completed");

    
    expect(ejecuciones.map((ejecucion) => ejecucion.id)).toEqual(["tool-c", "tool-a", "tool-b"]);
  });

  it("es idempotente: una segunda pasada no reemite cierres ni duplica ejecuciones", () => {
    const segments: SegmentoStream[] = [
      { kind: "tool", id: "tool-a", name: "ssh_execute", input: {}, status: "running" },
      { kind: "tool", id: "tool-b", name: "gns3_manage", input: {}, status: "waiting_approval" },
    ];
    const events: Array<{ event: string; data: any }> = [];
    const ejecuciones: ToolExecution[] = [];
    const send = (event: string, data: unknown) => events.push({ event, data });

    cerrarSegmentosPendientes(segments, send, ejecuciones);
    expect(events).toHaveLength(2);
    expect(ejecuciones).toHaveLength(2);

    cerrarSegmentosPendientes(segments, send, ejecuciones);
    expect(events).toHaveLength(2);
    expect(ejecuciones).toHaveLength(2);
  });

  it("no duplica una ejecución ya registrada con el mismo id", () => {
    const segments: SegmentoStream[] = [
      { kind: "tool", id: "tool-a", name: "ssh_execute", input: {}, status: "running" },
    ];
    const events: Array<{ event: string; data: any }> = [];
    const ejecuciones: ToolExecution[] = [
      { id: "tool-a", name: "ssh_execute", input: {}, output: "previo", status: "error" },
    ];

    cerrarSegmentosPendientes(segments, (event, data) => events.push({ event, data }), ejecuciones);

    expect(events).toHaveLength(1);
    expect(ejecuciones).toHaveLength(1);
    expect(ejecuciones[0].output).toBe("previo");
  });
});
