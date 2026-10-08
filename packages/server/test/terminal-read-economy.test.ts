

import { describe, expect, it } from "vitest";
import {
  classifyCommand,
  classifyCommandRisk,
  classifyCommands,
  matchesReadonly,
} from "@/agent/security/CommandClassifier";
import { getVendorProfile } from "@/agent/security/VendorProfile";
import { SSH_PROMPT } from "@/agent/ssh/Promt";
import { TELNET_PROMPT } from "@/agent/telnet/Promt";
import { SERIAL_PORT_PROMPT } from "@/agent/serialPort/Promt";


const PROMPTS_MOCKCONSOLE: ReadonlyArray<{ name: string; prompt: string }> = [
  { name: "SSH", prompt: SSH_PROMPT },
  { name: "Telnet", prompt: TELNET_PROMPT },
  { name: "Puerto serie", prompt: SERIAL_PORT_PROMPT },
];

describe("CommandClassifier — lectura por familia", () => {
  it("reconoce el verbo de lectura de cada familia de CLI", () => {
    
    
    const reads = [
      
      "show running-config",
      "show ip interface brief",
      "show version | include uptime",
      
      "display current-configuration",
      "display interface brief",
      
      "show configuration | display set",
      "show interfaces terse",
      
      "/ip user print",
      "/ip dns print",
      "/interface bridge print",
      "/system logging print",
      "/ppp secret print",
      "/ip hotspot print",
      "/user print",
      "/ip firewall filter print",
      "/system resource print",
      "/interface print detail",
      "/ip address print where interface=ether1",
      "/log print",
      
      "/export",
      "/export hide-sensitive",
      
      "show configuration commands",
      
      "get system status",
      "get router info routing-table all",
    ];
    for (const command of reads) {
      expect(classifyCommand(command), command).toBe("readonly");
      expect(matchesReadonly(command), command).toBe(true);
    }
  });

  it("un lote de lecturas MikroTik es readonly y safe de riesgo", () => {
    
    
    
    const lote = classifyCommands(
      ["/system resource print", "/ip user print", "/interface print"],
      "[admin@core-r1] >",
      getVendorProfile("mikrotik"),
    );
    expect(lote.level).toBe("readonly");
    expect(lote.risk).toBe("safe");
    expect(lote.configCommands).toEqual([]);
    expect(lote.dangerousCommands).toEqual([]);
  });

  it("distingue lectura de escritura dentro de la MISMA familia", () => {
    const writes = [
      
      "/ip address add address=10.0.0.1/24 interface=ether1",
      "/ip address remove 5",
      "/interface bridge add name=puente1",
      "/user set admin password=secreto",
      "/system script add name=x source=log",
      
      "/export file=backup",
      "/export hide-sensitive file=backup",
      
      
      "/ip address",
      "/interface",
      
      "configure terminal",
      "system-view",
      "set system host-name R1",
      "commit",
      "save",
      "write memory",
      "ip address 10.0.0.1 255.255.255.0",
    ];
    for (const command of writes) {
      expect(classifyCommand(command), command).toBe("config");
      expect(matchesReadonly(command), command).toBe(false);
    }
  });

  it("un lote mixto sigue siendo config (una sola escritura invalida la lectura)", () => {
    const lote = classifyCommands(
      ["/ip user print", "/user set admin password=secreto"],
      "[admin@core-r1] >",
      getVendorProfile("mikrotik"),
    );
    expect(lote.level).toBe("config");
    expect(lote.risk).toBe("config");
    expect(lote.configCommands).toEqual(["/user set admin password=secreto"]);
  });

  it("NO relaja la lista negra: un destructivo nunca se cuela como lectura", () => {
    
    
    
    const destructivos = [
      "reload",
      "reload in 5",
      "reboot",
      "/system reboot",
      "/system reset-configuration",
      "reset saved-configuration",
      "write erase",
      "wr erase",
      "erase startup-config",
      "erase nvram",
      "format flash:",
      "delete flash:config.txt",
      "factory-reset",
      "factory-default",
      "boot system flash:newimage.bin",
    ];
    for (const command of destructivos) {
      expect(classifyCommand(command), command).toBe("config");
      expect(classifyCommandRisk(command), command).toBe("dangerous");
      expect(matchesReadonly(command), command).toBe(false);
    }
  });

  it("un destructivo metido en un lote de lecturas sigue siendo peligroso", () => {
    const lote = classifyCommands(
      ["/ip user print", "/system reset-configuration"],
      "[admin@core-r1] >",
      getVendorProfile("mikrotik"),
    );
    expect(lote.level).toBe("config");
    expect(lote.risk).toBe("dangerous");
    expect(lote.dangerousCommands).toEqual(["/system reset-configuration"]);
  });

  it("`banner motd print …` NO es lectura (por eso el patrón exige barra)", () => {
    
    
    expect(classifyCommand("banner motd print hola")).toBe("config");
    expect(classifyCommand("banner motd ^Cprint")).toBe("config");
    expect(classifyCommand("print")).toBe("readonly"); 
  });

  it("un comando con saltos de línea nunca es readonly (defensa ya existente)", () => {
    expect(classifyCommand("/ip user print\n/system reboot")).toBe("config");
    expect(classifyCommandRisk("/ip user print\n/system reboot")).toBe("dangerous");
  });
});

