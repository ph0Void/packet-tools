

import { describe, expect, it } from "vitest";
import {
  CISCO_PACKET_TRACER_TOOLS_ADMIN,
  CISCO_TOOLS_USER,
  parsearComandosSoloLectura,
} from "@/agent/ciscoPacketTracer/Tool";
import { getToolPolicy, TOOL_POLICIES } from "@/agent/security/ToolPolicy";


interface InvokableTool {
  name: string;
  invoke: (input: Record<string, unknown>) => Promise<unknown>;
}


function toolByName(name: string): InvokableTool {
  const encontrada = CISCO_PACKET_TRACER_TOOLS_ADMIN.find(
    (candidate) => candidate.name === name,
  );
  if (!encontrada) throw new Error(`Tool no encontrada: ${name}`);
  return encontrada as unknown as InvokableTool;
}


async function invocarJson(
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const output = await toolByName(name).invoke(input);
  return typeof output === "string" ? JSON.parse(output) : output;
}


const MUTANTES_NUEVAS = [
  "saveDeviceConfig",
  "restoreDeviceConfig",
  "exportTopologyFile",
  "importTopologyFile",
  "clearWorkspace",
  "simulateLinkFailure",
  "restoreLink",
];


const READS_NUEVAS = [
  "readDeviceConsole",
  "getRoutingTable",
  "getVlanConfiguration",
  "getDeviceMetrics",
  "validateSecurityConfig",
];


const READS_USER = [
  "runDeviceCommand",
  "validateTopology",
  "listDeviceModels",
  "listDeviceModules",
  "subnetCalc",
  "getDeviceConfig",
  "generateNetworkReport",
];

