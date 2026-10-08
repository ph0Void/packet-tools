# EXTENSIÓN DE PACKET TRACER

## SOBRE LA EXTENSIÓN

- Extensión de Cisco Packet Tracer (`Plugin-PacketToolsAPIv1.0.8.pts`).
- La extensión es un cliente socket.io.
- La extensión se conecta al backend en `http://127.0.0.1:7531` con reconexión automática.
- Recibe el evento `tool_call` del backend, ejecuta la función en el motor de scripts de Packet Tracer y devuelve el resultado por `tool_result` (con cola de reentrega si se cae la conexión).
- Es necesario que esté abierta para el correcto funcionamiento de los agentes.

## INSTALACIÓN

1. Copia la carpeta `extension-packetracer/` (o instala `Plugin-PacketToolsAPIv1.0.8.pts`) dentro del directorio `extensions` de tu instalación de Cisco Packet Tracer y reinicia el programa.
2. Con el backend corriendo (`npm run dev`), abre **Extensions > Packet Tracer API**; se abrirá una ventana que muestra el estado de la conexión (`interface/index.html`).
3. Desde el chat o el workspace de Packet Tools ya puedes pedirle al agente que cree topologías, añada dispositivos y simule tráfico.

## COMO FUNCIONA

- `interface/interface.js` recibe el evento `tool_call` del backend y arma una
  llamada posicional a partir de `TOOL_ARGS` (el orden de los argumentos de
  cada herramienta).
- La llamada se ejecuta en el motor de scripts de Packet Tracer con
  `$se("runCode", "return <funcion>(<args>);")` y el resultado vuelve por
  `tool_result`.
- `userfunctions.js` define todas las funciones globales expuestas. Están
  escritas en ES5 (`var` + `function`), devuelven siempre
  `{success: true|false, ...}` y cada una envuelve su cuerpo en `try/catch`.
- Las funciones internas (las que empiezan por `__`, mas `pduPing` y `__pingCli`)
  **no** llevan entrada en `TOOL_ARGS`: el backend no las puede llamar.

## MARCA DE BUILD (`EXTENSION_BUILD`)

`userfunctions.js` empieza por una constante con la fecha/hora de modificación
del propio fichero:

```js
  var EXTENSION_BUILD = "2026-10-03T03:26:07";
```

- El valor debe coincidir **exactamente** con el `mtime` de
  `extension-packetracer/userfunctions.js` en el repo, en formato ISO local
  `yyyy-MM-ddTHH:mm:ss`
  (`(Get-Item extension-packetracer/userfunctions.js).LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ss')`
  en PowerShell). Si editas el fichero, vuelve a leer el mtime y actualiza la
  constante.
- Se expone en la respuesta de `listDeviceModels` como campo `build` (esa tool
  es la que la suite ya usa para comprobar vida, así no se toca ningún
  contrato).
- La suite `npm run test-pt` lo verifica al arrancar, junto a la comprobación
  de vida: si el build que reporta Packet Tracer no coincide con el mtime del
  repo (o no viene), registra un FALLO con `EXTENSIÓN DESACTUALIZADA` y sale
  con código 1. Motivo: si se regenera el `.pts` pero PT sigue ejecutando el
  código viejo, las pruebas fallan después con estados que ya no existen
  (p. ej. `pdu_error`) y solo se detecta leyendo el log a mano. Tras regenerar
  el `.pts`, recarga o reinicia Packet Tracer antes de volver a lanzar la
  suite.

## FUNCIONES EXPUESTAS AL BACKEND

### Nuevas

| Funcion | Argumentos posicionales | Descripcion |
| --- | --- | --- |
| `runDeviceCommands` | `deviceName, commands, options` | Motor de comandos: ejecuta un array de comandos sobre la consola del equipo y devuelve la salida real de cada uno (`{command, status, output}` + `summary`). `status` es `ok` \| `error` \| `unknown`: `unknown` = sin salida util (nunca se reporta `ok` con `output:""`). Antes de enviar nada "despierta" la consola (ver *Despertar la consola*), espera a que quede **inactiva** (ver *Consola inactiva*) y, si la detecta bloqueada por DNS, **no envia ningun comando** y devuelve todos los resultados en `unknown` mas el diagnostico en `payload.despertar`. `options` = `{mode, waitMs, maxChars}` (`mode` en `"user"\|"enable"\|"global"`). Campos de diagnostico **aditivos** (solo aparecen cuando hay algo que avisar, asi que la forma del payload no cambia en el caso normal): `despertar`, `modo`, `preambulo`, `arranque_pendiente`, `corte` + `salida_recortada` (cortes degradados) y `consola_ocupada` (ver *Corte de la salida de consola* y *Consola inactiva*). |
| `runCommandAsync` | `deviceName, commands, options` | **Fase 1** del motor en dos fases (ver *Evento `commandEnded`*): asegura el modo, registra `commandEnded`, envia el lote y devuelve `{success, pendienteId, deviceName, comandos, modo, eventoRegistrado, t0}` **de inmediato**, sin esperar la salida. `eventoRegistrado:false` = esa API no existe en ese PT. `options` = `{mode, waitMs, maxChars, preambulo, esperaFin, reiniciarSimulacion}`. |
| `pollCommandResult` | `pendienteId, options` | **Fase 2**: sondea un pendiente abierto. `en_curso` mientras el evento `commandEnded` no ha saltado, `terminado` con `results[]` cuando ha saltado (misma forma que `runDeviceCommands`) o cuando no habia senal disponible (`fuente:"buffer"`). En cada ronda **resuelve bloqueos de consola** (ver *Bloqueos de consola durante el sondeo*): si un prompt pendiente se ha comido el comando responde `reintentar` con `comandoConsumido:true`. `options` = `{esperarMs, maxChars, esperaFin}`. Al devolver `done:true` **cierra** el pendiente: la siguiente llamada da `success:false` con `pendiente desconocido o ya cerrado`. |
| `readDeviceConsole` | `deviceName, lines` | Solo lectura: ultimas `lines` (40 por defecto) del `getOutput()` de la consola. |
| `pingDevices` | `sourceName, targetName, options` | Ping ICMP **hibrido: PDU primero, CLI de respaldo** (ver *Ping por PDU*): `{success, ok, source, target, reversed, protocol, sourceIp, targetIp, sent, received, lossPercent, rttAvg, status, output, metodo}`, con `status` en `ok` \| `no_reply` \| `unsupported_device` \| `source_not_found` \| `target_not_found` \| `no_ip` \| `command_failed` \| `console_blocked` \| **`interfaz_no_lista`** (ver *Pre-flight de interfaces*) y **`metodo`** en `pdu` \| `cli` (campo aditivo: que via se resolvio). `sourceIp`/`metodo` son aditivos y el backend los ignora. `options` = `{metodo, probarReverso, waitMs, pollMs, maxSteps, stepMs, reiniciarSimulacion, esperaInterfazMs, reintentoEsperaMs}`: `metodo:"cli"` fuerza la via CLI, `probarReverso:false` desactiva el sondeo en sentido contrario, `esperaInterfazMs` acota (nunca sube de 5 s) la espera del pre-flight de interfaces y `reintentoEsperaMs` acota (nunca sube de 3 s) la espera antes del **unico reintento** del PDU cuando este no sale del origen (ver *Reintento cuando el PDU no sale del origen*; por defecto 800 ms). Campo **aditivo** `corte:"degradado"` (solo via CLI): el sondeo del bucle no pudo cortar la salida del ping de forma fiable (ver *Corte de la salida de consola*). Campo **aditivo** `modoRestaurado` (`true` \| `false`): el ping por PDU **entra en modo simulacion y sale al terminar**; vale `false` solo si PT se quedo en simulacion, para que se pueda verificar desde fuera (tamben en la via de respaldo, donde siempre es `true`). |
| `pduPing` | `sourceName, targetName, options` *(interno)* | Ping por PDU. **No esta en `TOOL_ARGS`**: es el motor de la via PDU de `pingDevices` y `reachabilityMatrix`, no una tool que el backend pueda llamar (exponerla seria anadir `pduPing: ["sourceName","targetName","options"]` en `interface/interface.js`, y `pduPing` a `PacketTracerClient`/`Tool.ts`). Mismo contrato de payload que `pingDevices` con `metodo:"pdu"` y `reversed:false` siempre. **REQUIERE modo simulacion** (en tiempo real el PDU no genera frames): entra antes de crear el PDU y restaura el modo previo en su `finally`. `options` = `{maxSteps, stepMs, reiniciarSimulacion, esperaInterfazMs, reintentoEsperaMs}` (techo de 40 `forward()`, 100 ms entre ellos, `reiniciarSimulacion:false` desactiva el `resetSimulation()`, `reintentoEsperaMs` recorta la espera del unico reintento, tope 3 s y por defecto 800 ms). El veredicto sale del **viaje de ida y vuelta** (ver *Ping por PDU*), con `accepted` como refuerzo. Campos aditivos: `modoPrevio`, `modoEntrada` (`rsswitch` \| `sin_cambio` \| `fallo`), `modoRestaurado`, `resetSimulacion`, `filtroDispositivos`, `framesPareja`, `framesAjenos`, `descartadoEn` (`origen` \| `destino` \| `intermedio` \| `""`), `llegoAlDestino`, `volvioAlOrigen`, `viajeCompleto`, `aceptadoDestino`, `aceptadoOrigen`, `aceptadoSinEquipo`, `indiceDestino`, `indiceOrigen`, `noSalioDelOrigen`, `destinoEnCola`, `origenEnCola`, `steps`, `framesVistos`, `rttUnidad`, `transitViaje`, `rttFuente`, `pduPendiente`, `aviso`, y del pre-flight `interfacesEsperadas`, `interfacesComprobadas`, `interfacesListas`, `estadoInterfazDesconocida`, `estadoInterfazOrigen`, `estadoInterfazDestino`, y del reintento `reintentosPdu` (0 o 1, siempre presente) y `reintentado` (`true` solo si el veredicto es del segundo intento). |
| `reachabilityMatrix` | `sourceName, targetNames` | Bucle sobre `pingDevices` (maximo 10 destinos, ya hibrido): `{success, source, rows:[{target, ok, received, lossPercent, status, metodo, modoRestaurado}]}`. `metodo` y `modoRestaurado` por fila son aditivos; cada fila reinicia la linea de tiempo de la simulacion, asi que los pings seguidos no se contaminan. Acota `maxSteps:30`, `esperaInterfazMs:1500` y `reintentoEsperaMs:400` por fila (peor caso 10 x 7,6 s = 76 s, dentro de los 90 s del backend; ver *Reintento cuando el PDU no sale del origen*). |
| `validateTopology` | *(sin argumentos)* | Valida la topologia en memoria: `errors`, `warnings`, `orphans`, `loops`, `unresolvedLinks` (enlaces descartados por no resolver alguno de sus extremos) y `nullPortLinks` (enlaces corruptos sin puerto en un extremo). |
| `listDeviceModels` | *(sin argumentos)* | Lista todos los modelos de `allDeviceTypes` como `{id, label, category}` y añade `build` con la marca de build de la extensión (ver más abajo). |
| `listDeviceModules` | `deviceName` | Modulos soportados por el equipo (`getSupportedModule`). |
| `getDeviceConfigSnapshot` | `deviceName` | `runningConfig` + `startupConfig` (texto con `\n`, sin banner/prompt ni la linea `end`), alias `config`, `xml` (`serializeToXml`), `startupEmpty` (cuando el startup acaba en blanco) y `warning` opcional. En IOS lee ambos por consola via `runDeviceCommands` (`show running-config` y, si el startup viene vacio, `show startup-config`); si la consola devuelve basura (dialogo, prompts, `%` o solo `^`) **no** se considera config: se hace fallback al propio `xml` (bloques `<RUNNINGCONFIG>`/`<STARTUPCONFIG>`, texto ya desescapado de `&amp;`/`&lt;`/`&gt;`/`&quot;`) y se anade el aviso `running_config_desde_xml` (el fallback de startup no anade aviso propio; se marca en su sitio con `startupEmpty`). En PC/Server `runningConfig` queda vacio y se marca `non_ios_device`. |
| `applyDeviceConfig` | `deviceName, configText` | Aplica un config de texto linea a linea delegando en `runDeviceCommands`. |
| `clearWorkspace` | *(sin argumentos)* | Limpia el workspace (`fileNew(false)`). |
| `exportWorkspace` | `filename, targetDir` | Exporta el `.pkt`: primero `fileSaveAsNoPrompt`, si no `fileSaveToBytes` + base64 propio. |
| `importWorkspace` | `filename, sourcePath, base64` | Importa el `.pkt`: primero `fileOpen(sourcePath)`, si no `fileOpenFromBytes` con base64 propio. |

