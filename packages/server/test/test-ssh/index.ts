
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
  write("Transporte: SSH\n");

  const host = env("SSH_HOST");
  if (!host) {
    skip(
      "equipo real SSH",
      "sin SSH_HOST en el entorno: no hay hardware configurado y un servidor SSH no se puede " +
        "simular con el servidor falso (es un TCP plano). No es un fallo; para probar la lógica " +
        "sin nada externo usa `npm run test-terminal`.",
    );
    write(
      "\nVariables que harían falta: SSH_HOST (obligatoria), SSH_PORT (22), SSH_USER, " +
        "SSH_PASSWORD, SSH_TYPE_DEVICE, SSH_NAME, SSH_COMMAND, SSH_PROMPT.\n" +
        "Sin nada externo, `npm run test-terminal` corre la batería completa contra el servidor falso.",
    );
    codeOfOutput();
    return 0;
  }

  const port = entero(env("SSH_PORT"), 22);
  const team = {
    protocolo: "SSH" as const,
    host,
    port,
    username: env("SSH_USER"),
    password: env("SSH_PASSWORD"),
    kindDevice: env("SSH_TYPE_DEVICE") ?? null,
    name: env("SSH_NAME") ?? host,
    command: env("SSH_COMMAND") ?? "show clock",
    prompt: env("SSH_PROMPT"),
  };
  write(`Equipo real: ${host}:${port} (comando de solo lectura: ${team.command})\n`);

  const envSuite = await prepararEnv();
  write("");
  await runSuite(envSuite.admin, envSuite.url, {
    ...team,
    connect: conectorReal(envSuite.admin, envSuite.url, team),
    etiqueta: `SSH ${host}:${port}`,
    mock: false,
  });
  write(`\nPara apuntar a otro equipo: cambia SSH_HOST y repite \`npm run test-ssh\`.`);
  const code = codeOfOutput();
  await cerrarEnv();
  return code;
}

main().then(
  (code) => finalizar(code),
  (error: unknown) => finalizar(2, error),
);
