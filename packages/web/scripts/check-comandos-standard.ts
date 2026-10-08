import {
  COMANDOS_DE_CIERRE,
  comandosATexto,
  comandosQueCierranSesion,
  extraerComandos,
  MAX_COMANDOS_STANDARD,
  motivoDispositivoNoSoportado,
} from "../src/component/jobs/comandosStandard";

let failures = 0;
let total = 0;

function check(name: string, condition: boolean, detail?: string): void {
  total += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

section("extraerComandos (las tres formas que hay en la base)");

check(
  'JSON con `commands`',
  extraerComandos('{"commands":["show version","show clock"]}').join("|") ===
    "show version|show clock",
  extraerComandos('{"commands":["show version","show clock"]}').join("|"),
);
check(
  "array JSON",
  extraerComandos('["show version","show clock"]').join("|") ===
    "show version|show clock",
);
check(
  "texto plano con saltos de línea",
  extraerComandos("show version\n\n  show clock  ").join("|") ===
    "show version|show clock",
);
check(
  "JSON con la clave alternativa `comandos`",
  extraerComandos('{"comandos":["show clock"]}').join("|") === "show clock",
);
check(
  "`commands` como string multilínea",
  extraerComandos('{"commands":"show version\\nshow clock"}').join("|") ===
    "show version|show clock",
);
check(
  "JSON inválido cae a texto plano (no se pierde la automatización)",
  extraerComandos("{show version").join("|") === "{show version",
);
check(
  "payload vacío",
  extraerComandos("").length === 0,
);
check(
  "payload null (automatización STANDARD vieja, sin comandos)",
  extraerComandos(null).length === 0,
);
check(
  "payload undefined",
  extraerComandos(undefined).length === 0,
);
check(
  "payload corrupto sin `commands` cae a texto plano, igual que el backend",
  extraerComandos('{"otro":1}').join("|") === '{"otro":1}',
  extraerComandos('{"otro":1}').join("|"),
);
check(
  "un JSON de comandos no numéricos no rompe",
  extraerComandos('{"commands":[1,true]}').join("|") === "1|true",
);

section("comandosATexto (el payload se relee al editar)");

check(
  "uno por línea",
  comandosATexto(["show version", "show clock"]) === "show version\nshow clock",
);
check(
  "lista vacía",
  comandosATexto([]) === "",
);
check(
  "descarta líneas vacías y recorta",
  comandosATexto(["  show version  ", "", "   "]) === "show version",
);
check(
  "ida y vuelta de un payload real",
  comandosATexto(
    extraerComandos('{"commands":["show version","show clock"]}'),
  ) === "show version\nshow clock",
);

section("MAX_COMANDOS_STANDARD");

check("el tope es 30 como en el backend", MAX_COMANDOS_STANDARD === 30);
check(
  "el parser no recorta: el backend avisa del exceso",
  extraerComandos(
    JSON.stringify({
      commands: Array.from({ length: 31 }, (_, index) => `comando ${index}`),
    }),
  ).length === 31,
);

section("comandosQueCierranSesion (aviso, no bloqueo)");

check(
  "exit / quit / logout / disconnect / close",
  comandosQueCierranSesion("exit\nquit\nlogout\ndisconnect\nclose").length === 5,
);
check(
  "no distingue mayúsculas",
  comandosQueCierranSesion("EXIT\nQuit").length === 2,
);
check(
  "con prefijo `do ` de Cisco IOS también cuenta (y se nombra la línea escrita)",
  comandosQueCierranSesion("do exit").join("|") === "do exit",
);
check(
  "`exit 1` con argumentos NO es un cierre de sesión",
  comandosQueCierranSesion("exit 1").length === 0,
);
check(
  "`show running-config` no se marca",
  comandosQueCierranSesion("show running-config").length === 0,
);
check("lista vacía", comandosQueCierranSesion("").length === 0);
check(
  "la lista coincide con la del clasificador del backend",
  COMANDOS_DE_CIERRE.join(",") === "exit,quit,logout,disconnect,close",
);

section("motivoDispositivoNoSoportado (espejo del `despachar`)");

check("SSH", motivoDispositivoNoSoportado({ protocol: "SSH" }) === null);
check("TELNET", motivoDispositivoNoSoportado({ protocol: "TELNET" }) === null);
check("SERIAL", motivoDispositivoNoSoportado({ protocol: "SERIAL" }) === null);
check(
  "SIMULATION + PACKET_TRACER",
  motivoDispositivoNoSoportado({
    protocol: "SIMULATION",
    typeDevice: "PACKET_TRACER",
  }) === null,
);
check(
  "SIMULATION + GNS3 NO se admite y se dice por qué",
  (motivoDispositivoNoSoportado({
    protocol: "SIMULATION",
    typeDevice: "GNS3",
  }) ?? "").includes("GNS3"),
);
check(
  "un protocolo desconocido avisa",
  (motivoDispositivoNoSoportado({ protocol: "XMPP" }) ?? "").includes("XMPP"),
);
check(
  "sin protocolo (deviceProviderId vacío) avisa",
  motivoDispositivoNoSoportado({}) !== null,
);
check(
  "deviceProviderId ausente (`undefined`) avisa",
  motivoDispositivoNoSoportado(undefined) !== null,
);
check(
  "SIMULATION con otro tipo de dispositivo avisa",
  motivoDispositivoNoSoportado({
    protocol: "SIMULATION",
    typeDevice: "COTELYX",
  }) !== null,
);
check(
  "la comparación es exacta como la del backend ('ssh' minúscula avisa)",
  motivoDispositivoNoSoportado({ protocol: "ssh" }) !== null,
);

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} · ${total - failures}/${total} checks en verde`,
);
process.exit(failures === 0 ? 0 : 1);