### Reescrituras (mismo nombre y firma, ahora con salida real)

| Funcion | Argumentos | Cambio |
| --- | --- | --- |
| `setSimulationMode` | `toSimMode` | **Arreglada**: `sim.setSimulationMode(bool)` LANZA en PT 9 (`Invalid arguments for IPC call`), asi que ahora usa `ipc.appWindow().getRSSwitch().showSimulationMode()` / `showRealtimeMode()` y, solo si ese objeto no existe, cae a la API del objeto de simulacion dentro de su propio `try/catch`. Si ambas fallan devuelve un error **explicito** que dice que PT 9 rechaza el argumento. Campos aditivos: `via` (`sin_cambio` \| `rsswitch` \| `simulacion` \| `ninguna`) y `modoAnterior`. El payload de exito (`{success, message, mode}`) no cambia. **El ping por PDU la usa** (vía `__irASimulacion`), porque el PDU solo avanza en simulacion: entra antes de medir y devuelve PT al modo previo. Ojo con el **argumento posicional** `toSimMode` (`interface/interface.js`, `TOOL_ARGS`): mandarlo como `simulation` devuelve `sin_cambio` sin cambiar nada. |
| `getSimulationStatus` | *(sin argumentos)* | El modo sale de `sim.isSimulationMode()` como **fuente de verdad** (antes se derivaba de otra cosa y no coincidia). Mantiene `mode`, `currentTime`, `frameCount` y `currentFrameIndex` — los contadores ahora se leen **tambien en tiempo real** (cada getter va envuelto, PT 9 no los expone todos) — y anade `conmutadorVentana` (`disponible` \| `no_disponible`) y `modoDesconocido` si el modo no se pudo leer. |
| `getPduResults` | `types` *(y `options`)* | Tope **configurable** (`options.limit`, por defecto `PDU_RESULTADOS_LIMITE` = 50, maximo 500) en vez del recorte fijo; anade `options.sinceIndex` / `options.sinceFrameCount` para pedir **solo los frames nuevos** (es lo que usa el ping por PDU para aislar los suyos), mas `truncated` y `modo` en `result`. Por frame anade `device` (`getDevice()`, que **si** viene en PT 9) y `transitTime` (`getTransitTime()`, que son **unidades de simulacion**, no ms) **solo si son utilizables**; `source`/`destination` se copian tal cual (en PT 9 vienen **vacios**, ver *Ping por PDU*). Esta lectura **no** exige modo simulacion (el historial se lee igual); lo que exige simulacion es **medir**, y de eso se encarga `pduPing`. Como `TOOL_ARGS` solo reenvia un argumento posicional, `options` tambien se puede pasar como **primer** argumento en forma de objeto: `getPduResults({types:["ICMP"], sinceIndex: n, limit: 10})`. |
| `sendPdu` | `sourceDevice, destinationDevice` | Delega el cambio de modo en `setSimulationMode` (el anterior llamaba a la API que revienta) y, como en tiempo real el PDU no genera frames, que el modo no cambie ya **no aborta** el envio: el PDU se queda pendiente hasta que el usuario simule, y se avisa en el payload. |
| `configureIosDevice` | `deviceName, commands` | Delega en `runDeviceCommands` con `mode:"global"` (el codigo anterior usaba los modos invalidos `"configure"`/`"interface-config"`) y hace `write memory` / `do write memory` best-effort. Devuelve `results` por linea + `summary`. |
| `simulateLinkFailure` | `deviceName, interfaceName, durationSeconds` | `interface <if>` + `shutdown` con `mode:"global"`. |
| `restoreLink` | `deviceName, interfaceName` | `interface <if>` + `no shutdown` con `mode:"global"`. |
| `getRoutingTable` | `deviceName` | Preset de `show ip route`. |
| `getVlanConfiguration` | `switchName` | Preset de `show vlan brief`. |
| `getDeviceMetrics` | `deviceName` | Preset de `show processes cpu` + `show memory statistics`. |
| `validateSecurityConfig` | `deviceName` | Preset de `show running-config \| include enable\|service\|line vty` (con fallback a `show running-config`). |

### Eliminadas (duplicadas o inertes)

`diagnoseConnectivity`, `scanNetwork`, `batchConfigureDevices`,
`startTrafficMonitor`, `generateNetworkReport`, `backupDeviceConfig`,
`restoreDeviceConfig`.

Su entrada tambien se borro de `TOOL_ARGS` en `interface/interface.js`.

### Sin cambios

`addDevice`, `addModule`, `addLink`, `removeDevice`, `removeLink`,
`configurePcIp`, `getNetwork`, `getDeviceInfo`, `stepSimulation`,
`renameDevice`, `moveDevice`, `setPower`, `getCommandLog`,
`exportTopologyJSON`, `loadTopologyFromJSON`.

## PING POR PDU (via principal del ping)

El ping es **hibrido**: `pduPing` (PDU) primero y, si el PDU no es viable, el
ping por CLI de siempre (`__pingCli`). El payload es **el mismo** en las dos
vias, asi que `interpretarPing` / `interpretarMatrizAlcance` del backend
consumen los dos sin ningun cambio; solo se anaden campos (`metodo`,
`sourceIp`, `steps`, `framesVistos`, `rttFuente`, `rttUnidad`, `transitViaje`,
`pduPendiente`, `reversoOk`, `modoPrevio`, `modoEntrada`, `modoRestaurado`,
`resetSimulacion`, `filtroDispositivos`, `framesPareja`, `framesAjenos`,
`descartadoEn`, `llegoAlDestino`, `volvioAlOrigen`, `viajeCompleto`,
`noSalioDelOrigen`, `aceptadoDestino`, `aceptadoOrigen`, `aceptadoSinEquipo`,
`indiceDestino`, `indiceOrigen`, `destinoEnCola`, `origenEnCola`,
`interfacesEsperadas`, `interfacesComprobadas`, `interfacesListas`,
`estadoInterfazDesconocida`, `estadoInterfazOrigen`, `estadoInterfazDestino`,
`aviso`).

Lo unico que **no** es aditivo es el `status` nuevo `interfaz_no_lista` (ver
*Pre-flight de interfaces*): es un estado de fallo explicito, para que un enlace
recien configurado que aun no ha levantado no se reporta como "el destino no
responde". El backend lo conoce (`PING_ESTADOS_DE_ERROR` en `Tool.ts`), asi que
no se toca ninguna forma de payload.

### Lo que esta MEDIDO (no es suposicion)

Sondeado contra Packet Tracer 9 real con
`packages/server/scripts/pt-diag-framedev.ts` (volcado de **50 frames** de un
PDU `PC1 -> R1` en modo simulacion, con sus claves, equipos y estados) y con
`packages/server/scripts/pt-diag-pduping.ts` (que habla con la extension por
`ciscoClient.callTool`):

| Dato | Valor medido |
| --- | --- |
| **El PDU solo fluye en MODO SIMULACION** | en **tiempo real**: `addSimplePdu` + 12 `forward()` → **0 frames nuevos** (`no_reply`, sin veredicto). En **simulacion** (`setSimulationMode {toSimMode:true}` → `via:"rsswitch"`): el **1er** intento leyó 34 frames y el veredicto fue contra un frame de un PDU **viejo** (`descartado en SRV1`), el **2º** intento dio `ok:true`, `metodo:"pdu"`, `sent=1 rec=1 loss=0%` con **16 frames de ICMP, entregado en PC1 (sim 5853807)** |
| **`fi.getDevice()` SI funciona** | **50 de 50** frames con nombre de equipo (`PC1`, `R1`, `SW1`, `PC2`, `SRV1`). Es la atribución fiable: el filtro por pareja es viable y no hace falta degradar al rango sin atribuir (eso queda solo como red de seguridad) |
| Claves de un frame | `destination`, `device`, `index`, `source`, `status`, `trafficType`, `transitTime` |
| `status:"accepted"` **NO aparece** | los frames van de `buffered` a `sent` y **vuelven** a `buffered`. Por eso el veredicto **no puede depender de `accepted`** (queda como refuerzo) |
| **La firma de un viaje completo** | `16 PC1 (sent)` → `17 SW1` → `18 SW1` → `19 R1 (sent)` **llega** → `20 PC1 (sent)` **vuelve**: un frame en el ORIGEN, uno en el INTERMEDIO, uno en el DESTINO y **otro en el ORIGEN con índice MAYOR** (la respuesta). Ese último frame es la firma; el switch se ignora |
| `transitTime` | **0 o 1**: son **unidades de simulación**, **no milisegundos** (por eso el RTT se mide con el reloj de simulación, ver abajo) |
| Frames de PDUs viejos | se mezclan en el mismo volcado (`SRV1` y `PC2`, e incluso un `dropped` **en R1**, que es un equipo de la pareja): `resetSimulation()` + filtro por dispositivo son imprescindibles |
| `addSimplePdu(origen, destino)` | devuelve un `errCode` (0/falsy = OK, otro valor = `ADD_PDU_ERROR`). Solo acepta **nombres** de dispositivo (no IPs) |
| Avance de los frames | **solo** con `sim.forward()`, y hace falta margen: un ping completo son **16-34 frames** (por eso el presupuesto es de **40 pasos a 100 ms**, no 12) |
| Estados de frame | `buffered` ⇄ `sent`, y `dropped` / `not_forwarded` / `unexpected` / `collision` cuando el frame muere |
| `getSourceString()` / `getDestinationString()` | **cadena vacia** en todos los frames: los frames se identifican **por indice** y, para atribuirlos, por `getDevice()` |
| `sim.setSimulationMode(bool)` | **LANZA**: `Invalid arguments for IPC call "setSimulationMode"` (probado con las tres variantes del nombre de argumento) |
| `getRSSwitch().showSimulationMode()` / `showRealtimeMode()` | es la via que funciona para cambiar de modo (y la que usa el ping por PDU para entrar y salir) |
| `sim.resetSimulation()` | vacia frames y reloj; **no** toca la topologia ni la configuracion de los equipos (eso es `clearWorkspace`) |
| Indice del escenario de PDU | `addSimplePdu` devuelve solo el `errCode` y `UserCreatedPDU` no expone `getScenarioCount` en la API documentada |

Ojo con el sondeo anterior (`pt-diag-pdu.ts`): dio la conclusion **falsa** de
que "no hace falta simular" porque PT ya estaba en modo simulacion. La tabla de
arriba es el sondeo controlado (realtime → simulacion → realtime).

### La secuencia exacta de `pduPing`

1. **Pre-validado** (equipos, `TIPOS_SIN_PDU`, IP utilizable de los dos con
   `__ipUtilDe`). Si algo falla se devuelve `source_not_found` /
   `target_not_found` / `unsupported_device` / `no_ip` **sin haber tocado el
   modo** (y sin llamar nunca a `addSimplePdu`, que es lo que congela PT con el
   dialogo *"No Functional Ports"*).
2. **Pre-flight de interfaces** (`__estadoInterfaz` + `__esperarInterfazLista`):
   espera a que origen y destino tengan interfaz operativa antes de crear el
   PDU. Si no llega a tiempo se devuelve `interfaz_no_lista`, tambien sin tocar
   el modo y **sin llamar a `addSimplePdu`** — ver *Pre-flight de interfaces*.
3. **Se guarda el modo real**: `simPrevio = sim.isSimulationMode() ? "simulation"
   : "realtime"`, y se comprueba que exista `getUserCreatedPDU()` (`command_failed`
   si no).
4. **Si no estamos en simulacion, se entra** con `__irASimulacion(true)`, que
   delega en `setSimulationMode(true)` (conmutador de la ventana y, si no
   existe, la API del objeto de simulacion). Si **no** se puede entrar → `status
   "command_failed"` con el motivo y el hibrido cae a `__pingCli`. En tiempo real
   no se intenta el PDU: esta medido que no genera frames.
5. **`sim.resetSimulation()`** para que la medicion arranque desde un estado
   conocido (los PDUs de pings anteriores siguen pendientes y avanzan con
   nuestros `forward()`). Desactivable con `options.reiniciarSimulacion:false`
   y **best effort**: si lanza, se sigue con un aviso en `aviso`.
6. `antes = sim.getFrameInstanceCount()`, `t0 = sim.getCurrentSimTime()`
   (**despues** del reset).
