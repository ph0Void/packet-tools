
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { requestContext } from "@/utils/RequestContext";
import { phaseCycleImportacion } from "./fases/cicloImportacion";
import { phaseReads } from "./fases/lecturas";
import { phaseSession } from "./fases/sesion";
import { phaseSimulation } from "./fases/simulacion";
import { phaseSnapshots } from "./fases/snapshots";
import { phaseTopology } from "./fases/topologia";
import {
  ExtensionMudaError,
  PHASES,
  comprobarBuild,
  cuentaDevices,
  phasesDesconocidas,
  phasesRequested,
  phaseRequested,
  hasFailures,
  hasPhasesRequested,
  invocar,
  record,
  summary,
  results,
  simActive,
  vida,
} from "./harness";

async function main(): Promise<number> {
  console.log("=== SUITE DE INTEGRACIÓN — EXTENSIÓN PACKET TRACER ===\n");

  
  
  const desconocidas = phasesDesconocidas();
  if (desconocidas.length > 0) {
    console.error(
      `PT_FASE no reconoce: ${desconocidas.join(", ")}. Fases: ${PHASES.join(", ")}.`,
    );
    return 2;
  }
  if (hasPhasesRequested()) {
    const requested = phasesRequested();
    const saltadas = PHASES.filter((f) => !requested.includes(f));
    console.log(`PT_FASE=${requested.join(",")}: solo esas fases.`);
    console.log(
      saltadas.length > 0
        ? `Se saltan: ${saltadas.join(", ")}.\n`
        : "No se salta ninguna.\n",
    );
  }


  const admin = await prismaClient.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) {
    console.error(
      "No hay usuario ADMIN en la base de datos: ejecuta `npm run seed`.",
    );
    return 2;
  }

  let code = 0;
  await requestContext.run(
    { id: admin.id, username: admin.username, role: "ADMIN", autonomous: true },
    async () => {

      const alive = await vida();
      if (!alive) {
        console.error("El entorno no responde (listDeviceModels sin contestar).");
        console.error("Cómo arreglarlo:");
        console.error(
          "  1. Backend escuchando en SERVER_PORT=7531 → `npm run dev` desde la raíz.",
        );
        console.error(
          "  2. Extensión de Packet Tracer conectada al backend (Packet Tracer abierto).",
        );
        console.error(
          "  3. Si Packet Tracer tiene un diálogo modal abierto, ciérralo o reinícialo.",
        );
        console.error(
          "Tras arreglarlo, vuelve a lanzar la suite (es idempotente: limpia antes).",
        );
        code = 2;
        return;
      }
      console.log("[OK] extensión viva (listDeviceModels)\n");


      const cb = await comprobarBuild();
      record(cb.status, "build de la extensión", cb.detail);
      if (cb.status !== "OK") {
        summary();
        code = 1;
        return;
      }
      console.log("       " + cb.detail + "\n");

      console.log(`Usuario de prueba: ${admin.username}`);
      if (simActive()) {
        console.log(
          "PT_SIM=1: la fase F ejecuta setSimulationMode, sendPdu y stepSimulation, " +
            "que pueden abrir un diálogo modal en PT.\n",
        );
      }


      const onlySeleccion = hasPhasesRequested();
      if (onlySeleccion) {
        console.log(
          "PT_FASE: no se hace la pre-limpieza del lienzo (cada fase trabaja con " +
            "lo que haya).\n",
        );
      }
      if (!onlySeleccion || phaseRequested("topologia")) {
        const red0 = await invocar("getNetwork");
        const inicial = cuentaDevices(red0?.result ?? red0);
        if (inicial !== 0) {
          await invocar("clearWorkspace", {});
          const ro = await invocar("getNetwork");
          const tras = cuentaDevices(ro?.result ?? ro);
          record(
            tras === 0 ? "OK" : "FALLO",
            "pre-limpieza clearWorkspace",
            `${inicial} → ${tras} dispositivos`,
          );
        }
      }

      if (phaseRequested("topologia")) await phaseTopology();
      if (phaseRequested("lecturas")) await phaseReads();

      let routeExport: string | undefined;
      if (phaseRequested("snapshots")) routeExport = await phaseSnapshots();
      if (phaseRequested("importacion")) await phaseCycleImportacion(routeExport);
      if (phaseRequested("sesion")) await phaseSession();
      if (phaseRequested("simulacion")) await phaseSimulation();

      summary();
      code = hasFailures() ? 1 : 0;
    },
  );

  return code;
}

async function desconectar(): Promise<void> {
  try {
    await prismaClient.$disconnect();
  } catch {

  }
}

main()
  .then(async (code) => {
    await desconectar();
    process.exit(code);
  })
  .catch(async (e: any) => {
    if (results.length > 0) summary();
    if (e instanceof ExtensionMudaError) {
      console.error(`\n${e.message}`);
    } else {
      console.error("\nError fatal:", e?.message ?? e);
    }
    await desconectar();
    process.exit(2);
  });
