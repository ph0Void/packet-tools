
import { conectorReal, runSuite } from "../test-terminal/bateria";
import {
  cerrarEnv,
  codeOfOutput,
  entero,
  env,
  write,
  finalizar,
  prepararEnv,
  skip,
} from "../test-terminal/harness";

async function main(): Promise<number> {
  write("=== BATERÍA DE TERMINALES (SSH / TELNET / SERIE) ===\n");
  write("Transporte: SERIAL\n");

  const serialPort = env("SERIAL_PORT");
  if (!serialPort) {
    skip(
      "equipo real por puerto serie",
      "sin SERIAL_PORT en el entorno: no hay hardware configurado y un puerto serie no se puede " +
        "simular con el servidor falso (es un TCP en 127.0.0.1). No es un fallo; para probar la " +
        "lógica sin nada externo usa `npm run test-terminal`.",
    );
    write(
      "\nVariables que harían falta: SERIAL_PORT (obligatoria, p. ej. COM3), SERIAL_BAUD (9600), " +
        "SERIAL_TYPE_DEVICE, SERIAL_NAME, SERIAL_COMMAND, SERIAL_PROMPT.\n" +
        "Sin nada externo, `npm run test-terminal` corre la batería completa contra el servidor falso.",
    );
    codeOfOutput();
    return 0;
  }

  const baudRate = entero(env("SERIAL_BAUD"), 9600);
  const team = {
    protocolo: "SERIAL" as const,
    serialPort,
    baudRate,
    kindDevice: env("SERIAL_TYPE_DEVICE") ?? null,
    name: env("SERIAL_NAME") ?? serialPort,
    command: env("SERIAL_COMMAND") ?? "show clock",
    prompt: env("SERIAL_PROMPT"),
  };
  write(`Equipo real: ${serialPort} @ ${baudRate} (comando de solo lectura: ${team.command})\n`);

  const envSuite = await prepararEnv();
  write("");
  await runSuite(envSuite.admin, envSuite.url, {
    ...team,
    connect: conectorReal(envSuite.admin, envSuite.url, team),
    etiqueta: `Serie ${serialPort} @ ${baudRate}`,
    mock: false,
  });
  write(`\nPara apuntar a otro puerto: cambia SERIAL_PORT y repite \`npm run test-serial\`.`);
  const code = codeOfOutput();
  await cerrarEnv();
  return code;
}

main().then(
  (code) => finalizar(code),
  (error: unknown) => finalizar(2, error),
);
