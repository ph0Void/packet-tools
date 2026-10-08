
import fs from "node:fs";
import { failureMockConsoleSucia, probar, truncate, withoutFailure } from "../harness";


function routeSnapshot(r: any): string {
  return String(r?.path ?? "");
}


function readSnapshot(route: string): string {
  if (!route) return "";
  try {
    return fs.readFileSync(route, "utf8");
  } catch {
    return "";
  }
}

export async function phaseSnapshots(): Promise<string | undefined> {
  console.log("\n--- FASE C: snapshots y archivos ---");

  await probar(
    "saveDeviceConfig",
    { deviceName: "R1", snapshotName: "check-snap" },
    (r) => {
      const sucia = failureMockConsoleSucia("R1", r);
      if (sucia) return sucia;
      
      const route = routeSnapshot(r);
      const guardada = failureMockConsoleSucia("R1", readSnapshot(route));
      if (guardada) {
        return {
          ...guardada,
          detail:
            `${guardada.detail} El snapshot '${route}' se guardó con basura: ` +
            "borra ese .cfg, reinicia la consola de R1 y vuelve a guardarlo.",
        };
      }
      return { ...withoutFailure(r), detail: truncate(r) };
    },
  );

  await probar(
    "restoreDeviceConfig",
    { deviceName: "R1", snapshotName: "check-snap" },
    (r) => {

      const sucia = failureMockConsoleSucia("R1", r);
      if (sucia) return sucia;
      return { ...withoutFailure(r), detail: truncate(r) };
    },
  );

  const namePkt = `ptcheck-${Date.now()}`;
  const rExport = await probar(
    "exportTopologyFile",
    { filename: namePkt },
    (r) => {
      const p = String(r?.path ?? "");
      const existe = !!p && fs.existsSync(p);
      return {
        ok: r?.success !== false && existe,
        detail: `${p || "(sin path)"} · existe=${existe}`,
      };
    },
  );

  const route = String(rExport?.path ?? "");
  return route || undefined;
}
