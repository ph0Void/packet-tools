# SERVER MCP - PACKET TOOLS

Servidor **MCP (Model Context Protocol)** sobre **stdio** que expone las
capacidades de automatización de red de Packet Tools como herramientas que
cualquier terminal de IA puede invocar: **Claude Code / Claude Desktop, Codex
CLI, OpenCode, GitHub Copilot (VS Code), LM Studio** y cualquier cliente MCP
estándar.

Permite diseñar topologías, configurar equipos IOS por CLI y hablar con
dispositivos reales por **puerto serie, Telnet y SSH**, exactamente con el mismo
motor que usa la aplicación web/desktop.

---

## 1. Qué problema resuelve

Packet Tools ya sabía hacer todo esto, pero **solo desde su propia interfaz**:
había que abrir la app web, escribir en su chat y tener el backend corriendo con
sesión iniciada. Este servidor MCP saca ese motor fuera de la app para que el
usuario trabaje desde **su** terminal de IA, con sus propias reglas y sin
depender de una UI.

### Estructura de carpetas

```
packages/mcp/
├── prisma/schema.prisma      # esquema de la BD propia del MCP
├── skills/*.md               # skills del usuario (markdown libre)
├── plans/*.md                # checklists generados por plan_task
├── scripts/                  # generate de Prisma y reescritor de dist
├── test/smoke.ts             # prueba de humo
└── src/
    ├── app.ts                # entrypoint (bin)
    ├── config/EnvConfig.ts   # configuración con defaults
    ├── core/                 # McpServer, ToolRegistry, errores
    ├── domains/              # un módulo por dominio
    ├── transports/           # DeviceTransport + adaptadores + motor
    ├── skills/               # cargador y exposición como resources
    ├── prisma/               # cliente de la BD propia
    └── utils/Logger.ts       # logs SIEMPRE por stderr
```

---

## 3. Herramientas expuestas

**95 herramientas en 7 dominios.** El prefijo de cada nombre indica su dominio,
para que el modelo lo deduzca sin leer la descripción.

### `@packet-tracer` — 40 herramientas

Topologías en Cisco Packet Tracer, a través del **bridge socket.io que aloja este
mismo servidor MCP** (`MCP_BRIDGE_PORT`, 7532 por defecto): la extensión de Packet
Tracer se conecta al MCP, no al backend.

