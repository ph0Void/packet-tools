# Contrato de los evals del arnés (Fase 6)

Este documento fija **qué** miden los evals y **por qué** los umbrales son esos.
No es una guía de uso del repo: es el contrato que hay que leer antes de tocar un
umbral, cambiar un guion o añadir un escenario.

## Qué es (y qué no es)

Un eval de arnés es un turno **real** del sistema con el modelo sustituido por un
guion. Todo lo demás es producción:

- el turno lo ejecuta `createTurnStream` (`agent/deep/turn.ts`), el mismo punto de
  entrada que usan el chat y el cron;
- el contexto vive en `requestContext.run(...)` (`utils/RequestContext.ts`), igual
  que en el router;
- la consola es una sesión registrada de verdad en `TerminalSessionHub`, con
  `write` simulado: por eso se puede **contar cuántas veces llegó un comando al
  dispositivo**;
- el HITL es el `ApprovalBroker` de verdad, y el escenario decide si aprueba o
  rechaza desde el propio canal SSE (`tool_approval_required` → `resolve`);
- la cola de terminal se compone con `construirBloqueTailTerminal`, la misma
  función que usa `ChatsRouter` (`api/router/turnoStream.ts`);
- el puente de Packet Tracer es el único trozo sustituido (`ciscoClient.callTool`,
  mismo patrón que `pt-ciclo-consola.test.ts`), porque sin extensión real cada
  tool esperaría hasta 45 s.

Lo único que **no** se mide es qué haría el modelo real. Los guiones deciden qué
tool se pide; un eval no puede afirmar que un LLM real habría pedido la tool con la
keyword correcta. Eso se documenta en `EVALS.md` y solo se comprueba con un modelo
real o con hardware.

## Las cinco magnitudes

| Magnitud | De dónde sale |
| --- | --- |
| `llm.calls` | nº de invocaciones a `_generate` del modelo falso en el turno, por nodo |
| `input_tokens` | `estimarTokensMensajes` (`agent/deep/metrics.ts`) + schemas REALES de las tools **ligadas en esa llamada** |
| `toolCalls` | `ToolMessage` del stream, clasificados con `clasificarEstadoToolResult` (la misma del router) |
| `respuesta` | texto de los chunks de AI del nodo principal, tal como lo vería el usuario |
| `escrituras` | `write` de la consola simulada: nº de veces que un comando llegó al dispositivo |

`input_tokens` usa la **misma estimación que el resto del proyecto**
(`≈4 caracteres por token`), a diferencia de `BASELINE.md` §Fase 4, que además
sustituyó los schemas de tools por una constante. Aquí los schemas se miden de
verdad sobre las tools ligadas, así que **las cifras de tools no son comparables
con las de las fases anteriores** (son mayores porque son reales).

## Cómo se inyecta el modelo (sin tocar producción)

`evals.test.ts` hace:

```ts
vi.mock("@/agent/Model", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/agent/Model")>();
  return {
    ...original,                       // buildSystemPrompt sigue siendo el real
    getModelProvider: /* modelo falso */,
    getModelProviderWithMeta: async () => ({ model: nuevoModeloFalso(), provider: "CUSTOM" }),
  };
});
```

El supervisor y los siete especialistas resuelven el modelo por esa función, así
que el guion los cubre a todos sin tocar `DeepSupervisor`, `runner` ni `turn`.
Si alguien añade otro punto de construcción de modelos, el mock **lanza** en vez
de llamar a la red.

Dos detalles que no son negociables:

- **Nodo = system prompt.** Cada llamada se atribuye al agente cuyo prompt
  compuesto vio (`identificarNodo`), no al orden de construcción: el supervisor y
  `general-purpose` comparten instancia de modelo.
- **El modelo falso emite `tool_call_chunks`.** `_streamResponseChunks` construye
  el chunk como lo haría un proveedor real. Sin eso, la puerta de
  `fastPathStream` no vería las `tool_calls` y el eval mediría un repliegue al
  supervisor que en producción no ocurre.

## Flags

`envConfig` es un objeto plano leído al cargar el módulo. Para medir el fast path
(Q2/D3, `FAST_PATH_ENABLED`, default OFF) `ejecutarTurno` enciende la propiedad en
runtime y la restaura en el `finally`. **No se toca el `.env`.**

`ruta.prevista` es la decisión de `decidirFastPath` con los MISMOS datos del turno
(y con la cola ya añadida al mensaje, porque es lo que lee `turn.ts`).
`ruta.previstaConFlag` es la misma predicción con la flag encendida, para poder
medir qué decidiría el fast path sin alterar el ruteo que se está midiendo.

