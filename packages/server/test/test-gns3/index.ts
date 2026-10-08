
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
  write(
    "Transporte: TELNET hacia la CONSOLA del nodo de GNS3\n" +
      "(es un Telnet: el mismo camino que `npm run test-telnet`, con otro host y puerto)\n",
  );

  const host = env("GNS3_HOST");
  if (!host) {
    skip(
      "nodo de GNS3",
      "sin GNS3_HOST en el entorno: no hay ningún nodo al que perguntarle. No es un fallo; la " +
        "consola de un nodo es un Telnet, así que el mismo recorrido se prueba sin nada externo " +
        "con `npm run test-terminal` (servidor falso) o `npm run test-telnet` (servidor falso, " +
        "salida idéntica).",
    );
    write(
      "\nVariables que harían falta: GNS3_HOST (obligatoria), GNS3_PORT (23 = puerto de consola " +
        "del nodo), GNS3_TYPE_DEVICE, GNS3_NAME, GNS3_COMMAND, GNS3_PROMPT.\n" +
        "Sin nada externo, `npm run test-terminal` corre la batería completa contra el servidor falso.",
    );
    codeOfOutput();
    return 0;
  }

  const port = entero(env("GNS3_PORT"), 23);
  const team = {
    
    protocolo: "TELNET" as const,
    host,
    port,
    kindDevice: env("GNS3_TYPE_DEVICE") ?? "CISCO",
    name: env("GNS3_NAME") ?? "gns3",
    command: env("GNS3_COMMAND") ?? "show clock",
    prompt: env("GNS3_PROMPT"),
  };
  write(`Nodo real: ${host}:${port} (consola Telnet · comando de solo lectura: ${team.command})\n`);

  const envSuite = await prepararEnv();
  write("");
  await runSuite(envSuite.admin, envSuite.url, {
    ...team,
    connect: conectorReal(envSuite.admin, envSuite.url, team),
    etiqueta: `GNS3 ${host}:${port} (consola Telnet)`,
    mock: false,
  });
  write(`\nPara apuntar a otro nodo: cambia GNS3_HOST/GNS3_PORT y repite \`npm run test-gns3\`.`);
  const code = codeOfOutput();
  await cerrarEnv();
  return code;
}

main().then(
  (code) => finalizar(code),
  (error: unknown) => finalizar(2, error),
);