| Herramienta                                | Qué hace                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `packet_tracer_connection_status`          | Estado del bridge del MCP, si la extensión está conectada, y recuento de dispositivos/enlaces |
| `packet_tracer_list_device_models`         | Catálogo REAL de modelos que acepta el motor                                                  |
| `packet_tracer_get_network`                | Topología completa: dispositivos, interfaces y enlaces                                        |
| `packet_tracer_get_device_info`            | Ficha de un dispositivo y sus puertos                                                         |
| `packet_tracer_list_device_modules`        | Módulos de expansión que admite un equipo                                                     |
| `packet_tracer_get_device_config_snapshot` | running-config, startup-config y XML del equipo                                               |
| `packet_tracer_read_console`               | Últimas líneas de la consola                                                                  |
| `packet_tracer_get_command_log`            | Historial de comandos ejecutados                                                              |
| `packet_tracer_get_routing_table`          | Tabla de rutas (`show ip route`)                                                              |
| `packet_tracer_get_vlan_configuration`     | VLANs de un switch                                                                            |
| `packet_tracer_get_device_metrics`         | Estado de encendido e interfaces                                                              |
| `packet_tracer_validate_security_config`   | Auditoría: contraseñas, SSH, Telnet                                                           |
| `packet_tracer_validate_topology`          | Errores, avisos, huérfanos y bucles                                                           |
| `packet_tracer_generate_network_report`    | Informe legible de la red                                                                     |
| `packet_tracer_add_device`                 | Coloca un equipo (valida el modelo contra el catálogo real)                                   |
| `packet_tracer_add_module`                 | Instala un módulo en una ranura                                                               |
| `packet_tracer_add_link`                   | Cablea dos equipos                                                                            |
| `packet_tracer_remove_device`              | Elimina equipos (detalle por equipo)                                                          |
| `packet_tracer_remove_link`                | Retira cables                                                                                 |
| `packet_tracer_move_device`                | Mueve un equipo en el lienzo                                                                  |
| `packet_tracer_rename_device`              | Renombra un equipo                                                                            |
| `packet_tracer_set_power`                  | Enciende / apaga                                                                              |
| `packet_tracer_configure_pc_ip`            | Direcciona un equipo final (estático o DHCP)                                                  |
| `packet_tracer_run_device_commands`        | Comandos CLI síncronos                                                                        |
| `packet_tracer_configure_ios_device`       | **Lote IOS fiable con verificación contra el equipo**                                         |
| `packet_tracer_apply_device_config`        | Bloque de configuración (motor antiguo)                                                       |
| `packet_tracer_run_command_async`          | Lanza un lote en el motor de dos fases                                                        |
| `packet_tracer_poll_command_result`        | Sondea el resultado del lote anterior                                                         |
| `packet_tracer_get_simulation_status`      | Estado de la simulación                                                                       |
| `packet_tracer_set_simulation_mode`        | Tiempo real ↔ simulación                                                                      |
| `packet_tracer_step_simulation`            | Avanza (o reinicia) la simulación                                                             |
| `packet_tracer_send_pdu`                   | Inyecta un paquete entre dos equipos                                                          |
| `packet_tracer_get_pdu_results`            | Fotogramas capturados y su estado                                                             |
| `packet_tracer_ping`                       | Comprueba conectividad (PDU con respaldo CLI)                                                 |
| `packet_tracer_reachability_matrix`        | Un origen contra hasta 10 destinos                                                            |
| `packet_tracer_simulate_link_failure`      | Simula la caída de un enlace                                                                  |
| `packet_tracer_restore_link`               | Restaura el enlace caído                                                                      |
| `packet_tracer_clear_workspace`            | **Borra todo el lienzo (irreversible)**                                                       |
| `packet_tracer_export_workspace`           | Exporta a `.pkt`                                                                              |
| `packet_tracer_import_workspace`           | Carga un `.pkt` (reemplaza el lienzo)                                                         |

### `@gns3` — 35 herramientas

Proyectos, nodos, enlaces, capturas y plantillas del servidor GNS3.

`gns3_list_configured_servers`, `gns3_test_connection`, `gns3_list_projects`,
`gns3_find_project`, `gns3_get_project`, `gns3_create_project`,
`gns3_open_project`, `gns3_close_project`, `gns3_delete_project`,
`gns3_get_project_stats`, `gns3_get_server_resources`, `gns3_list_nodes`,
`gns3_get_templates`, `gns3_create_node`, `gns3_control_node_power`,
`gns3_list_node_files`, `gns3_read_node_log`, `gns3_list_links`,
`gns3_connect_nodes`, `gns3_start_link_capture`, `gns3_stop_link_capture`,
`gns3_get_link_capture`, `gns3_download_link_pcap`, `gns3_list_snapshots`,
`gns3_create_snapshot`, `gns3_restore_snapshot`, `gns3_delete_snapshot`,
`gns3_get_template`, `gns3_create_template`, `gns3_update_template`,
`gns3_delete_template`, `gns3_duplicate_template`, `gns3_export_project`,
`gns3_import_project`, `gns3_auto_layout_project`.

### `@serial` — 5 herramientas

Consola física (RS-232 / USB) con detección de fabricante.

| Herramienta            | Qué hace                                                    |
| ---------------------- | ----------------------------------------------------------- |
| `serial_list_ports`    | Enumera los puertos serie del sistema (`SerialPort.list()`) |
| `serial_detect_vendor` | Lee el banner/prompt e identifica el fabricante             |
| `serial_send_commands` | Envía comandos con la sintaxis del fabricante detectado     |
| `serial_read_console`  | Lee sin enviar nada (arranque, logs)                        |
| `serial_disconnect`    | Libera el puerto                                            |

### `@telnet` y `@ssh` — 3 herramientas cada uno

