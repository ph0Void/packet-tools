# Packet Tracer extension — Packet Tools

Native Cisco Packet Tracer extension (plain JavaScript, socket.io client) that exposes the simulator to the backend agent over a `tool_call` / `tool_result` bridge. **Not an npm workspace** (only `packages/*` are); never build it with turbo.

## Files

| File | Role |
| --- | --- |
| `main.js` | Extension entry: registers the `"Packet Tracer API"` item in the extensions popup menu, opens the window on click, unregisters on cleanup |
| `window.js` | `htmlWindow` class: creates/shows the `"Packet Tracer API"` WebView (900×600, min 400×300) and handles its `closed` event |
| `interface/index.html` + `index.css` | Status window UI (endpoint, connection state, activity log capped at 300 nodes) |
| `interface/socket.io.min.js` | Vendored socket.io client (do not upgrade by hand; keep in sync with the server's `socket.io` major) |
| `interface/interface.js` | The bridge: connects to the backend, dispatches `tool_call`, returns `tool_result` |
| `runcode.js` | `runCode(scriptText)`: runs JS text via `new Function`, returns `{success,result}` or a typed error (parse vs runtime, with `errorType`/`stack`/`code`) |
| `devices.js` / `links.js` / `modules.js` | Lookup tables: model name → PT numeric device type, link name → link id, module name → slot/type id |
| `userfunctions.js` | ~100 global ES5 functions the backend can call (`var` + `function`, always `{success:true\|false,…}`, every body in `try/catch`) |
| `Plugin-PacketToolsAPIv1.0.8.pts` | Packaged plugin installed into Packet Tracer's `extensions` folder |

## Connection

- `API_URL = "http://127.0.0.1:7531"` (`interface.js`, mirrored in `index.html`).
- Transport: socket.io with `transports: ["websocket"]`, infinite reconnection (1 s → 5 s backoff).
- Incoming: `socket.on("tool_call")` → validates `tool_name`/`tool_call_id`, builds the positional argument array from `TOOL_ARGS`, invokes via `executePTCode` → `$se("runCode", "return <fn>(args…)")`.
- Outgoing: `socket.emit("tool_result", {tool_call_id, tool_name, tool_input, result})`. A pending-results queue (max 64, 300 s TTL) holds results while disconnected and flushes on `connect`.
- The backend accepts this socket **without JWT** (Qt user-agent / `clientType=packet-tracer` exception in `socket.auth`); never add credential handling here.

## Dispatch (`TOOL_ARGS`)

- Defined in `interface/interface.js` (`TOOL_ARGS`, with `buildPositionalArgs` right below): tool name → positional parameter list (e.g. `runDeviceCommands: ["deviceName","commands","options"]`).
- A tool missing from the map is rejected with "herramienta no compatible": exposing a new `userfunctions.js` function means adding its `TOOL_ARGS` entry **and** the backend client/tool wiring (`PacketTracerClient` + `Tool.ts`).
- Internal helpers (the `__*` functions, plus `pduPing` and `__pingCli`) intentionally have **no** `TOOL_ARGS` entry: the backend cannot call them.

## `userfunctions.js` rules

- ES5 only (`var`, `function`, no arrow/async syntax at top level the PT engine must parse).
- Every exposed function returns `{success,…}` and wraps its body in `try/catch`.
- Never call `addSimplePdu` on a device without a usable IP: PT opens a modal *"No Functional Ports"* dialog that freezes the simulator. The ping path pre-validates IPs and interface state first.
- `sim.setSimulationMode(bool)` throws in PT 9 (`Invalid arguments for IPC call`): mode switches go through the window switch (`getRSSwitch().showSimulationMode()/showRealtimeMode()`), falling back to the simulation object.

## Build stamp (`EXTENSION_BUILD`)

`userfunctions.js` starts with a constant holding the file's own modification time:

```js
var EXTENSION_BUILD = "2026-10-03T03:26:07";
```

- The value must match **exactly** the repo file's mtime in local ISO `yyyy-MM-ddTHH:mm:ss` (`(Get-Item extension-packetracer/userfunctions.js).LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ss')` in PowerShell). After editing the file, re-read the mtime and update the constant.
- It is exposed in the `listDeviceModels` response as `build` (that tool is what the suite already uses as a liveness check, so no contract changes).
- The `test-pt` suite verifies it on startup along with liveness: a mismatched or missing build fails with `EXTENSIÓN DESACTUALIZADA` and exit 1. After regenerating the `.pts`, reload or restart Packet Tracer before re-running the suite — otherwise PT keeps running the old code and tests fail later with stale states.

## PT API references

- https://tutorials.ptnetacad.net/help/default/IpcAPI/class_cisco_device-members.html
- https://cisco-packet-tracer-help.yue.zone/default/scriptModules_scriptEngine.htm
- https://tutorials.ptnetacad.net/help/default/scriptModules_webViews.htm
- https://tutorials.ptnetacad.net/help/default/index.htm