7. `addSimplePdu(origen, destino)`; si el `errCode` es truthy y distinto de
   `"0"` → `command_failed` con el `ADD_PDU_ERROR` y no se sigue.
8. Bucle de `sim.forward()` con `__busyWait(100)` y presupuesto de **40** pasos,
   parando en cuanto hay **veredicto por viaje completo** (o `accepted`, o un
   negativo), sin esperar al techo.
9. Se recogen **solo los frames con `index >= antes`** y, de entre ellos, **solo
   los de los equipos de la pareja** (origen y destino) — ver *Filtro por
   dispositivos*.
10. Veredicto (ver tabla siguiente) y `finally`: **restaurar el modo** solo si
    lo cambiamos nosotros.

### Pre-flight de interfaces (por que el PDU ya no se crea a ciegas)

**MEDIDO (suite `test-pt`, 41 OK / 1 FALLO, el unico FALLO era `pingTopology`):**

```
PDU ICMP PC1 -> R1: 2 frame(s) de ICMP, el PDU no llegó a salir de PC1 (sim 31146):
el equipo destino no responde
El sentido contrario (R1 -> PC1) SÍ responde: el problema es de un solo sentido
```

Los dos datos de ese mensaje lo explicaban: **"2 frame(s)"** (el PDU se quedo
encolado en PC1 y nunca se transmitio, o sea que el problema era el **enlace del
origen**, no el destino) y **"el sentido contrario SI responde"** (la topologia
estaba bien: era una condicion de carrera del primer ping tras montar la
topologia; `reachMatrix`, que repite los mismos pings DESPUES, si pasa). El
mensaje de antes **mentia** en el diagnostico y por eso el agente cambiaba una
configuracion que ya era correcta.

La API documentada de `Port` (`help/default/IpcAPI/class_port-members.html`)
declara justo lo que hace falta y **no se usaba en ningun sitio** del fichero
(`isPortUp`, `isProtocolUp`, `getLink`, `getName`): por eso se creo
`__estadoInterfaz(device)`.

| Campo | Que mide |
| --- | --- |
| `ok` | hay al menos un puerto **con cable** y con `isPortUp()` a true |
| `tieneCable` / `cableDesconocido` | si algun puerto tiene cable; `cableDesconocido:true` = `getLink()` no existe o lanza en **todos** los puertos, asi que no se puede afirmar que no tengan cable y no se bloquea |
| `puertoArriba` | algun puerto con cable con `isPortUp():true` |
| `protocoloArriba` | aditivo/informativo: `isProtocolUp():true` en algun puerto operativo (**no** se exige para `ok`, ver abajo) |
| `puertoProblema` / `puertoNombre` | el puerto que se nombra en el `output` de `interfaz_no_lista` y el primero con cable |
| `totalPuertos` / `puertosLeidos` / `puertosConCable` / `puertosArriba` | recuento |
| `desconocido` | **la API no se puede leer en ese equipo**: no hay `getPortCount`/`getPortAt`, `isPortUp` no existe o devuelve algo que no es booleano, o no hay puertos legibles |

Decisiones:

- **Por que `ok` es "cable + `isPortUp()`" y no "`isProtocolUp()`"**:
  `isProtocolUp()` en un router depende de que el line protocol este arriba, que
  ya es cosa de la **configuracion** (direccion, mascara, encapsulation).
  Exigirlo bloquearia pings validos de un equipo recien configurado, que es
  justo lo que hay que arreglar. `isPortUp()` es el estado del **enlace**.
- **Por que `desconocido` NO bloquea**: no es "no esta listo", es "no se puede
  comprobar". Reintentar algo que no se puede medir solo alarga el ping. Se
  comprueba el equipo entero una vez y se sigue con el flujo actual (el banco lo
  verifica: sin `isPortUp` el ping **no espera** y **no** se bloquea).
- **Un puerto que lanza no invalida los demas**: `getName`, `getLink`,
  `isPortUp`, `isProtocolUp` e `getPortAt(i)` van cada uno en su propio
  `try/catch`.
- **`puertoProblema` solo se consulta si el equipo NO esta listo**: si hay un
  puerto operativo, no hay culpable que nombrar.

Presupuesto de espera, con numeros:

| | Valor | Por que |
| --- | --- | --- |
| `INTERFAZ_ESPERA_MAX_MS` | **5000 ms** | los enlaces tardan "unos segundos" en levantar tras `no shutdown` + `configurePcIp` |
| `INTERFAZ_PASO_MS` | **400 ms** | 13 intentos = 12 esperas = **4800 ms** reales |
| `pingDevices` (60 s de timeout) | peor caso **27,6 s** | con el reintento del PDU: 13,8 s del sentido normal + 13,8 s de la sonda inversa (ver *Reintento cuando el PDU no sale del origen*). Sin reintento eran 18 s. Con `interfaz_no_lista` se sale antes: **5 s** y nada mas |
| `reachabilityMatrix` (90 s de timeout) | peor caso **76 s** | con un reintento por fila: `esperaInterfazMs:1500` (4 intentos x 400 ms = 3 esperas = **1200 ms**) + 3 s de pasos + `reintentoEsperaMs:400` + 3 s de pasos, x 10 filas = 10 x 7,6 s. Sin el reintento eran 58 s, y con los 3 s de pre-flight de antes + reintento se iria a 106 s (fuera de los 90 s). En el caso normal el pre-flight **no espera nada** (coste 0) y el reintento no llega a usarse |
| `pingDevices` via CLI (respaldo) | ~25 s medidos | solo se entra ahi en `no_ip` / `unsupported_device` / `command_failed` / inconcluso, nunca en `interfaz_no_lista` |

`interfacesEsperadas` lleva los **ms de verdad** esperados (`esperas x 400`), no
el presupuesto, y `interfacesComprobadas` los intentos: asi el banco puede
afirmar que un caso "listo" no espera **0** y que uno "caido" espera **4800**.

Cuando se agota el presupuesto se devuelve `interfaz_no_lista` y **`addSimplePdu`
NO se llama nunca** (tampoco se conmuta el modo de simulacion, que es lo primero
que haria el flujo del PDU). El `output` nombra el equipo y el puerto, dice que el
problema es del **enlace** y que **no** hay que cambiar la configuracion del
destino:

```
PDU ICMP PC1 -> R1: NO se creo el PDU porque 'PC1' tiene la interfaz FastEthernet0
sin enlace operativo (isPortUp: false, isProtocolUp: false) tras esperar 4800 ms
(comprobado cada 400 ms, 13 intento(s)). El problema es del ENLACE de esa interfaz
(recien configurada y sin terminar de levantar), NO del destino ni de la topologia:
no cambies la configuracion de R1 ni las rutas, espera unos segundos y repite el ping.
```

**Como lo ve el backend** (`packages/server/src/agent/ciscoPacketTracer/Tool.ts`):
`interfaz_no_lista` se anadio a `PING_ESTADOS_DE_ERROR`, asi que
`interpretarPing` lo devuelve como **fallo** (`{success:false, error}`) y no como
un ping valido, con un motivo que atribuye el fallo al **enlace** y dice
literalmente que no se cambie la configuracion y que reintentar puede bastar.
`interpretarMatrizAlcance` lo cuenta como **fila con error** (igual que los
demas de esa tabla, y a diferencia de `unsupported_device`, que es una limitacion
permanente del equipo): si todas las filas son de este tipo el fallo tambien lo
dice, y si solo hay algunas el `message` aclara que esas filas **no miden
alcance**. El `output` de la extension va ahi dentro, asi que el agente recibe las
dos cosas. `pingTopology` y `reachMatrix` lo mencionan tambien en su `description`
en ingles.

Cuidado con `reversoOk`: `pingDevices` lo mantiene para el `no_reply` normal, pero
con `interfaz_no_lista` **no** se sondea el sentido contrario, asi que nunca puede
aparecer (el mensaje "el problema es de un solo sentido" seria contradictorio con
"el enlace aun no ha levantado", que es lo que en realidad pasa).

### Filtro por dispositivos (por que el rango solo no basta)

`addSimplePdu` deja el escenario **pendiente** y PT 9 lo sigue avanzando con
nuestros `forward()`: el rango `index >= antes` puede traer frames de un PDU de
un ping anterior. Medido: el primer intento en simulación leyo **34** frames y
juzgó el ping contra uno `descartado en SRV1` (un PDU viejo), no contra el suyo.
El volcado de 50 frames lo confirma: conviven frames de `SRV1` y `PC2` (otros
pings) e incluso un `dropped` **en R1**, que es un equipo de la pareja.

Como `getSourceString()` / `getDestinationString()` vienen vacíos, la atribución
se hace con `getDevice()`, comparando con los nombres de origen y destino
(`__framesDePareja`). **Medido: `getDevice()` SÍ funciona (50 de 50 frames con
nombre)**, asi que el filtro por pareja es la via normal y no hace falta degradar
al rango sin atribuir. Los frames de otros equipos **no deciden el veredicto**:
solo se cuentan en `framesAjenos` y se mencionan en el `output` (con
"no se atribuyen a este PDU") para no perder el diagnostico. Si **ningún** frame
trae `device` (o sea, `getDevice()` no es utilizable en esa version), no hay nada
mejor que el rango de indices: se usa el rango entero, `filtroDispositivos:false`
lo dice en el payload y `aviso` lo explica (y un `accepted` sin equipo sigue
valiendo como entrega, para no dejar el ping inconcluso para siempre).

El filtro **no puede decidirse por el negativo**: un `dropped` viejo en la pareja
no puede matar un ping que ya tiene la firma del viaje. Por eso `__analisisFrames`
calcula primero el viaje y el negativo, y el veredicto `ok` gana si esta el viaje
completo o un `accepted`.

### Veredicto: como se distingue "llego" de "no llego"

**La señal principal es el VIAJE DE IDA Y VUELTA**: con los frames de la pareja
**ordenados por `index`**, hay un frame **vivo** en el **DESTINO** y,
**posterior a él** (índice **mayor**), otro frame **vivo** en el **ORIGEN**. Ese
último es la respuesta que vuelve; el **intermediario se ignora** (destino →
origen ya es inequívoco). MEDIDO en PT 9:

```
16 PC1 (sent) -> 17 SW1 -> 18 SW1 -> 19 R1 (sent)  LLEGA
20 PC1 (sent)  la RESPUESTA vuelve al ORIGEN (indice 20 > 19)
```

Detalles de la regla:

- Se ordena por **`index`**, nunca por la posición del array (`__framesOrdenados`
  ordena una **copia**: el array de entrada no se toca).
- **Vivo** = estado que no es `dropped` / `not_forwarded` / `unexpected` /
  `collision`: un frame que se cayó no prueba nada. Un `buffered` **también** es
  "en cola", así que no cuenta ni como llegada ni como retorno
  (`destinoEnCola` / `origenEnCola` lo dicen en el payload y en el `output`).
- Es una regla de **existencia**, no de "el primero de cada": en el volcado
  medido hay un `PC1` en el 0 y un `R1` en el 1, y con "el primero de cada" no
  habría viaje **nunca**. Para nombrar la pareja se usa la de **menor
  separación** (en el volcado medido sale `indiceDestino:19`,
  `indiceOrigen:20`, que es la firma).
- Un `buffered` en el origen **sin destino previo** → **inconcluso**, nunca `ok`.
- Si solo hay `accepted` y no hay viaje, `accepted` también da `ok` (señal
  **adicional**: puede no aparecer nunca, como se ve arriba).

#### `noSalioDelOrigen`: "no salió del origen" NO es "el destino no responde"

Antes, los dos fallos que mas se confundian acababan en la misma frase
(*"el equipo destino no responde"*) y no tenian el mismo origen:

| Frames de la pareja | `noSalioDelOrigen` | Lo que REALMENTE paso | Lo que dice el `output` |
| --- | --- | --- | --- |
| todos `buffered` en el origen, o `not_forwarded`/`dropped` **en el origen**, y nada vivo en el destino | **`true`** | el PDU **se quedo encolado en el origen**: su interfaz no estaba operativa | *"el PDU no llegó a salir de PC1 ... su interfaz no estaba operativa ... el problema es del ENLACE del ORIGEN, no del destino ni de la topologia"* |
| `dropped` / `not_forwarded` **en el destino** | `false` | el PDU salio y se cayo al llegar | *"descartado en R1 ... el equipo destino no responde"* |
| llego al destino y no se vio la respuesta volver | `false` | el PDU salio y no hay retorno | *"el PDU llegó a R1 (frame N) pero no se vio la respuesta volver a PC1"* |