| Herramienta                                  | Qué hace                                     |
| -------------------------------------------- | -------------------------------------------- |
| `telnet_detect_vendor` / `ssh_detect_vendor` | Identifica el fabricante del equipo remoto   |
| `telnet_send_commands` / `ssh_send_commands` | Envía comandos con el motor multi-fabricante |
| `telnet_disconnect` / `ssh_disconnect`       | Cierra la sesión                             |

### `@plan` — 4 herramientas

`plan_task` (crea el plan), `plan_execute` (devuelve los pasos pendientes),
`plan_mark_step` (marca hecho/fallido) y `plan_list` (lista los planes).

### `@skills` — 5 herramientas

`skills_list`, `skills_read`, `skills_create`, `skills_delete` y
`skills_directory`.

---

## 4. Detección de fabricante (motor multi-marca)

Es lo que permite configurar equipos reales sin saber de antemano con qué
sintaxis hablarles. Se resuelve en **tres niveles**:

1. **Declarado** — el `typeDevice` del dispositivo configurado en la BD del MCP.
   Solo es concluyente para `CISCO`, `HUAWEI`, `ARUBA`, `MIKROTIK` y `JUNOS`.
2. **Detectado por el prompt** — reglas ordenadas de más a menos específica:

   | Prompt                            | Fabricante        |
   | --------------------------------- | ----------------- |
   | `[admin@MikroTik] >`              | MikroTik RouterOS |
   | `[edit interfaces]`, `user@host>` | Juniper JunOS     |
   | `<R1>`, `[R1-GigabitEthernet0/0]` | Huawei VRP        |
   | `(host) (config) #`               | ArubaOS           |
   | `R1(config)#`                     | Cisco IOS         |

3. **Conservador** — sin datos concluyentes. Reconoce prompts y paginadores
   genéricos, pero **no inventa transiciones de modo**: es preferible no tocar la
   consola que teclear un comando que no existe.

El perfil decide qué preámbulo se envía (por ejemplo `terminal length 0` en Cisco
para que un `show run` no se quede en `--More--`), cómo se detecta un sub-modo y
qué comando sale de él (`exit` en Cisco, `quit` en Huawei, `..` en MikroTik).

**Nunca se envían comandos que cerrarían la consola** (`exit`, `quit`, `logout`,
`disconnect`, `close`): se descartan y se avisa en la respuesta.

---

## 5. `@plan` y `@execute`

`@plan` y `@execute`Se implementan como herramientas
que el modelo invoca cuando el usuario escribe esa mención en el chat.

### Flujo

```
Usuario:  @plan crea una topología con 2 routers y 3 PCs con OSPF
   │
   ├─ El modelo llama a plan_task(objective, steps, openQuestions, risks)
   │     └─ escribe plans/plan-2026-01-15T10-30-00-topologia-2-routers.md
   │        y lo devuelve para que el usuario lo revise
   │
Usuario:  @execute
   │
   ├─ El modelo llama a plan_execute()          → pasos PENDIENTES
   ├─ ejecuta cada paso llamando a la herramienta correspondiente
   └─ tras cada paso: plan_mark_step(step, success)
```

### Ejemplo de plan generado

```markdown
# Plan: crea una topología con 2 routers y 3 PCs con OSPF

- **Archivo**: `plan-2026-01-15T10-30-00-topologia-2-routers.md`
- **Pasos**: 8

## Riesgos detectados

> Estas acciones son destructivas o ambiguas. Confírmalas con el usuario.

- ⚠️ Se vaciará el lienzo actual con packet_tracer_clear_workspace

## Pasos

- [ ] 1. packet_tracer_clear_workspace()
- [ ] 2. packet_tracer_add_device(name="R1", model="2911", x=100, y=100)
- [ ] 3. packet_tracer_add_device(name="R2", model="2911", x=400, y=100)
- [ ] 4. packet_tracer_add_link(device1Name="R1", device1Interface="GigabitEthernet0/0", ...)
- [ ] 5. packet_tracer_configure_ios_device(deviceName="R1", commands=["hostname R1", ...])
     ...
```

Tras ejecutarlo, el mismo archivo queda como registro auditable:

