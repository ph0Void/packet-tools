
import { isWithoutSession, invocar, record, truncate } from "../harness";

export async function phaseSession(): Promise<void> {
  console.log("\n--- FASE E: createTopology (requiere sesión) ---");

  const rCreates = await invocar("createTopology", {
    name: "prueba-tools",
    description: "topologia de prueba",
  });

  if (isWithoutSession(rCreates)) {
    record(
      "SKIP",
      "createTopology",
      "requiere sesión web (contexto de usuario) — no ejecutable desde script",
    );
    return;
  }
  record(
    rCreates?.success !== false ? "OK" : "FALLO",
    "createTopology",
    truncate(rCreates),
  );
}
