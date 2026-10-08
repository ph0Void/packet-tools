
import {
  failureMockConsoleSucia,
  list,
  probar,
  truncate,
  outputCommands,
} from "../harness";


const PING_NO_SOPORTADO = "unsupported_device";

type Validacion = { ok: boolean; detail: string; skip?: string };


function validarPing(r: any): Validacion {
  if (r?.success === false || r?.error) {
    return { ok: false, detail: `pingDevices falló: ${truncate(r)}` };
  }
  if (r?.status === PING_NO_SOPORTADO) {
    return {
      ok: false,
      skip: `unsupported_device: el equipo no tiene CLI IOS y no puede ejecutar ping (resultado normal, no un fallo)`,
      detail: `${r?.source} → ${r?.target}`,
    };
  }
  const ok = r?.ok === true && Number(r?.received ?? 0) > 0;
  return {
    ok,
    detail:
      `status=${r?.status} sent=${r?.sent} received=${r?.received} ` +
      `loss=${r?.lossPercent}% rtt=${r?.rttAvg} · ` +
      `${String(r?.output ?? "").slice(0, 200)}`,
  };
}


function validarMatriz(r: any): Validacion {
  if (r?.success === false || r?.error) {
    return { ok: false, detail: `reachabilityMatrix falló: ${truncate(r)}` };
  }
  const filas = list(r?.rows);
  if (filas.length === 0) {
    return { ok: false, detail: `sin filas de alcance: ${truncate(r)}` };
  }
  const summary = filas
    .map(
      (f: any) =>
        `${f?.target}:${f?.status}(rec=${f?.received} loss=${f?.lossPercent}%)`,
    )
    .join(" | ");
  const withoutCli = filas.filter((f: any) => f?.status === PING_NO_SOPORTADO);
  if (withoutCli.length === filas.length) {
    return {
      ok: false,
      skip: `unsupported_device en los ${withoutCli.length} destinos: ninguno tiene CLI IOS para hacer ping (resultado normal, no un fallo)`,
      detail: summary,
    };
  }

  const fallidos = filas.filter(
    (f: any) => f?.status !== PING_NO_SOPORTADO && f?.ok !== true,
  );
  return {
    ok: fallidos.length === 0,
    detail: `${summary}${withoutCli.length ? ` · ${withoutCli.length} sin CLI IOS` : ""}`,
  };
}


function summaryOfHallazgos(r: any): string {
  const topo = r?.topology;
  if (topo === undefined || topo === null) return "topology: (sin bloque)";
  
  
  
  
  let hallazgos: any[] = list(topo);
  if (hallazgos.length === 0 && typeof topo === "object") {
    
    hallazgos = Object.entries(topo).flatMap(([key, value]) =>
      Array.isArray(value)
        ? value.map((x: any) => `${key}: ${String(x)}`)
        : [],
    );
  }
  if (hallazgos.length === 0) return "topology: sin hallazgos";
  return `topology: ${hallazgos.map((h: any) => String(h)).join(" | ")}`;
}


function validarQa(r: any): Validacion {
  const topo = summaryOfHallazgos(r);
  if (r?.success === false || r?.error) {
    return {
      ok: false,
      detail: `qaTopologySuite falló: ${truncate(r)} · ${topo}`,
    };
  }
  const summary = `addressing=${!!r?.addressing} · ${topo}`;
  const ping = r?.connectivity?.result;
  if (!ping) {
    return {
      ok: false,
      detail: `${summary} · sin bloque connectivity: ${truncate(r?.connectivity)}`,
    };
  }
  if (ping.success === false || ping.error) {
    return {
      ok: false,
      detail: `${summary} · ping fallido: ${truncate(ping)}`,
    };
  }
  if (ping.status === PING_NO_SOPORTADO) {
    return {
      ok: false,
      skip: `unsupported_device en el ping embebido: el equipo no tiene CLI IOS (resultado normal, no un fallo)`,
      detail: `${summary} · validación y direccionamiento correctos`,
    };
  }
  return {

    ok: ping.ok === true && Number(ping.received ?? 0) > 0,
    detail: `${summary} · ping status=${ping.status} rec=${ping.received}/${ping.sent} loss=${ping.lossPercent}%`,
  };
}

