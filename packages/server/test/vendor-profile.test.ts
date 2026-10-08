

import { describe, expect, it } from "vitest";
import {
  CONSERVADOR,
  getVendorProfile,
  resolveVendorId,
  resolveVendorProfile,
  detectVendorIdFromPrompt,
  type VendorProfile,
} from "@/agent/security/VendorProfile";
import {
  classifyCommandRisk,
  classifyCommands,
  isNestedPrompt,
} from "@/agent/security/CommandClassifier";
import { sanitizeCommandsForPrompt } from "@/agent/terminal/sanitizeCommands";


const profile = (id: string): VendorProfile => getVendorProfile(id);


const CISCO_CONFIG = "R1(config)#";
const CISCO_CONFIG_IF = "R1(config-if)#";
const HUAWEI_SEEN = "[R1-GigabitEthernet0/0]";
const MIKROTIK_MENU = "[admin@MikroTik] /interface bridge";
const ARUBA_CONFIG = "(host) (config) #";

describe("VendorProfile: isNested reconoce el sub-modo de su vendor y no el ajeno", () => {
  it("Cisco: (config)# y (config-if)# son sub-modo; R1#, R1> y los de otros vendors no", () => {
    expect(profile("cisco").prompt.isNested(CISCO_CONFIG)).toBe(true);
    expect(profile("cisco").prompt.isNested(CISCO_CONFIG_IF)).toBe(true);
    expect(profile("cisco").prompt.isNested("R1#")).toBe(false);
    expect(profile("cisco").prompt.isNested("R1>")).toBe(false);
    expect(profile("cisco").prompt.isNested(HUAWEI_SEEN)).toBe(false);
    expect(profile("cisco").prompt.isNested(MIKROTIK_MENU)).toBe(false);
    expect(profile("cisco").prompt.isNested(ARUBA_CONFIG)).toBe(false);
  });

  it("Huawei: [R1-GigabitEthernet0/0] es sub-modo y [R1] es la vista raíz", () => {
    expect(profile("huawei").prompt.isNested(HUAWEI_SEEN)).toBe(true);
    expect(profile("huawei").prompt.isNested("[R1-aaa]")).toBe(true);
    expect(profile("huawei").prompt.isNested("[R1]")).toBe(false);
    expect(profile("huawei").prompt.isNested("<R1>")).toBe(false);
    
    expect(profile("huawei").prompt.isNested(CISCO_CONFIG)).toBe(false);
    expect(profile("huawei").prompt.isNested(MIKROTIK_MENU)).toBe(false);
    expect(profile("huawei").prompt.isNested(ARUBA_CONFIG)).toBe(false);
  });

  it("MikroTik: [admin@host] /interface es sub-modo y su prompt raíz no", () => {
    expect(profile("mikrotik").prompt.isNested("[admin@host] /interface")).toBe(
      true,
    );
    expect(profile("mikrotik").prompt.isNested(MIKROTIK_MENU)).toBe(true);
    expect(profile("mikrotik").prompt.isNested("[admin@MikroTik]")).toBe(false);
    expect(profile("mikrotik").prompt.isNested("[admin@MikroTik] >")).toBe(false);
    
    expect(profile("mikrotik").prompt.isNested(HUAWEI_SEEN)).toBe(false);
    expect(profile("mikrotik").prompt.isNested(CISCO_CONFIG)).toBe(false);
  });

  it("MikroTik: la RUTA DE MENÚ es el patrón de configuración, y no da falsos positivos", () => {
    
    
    
    
    const config = profile("mikrotik").prompt.config;
    
    expect(config.test("[admin@MikroTik] /system>")).toBe(true);
    expect(config.test("[admin@MikroTik] /system identity>")).toBe(true);
    expect(config.test("[admin@MikroTik] /interface bridge>")).toBe(true);
    expect(config.test("[admin@MikroTik] /interface ethernet switch>")).toBe(true);
    
    
    expect(config.test("[admin@MikroTik] >")).toBe(false);
    expect(config.test("[admin@MikroTik]")).toBe(false);
    
    
    expect(config.test("vrf/something")).toBe(false);
    expect(config.test("[admin@MikroTik] /system> print")).toBe(false);
    expect(config.test("[admin@MikroTik] /interface bridge print")).toBe(false);
    
    
    expect(config.test("[admin@MikroTik] /system> set name=X")).toBe(false);
    
    expect(config.test(CISCO_CONFIG)).toBe(false);
    expect(config.test(HUAWEI_SEEN)).toBe(false);
    expect(config.test(ARUBA_CONFIG)).toBe(false);
  });

  it("MikroTik: no inventa modo de configuración global pero SÍ sabe salir del menú", () => {
    
    
    
    
    
    const mikrotik = profile("mikrotik");
    expect(mikrotik.transiciones.aConfig).toBeNull();
    expect(mikrotik.transiciones.salirDeConfig).toBe("..");
    expect(mikrotik.prompt.isPrompt("[admin@MikroTik] /interface bridge>")).toBe(true);
    expect(mikrotik.prompt.isNested("[admin@MikroTik] /interface bridge>")).toBe(true);
  });

  it("Aruba: (host) (config) # es sub-modo y (host) # es el prompt raíz", () => {
    expect(profile("aruba").prompt.isNested(ARUBA_CONFIG)).toBe(true);
    expect(profile("aruba").prompt.isNested("(host) (config-if) #")).toBe(true);
    expect(profile("aruba").prompt.isNested("(host) #")).toBe(false);
    expect(profile("aruba").prompt.isNested("(host) >")).toBe(false);
    expect(profile("aruba").prompt.isNested(CISCO_CONFIG)).toBe(false);
    expect(profile("aruba").prompt.isNested(HUAWEI_SEEN)).toBe(false);
  });

  it("JunOS: el marcador [edit ...] es el sub-modo (no aparece en el prompt)", () => {
    expect(profile("junos").prompt.isNested("[edit interfaces]")).toBe(true);
    expect(profile("junos").prompt.isNested("[configure]")).toBe(true);
    expect(profile("junos").prompt.isNested("admin@r1>")).toBe(false);
    expect(profile("junos").prompt.isNested(CISCO_CONFIG)).toBe(false);
  });

  it("conservador: reconoce los sub-modos comunes sin conocer el vendor", () => {
    expect(CONSERVADOR.prompt.isNested(CISCO_CONFIG)).toBe(true);
    expect(CONSERVADOR.prompt.isNested(CISCO_CONFIG_IF)).toBe(true);
    expect(CONSERVADOR.prompt.isNested(HUAWEI_SEEN)).toBe(true);
    expect(CONSERVADOR.prompt.isNested(MIKROTIK_MENU)).toBe(true);
    expect(CONSERVADOR.prompt.isNested(ARUBA_CONFIG)).toBe(true);
    
    expect(CONSERVADOR.prompt.isNested("R1#")).toBe(false);
    expect(CONSERVADOR.prompt.isNested("<R1>")).toBe(false);
    expect(CONSERVADOR.prompt.isNested("(host) #")).toBe(false);
    expect(CONSERVADOR.prompt.isNested("")).toBe(false);
    expect(CONSERVADOR.prompt.isNested(null)).toBe(false);
  });

  it("conservador: detecta prompts de cualquier familia por forma genérica", () => {
    expect(CONSERVADOR.prompt.isPrompt("R1#")).toBe(true);
    expect(CONSERVADOR.prompt.isPrompt("R1>")).toBe(true);
    expect(CONSERVADOR.prompt.isPrompt("<R1>")).toBe(true);
    expect(CONSERVADOR.prompt.isPrompt("[R1]")).toBe(true);
    expect(CONSERVADOR.prompt.isPrompt("[admin@MikroTik] >")).toBe(true);
    expect(CONSERVADOR.prompt.isPrompt("(host) #")).toBe(true);
    expect(CONSERVADOR.prompt.isPrompt("admin@router:~$")).toBe(true);
    
    expect(CONSERVADOR.prompt.isPrompt("Building configuration...")).toBe(false);
    expect(CONSERVADOR.prompt.isPrompt("")).toBe(false);
  });
});

