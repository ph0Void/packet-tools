
import path from "node:path";
import {
  cuentaDevices,
  invocar,
  probar,
  record,
  withoutFailure,
} from "../harness";

export async function phaseCycleImportacion(routeExport?: string): Promise<void> {
  console.log("\n--- FASE D: clearWorkspace → importTopologyFile ---");

  await probar("clearWorkspace", {}, withoutFailure);

  const trasClear = await invocar("getNetwork");
  const nTrasClear = cuentaDevices(trasClear?.result ?? trasClear);
  record(
    nTrasClear === 0 ? "OK" : "FALLO",
    "clearWorkspace → getNetwork",
    `devices=${nTrasClear} tras limpiar`,
  );

  const nameImport = routeExport ? path.basename(routeExport) : "";
  if (!nameImport) {
    record(
      "FALLO",
      "importTopologyFile",
      "no hay archivo exportado en la fase C: no se puede restaurar la topología",
    );
    return;
  }

  await probar("importTopologyFile", { filename: nameImport }, withoutFailure);

  const trasImport = await invocar("getNetwork");
  const nTrasImport = cuentaDevices(trasImport?.result ?? trasImport);
  record(
    nTrasImport >= 5 ? "OK" : "FALLO",
    "importTopologyFile → getNetwork",
    `devices=${nTrasImport} tras restaurar`,
  );
}