Regla conservadora (cualquier evidencia en contra la desactiva), tal cual la
implementa `__analisisFrames`:

```
noSalioDelOrigen = ordenados > 0
  && !llegoAlDestino            // ningun frame VIVO llego al destino
  && !destinoEnCola             // si hay uno EN COLA alla, algo se movio
  && vivosAjenos === 0           // sin frames vivos sin atribuir (getDevice() inutilizable)
  && (!negativo || negativoEn === origen)  // si se cayo en el destino, es problema de alli
```

Los tres `output` tal cual quedan (el primero es el caso medido de `test-pt`):

```
PDU ICMP PC1 -> R1: 2 frame(s) de ICMP, el PDU no llegó a salir de PC1 (sim 31146): el PDU se
quedo encolado en PC1 y su interfaz no estaba operativa (el enlace todavia no habia levantado): el
problema es del ENLACE del ORIGEN, no del destino ni de la topologia, asi que no cambies la
configuracion de R1: espera unos segundos y repite el ping

PDU ICMP PC1 -> R1: sin veredicto tras 40 paso(s) de simulacion (2 frame(s) de ICMP de la pareja sin
llegar ni caerse): el PDU no completó; el PDU no llegó a salir de PC1: su interfaz no estaba
operativa y se quedo encolado en el origen. El problema es del ENLACE del origen, NO del destino ni
de la topologia, asi que no cambies la configuracion de R1: espera unos segundos y repite el ping
(en PC1 hay frames aún en cola). No se puede afirmar alcance por PDU.

PDU ICMP PC1 -> R1: 3 frame(s) de ICMP, descartado en R1 (sim 1140): el equipo destino no responde
```

El segundo conserva el conservatismismo del ping inconcluso ("sin veredicto" /
"No se puede afirmar alcance por PDU") y **añade** la causa honesta: en el caso
anterior solo decia "no se puede afirmar", y el agente no tenia por que tocar
nada, mientras que el caso **medido** si decia "el destino no responde" y por eso
si inducía a cambiar la configuración. `status` sigue siendo `no_reply` en los
tres (el contrato del backend no cambia) y `noSalioDelOrigen` es lo que los
distingue.

### Reintento cuando el PDU no sale del origen (lo que faltaba en PT 9)

`noSalioDelOrigen` no es solo un diagnostico: es la unica senal fiable de que el
**enlace del origen todavia no estaba operativo**, y por eso habilita **un**
reintento automatico del ciclo de medicion.

**Lo medido (suite `packages/server/test-pt`, 40 OK / 1 FALLO).** El unico fallo
era `pingTopology`, y su `output` era:

```
PDU ICMP PC1 -> R1: 2 frame(s) de ICMP, el PDU no llegó a salir de PC1 (sim 89766): el PDU se quedo encolado en PC1 y su interfaz no estaba operativa (el enlace todavia no habia levantado): el problema es del ENLACE del ORIGEN, no del destino ni de la topologia
```

Datos que lo explican:

- **2 frames y nada mas**: el PDU se creo pero quedo **encolado en el origen**, sin
  transmitirse. No salio **ningun paquete**, asi que no produjo ningun efecto.
- `reachMatrix` (que hace los **mismos** tres pings unos 10 s despues) **pasa**:
  es una condicion de carrera del primer ping tras montar la topologia.
- El **pre-flight de interfaces** (`__estadoInterfaz`, que espera hasta 5 s a que
  `isPortUp()` sea true) **dejo pasar** el caso: no devolvio `interfaz_no_lista`,
  es decir, considero la interfaz lista y envio el PDU. Conclusion: **`isPortUp()`
  no es un predictor fiable** de que el PDU vaya a salir, asi que el reintento
  **no vuelve a preguntar por la interfaz** (preguntar de nuevo costaria
  presupuesto y no aportaria nada): se apoya solo en la medicion.

**Por que el reintento es SEGURO aqui** (y en que se diferencia del reintento del
comando por consola): el PDU **no se transmitio**, luego **no produjo ningun
efecto**. No hubo paquete que saliera, ni estado remoto que cambiar, ni respuesta
que duplicar: reenviarlo es idempotente por construccion. Un comando de consola,
en cambio, puede **haber aplicado una escritura** antes de que la lectura fallara,
y ahi repetirlo si podria duplicarla. Aqui la unica accion es "mandar un ICMP de
medicion".

**Que se reintenta y que no** (`__debeReintentarPdu`):

| Situacion | ¿Reintenta? | Por que |
| --- | --- | --- |
| `noSalioDelOrigen:true` y el ping **no** es `ok` | **si**, **una vez** | el PDU no salio: no hubo transmision ni efecto |
| viaje completo, `accepted`, `descartado en el destino`, "llego pero no volvio", o cualquier frame **en cola en el destino** | **no** | el PDU **si salio**: repetir la medicion solo gastaria presupuesto |
| `interfaz_no_lista`, `no_ip`, `unsupported_device`, `command_failed`, `source_not_found`, `target_not_found`, excepcion | **no** | son fallos **anteriores** a la medicion: no hay carrera del enlace que reintentar |

El ciclo que se repite es **completo**: `resetSimulation()` (la linea de tiempo y
los frames), marcadores (`getFrameInstanceCount` / `getCurrentSimTime`),
`addSimplePdu`, el bucle de `forward()` con presupuesto y el analisis de frames.
Entre intentos se hace una espera (800 ms por defecto) y se **borra el escenario
de PDU del intento fallido** antes de crear el siguiente, con el mismo criterio
cauteloso del `finally` (solo si el contador de PT existe y ha crecido
exactamente en 1, y solo en el indice que creamos nosotros). Si el borrado no es
posible, `pduPendiente:true` lo dice en vez de adivinar. El modo de simulacion
**no** se restaura entre intentos: se entra y se sale una sola vez, en el
`finally`.

Campos **aditivos** del payload (el backend los ignora, `interpretarPing` copia
todo lo demas):

| Campo | Significado |
| --- | --- |
| `reintentosPdu` | **0** o **1**: cuantos reintentos se hicieron de verdad. Se informa **siempre** (tambien en `interfaz_no_lista` y `command_failed`), para que la forma del payload sea estable |
| `reintentado` | `true` solo si el veredicto es del **segundo** intento |

Si el segundo intento **tampoco** sale, el veredicto es el de siempre
(`no_reply` + `noSalioDelOrigen:true` + el mensaje que culpa al enlace del
origen) y el `output` **añade** que ya se reintento:

```
PDU ICMP PC1 -> R1: 2 frame(s) de ICMP, el PDU no llegó a salir de PC1 (sim 89766): el PDU se quedo encolado en PC1 y su interfaz no estaba operativa (el enlace todavia no habia levantado): el problema es del ENLACE del ORIGEN, no del destino ni de la topologia, asi que no cambies la configuracion de R1: espera unos segundos y repite el ping (ya se reintento 1 vez y el enlace del origen seguia sin levantar: el problema NO se resuelve reintentando, es del entorno o del cableado)
```

Si el segundo intento **si** completa el viaje, sale un ping `ok` normal, con
`reintentosPdu:1` y `reintentado:true` en el payload, y **el mismo mensaje de
siempre** (el de `ok` no se adorna). Ese es el resultado que se quiere en el caso
normal de la suite.

**Presupuesto** (todo en ms, justificando los numeros):

| | Valor | Calculo |
| --- | --- | --- |
| `PDU_REINTENTO_ESPERA_MS` | **800 ms** | lo que tarda un enlace recien configurado en levantar |
| `PDU_REINTENTO_ESPERA_MAX_MS` | **3000 ms** | tope para que un llamante no se lleve el presupuesto |
| `reintentoEsperaMs` (opcion) | por defecto 800 | lo que pasa quien llama (la matriz usa 400); recortado al tope |
| `pduPing` | **13,8 s** | pre-flight 5 s + pasos 4 s (40 x 100 ms) + espera 0,8 s + pasos 4 s. Sin reintento eran 9 s |
| `pingDevices` (60 s) | **27,6 s** | 13,8 s del sentido normal + 13,8 s de la sonda inversa (que solo sale con `no_reply`, y en ese caso no se cae a la CLI) |
| `reachabilityMatrix` (90 s) | **76 s** | 10 filas x (1,2 s de pre-flight + 3 s de pasos + 0,4 s de espera + 3 s de pasos). Por eso `reachabilityMatrix` recorta `esperaInterfazMs` a 1500 y pasa `reintentoEsperaMs:400`: con los 3 s de antes y sin recortar la espera serian 106 s |

| Frames de la pareja | `status` | `ok` | `lossPercent` | Razon |
| --- | --- | --- | --- | --- |
| **VIAJE COMPLETO**: vivo en el destino y vivo en el origen con indice mayor | `ok` | `true` | 0 | la peticion llego y **la respuesta volvio** (`viajeCompleto:true`, `llegoAlDestino:true`, `volvioAlOrigen:true`, con `indiceDestino`/`indiceOrigen` que lo prueban) |
| `accepted` en el **destino** | `ok` | `true` | 0 | el PDU **llego**: en PT el frame lo **acepta el equipo que lo recibe** (un router o un switch reenvia, no acepta). Señal **adicional**: da `ok` incluso sin viaje completo |
| `accepted` en el **origen** | `ok` | `true` | 0 | la **respuesta volvio** y fue aceptada (también sin viaje completo) |
| `accepted` sin equipo identificado | `ok` | `true` | 0 | solo si `getDevice()` no es utilizable: el rango de indices es lo unico que hay |
| `dropped` / `not_forwarded` / `unexpected` / `collision` y **ni** viaje completo **ni** `accepted` | `no_reply` | `false` | 100 | el PDU **murio por el camino**; el `output` distingue si se cayo **en origen** (`noSalioDelOrigen:true`, se culpa al **enlace del origen**) o **en destino** (`el equipo destino no responde`), y `descartadoEn` lo deja como codigo |
| llego al destino pero **no se vio volver nada** (o el retorno sigue `buffered`), y se agotan los pasos | `no_reply` | `false` | 100 | **inconcluso**: el `output` lo dice ("el PDU llegó a R1 pero no se vio la respuesta volver a PC1") y nunca se marca `ok`. Se prefiere un "no pude afirmar" a un falso "llego" |
| se agotan los pasos y todos siguen en `buffered` / `sent` / `in_transit` | `no_reply` | `false` | 100 | **inconcluso**: el `output` lo dice ("el PDU no completó") y nunca se marca `ok`. Si ademas nada salio del origen, `noSalioDelOrigen:true` nombra la interfaz |
| **la interfaz del origen o del destino no esta operativa** (pre-flight agotado) | `interfaz_no_lista` | `false` | 100 | **el PDU ni se creo** y `addSimplePdu` no se llama; es transitorio y no dice nada del destino (ver *Pre-flight de interfaces*) |
| `errCode` de `addSimplePdu` que no es `"0"` | `command_failed` | `false` | 100 | el `ADD_PDU_ERROR` va en el `output` y no se sigue |
| **no se pudo entrar en modo simulacion** | `command_failed` | `false` | 100 | el PDU no fluye en tiempo real: el hibrido cae a la via CLI (que si funciona en tiempo real) |
| el equipo no tiene IP utilizable | `no_ip` | `false` | 0 | **y `addSimplePdu` no se llama NUNCA** (ver abajo) |
| el equipo es de un tipo sin PDU (IoT, patch panel, WLC, pasivos...) | `unsupported_device` | `false` | 0 | tampoco se llama `addSimplePdu` |
| el equipo no existe | `source_not_found` / `target_not_found` | `false` | 0 | no se toca nada |

**El unico `status` nuevo es `interfaz_no_lista`** (transitorio, de medicion: el
PDU no se creo). El inconcluso y el descartado siguen compartiendo `no_reply`,
que es el valor que el ping por CLI ya usaba para "sin respuesta" (esta en el
contrato del backend y **no** esta en `PING_ESTADOS_DE_ERROR`, asi que el agente
lo lee como un ping sin respuesta y no como un fallo de la tool).
`interfaz_no_lista` **si** esta en `PING_ESTADOS_DE_ERROR`, con un motivo que
atribuye el fallo al enlace y dice que reintentar puede bastar (ver
*Pre-flight de interfaces* y el bloque de abajo).
`unsupported_device` tampoco es nuevo: el backend lo trata como "el equipo no
tiene esa capacidad", no como error.