describe("VendorProfile: transiciones, preámbulo y datos por vendor", () => {
  it("Cisco conserva transiciones, preámbulo, abortKey y sondeo", () => {
    const cisco = profile("cisco");
    expect(cisco.transiciones).toEqual({
      aUser: "disable",
      aPrivilegiado: "enable",
      aConfig: "configure terminal",
      guardarConfig: "write memory",
      
      
      salirOfConfig: "exit",
    });
    expect(cisco.preambulo.sinPaginacion).toBe("terminal length 0");
    expect(cisco.preambulo.sinLookupDns).toBe("no ip domain-lookup");
    expect(cisco.abortKey).toBe("\u001e");
    expect(cisco.sondeo).toBe("show clock");
    expect(cisco.eol).toBe("\r");
  });

  it("Huawei: quit, system-view, save y screen-length 0", () => {
    const huawei = profile("huawei");
    expect(huawei.transiciones.aUsuario).toBe("quit");
    expect(huawei.transiciones.aConfig).toBe("system-view");
    expect(huawei.transiciones.guardarConfig).toBe("save");
    
    expect(huawei.transiciones.aPrivilegiado).toBeNull();
    expect(huawei.preambulo.sinPaginacion).toBe("screen-length 0 temporary");
    expect(huawei.preambulo.sinLookupDns).toBe("undo ip domain-lookup");
    expect(huawei.sondeo).toBe("display clock");
  });

  it("MikroTik: /exit, sin configuración global ni sondeo conocido", () => {
    const mikrotik = profile("mikrotik");
    expect(mikrotik.transiciones.aUsuario).toBe("/exit");
    expect(mikrotik.transiciones.aConfig).toBeNull();
    expect(mikrotik.transiciones.guardarConfig).toBeNull();
    expect(mikrotik.preambulo.sinPaginacion).toBeNull();
    expect(mikrotik.sondeo).toBeNull();
  });

  it("Aruba: enable/configure terminal; el guardado queda vacío por no confirmarlo", () => {
    const aruba = profile("aruba");
    expect(aruba.transiciones.aPrivilegiado).toBe("enable");
    expect(aruba.transiciones.aConfig).toBe("configure terminal");
    expect(aruba.transiciones.guardarConfig).toBeNull();
    expect(aruba.sondeo).toBeNull();
  });

  it("el perfil conservador no inventa transiciones, preámbulo ni abortKey", () => {
    expect(CONSERVADOR.transiciones).toEqual({
      aUser: null,
      aPrivilegiado: null,
      aConfig: null,
      guardarConfig: null,
      salirOfConfig: null,
    });
    expect(CONSERVADOR.preambulo.sinPaginacion).toBeNull();
    expect(CONSERVADOR.preambulo.sinLookupDns).toBeNull();
    expect(CONSERVADOR.abortKey).toBeNull();
    expect(CONSERVADOR.sondeo).toBeNull();
    
    expect(CONSERVADOR.paginator.some((p) => p.test("--More--"))).toBe(true);
    expect(
      CONSERVADOR.dialogos.confirmacionPatrones.some((p) =>
        p.test("[yes/no]:"),
      ),
    ).toBe(true);
    expect(CONSERVADOR.dialogos.respuestaConfirmacion).toBe("no");
  });

  it("cada perfil expone sus patrones de paginador de su familia", () => {
    expect(profile("cisco").paginator.some((p) => p.test("--More--"))).toBe(true);
    expect(
      profile("huawei").paginator.some((p) => p.test("---- More ----")),
    ).toBe(true);
    expect(profile("cisco").paginator.some((p) => p.test("(END)"))).toBe(true);
  });
});