## Aislamiento entre escenarios

`limpiarAislamiento()` (antes de cada turno y en `afterAll`):

| Estado | Cómo se limpia |
| --- | --- |
| Modelo | `activarGuion(null)` + instancia nueva por agente |
| Supervisor cacheado | `clearDeepSupervisorCache()` (el runner cachea por modelo+rol) |
| Identidad | `modelProviderId` y `threadId` propios de cada escenario |
| Terminal | `terminalSessionHub.clear()` + `stopKeepalive()` |
| HITL | `approvalBroker.clear()` + `resetApprovalAttempts()` |
| Delegaciones (V6) | `resetDelegaciones()` |
| Tools perezosas | `resetToolsActivadas()` |
| Presupuesto | `resetBudgetCounters()` |
| Mocks | `vi.restoreAllMocks()` |

## Reglas para cambiar un umbral

1. **Un umbral es un contrato, no una observación.** Si sube sin que cambie el
   diseño, es una regresión aceptada: dilo en el PR y anótalo en `EVALS.md`.
2. **Nada de `≥` donde el objetivo es `≤`.** Los tokens y las llamadas solo pueden
   bajar; los guiones solo pueden crecer si el guion crece.
3. **Todo hallazgo va como escenario de caracterización**, con su número y su
   propuesta de arreglo, nunca como excepción silenciosa. Así, cuando se arregle,
   el eval dice que hay que cambiarlo.
4. **Un eval que necesita red, hardware o una API key no es un eval.** Si no se
   puede decidir con `vi.mock`, el caso no entra aquí.

## Los dos escenarios caracterizaban un defecto y ya fijan el contrato

Ninguno de los dos queda como excepción silenciosa: al arreglar el defecto, sus
umbrales pasaron de «esto es lo que hace hoy» a «esto es lo que DEBE hacer».

- `hallazgo-send-command-duplicada` (E1): el payload de `send_command` siempre lleva
  `"timedOut"`, y el patrón transitorio de `ToolErrorClassifier` casaba con el
  **nombre** del campo; `duplicateGuardMiddleware` no podía cortar un
  `send_command` repetido. **Arreglado**: el fallo se decide por el VALOR
  (`readCacheMiddleware.textoDeSenalesDeFallo` deja fuera `"timedOut":false` y los
  patrones se aplican sobre ese texto). El eval ahora fija `= 1` ejecución real y
  `≥ 1` bloqueo, y que un `send_command` correcto se clasifique como `unknown`.
- `hallazgo-puerta-fast-path` (E2): `fastPathStream.observarChunk` miraba `tool_calls`
  sobre el chunk crudo, pero `streamMode:"messages"` entrega tuplas
  `[mensaje, metadata]`. **Arreglado** con `deep/streamChunk.ts`, que normaliza el
  item (misma regla que `extractStreamChunk` del router). El eval ahora fija
  `llm.calls = 2`, supervisor `= 0` y que el especialista ejecutó la tool.

Los otros dos que también cambiaron de significado:

- `fastpath-conservador`: fijaba que «quiero saber el modelo del sistema» NO entraba
  por la vía rápida (`VERBOS_DE_EJECUCION` no incluía «querer saber»). **Arreglado**
  (E3b): ahora fija que SÍ entra, en 2 llamadas. La contrapartida —que una pregunta
  teórica no entra— la sigue fijando `pregunta-teorica`.
- `cola-consola-25-lineas`: fijaba que 25 líneas de cola descartaban el fast path.
  **Arreglado** (E3a): `decidirFastPath` decide sobre el texto sin la cola
  (`textoSinColaDeTerminal`), así que ahora fija que NO lo descartan, más una
  comprobación de que el mensaje con la cola sí supera `MAX_CHARS` (si no, el umbral
  no estaría probando nada).

## Comandos

```bash
npm run eval                       # tabla por escenario; sale ≠0 si un umbral se incumple
npx vitest run test/agent-evals/evals.test.ts   # solo la suite, sin la tabla
npm test                           # la suite completa, evals incluidos
```

`npm run eval` lanza la suite y lee el JSON que deja en `afterAll`
(`rutaInforme.ts`, en el tmp del sistema). Si la suite no termina, `run.ts` no
imprime una tabla vieja y sale con código ≠0: nunca se muestra el informe de una
ejecución anterior.