describe("políticas de las tools de Packet Tracer", () => {
  it("cada tool del set ADMIN tiene entrada explícita y coherente en TOOL_POLICIES", () => {
    for (const tool of CISCO_PACKET_TRACER_TOOLS_ADMIN) {
      const policy = TOOL_POLICIES[tool.name];
      expect(
        policy,
        `Falta la política de TOOL_POLICIES para '${tool.name}'`,
      ).toBeDefined();

      if (policy!.access === "readonly") {
        expect(policy!.autoApprove, `${tool.name} (readonly)`).not.toBe(
          true,
        );
      }
      expect(["readonly", "mutating", "internal"]).toContain(policy!.access);
    }
  });

  it("las nuevas herramientas de escritura exigen aprobación humana", () => {
    for (const name of MUTANTES_NUEVAS) {
      const policy = TOOL_POLICIES[name];
      expect(policy, `Falta la política de '${name}'`).toBeDefined();
      expect(policy.access).toBe("mutating");
      expect(policy.kind).toBe("topology");
      expect(policy.autoApprove, `${name} no debe auto-aprobarse`).not.toBe(
        true,
      );

      expect(policy.autoApprove).toBeUndefined();
    }
  });

  it("las nuevas herramientas de solo lectura quedan como readonly", () => {
    for (const name of [
      ...READS_USER,
      ...READS_NUEVAS,
      "pingTopology",
      "reachMatrix",
      "qaTopologySuite",
    ]) {
      const policy = getToolPolicy(name);
      expect(policy.access, name).toBe("readonly");
      expect(policy.autoApprove, name).not.toBe(true);
    }

    expect(getToolPolicy("pingTopology").kind).toBe("simulation");
    expect(getToolPolicy("reachMatrix").kind).toBe("simulation");
    expect(getToolPolicy("validateTopology").kind).toBe("topology");
    expect(getToolPolicy("runDeviceCommand").kind).toBe("topology");
  });

  it("CISCO_TOOLS_USER solo contiene herramientas de solo lectura", () => {
    for (const tool of CISCO_TOOLS_USER) {
      const policy = getToolPolicy(tool.name);
      expect(
        policy.access,
        `${tool.name} no es readonly`,
      ).toBe("readonly");
      expect(policy.autoApprove, tool.name).not.toBe(true);
    }
  });

  it("el set de usuario incluye las lecturas seguras y excluye las de simulación", () => {
    const names = CISCO_TOOLS_USER.map((tool) => tool.name);
    for (const name of READS_USER) {
      expect(names, `${name} debería estar en USER`).toContain(name);
    }

    expect(names).not.toContain("pingTopology");
    expect(names).not.toContain("reachMatrix");
    expect(names).not.toContain("qaTopologySuite");
    expect(names).not.toContain("sendPdu");
  });


  it("las acciones sobre el escenario y el lienzo exigen aprobación y no están en USER", () => {
    const namesUser = new Set(
      CISCO_TOOLS_USER.map((tool) => tool.name),
    );
    const esperado: Record<string, string> = {
      setSimulationMode: "simulation",
      stepSimulation: "simulation",
      moveDevice: "topology",
    };
    for (const [name, kind] of Object.entries(esperado)) {
      const policy = getToolPolicy(name);
      expect(policy.access, `${name} debe ser mutating`).toBe("mutating");
      expect(policy.kind, `${name} kind`).toBe(kind);

      expect(policy.autoApprove, `${name} no debe auto-aprobarse`).not.toBe(
        true,
      );
      expect(namesUser.has(name), `${name} no debe estar en USER`).toBe(
        false,
      );

      expect(
        CISCO_PACKET_TRACER_TOOLS_ADMIN.map((h) => h.name),
        `${name} debe seguir en ADMIN`,
      ).toContain(name);
    }

    expect(getToolPolicy("sendPdu").access).toBe("readonly");
    expect(getToolPolicy("getSimulationStatus").access).toBe("readonly");
  });

  it("las tools nuevas están exportadas en el set ADMIN y sin nombres repetidos", () => {
    const names = CISCO_PACKET_TRACER_TOOLS_ADMIN.map(
      (tool) => tool.name,
    );
    for (const name of [
      ...MUTANTES_NUEVAS,
      ...READS_USER,
      ...READS_NUEVAS,
    ]) {
      expect(names, `${name} debería estar en ADMIN`).toContain(name);
    }
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("subnetCalc (cálculo local)", () => {
  it("calcula red, broadcast y hosts de un /24", async () => {
    const output = await invocarJson("subnetCalc", { cidr: "192.168.1.0/24" });

    expect(output.success).toBe(true);
    expect(output.cidr).toBe("192.168.1.0/24");
    expect(output.network).toBe("192.168.1.0");
    expect(output.netmask).toBe("255.255.255.0");
    expect(output.broadcast).toBe("192.168.1.255");
    expect(output.firstHost).toBe("192.168.1.1");
    expect(output.lastHost).toBe("192.168.1.254");
    expect(output.hosts).toBe(254);
  });

  it("divide un /24 en 4 subredes consecutivas de /26", async () => {
    const output = await invocarJson("subnetCalc", {
      cidr: "192.168.1.0/24",
      subnetCount: 4,
    });

    expect(output.success).toBe(true);
    expect(output.subnetCount).toBe(4);
    expect(output.prefix).toBe(26);
    expect(output.subnets).toHaveLength(4);
    expect(output.subnets.map((subred: any) => subred.cidr)).toEqual([
      "192.168.1.0/26",
      "192.168.1.64/26",
      "192.168.1.128/26",
      "192.168.1.192/26",
    ]);
    expect(output.subnets[0]).toEqual({
      cidr: "192.168.1.0/26",
      network: "192.168.1.0",
      firstHost: "192.168.1.1",
      lastHost: "192.168.1.62",
      broadcast: "192.168.1.63",
      gateway: "192.168.1.1",
    });
    expect(output.subnets[3].broadcast).toBe("192.168.1.255");
    expect(output.subnets[3].lastHost).toBe("192.168.1.254");
  });

  it("devuelve success:false ante CIDRs o subredes inválidos", async () => {
    const cidrRoto = await invocarJson("subnetCalc", { cidr: "10.0.0.0" });
    expect(cidrRoto.success).toBe(false);
    expect(cidrRoto.error).toContain("A.B.C.D/nn");

    const octetoInvalido = await invocarJson("subnetCalc", {
      cidr: "300.1.1.0/24",
    });
    expect(octetoInvalido.success).toBe(false);

    const noPotenciaOfDos = await invocarJson("subnetCalc", {
      cidr: "192.168.1.0/24",
      subnetCount: 3,
    });
    expect(noPotenciaOfDos.success).toBe(false);
    expect(noPotenciaOfDos.error).toContain("potencia de 2");
  });
});

describe("lista blanca de runDeviceCommand", () => {
  it("acepta varias líneas de solo lectura y las limpia", () => {
    const result = parsearComandosSoloLectura(
      "show ip int brief\n\n  show vlan brief\r\nping 10.0.0.1",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commands).toEqual([
        "show ip int brief",
        "show vlan brief",
        "ping 10.0.0.1",
      ]);
    }
  });

  it("rechaza cualquier línea que no sea de solo lectura y apunta a configureIosDevice", () => {
    const result = parsearComandosSoloLectura(
      "show run\nconfigure terminal",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("configure terminal");
      expect(result.error).toContain("configureIosDevice");
    }
  });

  it("rechaza comandos vacíos", () => {
    const result = parsearComandosSoloLectura("   \n\n");
    expect(result.ok).toBe(false);
  });

  it("acepta la lista de solo lectura multi-vendor (display, screen-length, who)", () => {

    const result = parsearComandosSoloLectura(
      "display current-configuration\nscreen-length 0 temporary\nwho\ndisplay ip interface brief",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commands).toHaveLength(4);
    }
  });

  it("sigue rechazando escritura y reinicio (configure, reload, erase)", () => {
    const result = parsearComandosSoloLectura(
      "configure terminal\nreload\nerase startup-config",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("configure terminal");
      expect(result.error).toContain("reload");
      expect(result.error).toContain("erase startup-config");
    }
  });
});
