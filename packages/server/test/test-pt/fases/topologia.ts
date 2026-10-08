
import {
  failureMockConsoleSucia,
  invocar,
  list,
  libre,
  probar,
  record,
  truncate,
  withoutFailure,
} from "../harness";

export async function phaseTopology(): Promise<void> {
  console.log("--- FASE A: crear topología de ejemplo ---");

  const models = await invocar("listDeviceModels");
  const catalogo: any[] = list(models?.models);
  record(
    catalogo.length >= 50 ? "OK" : "FALLO",
    "listDeviceModels (catálogo)",
    `${catalogo.length} modelos`,
  );

  await probar(
    "addDevice",
    { deviceName: "R1", deviceModel: "2911", x: 200, y: 200 },
    (r) => ({ ...withoutFailure(r), detail: `R1/2911 → ${truncate(r)}` }),
  );
  await probar(
    "addDevice",
    { deviceName: "SW1", deviceModel: "2960-24TT", x: 420, y: 200 },
    (r) => ({ ...withoutFailure(r), detail: `SW1/2960-24TT → ${truncate(r)}` }),
  );
  await probar(
    "addDevice",
    { deviceName: "PC1", deviceModel: "PC-PT", x: 640, y: 120 },
    (r) => ({ ...withoutFailure(r), detail: `PC1/PC-PT → ${truncate(r)}` }),
  );
  await probar(
    "addDevice",
    { deviceName: "PC2", deviceModel: "PC-PT", x: 640, y: 280 },
    (r) => ({ ...withoutFailure(r), detail: `PC2/PC-PT → ${truncate(r)}` }),
  );
  await probar(
    "addDevice",
    { deviceName: "SRV1", deviceModel: "Server-PT", x: 640, y: 440 },
    (r) => ({ ...withoutFailure(r), detail: `SRV1/Server-PT → ${truncate(r)}` }),
  );

  const iR1 = await libre("R1", /^GigabitEthernet/);
  const iSW1 = await libre("SW1", /^GigabitEthernet/);
  const iSW1a = await libre("SW1", /^FastEthernet/);
  console.log(`       interfaces elegidas: R1=${iR1} SW1=${iSW1}/${iSW1a}`);
  if (!iR1 || !iSW1 || !iSW1a) {
    throw new Error(
      `No se pudieron elegir interfaces (R1=${iR1}, SW1=${iSW1}, SW1fa=${iSW1a})`,
    );
  }

  await probar(
    "addLink",
    {
      device1Name: "R1",
      device1Interface: iR1,
      device2Name: "SW1",
      device2Interface: iSW1,
      linkType: "straight",
    },
    (r) => ({ ...withoutFailure(r), detail: `R1.${iR1} ↔ SW1.${iSW1}` }),
  );

  const pSW1a = await libre("SW1", /^FastEthernet/);
  await probar(
    "addLink",
    {
      device1Name: "SW1",
      device1Interface: pSW1a,
      device2Name: "PC1",
      device2Interface: "FastEthernet0",
      linkType: "straight",
    },
    (r) => ({ ...withoutFailure(r), detail: `SW1.${pSW1a} ↔ PC1.Fa0` }),
  );
  const pSW1b = await libre("SW1", /^FastEthernet/);
  await probar(
    "addLink",
    {
      device1Name: "SW1",
      device1Interface: pSW1b,
      device2Name: "PC2",
      device2Interface: "FastEthernet0",
      linkType: "straight",
    },
    (r) => ({ ...withoutFailure(r), detail: `SW1.${pSW1b} ↔ PC2.Fa0` }),
  );
  const pSW1c = await libre("SW1", /^FastEthernet/);
  await probar(
    "addLink",
    {
      device1Name: "SW1",
      device1Interface: pSW1c,
      device2Name: "SRV1",
      device2Interface: "FastEthernet0",
      linkType: "straight",
    },
    (r) => ({ ...withoutFailure(r), detail: `SW1.${pSW1c} ↔ SRV1.Fa0` }),
  );

  await probar(
    "configurePcIp",
    {
      deviceName: "PC1",
      dhcpEnabled: false,
      ipaddress: "192.168.10.10",
      subnetMask: "255.255.255.0",
      defaultGateway: "192.168.10.1",
    },
    (r) => ({ ...withoutFailure(r), detail: `PC1 → 192.168.10.10/24` }),
  );
  await probar(
    "configurePcIp",
    {
      deviceName: "PC2",
      dhcpEnabled: false,
      ipaddress: "192.168.10.11",
      subnetMask: "255.255.255.0",
      defaultGateway: "192.168.10.1",
    },
    (r) => ({ ...withoutFailure(r), detail: `PC2 → 192.168.10.11/24` }),
  );
  await probar(
    "configurePcIp",
    {
      deviceName: "SRV1",
      dhcpEnabled: false,
      ipaddress: "192.168.10.100",
      subnetMask: "255.255.255.0",
      defaultGateway: "192.168.10.1",
    },
    (r) => ({ ...withoutFailure(r), detail: `SRV1 → 192.168.10.100/24` }),
  );

  const cfgR1 = [
    "hostname R1",
    `interface ${iR1}`,
    "ip address 192.168.10.1 255.255.255.0",
    "no shutdown",
    "exit",
  ].join("\n");
  await probar(
    "configureIosDevice",
    { deviceName: "R1", commands: cfgR1 },
    (r) => {

      const sucia = failureMockConsoleSucia("R1", r);
      if (sucia) return sucia;
      const lines: any[] = list(r?.results);
      const ok =
        r?.success !== false &&
        lines.length > 0 &&
        lines.every((l) => l.status === "ok");
      return {
        ok,
        detail:
          lines.map((l) => `${l.status}: ${l.command}`).join(" | ") ||
          truncate(r),
      };
    },
  );


  await probar(
    "addDevice",
    { deviceName: "TMP1", deviceModel: "Printer-PT", x: 850, y: 600 },
    (r) => ({ ...withoutFailure(r), detail: "TMP1 creado para borrarlo" }),
  );
  await probar("removeDevice", { deviceNames: ["TMP1"] }, (r) => {
    const ok = r?.success !== false && !r?.error;
    return { ok, detail: truncate(r) };
  });
}