```markdown
- [x] 1. packet_tracer_clear_workspace()
- [x] 2. packet_tracer_add_device(...) — nota: verificado
- [!] 4. packet_tracer_add_link(...) — error: el puerto GigabitEthernet0/1 ya está en uso
```

**Ante un fallo, el plan se detiene**: `plan_execute` devuelve los pasos fallidos
con su error y avisa de que hay que preguntar al usuario si reintentar, saltar o
abortar. No hay reintentos en bucle.

Los planes se pueden **editar a mano** antes de ejecutarlos: el parser lee el
checklist, así que añadir, quitar o reordenar pasos funciona mientras se respete
el formato `- [ ] <número>. <acción>`.

---

## 6. Skills del usuario

Instrucciones propias (convenciones de nombres, políticas de seguridad,
procedimientos) que el modelo debe respetar, sin tocar el código del MCP.

### Dónde se ponen

`packages/mcp/skills/*.md` — hay un ejemplo en
[ejemplo-convencion-nombres.md](./skills/ejemplo-convencion-nombres.md).
El agente también puede crearlas desde el chat con `skills_create`.

### Formato

```markdown
---
title: Convención de nombres
description: Cómo nombrar los dispositivos de la red
slug: convencion-nombres
---

# Convención de nombres

- Routers: R<n>
- Switches: SW<n>
```

El frontmatter es **opcional**: sin él, el título se toma del primer encabezado
`# ` y el slug del nombre del archivo.

### Cómo llegan al modelo: dos mecanismos a la vez

| Mecanismo                               | Ventaja                                                                                    | Limitación                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **`resources`** MCP (`skill://<slug>`)  | Nativo del protocolo; el cliente puede listarlos y leerlos sin gastar una tool             | **No todos los clientes lo implementan** (LM Studio y clientes ligeros, por ejemplo) |
| **Tools** `skills_list` / `skills_read` | Funciona en **cualquier** cliente: las tools son la parte del protocolo que todos soportan | Consume una llamada a herramienta                                                    |

Se implementan **las dos** porque el objetivo es no depender de que el cliente
soporte `resources`. Ambas leen del mismo sitio, así que nunca se contradicen.

Las skills se leen **en cada llamada** (no al arrancar), así que una skill nueva
aparece sin reiniciar el servidor MCP — y sin obligar a reiniciar el cliente de IA.

> Nota sobre `skills-lock.json`: el del repositorio es el manifiesto de las skills
> de **los agentes de desarrollo** (`ai-sdk`, `impeccable`...), no de las de este
> servidor. Son cosas distintas y por eso el MCP no lo reutiliza.

---

## 8. Configuración en cada cliente

El servidor se lanza **siempre igual**; lo único que cambia es dónde se declara.

```bash
node
```

Durante el desarrollo (sin compilar) puede usarse
`npx tsx C:/.../packages/mcp/src/app.ts`.

### Claude Code / Claude Desktop

`claude_desktop_config.json` (o `.mcp.json` en la raíz del proyecto para Claude Code):

```json
{
  "mcpServers": {
    "packet-tools": {
      "command": "node",
      "args": ["   "],
      "env": {
        "DATABASE_URL_MCP": "file:.packet_tools_mcp.db",
        "MCP_BRIDGE_PORT": "7532"
      }
    }
  }
}
```

### OpenCode

`opencode.json`:

```json
{
  "mcp": {
    "packet-tools": {
      "type": "local",
      "command": ["node", "   "],
      "enabled": true
    }
  }
}
```

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.packet-tools]
command = "node"
args = ["   "]
```

### GitHub Copilot (VS Code)

`.vscode/mcp.json`:

```json
{
  "servers": {
    "packet-tools": {
      "type": "stdio",
      "command": "node",
      "args": ["   "]
    }
  }
}
```

### LM Studio

`mcp.json` en la carpeta de LM Studio:

```json
{
  "mcpServers": {
    "packet-tools": {
      "command": "node",
      "args": ["   "]
    }
  }
}
```

> **Compatibilidad de `resources`:** si un cliente no soporta `resources` MCP (es
> el caso de los más ligeros, como LM Studio), las skills siguen siendo accesibles
> por las tools `skills_list` y `skills_read`. No se pierde funcionalidad.
