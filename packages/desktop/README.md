# Instalador de escritorio - Packet Tools

Aplicación de escritorio de **Packet Tools**: empaqueta el backend, el frontend y la base de datos SQLite en un solo programa instalable. **No requiere Node.js, Docker ni dependencias adicionales** en el equipo donde se instala: la aplicación trae su propio runtime de Node y arranca todo automáticamente.

- [README principal](../../README.md)
- [Documentación técnica (agentes)](./AGENTS.md)

## Descarga e instalación

1. Descarga `Packet Tools Setup <versión>.exe` desde la sección [Releases](https://github.com/ph0Void/packet-tools/releases).
2. Ejecuta el instalador (permite elegir la carpeta de instalación y crea accesos directos).
3. Abre **Packet Tools**: la aplicación levanta el backend y el frontend, y abre su propia ventana.

| Detalle | Valor |
| --- | --- |
| Requisitos | Windows 10/11 (x64); puertos `7531` y `3090` libres |
| Servicios | Backend en `http://localhost:7531` y frontend en `http://localhost:3090` |
| Datos y configuración | `%APPDATA%\Packet Tools` (base de datos, `uploads/`, `logs/` y secreto JWT generado automáticamente) |
| Otras plataformas | El mismo pipeline genera `AppImage` y `.deb` para Linux |

## Primer arranque

En el primer arranque la aplicación aplica las migraciones de la base de datos, ejecuta el seed y crea el usuario inicial:

| Usuario | Contraseña | Rol |
| --- | --- | --- |
| `admin` | `admin123` | `ADMIN` |

> Cambia la contraseña de `admin` después del primer acceso.

## Generar el instalador desde el código fuente

Desde la raíz del monorepo:

```bash
npm run build-desktop -- --win     # instalador NSIS (.exe) — se compila en Windows
npm run build-desktop -- --linux   # AppImage / .deb — se compila en Linux
```

Los artefactos quedan en `packages/desktop/dist/`. El proceso descarga Electron, el runtime de Node y las herramientas de empaquetado (requiere conexión a internet) y no necesita Visual Studio Build Tools. Con `DESKTOP_OBFUSCATE=true` en el `.env` raíz, el código propio se compila además a bytecode V8 antes de empaquetar. Detalles técnicos del pipeline en [`AGENTS.md`](./AGENTS.md).

## Solución de problemas

- **"El puerto ya está en uso"**: cierra el programa que ocupe el `7531` o el `3090` (otro Packet Tools, un dev con `npm run dev`) y vuelve a abrir la aplicación.
- **La ventana muestra "No se pudo cargar la interfaz"**: el frontend no terminó de arrancar; revisa el log correspondiente en `%APPDATA%\Packet Tools\logs\` (`server.log`, `web.log`, `bootstrap.log`).
- **Chat con "Autenticación requerida" o terminal en "Conectando…"**: abre siempre la aplicación desde su propia ventana (va por `localhost`); no la sustituyas por `127.0.0.1` en el navegador, la cookie de sesión no se enviaría.