describe("Prompts de consola — criterio de parada en las lecturas", () => {
  it.each(PROMPTS_MOCKCONSOLE)(
    "$nombre: dice cuándo ya tiene suficiente y cómo elegir el comando",
    ({ name, prompt }) => {
      
      expect(prompt, name).toContain("Reading vs. working");
      expect(prompt, name).toContain("stopping criterion");
      expect(prompt, name).toMatch(/STOP as soon as the output answers/);
      
      
      
      
      
      expect(prompt, name).toMatch(/MOST COMPLETE READ/i);
      expect(prompt, name).toContain("get_terminal_status");
      expect(prompt, name).toContain("canonical read depends on the vendor");
      expect(prompt, name).toContain("no per-brand list");
      expect(prompt, name).toContain("lecturasCanonicas");
      expect(prompt, name).toMatch(/Never guess a command/);
      for (const familia of [
        "show running-config",
        "display current-configuration",
        "show configuration | display set",
        "/export",
      ]) {
        expect(prompt, name).not.toContain(familia);
      }
      
      expect(prompt, name).toContain("NEVER ENUMERATE");
      
      expect(prompt, name).toContain("read_terminal");
      expect(prompt, name).toMatch(/instead of firing a 'print' blind/);
      
      
      expect(prompt, name).toContain("### WORKING");
      expect(prompt, name).toMatch(/long command sequences ARE the work/);
      expect(prompt, name).toMatch(/applies ONLY to reading/);
    },
  );

  it.each(PROMPTS_MOCKCONSOLE)(
    "$nombre: ya no invita a encadenar lecturas",
    ({ name, prompt }) => {
      expect(prompt, name).not.toContain("sequentially, checking each result");
      expect(prompt, name).not.toContain(
        "verify the output of each batch before continuing",
      );
      expect(prompt, name).toContain(
        "Send the FEWEST commands that actually answer the question",
      );
    },
  );

  it.each(PROMPTS_MOCKCONSOLE)("$nombre: conserva sus secciones previas", ({ name, prompt }) => {
    expect(prompt, name).toContain("## Configuring a device");
    expect(prompt, name).toContain("## Interactive console control");
    expect(prompt, name).toContain("search_knowledge_base");
    
    
    expect(prompt, name).toContain("[ERROR DEFINITIVO]");
    expect(prompt, name).toContain("[ERROR TRANSITORIO]");
    expect(prompt, name).not.toContain("If a tool fails, do not retry it more than once");
  });
});