export async function phaseReads(): Promise<void> {
  console.log("\n--- FASE B: lecturas ---");

  await probar(
    "runDeviceCommand",
    { deviceName: "R1", command: "show ip int brief" },
    (r) => {
      const txt = outputCommands(r);

      const sucia = failureMockConsoleSucia("R1", r);
      if (sucia) return sucia;
      const ok =
        !!r?.success &&
        txt.trim().length > 20 &&
        !txt.includes("console_output_unavailable");
      return { ok, detail: txt.slice(0, 300) || truncate(r) };
    },
  );

  await probar(
    "runDeviceCommand",
    { deviceName: "R1", command: "show running-config" },
    (r) => {
      const txt = outputCommands(r);
      const sucia = failureMockConsoleSucia("R1", r);
      if (sucia) return sucia;
      const ok =
        !!r?.success && !txt.includes("--More--") && txt.length > 100;
      return {
        ok,
        detail: `sin --More--: ${!txt.includes("--More--")} · ${txt.length} chars`,
      };
    },
  );

  await probar(
    "runDeviceCommand",
    { deviceName: "PC1", command: "ipconfig" },
    (r) => {
      const txt = outputCommands(r);
      const sucia = failureMockConsoleSucia("PC1", r);
      if (sucia) return sucia;
      const ok = !!r?.success && /192\.168\.10\.10/.test(txt);
      return { ok, detail: txt.slice(0, 260) || truncate(r) };
    },
  );

  await probar(
    "runDeviceCommand",
    { deviceName: "R1", command: "show ip route" },
    (r) => {
      const txt = outputCommands(r);
      const sucia = failureMockConsoleSucia("R1", r);
      if (sucia) return sucia;
      const ok = !!r?.success && txt.trim().length > 10;
      return { ok, detail: txt.slice(0, 260) || truncate(r) };
    },
  );

  await probar("listDeviceModules", { deviceName: "R1" }, (r) => {

    const sucia = failureMockConsoleSucia("R1", r);
    if (sucia) return sucia;
    const mods: any[] = list(r?.modules);
    return {
      ok: !!r?.success && mods.length > 0,
      detail: `${mods.length} módulos: ${truncate(mods.slice(0, 6))}`,
    };
  });

  await probar("getDeviceConfig", { deviceName: "R1" }, (r) => {

    const sucia = failureMockConsoleSucia("R1", r);
    if (sucia) return sucia;
    const cfg = r?.runningConfig ?? r?.config ?? r?.startupConfig ?? "";
    const ok = !!r?.success && String(cfg).trim().length > 20;
    return {
      ok,
      detail: `${String(cfg).length} bytes de configuración · ${String(cfg).slice(0, 160)}`,
    };
  });

  await probar("validateTopology", {}, (r) => {
    const errs: any[] = list(r?.errors ?? r?.errores);
    const warns: any[] = list(r?.warnings ?? r?.avisos);

    const loops: any[] = list(r?.loops);
    const huerfanos: any[] = list(r?.orphans);
    const hallazgos = [
      loops.length > 0 ? `loops: ${loops.join(" | ")}` : "",
      huerfanos.length > 0 ? `orphans: ${huerfanos.join(" | ")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      ok: !!r?.success && errs.length === 0,
      detail:
        `errores=${errs.length} avisos=${warns.length}` +
        (hallazgos ? ` · ${hallazgos}` : "") +
        ` · ${truncate(r)}`,
    };
  });


  await probar("generateNetworkReport", {}, (r) => {
    const txt =
      typeof r === "string" ? r : (r?.report ?? r?.markdown ?? "");
    const ok = /flowchart|graph TB|mermaid/i.test(String(txt));
    return {
      ok,
      detail: `${String(txt).length} chars · ${String(txt).slice(0, 200)}`,
    };
  });

  await probar("subnetCalc", { cidr: "192.168.10.0/24" }, (r) => {
    const ok = !!r?.success && !!r?.network;
    return { ok, detail: truncate(r) };
  });

  await probar("getNetwork", {}, (r) => {
    const net = r?.result ?? r;
    const n = net?.devices?.length ?? 0;
    return {
      ok: n >= 5 && (net?.unresolvedLinks ?? 0) === 0,
      detail: `devices=${n} links=${list(net?.connections).length} unresolved=${net?.unresolvedLinks} nullPort=${net?.nullPortLinks}`,
    };
  });

  await probar("getDeviceInfo", { deviceName: "SW1" }, (r) => {
    const net = r?.result ?? r;
    const dev = net?.device;
    return {
      ok: !!dev && list(dev?.interfaces).length > 0,
      detail: `${dev?.name}/${dev?.model} · ${list(dev?.interfaces).length} interfaces · ${list(net?.connections).length} enlaces`,
    };
  });


  await probar(
    "pingTopology",
    { sourceName: "PC1", targetName: "R1" },
    validarPing,
  );

  await probar(
    "reachMatrix",
    { sourceName: "PC1", targetNames: ["R1", "PC2", "SRV1"] },
    validarMatriz,
  );

  await probar(
    "qaTopologySuite",
    { sourceName: "PC1", targetName: "R1" },
    validarQa,
  );
}