describe("VendorProfile: resolución en tres niveles", () => {
  it("1) el tipo declarado gana aunque el prompt sea de otro vendor", () => {
    expect(resolveVendorId({ typeDevice: "HUAWEI", prompt: "R1#" })).toBe(
      "huawei",
    );
    expect(resolveVendorId({ typeDevice: "MIKROTIK", prompt: "R1(config)#" })).toBe(
      "mikrotik",
    );
    expect(resolveVendorId({ typeDevice: "ARUBA", prompt: null })).toBe("aruba");
    expect(resolveVendorId({ typeDevice: "CISCO", prompt: "[R1]" })).toBe(
      "cisco",
    );
  });

  it("2) GENERIC/PACKET_TRACER/GNS3/null se deducen del prompt real", () => {
    expect(resolveVendorId({ typeDevice: "GENERIC", prompt: HUAWEI_SEEN })).toBe(
      "huawei",
    );
    expect(resolveVendorId({ typeDevice: "GENERIC", prompt: "<R1>" })).toBe(
      "huawei",
    );
    expect(
      resolveVendorId({ typeDevice: "GENERIC", prompt: "[admin@MikroTik] >" }),
    ).toBe("mikrotik");
    expect(resolveVendorId({ typeDevice: "PACKET_TRACER", prompt: MIKROTIK_MENU })).toBe(
      "mikrotik",
    );
    expect(resolveVendorId({ typeDevice: "GNS3", prompt: ARUBA_CONFIG })).toBe(
      "aruba",
    );
    expect(resolveVendorId({ typeDevice: null, prompt: CISCO_CONFIG })).toBe(
      "cisco",
    );
    expect(resolveVendorId({ prompt: "[edit interfaces]" })).toBe("junos");
  });

  it("2) con prompt ambiguo se resuelve el conservador, no un vendor cualquiera", () => {
    expect(resolveVendorId({ typeDevice: "GENERIC", prompt: "R1>" })).toBe(
      "conservative",
    );
    expect(resolveVendorId({ typeDevice: "PACKET_TRACER", prompt: "$" })).toBe(
      "conservative",
    );
    expect(resolveVendorId({ typeDevice: "GENERIC", prompt: "sin prompt" })).toBe(
      "conservative",
    );
  });

  it("3) sin tipo declarado ni prompt (o con valores no concluyentes) → conservador", () => {
    expect(resolveVendorId({})).toBe("conservative");
    expect(resolveVendorId()).toBe("conservative");
    expect(resolveVendorId({ typeDevice: null, prompt: null })).toBe(
      "conservative",
    );
    expect(resolveVendorId({ typeDevice: "CISCO-XL", prompt: null })).toBe(
      "conservative",
    );
    expect(resolveVendorProfile({}).id).toBe("conservative");
  });

  it("un typeDevice fuera del enum cae al nivel 2 (detección por prompt)", () => {
    
    expect(resolveVendorId({ typeDevice: "CISCO-XL", prompt: CISCO_CONFIG })).toBe(
      "cisco",
    );
    expect(resolveVendorId({ typeDevice: "CISCO-XL", prompt: HUAWEI_SEEN })).toBe(
      "huawei",
    );
  });

  it("detectVendorIdFromPrompt es conservador: null cuando no concluye", () => {
    expect(detectVendorIdFromPrompt("R1#")).toBeNull();
    expect(detectVendorIdFromPrompt("")).toBeNull();
    expect(detectVendorIdFromPrompt(null)).toBeNull();
    expect(detectVendorIdFromPrompt(HUAWEI_SEEN)).toBe("huawei");
    
    expect(detectVendorIdFromPrompt("[admin@MikroTik] /ip address")).toBe(
      "mikrotik",
    );
  });
});

