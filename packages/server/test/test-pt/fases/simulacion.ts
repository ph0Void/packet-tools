
import {
  NOTICE_SIM,
  isTimeout,
  failureMockConsoleSucia,
  invocar,
  list,
  libre,
  probar,
  probarSim,
  truncate,
  record,
  skip,
  simActive,
  onlyPhase,
  withoutFailure,
  vida,
} from "../harness";


const ERROR_MODE_TIME_REAL = /not in simulation mode/i;


const TOOLS_TRAS_EL_GATE = "setSimulationMode, sendPdu y stepSimulation";


const ORIGEN = "PC1";
const DESTINO = "R1";


const IP_PC = {
  deviceName: ORIGEN,
  dhcpEnabled: false,
  ipaddress: "192.168.10.10",
  subnetMask: "255.255.255.0",
  defaultGateway: "192.168.10.1",
};
const IP_ROUTER = "192.168.10.1 255.255.255.0";


const SCENARIO = [
  { deviceName: DESTINO, deviceModel: "2911", x: 200, y: 200 },
  { deviceName: ORIGEN, deviceModel: "PC-PT", x: 460, y: 200 },
];


async function prepararScenario(): Promise<string[]> {
  const created: string[] = [];
  console.log(
    `       PT_FASE=simulacion: se completa lo que falte de ${DESTINO} + ${ORIGEN} ` +
      "(si ya estaban, no se toca nada).",
  );

  const red0 = await invocar("getNetwork");
  const lienzo0 = red0?.result ?? red0 ?? {};
  const existentes = new Set(
    list(lienzo0.devices).map((d: any) => String(d.name ?? d.deviceName ?? "")),
  );

  for (const team of SCENARIO) {
    if (existentes.has(team.deviceName)) continue;
    const r = await probar(
      "addDevice",
      team,
      (x) => ({
        ...withoutFailure(x),
        detail: `${team.deviceName}/${team.deviceModel} (escenario de la fase F)`,
      }),
    );
    if (r?.success !== false && !r?.error) created.push(team.deviceName);
  }

  if (created.length === 0) {
    console.log("       R1 y PC1 ya estaban en el lienzo: no se toca nada.");
    return created;
  }


  const iRouter = await libre(DESTINO, /^GigabitEthernet/);
  const iHost = await libre(ORIGEN, /^FastEthernet/);

  const red1 = await invocar("getNetwork");
  const enlaces = list((red1?.result ?? red1 ?? {}).connections);
  const unidos = enlaces.some(
    (c: any) =>
      (c.from === DESTINO && c.to === ORIGEN) ||
      (c.from === ORIGEN && c.to === DESTINO),
  );

  if (!unidos) {
    if (iRouter && iHost) {
      await probar(
        "addLink",
        {
          device1Name: DESTINO,
          device1Interface: iRouter,
          device2Name: ORIGEN,
          device2Interface: iHost,
          linkType: "straight",
        },
        (r) => ({
          ...withoutFailure(r),
          detail: `${DESTINO}.${iRouter} <-> ${ORIGEN}.${iHost}`,
        }),
      );
      console.log(`       escenario cableado en ${DESTINO}.${iRouter}`);
    } else {
      record(
        "FALLO",
        "addLink (escenario de la fase F)",
        `no se pudo elegir interfaz libre (${DESTINO}=${iRouter || "ninguna"}, ` +
          `${ORIGEN}=${iHost || "ninguna"}): la PDU no podrá salir`,
      );
    }
  }


  if (created.includes(ORIGEN)) {
    await probar("configurePcIp", IP_PC, (r) => ({
      ...withoutFailure(r),
      detail: `${ORIGEN} -> ${IP_PC.ipaddress}/24`,
    }));
  }


  if (created.includes(DESTINO) && iRouter) {
    const cfg = [
      `hostname ${DESTINO}`,
      `interface ${iRouter}`,
      `ip address ${IP_ROUTER}`,
      "no shutdown",
      "exit",
    ].join("\n");
    await probar("configureIosDevice", { deviceName: DESTINO, commands: cfg }, (r) => {
      const sucia = failureMockConsoleSucia(DESTINO, r);
      if (sucia) return sucia;
      const lines: any[] = list(r?.results);
      return {
        ok: r?.success !== false && lines.length > 0 && lines.every((l) => l.status === "ok"),
        detail:
          lines.map((l) => `${l.status}: ${l.command}`).join(" | ") || truncate(r),
      };
    });
  }

  return created;
}


async function recogerScenario(created: string[]): Promise<void> {
  if (created.length === 0) return;
  const r = await invocar("removeDevice", { deviceNames: created });
  record(
    r?.success !== false && !r?.error ? "OK" : "FALLO",
    "removeDevice (escenario de la fase F)",
    `${created.join(", ")} — ${truncate(r)}`,
  );
}

export async function phaseSimulation(): Promise<void> {
  console.log("\n--- FASE F: simulación ---");
  console.log(
    simActive()
      ? `       PT_SIM=1 activo: se ejecutarán ${TOOLS_TRAS_EL_GATE} (${NOTICE_SIM}).`
      : `       PT_SIM no activo: ${TOOLS_TRAS_EL_GATE} se saltan ` +
          `(sin PT_SIM=1 ${NOTICE_SIM}).`,
  );


  const created = onlyPhase("simulacion") ? await prepararScenario() : [];

  await probar("getSimulationStatus", {}, (r) => ({
    ok: r?.success !== false && !r?.error,
    detail: truncate(r),
  }));


  const pdu = await invocar("getPduResults", { types: ["ICMP"] });
  if (ERROR_MODE_TIME_REAL.test(JSON.stringify(pdu ?? {}))) {
    skip(
      "getPduResults",
      "en modo tiempo real: requiere PT_SIM=1 y modo simulación",
    );
  } else {
    record(
      pdu?.success !== false && !pdu?.error ? "OK" : "FALLO",
      "getPduResults",
      truncate(pdu),
    );
  }

  await probarSim("setSimulationMode", { toSimMode: true }, (r) => ({
    ok: r?.success !== false && !r?.error,
    detail: truncate(r),
  }));

  await probarSim(
    "sendPdu",
    { sourceDevice: ORIGEN, destinationDevice: DESTINO },
    (r) => ({ ok: r?.success !== false && !r?.error, detail: truncate(r) }),
  );

  await probarSim(
    "stepSimulation",
    { direction: "forward", steps: 1 },
    (r) => ({ ok: r?.success !== false && !r?.error, detail: truncate(r) }),
  );


  if (simActive()) {
    if (await vida()) {
      const r = await invocar("setSimulationMode", { toSimMode: false });
      if (isTimeout(r)) {
        console.log(
          "       AVISO: no se pudo volver a tiempo real (timeout); " +
            "cierra el diálogo de PT si está abierto.",
        );
      } else {
        console.log("       vuelta a modo tiempo real OK");
      }
    } else {
      console.log(
        "       AVISO: la extensión no responde; reinicia Packet Tracer " +
          "y comprueba el modo (simulation/real-time) manualmente.",
      );
    }
  }

  await recogerScenario(created);
}