**El RTT NO es el `transitTime`.** MEDIDO en PT 9, `getTransitTime()` vale **0 o
1** y son **unidades de simulación**, no milisegundos: ponerlo en `rttAvg` se
leería como "1 ms" y sería mentira. `rttAvg` sale del **reloj de simulación**
(`getCurrentSimTime()` medido antes y después del PDU, que avanza con cada
`forward()`), con:

- `rttFuente:"simTime"` cuando es utilizable, o `"sin_dato"` con `rttAvg:0` si
  no lo es (nunca un numero inventado);
- `rttUnidad:"reloj_simulacion_pt"` (aditivo), que deja el dato explícito, y el
  `output` repite "RTT de simulación N unidades del reloj de Packet Tracer (no
  son ms)";
- `transitViaje` (aditivo) con la suma del `transitTime` de los **dos** frames de
  la firma, que sigue siendo informativo **en unidades de simulación**.

Como el reloj avanza con los `forward()`, el numero crece con los pasos que hizo
falta para la respuesta: es una medida del tiempo de simulación del viaje, no un
RTT de red. Quien necesite milisegundos de verdad, que use el ping por CLI.

### La pre-validacion de IP (por que el ping no cuela Packet Tracer)

Riesgo historico real: llamar a `addSimplePdu` contra un equipo **sin IP
utilizable** abre en PT un dialogo modal *"No Functional Ports"* que **congela
Packet Tracer** y deja la extension muda. Por eso `pduPing` comprueba, **antes
de crear nada**, que los dos equipos tienen IP (`__ipUtilDe`, que reutiliza
`__ipParaPing` y los getters de puerto/equipo) y que ninguno es de un tipo sin
PDU (`TIPOS_SIN_PDU`, una lista de *exclusion*: IoT 39, patch panels 46/47, WLC
41, AccessPoint 7, pasivos 5/6/29/31/32, camaras y sniffers 34/35, MCU/SBC
36/37, Controllers 50, metali 48/49, ...). Si algo falla, se devuelve
`no_ip` / `unsupported_device` **sin llamar a `addSimplePdu`** y el banco local
lo verifica con un contador de llamadas.

### Restauracion del modo de simulacion

El PDU **EXIGE** modo simulacion (MEDIDO: en tiempo real `addSimplePdu` +
`forward()` no crean ni un frame, asi que el ping quedaria inconcluso siempre), y
`pduPing` **entra y sale por su cuenta**: conmutar el modo no es opcional para
quien llama, porque la extension lo hace sola y restaura el previo. Solo lo
restaura si **el mismo** lo cambio:

- Se guarda `modoPrevio` antes de hacer nada y solo se entra si no estaba ya en
  simulacion (`modoEntrada:"sin_cambio"` cuando ya lo estaba: entrar dos veces no
  puede fallar un ping).
- En el `finally` se vuelve al modo previo **aunque algo haya lanzado a mitad**
  (un `addSimplePdu` que revienta, una excepcion no envuelta...).
- Si la vuelta **falla**, no se enmascara el error original: se anade como aviso
  en `aviso` y `modoRestaurado` queda en `false`.
- `modoRestaurado` viaja en el payload del ping (tambien en cada fila de
  `reachabilityMatrix`, y en `true` en la via CLI, que no toca el modo) para que
  se pueda comprobar desde fuera que la suite **no deja PT en simulacion**.
- La sonda en sentido contrario (`reversoOk`) entra y sale por su cuenta, asi que
  los pings seguidos no acumulan modos.

### Limpieza del escenario de PDU

Cada ping deja **una entrada en la lista de PDUs de Packet Tracer** (la de
"Add Simple PDU" de la UI), y `addSimplePdu` no devuelve el indice. Borrar el
escenario equivocado seria peor que dejar la entrada, asi que **no se adivina
un indice a lo bruto**:

- Si el objeto de `getUserCreatedPDU()` expone un contador (`getPDUCount` y
  similares) y `deletePDU(i)`, el escenario nuevo es el **ULTIMO**: se comprueba
  que el contador ha crecido **exactamente en 1** y se borra ese indice en el
  `finally` (tambien si algo lanzo a mitad).
- Si no hay contador o no hay API de borrado, el payload lleva
  **`pduPendiente:true`** y la entrada se limpia desde la UI de PT.

### Politica hibrida de `pingDevices` / `reachabilityMatrix`

| Situacion | Que hace |
| --- | --- |
| `options.metodo:"cli"` | fuerza la via CLI (para depurar) |
| PDU `ok` o `no_reply` **con veredicto** | se respeta el veredicto del PDU: es la via oficial y la consola no puede mejorarlo |
| PDU `no_reply` | ademas sondea el **sentido contrario** (`destino -> origen`), que se anade como `reversoOk:true` **solo si el otro sentido SI responde** (distingue "caido" de "no responde en ese sentido"). `probarReverso:false` lo desactiva; la matriz lo desactiva siempre (duplicaria el coste de cada fila) |
| PDU `interfaz_no_lista` | se devuelve **directo**: NO se sondea el sentido contrario (su `reversoOk:true` anadiria "el problema es de un solo sentido", que CONTRADICE al estado) y NO se cae a la via CLI (en tiempo real daria 100% de perdida por el mismo enlace y la consola diria "no responde", que es justo el falso diagnostico que se quiere evitar) |
| PDU `no_ip` / `unsupported_device` / `command_failed` / inconcluso | el PDU no era viable: **cae a la via CLI**, que es la de siempre (en `command_failed` por no poder simular, la CLI es ademas la unica via que queda) |
| `source_not_found` / `target_not_found` | se devuelve directo: el CLI daria lo mismo y no se gasta la consola |

**La inversion del ping (`reversed`) es SOLO de la via CLI.** El PDU acepta
cualquier equipo como emisor, asi que por PDU `reversed` es siempre `false`; si
el respaldo es por CLI y ahi hizo falta invertir (el origen no tiene consola
IOS), el payload lo refleja con `reversed:true` + `metodo:"cli"`, y
`source`/`target` **nunca** se intercambian.

`reachabilityMatrix` acota `maxSteps:30`, `esperaInterfazMs:1500` y
`reintentoEsperaMs:400` por fila para que 10 filas quepan en el timeout del
backend: cada fila entra en simulacion, reinicia la linea de tiempo, mide y sale,
asi que **el estado queda limpio entre una fila y la siguiente**. El techo del
ping suelto es de 40 pasos, pero con 100 ms por paso una fila de la matriz sigue
costando 3 s como peor caso (el mismo que antes: 20 x 150 ms), con un 50% mas de
margen para que la respuesta de vuelta quepa. Las dos esperas se recortan porque
las filas van en **serie** y el origen es el mismo para todas: si el enlace no
levanta en la primera, en la segunda ya ha tenido su propio margen. Peor caso de
la matriz con un reintento por fila: 10 x (1,2 s + 3 s + 0,4 s + 3 s) = **76 s**,
por debajo de los 90 s de `TIMEOUT_POR_HERRAMIENTA` (con los 3 s de pre-flight de
antes y sin recortar la espera del reintento serian 106 s); en el caso normal el
pre-flight **no espera nada** y el reintento no llega a usarse.

### Banco local sin Packet Tracer

El `.pts` de PT no lleva estos cambios (lo regenera el coordinador), asi que la
logica se valida con un `ipc` falso en un `vm`. Vive **fuera del repo**, en
`%TEMP%\opencode\`:

| Banco | Aserciones | Que cubre |
| --- | --- | --- |
| `bench-pdu-reintento.js` | **29 OK / 0 FALLO** | el **reintento del PDU cuando no sale del origen** (ver *Reintento cuando el PDU no sale del origen*): el caso MEDIDO de `test-pt` (el pre-flight dice que la interfaz esta lista y el PDU se encola igual) reintentando **una vez** y saliendo `ok:true` + `reintentosPdu:1` + `reintentado:true` con el mensaje normal, los **dos** intentos encolados (-> `no_reply` + `noSalioDelOrigen:true` + `reintentosPdu:1` + la frase "ya se reintento 1 vez", con y sin negativo), que **no reintenta** cuando el PDU si salio (viaje completo, descartado en el destino, "llego pero no volvio", frame en cola en el destino) ni con errores de otro tipo (`interfaz_no_lista`, `ADD_PDU_ERROR`, `target_not_found`), la limpieza (el escenario del intento fallido se borra antes del siguiente, con `deletePDU(0)` dos veces, y PT entra y sale de simulacion una sola vez), el presupuesto (800 ms de espera, `reintentoEsperaMs` recortado y con tope de 3000 ms, el propio 13,8 s dentro de los 60 s) y el barrido de que **ningun** payload lleva caracteres > U+00FF ni consola en ingles prohibido |
| `bench-interfaz.js` | **49 OK / 0 FALLO** | el **pre-flight de interfaces** y el **veredicto honesto**: `__estadoInterfaz` con la API real de `Port` (cable + `isPortUp` -> `ok`; sin cable -> `tieneCable:false`; `getLink()` inexistente -> `cableDesconocido` y no bloquea; `isPortUp` no booleano o inexistente, o sin `getPortCount` -> `desconocido`; **un puerto que lanza no invalida los demas**; `isPortUp:1`/`0` normalizado; `__puertoNombreDe` con el legacy), `pduPing` con origen y destino listos (**no espera**: `interfacesEsperadas:0` y cero esperas de 400 ms) y con el PDU enviado, con el origen sin `isPortUp` (**13 intentos / 4800 ms** y `interfaz_no_lista` **sin llamar a `addSimplePdu`** ni conmutar el modo, afirmado con contador), sin cable, y con el destino caido, el enlace levantando a mitad (1200 ms y `ok`), `esperaInterfazMs` acota (2800 ms) y no sube del tope de 5 s, la API que **no** se puede leer (`isPortUp` ausente en origen o en destino, o no booleano) -> **sigue sin esperar y sin bloquear**, `noSalioDelOrigen` con sus tres mensajes (encolado en el origen / `buffered` en cola en el origen / descartado en el destino) y la guardia de un frame en cola en el destino, un ping `ok` con `noSalioDelOrigen:false`, y la politica hibrida: `interfaz_no_lista` **no** marca `reversoOk` ni cae a la CLI (cero PDUs creados, cero conmutaciones de modo), y la matriz con el pre-flight **recortado a `esperaInterfazMs:1500`** por fila (6 esperas de 400 ms en 2 filas, el techo se lleva con cuentas) |
| `bench-bloqueos.js` | **41 OK / 0 FALLO** | el **resolutor de bloqueos** (`__resolverBloqueo` + `__aplicarBloqueo`) y el estado `reintentar`: la tabla de señales → acción (`--More--`→espacio, aviso de arranque→enter incluso con línea de sistema detrás, `[yes/no]`→`no`, `translating "`→`\u001e`, sin línea/consola muda→sin acción), la prioridad paginador > prompts, `__aplicarBloqueo` paga con `enterCommand(" ")` (**no** con `enterChar(32)`, que es no-op en PT 9: se comprueba que `chars` queda vacio y que `pagerVia:"enterCommandEspacio"`) / teclea `no` con modo `""` / `\u001e` (y cae al `device` si la línea no tiene `enterCommand`), el caso medido (aviso pendiente → `reintentar` + `comandoConsumido` + `bloqueoResuelto:"enter"`, Enter tecleado, pendiente **abierto** y **nada reenviado**), el eco escrito con la barrera puesta (también `reintentar`), `--More--` → `en_curso` + `paginasPagadas` sin pedir reintento, la acumulación `"enter,espacio"` sin repetir motivos ni reenviar, `done:true` con el diagnóstico acumulado, el camino normal cuando el comando ya esta en el buffer (salida correcta y sin `reintentar`), los topes (8 de prompt, 40 de paginador → `bloqueoAgotado`) y la **consola muda** (`eco:false`, donde ningun escalon mueve el buffer: se prueban los cuatro, `chars` queda `[32,32]`, el paginador no se cuenta como pagado y no se cuelga), y la robustez (consola sin `enterChar`, sin `getOutput`, forma de `results[]`/`summary`, salida vacía nunca `ok`, y **ningún payload con texto de consola en inglés prohibido**) |
| `bench-commandended.js` | **39 OK / 0 FALLO** | el motor **en dos fases**: `runCommandAsync` devuelve `eventoRegistrado:true` + `pendienteId` y registra `commandEnded` **una vez por lote** con handler de 2 parametros, `pollCommandResult` **antes** del evento -> `en_curso` (y repetirlo no lo cierra), **despues** -> `done:true`/`fuente:"commandEnded"` con el `output` correcto via `__corte` y las **mismas claves** que `runDeviceCommands`, el lote de 2 comandos con corte propio en cada fila (sin contaminacion), salida vacia **nunca** `ok`, el cierre (2ª llamada -> `pendiente desconocido o ya cerrado`, mapa vacio) con `unregisterEvent` llamado con la **misma referencia** del handler, `esperarMs` esperando dentro de la ronda **sin** forzar `done` (tope de 3 s, con `setTimeout` presente tambien), la vigencia vencida -> `done:true`/`fuente:"buffer"` + `motivo`, `registerEvent` inexistente -> `eventoRegistrado:false` + `fuente:"buffer"`, supersede por equipo (con su desregistro), la purga del mas viejo con 40 altas (32 vivos, los 8 primeros con error) y `__cerrarTodosLosPendientes()`, el evento tardio (`eventoEn`), y las opciones (`mode` invalido, `preambulo:false`, `reiniciarSimulacion`, `esperaFin`, lote vacio, `commands` como string, consola sin `getOutput`, buffer desbordado con corte por ancla y ventana degradada) |
| `bench-pduping3.js` | **28 OK / 0 FALLO** | el **veredicto por VIAJE DE IDA Y VUELTA**, con el volcado REAL de 50 frames como fixture (`16 PC1` → `19 R1` → `20 PC1`): `ok:true` + `viajeCompleto`/`llegoAlDestino`/`volvioAlOrigen` **sin ningun `accepted`** en todo el volcado, el `dropped` viejo de R1 (frame 38) que no envenena el veredicto, los frames de `SW1`/`PC2`/`SRV1` filtrados, el RTT del reloj de simulacion (y que no sale del `transitTime`), `accepted` presente → tambien `ok`, `dropped` en destino sin vuelta → `no_reply` + `descartadoEn:"destino"`, **frames desordenados** (se ordenan por indice y el array de entrada no se muta), la salida del PDU (indice 16) no confundida con la respuesta (20), `buffered` en el origen → inconcluso y **nunca** `ok`, el presupuesto (40 x 100 ms, para en el tope sin colgarse, `maxSteps` recorta), la matriz con `maxSteps:30` y el `getDevice()` inutilizable |
| `bench-pduping2.js` | **37 OK / 0 FALLO** | el ping **con modo simulacion**: la secuencia completa (entrar → `resetSimulation` → `addSimplePdu` → `forward` → salir, con el orden comprobado), PDU que llega, PDU descartado en origen y en destino, el `finally` restaurando el modo **aunque algo lance** (incluida una excepcion no envuelta), que **no se entra en simulacion si el pre-validado falla** (con contador de llamadas), `resetSimulation()` que lanza (best effort), el filtro por dispositivos (frames de otros equipos no deciden), el `getDevice()` inutilizable, el presupuesto de pasos, `ADD_PDU_ERROR`, la limpieza del escenario, el hibrido con `reversoOk` y la matriz |
| `bench-pduping.js` | **46 OK / 0 FALLO** | lo anterior que no cambio: pre-validacion de IP con contador de `addSimplePdu`, `setSimulationMode` con y sin `RSSwitch`, `getPduResults` con `limit` / `sinceIndex` / filtro de tipos, el hibrido y la matriz |
| `bench-corte.js` | **22 OK / 0 FALLO** | el corte de la salida de consola y `__despertarConsola` |


