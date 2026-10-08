
import { conectorReal, runSuite, runSuiteMock } from "../test-terminal/bateria";
import {
  cerrarEnv,
  codeOfOutput,
  entero,
  env,
  write,
  finalizar,
  prepararEnv,
} from "../test-terminal/harness";

async function main(): Promise<number> {
  write("=== BATERÍA DE TERMINALES (SSH / TELNET / SERIE) ===\n");
  write("Transporte: TELNET\n");

  const host = env("TELNET_HOST");
  const port = entero(env("TELNET_PORT"), 23);

  if (!host) {
    write(
      `Sin TELNET_HOST en el entorno: se corre la batería completa contra el servidor falso\n` +
        `(mismo recorrido que \`npm run test-terminal\`; no es un fallo).\n`,
    );
    const envSuite = await prepararEnv();
    write("");
    await runSuiteMock(envSuite.admin, envSuite.url, {
      protocolo: "TELNET",
      name: "telnet-falso",
    });
    write("\nPara apuntar a un Telnet real: exporta TELNET_HOST (y TELNET_PORT si no es 23).");
    const code = codeOfOutput();
    await cerrarEnv();
    return code;
  }

  const team = {
    protocolo: "TELNET" as const,
    host,
    port,
    kindDevice: env("TELNET_TYPE_DEVICE") ?? null,
    username: env("TELNET_USER"),
    password: env("TELNET_PASSWORD"),
    name: env("TELNET_NAME") ?? host,
    command: env("TELNET_COMMAND") ?? "show clock",
    prompt: env("TELNET_PROMPT"),
  };
  write(`Equipo real: ${host}:${port} (comando de solo lectura: ${team.command})\n`);

  const envSuite = await prepararEnv();
  write("");
  await runSuite(envSuite.admin, envSuite.url, {
    ...team,
    connect: conectorReal(envSuite.admin, envSuite.url, team),
    etiqueta: `Telnet ${host}:${port}`,
    mock: false,
  });
  write(`\nPara apuntar a otro equipo: cambia TELNET_HOST y repite \`npm run test-telnet\`.`);
  const code = codeOfOutput();
  await cerrarEnv();
  return code;
}

main().then(
  (code) => finalizar(code),
  (error: unknown) => finalizar(2, error),
);
