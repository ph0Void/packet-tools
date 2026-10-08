
import { runSuiteMock } from "./bateria";
import {
  cerrarEnv,
  codeOfOutput,
  write,
  finalizar,
  prepararEnv,
} from "./harness";

async function main(): Promise<number> {
  write("=== BATERÍA DE TERMINALES (SSH / TELNET / SERIE) ===\n");
  write("Modo: simulado (servidor falso). No hace falta GNS3 ni hardware.\n");

  let env: Awaited<ReturnType<typeof prepararEnv>>;
  try {
    env = await prepararEnv();
  } catch (error) {
    write("");
    write(
      "El entorno no está listo:\n  " +
        (error instanceof Error ? error.message : String(error)),
    );
    write(
      "\nCómo arreglarlo:\n" +
        "  1. Base de datos creada y sembrada → `npm run seed` desde la raíz.\n" +
        "  2. Si el puerto está ocupado, exporta TERMINAL_TEST_PORT con otro valor.\n",
    );
    return 2;
  }

  write("");
  try {
    await runSuiteMock(env.admin, env.url, { protocolo: "TELNET" });
  } catch (error) {
    write(
      "\nError fatal durante la batería:\n" +
        (error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)),
    );
    await cerrarEnv();
    return 2;
  }

  write(
    "\nPara probar contra un equipo real: exporta SSH_HOST y SSH_USER (o TELNET_HOST, " +
      "o SERIAL_PORT, o GNS3_HOST) y lanza `npm run test-ssh`, `npm run test-telnet`, " +
      "`npm run test-serial` o `npm run test-gns3`.",
  );
  const code = codeOfOutput();
  await cerrarEnv();
  return code;
}

main().then(
  (code) => finalizar(code),
  (error: unknown) => finalizar(2, error),
);