## DESPERTAR LA CONSOLA

Los routers de PT arrancan en el dialogo inicial o muestran `Press RETURN to get
started!`, y un `no` tecleado a ciegas (como hostname) provoca un lookup DNS
(`Translating "no"...`) que deja la consola bloqueada. Por eso
`runDeviceCommands` y la **via CLI** del ping (`__pingCli`, que es a donde cae
`pingDevices` cuando el PDU no es viable) llaman antes a `__despertarConsola(line,
device, espera)`. La via PDU del ping no toca la consola.

**El arranque de un equipo tarda segundos, asi que se espera por estado
observable y no por un presupuesto fijo.** El bucle tiene dos fases:

- **Fase rapida** (`DESPIERTA_MAX_INTENTOS = 4` pasadas con la espera del
  caller): resuelve el caso normal —consola ya operativa— en la primera pasada
  sin coste añadido. Si hay prompt, se exige que sea **estable** (dos sondeos
  consecutivos con el mismo prompt) y se sale con `ok:true` sin teclear nada.
- **Fase extendida** (`DESPIERTA_DEADLINE_MS = 10_000`): si al terminar la fase
  rapida no hay prompt y el buffer muestra senales de arranque o dialogo
  pendiente, se sigue reevaluando hasta ese deadline. El techo son 10 s (y no
  los 60 s que seria lo ideal) porque `__busyWait` **congela** el motor de
  scripts de PT, que es monohilo con su UI.

En cada ronda se reevalua, en este orden:

1. Bloqueo DNS (`Translating "` en el buffer): se manda el byte `\u001e`
   (Ctrl+^, la escape sequence por defecto de IOS) hasta `MAX_DESBLOQUEOS = 2`
   veces. Si aun asi sigue bloqueado, `bloqueo_dns_translating` y no se envia
   nada mas.
2. Dialogo inicial: se envia `no` con modo `""`. Se busca tanto en la ultima
   linea como en un **tail de 300 chars** del buffer (robustez entre versiones
   de PT), pero **sigue exigiendose que la pregunta este abierta** antes de
   teclear `no`.
3. `Press RETURN to get started!` → `__responderReturn` (su escalera: 
   `enterChar(13)`, `enterChar(10)`, `enterCommand("\n")` y `enterCommand("")`, con
   `enterVia` en el payload; ver *Como se paga el paginador*).
4. Prompt limpio (`>`/`#`) → `ok:true`.
5. Buffer vacio → UN sondeo `show clock` con modo `""` (nunca `enable`).
6. Sin prompt tras ~6 sondeos **y sin boot log** → un unico *nudge* con
   `enterCommand("")`.

El prompt se lee con `line.getPrompt()` como fuente primaria (mas fiable que
parsear texto) y, si no existe o devuelve algo que no parece prompt, se cae a
la ultima linea del buffer. Durante el arranque PT puede devolver un prompt a
medio formarse, asi que `getPrompt()` solo se acepta si el buffer no trae
marcas de arranque en su cola de 600 chars.

Devuelve `{ok, motivo, despertado}`. `motivo` es un codigo corto en
minusculas: `prompt_limpio`, `dialogo_inicial`, `press_return`, `sondeo`,
`bloqueo_dns_translating`, `arranque_incompleto` (habia boot log y no se
llegó a prompt), `texto_no_reconocido`, `sin_lectura`, `sin_linea_consola`,
`sin_enter_command`, `sin_respuesta_return`, `no_ios`. Solo se anade
`despertar` a la raiz del payload cuando `ok === false`; ademas `pingDevices`
traduce el bloqueo en `status:"console_blocked"` y `runDeviceCommands` no envia
nada (todos los resultados en `unknown`).

Los codigos de bloqueo `dialogo_inicial` / `press_return` / `bloqueo_dns`
tambien los devuelve `__motivoConsolaBloqueada`, que revisa la salida tras un
ping fallido. **Nunca** se deben escribir en el payload las frases en ingles
`initial configuration dialog`, `Press RETURN to get started`, `Please answer
'yes' or 'no'` ni `--More--`: la suite `test-pt` (`falloConsolaSucia`) barre el
JSON completo y marcaria FALLO por consola sucia.

## PREAMBULO DE CONSOLA

Antes del primer lote, `__preambuloSeguro` emite **una vez por consola** (se
detecta por el buffer acumulativo, que ya contenga `no ip domain-lookup`) y
solo a equipos IOS:

| Comando | Para que |
| --- | --- |
| `terminal length 0` | Desactiva la paginacion `--More--`, que si no se come los comandos siguientes. **Best effort**: los switches de PT 9 no lo implementan (no dan error, no hacen nada) y su efecto real no esta verificado en vivo. |
| `no ip domain-lookup` | **El importante**: sin el, cualquier palabra que IOS interprete como hostname desconocida lanza `Translating "<palabra>"...domain server`, un lookup DNS que bloquea el buffer ~30 s. |

Va en modo global (`configure terminal` … `end`) y queda fuera de `results[i]`
porque se emite antes del primer `before`, que `__sliceAfter` descarta. El
payload expone `preambulo: "terminal_length_0,no_ip_domain_lookup"`.

**`no ip domain-lookup` modifica la configuracion del equipo** (aparece en el
`running-config` y por tanto en los snapshots). Es un precio deliberado por
que la consola no se quede muda; no es configurable. `terminal length 0` solo
existe en modo exec, asi que el helper alterna entre modo privilegiado y
global.

## BANNER DE ARRANQUE EN LAS SALIDAS

PT imprime el arranque de forma **asincrona**: `System Bootstrap` … `Self
decompressing the image` … `Press RETURN to get started!` puede aterrizar en el
buffer despues de que se tomara el `before` de un comando, y entraria en su
slice. La fase extendida del despertar hace que ese banner se gaste durante la
espera; como segunda defensa, si aun assim un `output` contiene un bloque de
arranque (`RE_ARRANQUE`), ese resultado se degrada a `status:"unknown"` (nunca
`ok`) y el payload lleva `arranque_pendiente` con cuantos comandos lo肥大aron.
Preferimos fallar visiblemente a devolver basura como si fuera salida valida.
Con el corte por ancla (ver *Corte de la salida de consola*) esto deberia ser
**raro**: el banner esta al principio del buffer y el corte sale pegado al eco del
comando. La degradacion se mantiene a proposito, sin tocar: si vuelve a aparecer
hay que ver por que, no taparlo.

## CORTE DE LA SALIDA DE CONSOLA

`getOutput()` de PT es **acotado** y **no es monotono**: medido en PT 9 (2911,
`packages/server/scripts/pt-diag-slice.ts`), el buffer llega a ~8 KB y al
desbordarse deja de ser el mismo texto que era (mismo `getOutput()` a los 500 ms
y a los 2.500 ms medidos 5.825 y 6.164 chars). Por eso el snapshot `before`
capturado antes de un comando **deja de ser prefijo**, y el corte antiguo
(`if (no es prefijo) return text`) devolvia el **buffer entero**: un
`show ip route` llego a devolver 5.147 chars empezando por
`System Bootstrap, Version 15.1(4)M4 ... Total memory size = 512 MB` (que es
justo lo que la suite marca FALLO por consola sucia).

`__corte(full, before, ancla)` decide en este orden (la primera que aplica
gana) y devuelve `{texto, limpio, motivo}`:

| # | Situacion | Corte | `limpio` | `motivo` |
| --- | --- | --- | --- | --- |
| 1 | `before` sigue siendo prefijo (caso normal) | por longitud, `full.slice(before.length)` | `true` | `prefijo` |
| 2 | No es prefijo pero aparece el **eco exacto** del comando | desde el ultimo `lastIndexOf` del ancla | `true` | `ancla` |
| 3 | Solo aparece el eco **aproximado** (dos ultimas palabras / ultima palabra) | desde ese `lastIndexOf` | **`false`** | `ancla_parcial` |
| 4 | Ni prefijo ni ancla, o no habia snapshot | ventana final de `CORTE_VENTANA_FINAL` (4000 chars) | **`false`** | `sin_ancla` / `sin_before` |

**El ancla es el texto del comando** (PT lo hace eco y, como se acaba de
teclear, queda pegado al final del buffer), que es la tecnica del MCP de
referencia (`examples/mcp-example/src/sim/runner.ts:36-48`, `readSinceMarkerJs`).
Las anclas candidatas van de mas a menos especificidad: el comando entero, sus
dos ultimas palabras y su ultima palabra. Solo la primera da un corte limpio:
las demas se marcan `ancla_parcial`, que es justo el caso del comando **mutilado**
(`how ip route` contiene `ip route`), para que la degradacion se vea en vez de
disfrazarse de corte bueno. La busqueda exige **limites de palabra** (asi
`R1#show ip route` cuenta aunque PT pegue el prompt delante, y `ip route` no casa
dentro de `ip route-map`) y que el eco este en los ultimos
`CORTE_VENTANA_ANCLA` (12000) chars, para no aceptar el eco de una ejecucion
vieja.

Los cortes degradados se ven en el payload: `results[i].corte` con el motivo y,
en la raiz, `corte:"degradado"` + `salida_recortada:"N"`. Con el corte limpio
ninguno de esos campos aparece. `__sliceAfter(full, before, ancla)` se mantiene
como envoltorio que devuelve solo el texto (compatibilidad).