describe("CommandClassifier.isNestedPrompt: regresión Cisco + vendors nuevos", () => {
  it("sin perfil explícito mantiene el comportamiento histórico de Cisco", () => {
    expect(isNestedPrompt(CISCO_CONFIG_IF)).toBe(true);
    expect(isNestedPrompt(CISCO_CONFIG)).toBe(true);
    expect(isNestedPrompt("R1#")).toBe(false);
    expect(isNestedPrompt("R1>")).toBe(false);
    expect(isNestedPrompt("")).toBe(false);
    expect(isNestedPrompt(null)).toBe(false);
    
    
    expect(isNestedPrompt(HUAWEI_SEEN)).toBe(false);
  });

  it("con el perfil del vendor, el prompt no-Cisco sí es sub-modo", () => {
    expect(isNestedPrompt(HUAWEI_SEEN, profile("huawei"))).toBe(true);
    expect(isNestedPrompt(MIKROTIK_MENU, profile("mikrotik"))).toBe(true);
    expect(isNestedPrompt(ARUBA_CONFIG, profile("aruba"))).toBe(true);
    expect(isNestedPrompt("[admin@MikroTik] >", profile("mikrotik"))).toBe(
      false,
    );
    
    expect(isNestedPrompt(HUAWEI_SEEN, CONSERVADOR)).toBe(true);
    expect(isNestedPrompt(MIKROTIK_MENU, CONSERVADOR)).toBe(true);
  });

  it("el riesgo de exit/quit sigue siendo sessionControl en el prompt raíz", () => {
    expect(classifyCommandRisk("exit", "R1#", profile("huawei"))).toBe(
      "sessionControl",
    );
    expect(classifyCommandRisk("quit", "[R1]", profile("huawei"))).toBe(
      "sessionControl",
    );
    
    expect(classifyCommandRisk("logout", HUAWEI_SEEN, profile("huawei"))).toBe(
      "sessionControl",
    );
  });

  it("classifyCommandRisk permite exit/quit dentro del sub-modo del vendor", () => {
    expect(classifyCommandRisk("exit", HUAWEI_SEEN, profile("huawei"))).toBe(
      "safe",
    );
    expect(classifyCommandRisk("quit", MIKROTIK_MENU, profile("mikrotik"))).toBe(
      "safe",
    );
    expect(classifyCommandRisk("quit", ARUBA_CONFIG, profile("aruba"))).toBe(
      "safe",
    );
  });

  it("classifyCommands con perfil Huawei ya no lista el exit interno como cierre", () => {
    
    const anidado = classifyCommands(
      ["ip address 10.0.0.1 24", "quit"],
      HUAWEI_SEEN,
      profile("huawei"),
    );
    expect(anidado.sessionCommands).toEqual([]);
    expect(anidado.configCommands).toContain("ip address 10.0.0.1 24");

    
    
    const enRaiz = classifyCommands(["quit"], "[R1]", profile("huawei"));
    expect(enRaiz.sessionCommands).toEqual(["quit"]);
  });

  it("los comandos destructivos nuevos (reset/reboot) cuentan como dangerous", () => {
    const huawei = profile("huawei");
    expect(classifyCommandRisk("reboot", "[R1]", huawei)).toBe("dangerous");
    expect(classifyCommandRisk("reset saved-configuration", "[R1]", huawei)).toBe(
      "dangerous",
    );
    const mikrotik = profile("mikrotik");
    expect(classifyCommandRisk("/system reboot", "[admin@MikroTik]", mikrotik)).toBe(
      "dangerous",
    );
    expect(
      classifyCommandRisk("/system reset-configuration", "[admin@MikroTik]", mikrotik),
    ).toBe("dangerous");
    expect(classifyCommandRisk("factory-default", "(host) #", profile("aruba"))).toBe(
      "dangerous",
    );
    
    expect(classifyCommandRisk("format flash:", "R1#")).toBe("dangerous");
  });
});