## CONSOLA INACTIVA

Medido en PT 9: mandar un comando con la consola ocupada hace que PT **se coma
el primer caracter** (`R1#how ip route` + `% Invalid input detected at '^'
marker.`), y la salida se captura **a medias** (`show running-config` devolvia
264 chars y el resto del texto aparecia en el buffer mas tarde).

`__esperarConsolaInactiva(line, tope, lecturas, paso)` espera por **estado
observable**: la consola esta inactiva cuando la ultima linea del buffer es un
prompt (`>`, `#`, `Router(config)#`) y no hay paginador pendiente, con la longitud
del buffer **estable** en `lecturas` lecturas consecutivas. Topes: 1.500 ms antes
de cada comando (`lecturas: 1`) y 1.500 ms despues (`lecturas: 2`, paso 100 ms),
que es la confirmacion de que PT termino de escribir la salida.

- **Coste en el caso normal: ~0.** Antes de cada comando, una lectura del buffer
  y, si ya hay prompt, ni un `__busyWait` (medido en el banco local: 5 ms de
  reloj y **0 esperas**). Despues de cada comando, un paso de confirmacion
  (100 ms). En hosts (PC/Server/Laptop) no se aplica: su prompt no es de IOS.
- Si tras el tope la consola sigue ocupada se **manda el comando igualmente** y
  se avisa con `payload.consola_ocupada:"N"`: bloquear al agente seria peor que
  el comando mal tecleado.
- El paginador `--More--` se paga con `__pagarPagina` (`line.enterCommand(" ")`, el
  **unico** sitio del fichero que teclea el paginador: lo comparten
  `__pageThrough` y esta espera). MEDIDO en PT 9: `line.enterChar(32)` es un
  **NO-OP** (con 1 argumento y con los 2 de la API oficial), asi que la escalera
  pone `enterCommand` primero y deja `enterChar` al final como respaldo
  documentado (ver *Como se paga el paginador (y por que `enterChar` no sirve)*).

## EVENTO `commandEnded` (motor de comandos en dos fases)

`runDeviceCommands` envia el lote y luego **adivina** cuando ha terminado: manda
los comandos, espera `waitMs` a ciegas con `__busyWait` (espera ACTIVA) y recorta
el buffer con heuristicas. Con un comando lento (`ping`, o un `show` tras un
equipo recien arrancado) la espera se queda corta y la salida sale **vacia o
truncada**.

Packet Tracer tiene una senal exacta para eso y no la estabamos usando: el
**evento `commandEnded`** de la linea de consola, que dispara cuando el comando
en curso ha terminado de verdad. Referencia probada en
`examples/PING-EXTENCION.md:186-206` (handler) y `:242-244` (registro):

```js
terminalLine.registerEvent("commandEnded", null, onCommandEnded);
function onCommandEnded(src, args) {
  var fullOutput = terminalLine.getOutput();   // salida COMPLETA del comando
}
terminalLine.unregisterEvent("commandEnded", null, onCommandEnded);
```

El evento hermano `terminalUpdated` **no** sirve como senal de fin: no se
dispara siempre, y su payload es el texto del tick, no el fin del comando.

### Por que son DOS FASES y no una llamada

`__busyWait` es un busy-wait **real** (`while (Date.now() - start < ms) {}`,
`userfunctions.js:60`) que bloquea el hilo del **Script Engine** de PT, que es
monohilo y comparte proceso con la UI. Mientras una llamada nuestra esta en
curso, PT **no despacha eventos**: `commandEnded` se encola y salta despues de
que volvamos, ya fuera de la funcion. Por eso no vale un `while (!terminado) {}`
dentro de la llamada (no saldria nunca) ni esperar el evento desde el propio
envio. La solucion es de dos fases, con el **backend** haciendo el sondeo:

1. `runCommandAsync(deviceName, commands, options)` — asegura el modo
   (`__despertarConsola` + `__asegurarModo` + `__preambuloSeguro`, los mismos
   que usa `runDeviceCommands`), **registra `commandEnded`**, envia el lote y
   devuelve `pendienteId` de inmediato.
2. `pollCommandResult(pendienteId, options)` — el backend lo llama en
   peticiones posteriores. Para entonces el motor ya puede despachar el evento.

`options` de `runCommandAsync` = `{mode, waitMs, maxChars, preambulo, esperaFin,
reiniciarSimulacion}`. `mode` tiene la misma semantica que en `runDeviceCommands`
(`""`/`"user"`/`"enable"`/`"global"`). `waitMs` aqui es una espera **MINIMA** para
que PT acepte el comando (por defecto 0, tope 150 ms): **no** es la espera de
captura de la salida, esa la hace el sondeo. `preambulo:false` no emite el
preambulo profilactico. `reiniciarSimulacion:true` reinicia la linea de tiempo de
la simulacion en modo best effort (por defecto **no** se reinicia: aqui no hay
PDU que medir, y `resetSimulation()` con comandos en vuelo es justo lo que no se
quiere).

Respuesta: `{success, pendienteId, deviceName, comandos, modo, eventoRegistrado,
t0}`, con `eventoRegistrado:false` si `registerEvent` no existe en ese PT (todo en
`try/catch`: si esa API falla, el pendiente sigue siendo valido y el backend
sabe que **no** puede esperar la senal).

### El sondeo

- Antes del evento: `{success, pendienteId, done:false, estado:"en_curso",
  pendienteMs, eventoRegistrado, paginasPagadas}`. Sin `results` ni `fuente`.
- Con el evento: `{success, pendienteId, done:true, estado:"terminado",
  fuente:"commandEnded", pendienteMs, deviceName, results, summary}`.
  `results[i]` es `{command, status, output}` — **la misma forma que
  `runDeviceCommands`**, con `corte` solo si el corte fue degradado y el `status`
  de la misma triada `ok`/`error`/`unknown` (salida vacia **nunca** es `ok`) —,
  para que el backend reutilice el parseo que ya tiene. El corte se hace con
  `__corte(full, before, comando)` usando el `before` capturado **antes** de cada
  comando y el propio comando como ancla. Como los comandos de un lote se envian
  seguidos y PT no los escribe de uno en uno, la fila `i` se recorta ademas por
  el `before` **siguiente** (donde empieza lo que escribio el comando `i+1`): sin
  eso la fila `i` se tragaria la salida de los comandos siguientes.
- Un prompt pendiente se ha comido el comando: `{success, pendienteId,
  done:false, estado:"reintentar", pendienteMs, eventoRegistrado,
  paginasPagadas, bloqueoResuelto, comandoConsumido:true,
  motivo:"prompt_pendiente_consumio_el_comando"}`. El pendiente **no** se
  cierra (ver *Bloqueos de consola durante el sondeo*).
- `options` = `{esperarMs, maxChars, esperaFin}`. `esperarMs` (0-3000, por
  defecto 0) es el **presupuesto interno de la ronda**: cuanto esperar DENTRO de
  esa llamada antes de responder (el host reparte su intervalo entre lo que pide
  aqui y lo que espera fuera de la llamada, para no tener el equipo bloqueado
  entre rondas).

**El campo que hay que mirar es `fuente`**: `"commandEnded"` = el evento salto
(senal exacta, la salida es la del fin real del comando) | `"buffer"` = se leyo
`getOutput()` porque **no** habia senal de fin utilizable. Hay **tres** vias de
salida, y solo la primera es exacta:

| Situacion | Respuesta | `fuente` |
| --- | --- | --- |
| El evento salto | `done:true` | `commandEnded` |
| `eventoRegistrado:false` (PT no expone la API), sin `getOutput`, o lote vacio | `done:true` al primer poll | `buffer` |
| El evento nunca salta y el pendiente **venció** (`PENDIENTE_VIGENCIA_MS`, 60 s) | `done:true` + `motivo:"presupuesto_vencido"` | `buffer` |
| Un prompt pendiente se ha comido el comando | `done:false` (`reintentar`) + `comandoConsumido:true`, el host decide | — |
| El evento esta vivo y aun no salta | `done:false` (`en_curso`), el host repite | — |

`esperarMs` **no** fuerza `done:true`: si lo hiciera, cada ronda devolveria una
lectura a ciegas de `getOutput()` y el ciclo del evento no serviria de nada
(seria el mismo falso OK que este motor viene a sustituir: un `ping` lento
"terminaria" a los 250 ms con la salida a medias). El plazo de vigencia esta a
proposito **por encima** del presupuesto del host (`BUDGET_MS_POR_DEFECTO` = 25 s
en `packages/server/src/client/PacketTracerConsola.ts`): si el evento no salta,
quien decide como seguir es el host (releyendo la consola, sin re-ejecutar); los
60 s son solo la red de seguridad contra fugas.

Campos **aditivos** (solo cuando hay algo que avisar, como en el resto del
fichero): `warning` (sin `getOutput`), `despertar`, `modo`, `preambulo`,
`resetSimulacion`, `enviadosConError`, `consola_ocupada`, `pendientesCerrados`,
`pendientesPurgados`, `eventoEn`, `motivo`, `arranque_pendiente`, `corte` +
`salida_recortada`, y los del resolutor de bloqueos `bloqueoResuelto`,
`comandoConsumido` y `bloqueoAgotado`.

## BLOQUEOS DE CONSOLA DURANTE EL SONDEO

`__despertarConsola` ya sabia contestar un `Press RETURN to get started!`, un
dialogo `[yes/no]` o un lookup DNS… pero **no puede adelantarse a un arranque
asincrono**. MEDIDO en PT 9 con la suite `test-pt`: `show running-config` contra
un 2911 recien creado **no termina nunca** (45 sondeos, 55 s de presupuesto
agotados, `pollCommandResult` siempre en `en_curso`). La captura de la consola del
router da la causa exacta: el equipo termina de arrancar **despues** de que pasara
el despertar, su aviso se queda esperando, y el `show running-config` siguiente
**se consume como la tecla del RETURN**. El comando nunca se ejecuta y por eso el
evento `commandEnded` no salta nunca. Antes, el sondeo solo pagaba el `--More--`:
nunca pulsaba Enter, que es justo donde se pasa el 99 % de la espera.

Por eso cada ronda de `pollCommandResult` consulta `__resolverBloqueo(line)` y, si
hay algo que atender, ejecuta **una sola** accion con `__aplicarBloqueo`. Son dos
funciones y no una porque el sondeo necesita poder **consultar la senal sin
actuar**: el tope de acciones por pendiente se comprueba *antes* de teclear.

| Señal en el buffer | Acción | Pieza reutilizada | `consumioComando` |
| --- | --- | --- | --- |
| `--More--` | `line.enterCommand(" ")` (espacio como comando; `enterChar` queda de respaldo) | `__pagarPagina` | **`false`** |
| `Press RETURN to get started!` pendiente | Enter (y, si el buffer no cambia, `"\n"`) | `__responderReturn` | **`true`** |
| `initial configuration dialog` / `[yes/no]` / `Please answer 'yes' or 'no'` abierto | `no` con modo `""` | `__sendCommand` + `__dialogoAbierto` | **`true`** |
| `Translating "` con la consola sin prompt | `\u001e` (Ctrl+^) | `__sendCommand` | **`true`** |

Prioridad: **paginador > prompts** (el `--More--` es la salida larga del comando
*en curso*, asi que se paga antes de mirar nada mas).

- `__resolverBloqueo` es una **lectura** y devuelve
  `{accion:"espacio"|"enter"|"no"|"escape"|"", motivo, consumioComando}`; con
  `accion:""` cuando no hay nada que atender. Todo en `try/catch`: si una lectura
  o una API falla, se devuelve "sin accion" y el sondeo sigue vivo.
- `__aplicarBloqueo(line, device, bloqueo)` ejecuta la accion y devuelve si pudo
  teclear. `device` es el respaldo de `__sendCommand` (el pendiente lo guarda, y
  `__cerrarPendiente` lo suelta al cerrar).
- El aviso de arranque se busca en una **cola de 600 chars**, no en la ultima
  linea: medido en PT 9 el aviso queda seguido de un mensaje de sistema
  (`%LINEPROTO-5-UPDOWN: …`) que la consola sigue escribiendo mientras el RETURN
  sigue pendiente. `__pressReturnPendiente` lo trata como una **barrera**: solo
  se da por resuelto cuando *detras* de la marca aparece una linea que es un
  prompt de IOS entero (`RE_PROMPT_LINEA`, sin espacios: `R1#`, `Router(config)#`).