describe("sanitizeCommandsForPrompt: decide con el perfil y propaga lo quitado", () => {
  it("conserva el exit de un sub-modo Huawei y lo dice en el payload", () => {
    const result = sanitizeCommandsForPrompt(
      ["interface GigabitEthernet0/0/0", "quit"],
      HUAWEI_SEEN,
      profile("huawei"),
    );

    expect(result.commands).toEqual([
      "interface GigabitEthernet0/0/0",
      "quit",
    ]);
    expect(result.removed).toEqual([]);
    expect(result.vendor).toBe("huawei");
  });

  it("sigue quitando el cierre en el prompt raíz y nombra el comando quitado", () => {
    const result = sanitizeCommandsForPrompt(["show clock", "exit"], "<R1>", profile("huawei"));

    expect(result.commands).toEqual(["show clock"]);
    expect(result.removed).toEqual(["exit"]);
    expect(result.vendor).toBe("huawei");
  });

  it("sin perfil explícito el vendor por defecto es Cisco (comportamiento previo)", () => {
    const result = sanitizeCommandsForPrompt(["show version", "exit"], "R1#");

    expect(result.commands).toEqual(["show version"]);
    expect(result.removed).toEqual(["exit"]);
    expect(result.vendor).toBe("cisco");
  });

  it("el perfil conservador tampoco pierde el exit de un sub-modo evidente", () => {
    const result = sanitizeCommandsForPrompt(["exit"], HUAWEI_SEEN, CONSERVADOR);

    expect(result.commands).toEqual(["exit"]);
    expect(result.removed).toEqual([]);
    expect(result.vendor).toBe("conservative");
  });
});