- Topes por pendiente: `PAGINADOR_MAX_PAGINAS` (40) para los espacios y
  `BLOQUEO_MAX_PROMPTS` (8) para las tecleadas de prompt. Al superarlos **se deja
  de actuar** y el payload lo dice con `bloqueoAgotado:true`.

### Como se paga el paginador (y por que `enterChar` no sirve)

**Hallazgo MEDIDO en PT 9** (no es una teoria; con `show running-config` sobre un
router real, `scripts/pt-diag-runningconfig.ts`, build `2026-10-02T15:14:15`):

| | Resultado medido |
| --- | --- |
| `line.enterChar(32)` | **NO-OP**. El buffer se queda en ` --More-- ` indefinidamente y `show running-config` no termina nunca: el agente agotaba 27,5 s y devolvia el banner de arranque como si fuera la salida |
| `line.enterChar(32, null)` | **NO-OP** tambien, con los **dos** argumentos que declara la API oficial (`enterChar(byte, SpecialChar)`) |
| `line.enterCommand(" ")` | **FUNCIONA**: un espacio enviado como comando. Todos los comandos del sistema pasan por `enterCommand`, y el paginador se come el espacio y muestra la siguiente pagina (`payload.pagerVia:"enterCommandEspacio"`) |
| evento `moreDisplayed` | **si dispara** y es la senal **fiable** de que el paginador esta abierto (`payload.pagerVisto:true`). Mucho mas fiable que buscar la cadena `--More--`, que sale como `" --More-- "` con espacios o no sale |

Por eso la escalera de `__pagarPagina` pone **primero lo que esta medido que
funciona** y deja `enterChar` al final como respaldo documentado:

| Orden | Escalon | Nota |
| --- | --- | --- |
| 1 | `enterCommand(" ")` | la via que funciona |
| 2 | `enterCommand("\n")` | otro `enterCommand`, por si el espacio no basta |
| 3 | `enterChar(32, null)` | aridad oficial de PT 9 (no-op medido) |
| 4 | `enterChar(32)` | aridad corta (no-op medido, era la que usabamos) |

La escalera **sigue verificando contra el buffer** despues de cada escalon (si el
buffer no cambia se pasa al siguiente) y expone que via surtio efecto en
`__PAGINADOR_VIA_ULTIMA` -> `payload.pagerVia`. `enterChar` no se borra: si
`enterCommand` no existiera en alguna build, es lo unico que queda, y su coste es
una llamada que no cambia el buffer y se descarta.

**El Enter (`Press RETURN to get started!`) NO se reordena.** Con ese aviso solo
se ha medido el caso de un router recien creado y arrancando
(`scripts/pt-diag-estado-consola.ts`, 27 rondas de sondeo: el aviso seguia
pendiente, sin ni un prompt en el buffer), donde `enterCommand("")` es no-op y
`enterCommand("\n")` es lo que se ha probado. Un espacio al arrancar podria
colarse como respuesta del dialogo, asi que `__responderReturn` mantiene su
escalera (`enterChar(13)`, `enterChar(10)`, `enterCommand("\n")`,
`enterCommand("")`) y expone en `payload.enterVia` que via surtio efecto. Cuando
haya una medicion con el aviso pendiente, ese campo dira si hay que mover
`enterCommand` de sitio.

### `consumioComando`: por que solo tres acciones

Depende **solo de la naturaleza de la tecla**, no de si surtio efecto:

- `espacio` → `false`. Pagar una pagina **no invalida el comando**: sigue siendo el
  mismo, el corte por `before` sigue valiendo y su `commandEnded` seguira saltando
  cuando termine. Por eso el paginador nunca pide reintentar.
- `enter` / `no` / `escape` → `true`. Un RETURN, un aviso de arranque, un dialogo
  o un Ctrl+^ los consume **un prompt pendiente, no el comando**: la linea
  recien tecleada se pierde. El comando ya no se esta ejecutando, asi que su
  evento no llegara nunca y el host se quedaria esperando en silencio.

### `reintentar` frente a `en_curso`

Se devuelve `estado:"reintentar"` (con `comandoConsumido:true`,
`bloqueoResuelto:"<motivos>"` y `motivo:"prompt_pendiente_consumio_el_comando"`)
en vez de `en_curso` cuando se cumple **todo** esto:

1. el resolutor tecleó alguna vez algo con `consumioComando` (se accumulates en
   el pendiente como `p.comandoConsumido`), **y**
2. el lote **aun no ha producido la salida de su comando**: `__comandoYaTecleado`
   no encuentra el eco, con el **mismo criterio que los `results`** (`__corte` con
   el `before` previo y el comando como ancla).

`reintentar` va **antes** que `en_curso` y que las tres vias de salida, porque
teclear el desbloqueo tambien puede hacer saltar el evento de PT y ese evento
**no** es el fin del comando del lote (el comando ni se ejecuto): un `done` ahi
devolveria salida vacia. El pendiente **no se cierra**: decide el host.

Si el host vuelve a preguntar y el comando ya **si** esta escrito en el buffer, se
sigue el camino normal (`en_curso` y luego `done:true` con la salida real).

- `bloqueoResuelto` **acumula** los motivos del pendiente sin repetirlos:
  `""` → `"enter"` → `"enter,espacio"`. Se añade tambien a la respuesta `done`,
  con los valores acumulados, para que quede en el diagnostico del agente.
- Al cerrar el pendiente (`__cerrarPendiente`) se vacian `bloqueoResuelto`,
  `comandoConsumido`, `paginasPagadas` y `accionesBloqueo`, y se suelta `device`:
  el objeto ya no esta en el mapa y el handler del evento no debe dejar rastros.
- **El reintento NO es de esta extension.** El host debe tratar
  `estado:"reintentar"` (o `comandoConsumido:true`) como "el prompt pendiente se
  comio mi comando": cerrar el pendiente y **reenviar una sola vez** los mismos
  comandos, y solo si el llamante los declara reintentables (lecturas).

Los motivos son **codigos cortos en espanol** (`"espacio"`, `"enter"`,
`"dialogo"`, `"dns"`), nunca las frases en ingles: la suite `test-pt`
(`falloConsolaSucia`) barre el JSON completo y el diagnostico no puede
dispararla.

### Registro en bloque y referencia estable

El evento se registra **UNA vez por lote**, no una por comando: un `commandEnded`
cierra el comando **en curso**, asi que un evento por comando no seria senal de
"el lote termino" (la del ultimo tecleado). Por eso se registra antes del primer
comando y **despues** de las fases de arranque: esas teclean comandos propios
(`show clock` del sondeo, `enable`, `terminal length 0`, `no ip domain-lookup`) y
sus `commandEnded` se atribuirian al lote, haciendo que el primer poll cortara la
salida a medias.

`unregisterEvent` exige **exactamente la misma referencia** de handler que se
paso en `registerEvent` (la compara por identidad). Por eso el handler se crea
una vez por pendiente y se guarda en `p.handler`, y es ese mismo `p.handler` el
que se pasa al desregistrar: si se recreara, la suscripcion no se encontraria, el
evento seguiria vivo y cada `runCommandAsync` dejaria una suscripcion huerfana
disparando contra un pendiente ya cerrado.

Si el evento salta **antes de tiempo** (por ejemplo por el `enable` del ajuste de
modo) no se descarta: el handler marca `done` y anade `eventoEn` con cuantos
comandos se habian enviado. Si al backend le hace falta mas, vuelve a llamar
(el `getOutput()` siguiente ya tiene el resto) o relanza el lote.

### Un pendiente por equipo, limite duro y limpieza

- Al cerrar (`done:true`) el pendiente **se borra**: se desregistra el evento y se
  elimina la entrada del mapa. Preguntar otra vez por ese id devuelve
  `{success:false, error:"pendiente desconocido o ya cerrado"}`.
- Al cerrar **tambien** se vacian `bloqueoResuelto`, `comandoConsumido`,
  `paginasPagadas` y `accionesBloqueo`, y se suelta el `device` (la linea se
  conserva, es la que ya tenia el pendiente): el diagnostico de bloqueos vive en el
  pendiente y el handler del evento sigue vivo hasta el desregistro, asi que no
  debe dejar rastros del lote cerrado.
- Un `runCommandAsync` nuevo **sobre el mismo equipo** cierra antes el pendiente
  anterior (con su desregistro), para que no se acumulen eventos y buffers de dos
  lotes sobre la misma linea.
- **Limite duro de 32 pendientes vivos** con purga por antiguedad: al superarlo
  se cierra el mas viejo (el primero que entro), desregistrando su evento antes
  de borrarlo. Nunca hay fugas aunque el backend abandone un pendiente.
- `cleanUp()` de `main.js` **no se engancha** (solo desregistra el item de menu y
  ese fichero no se toca desde aqui). El helper global
  `__cerrarTodosLosPendientes()` queda preparado para que se llame desde ahi;
  mientras tanto, las tres reglas anteriores ya acotan las fugas.

### Limite de la espera interna

`setTimeout` en el motor de scripts de PT es **diferido**: su callback corre
DESPUES de que la llamada devuelve, asi que **no se puede esperar dentro de un
poll** (`runCode`, `runcode.js:3`, es sincrono: `new Function` + return
inmediato). Por eso `esperarMs` no se apoya solo en el: se arma igualmente un
`setTimeout` para el **refresco diferido** del buffer (el mismo truco de 150 ms
del ejemplo de `PING-EXTENCION.md`, util cuando PT sigue volcando la salida
justo despues del evento) y la espera la hace el presupuesto acotado de
`__busyWait`, con tope de 3000 ms. Mientras espera **no** puede saltar el evento
(el mismo hecho que motiva las dos fases), pero el siguiente poll lo ve: la
exactitud no se pierde.

## NOTAS DE IMPLEMENTACION

- `getOutput()` es acumulativo y acotado: el motor captura un snapshot antes de
  cada comando y recorta con `__corte` (ver *Corte de la salida de consola*).
- Si la salida trae `--More--`, se envia espacio con `line.enterCommand(" ")` en
  bucle (maximo `PAGINADOR_MAX_PAGINAS` = 40 iteraciones), se vuelve a cortar
  con `__corte` en cada pago y se limpia el marcador del texto. `enterChar` queda
  como respaldo documentado, no como via principal (es un NO-OP en PT 9).
- **TODA la salida de la extension es ASCII o Latin-1**: el motor de Packet
  Tracer convierte a mojibake todo caracter por encima de U+00FF al volcar el
  payload al socket (medido: una flecha de U+2192 llegaba al agente como tres
  bytes basura, `a` + 0xE2 + 0x86 + 0x27), mientras que los acentos Latin-1
  (`llegó`) se transmiten bien. Nada de tipografia: ni flechas, ni rayas, ni
  comillas tipograficas, ni elipsis, ni dagas. En el codigo se escribe `->`.
- Si el equipo no tiene consola legible, `runDeviceCommands` devuelve
  `output:""` por comando y `warning:"console_output_unavailable"` en la raiz
  (no lanza).
- Los modos de `enterCommand` son SOLO `""`, `"user"`, `"enable"` y `"global"`.
- Los argumentos se serializan como literales JS: los strings entre comillas
  (con `JSON.stringify`, escapando ademas U+2028/U+2029) y los arrays/objetos
  con `JSON.stringify`.
- El Script Engine de Packet Tracer no tiene `btoa` ni `Buffer`: por eso
  `exportWorkspace`/`importWorkspace` traen su propio codificador/decodificador
  base64 escrito a mano.
- Los enlaces se resuelven con `Port.getOwnerDevice()` (`__portDeviceName`);
  `getDevice`/`getDeviceName`/`getParentDevice` no existen en la API de PT 9.
  Ningun enlace se "adivina" por nombre de interfaz (los nombres se repiten
  entre equipos): si un extremo no se resuelve, `getNetwork` lo descarta y lo
  cuenta en `result.unresolvedLinks`, igual que `validateTopology` en su
  `unresolvedLinks`. Los enlaces con un extremo sin puerto (o sin objeto de
  enlace) se cuentan aparte en `nullPortLinks`.
- Toda clave por puerto usa el formato `equipo::puerto`: `in_use` en
  `getNetwork` y `portUse`/`portPairUse` en `validateTopology` (de ahi salen
  los mensajes "Interfaz repetida" y "Enlace duplicado"). Asi el mismo nombre
  de interfaz en dos equipos distintos no genera falsos positivos.
