---
title: Convención de nombres de dispositivos
description: Cómo nombrar routers, switches y equipos finales en las topologías
slug: convencion-nombres
---

# Convención de nombres

> Este archivo es un EJEMPLO. Cópialo, renómbralo o bórralo: el servidor MCP lee
> todos los `.md` de esta carpeta (`packages/mcp/skills/`) y los expone al modelo
> como skills. El frontmatter de arriba es opcional; sin él, el título se toma del
> primer encabezado `# ` y el slug del nombre del archivo.

## Reglas

- **Routers**: `R<n>` — por ejemplo `R1`, `R2`.
- **Switches**: `SW<n>` — por ejemplo `SW1`, `SW2`.
- **Equipos finales**: `PC<n>`, `SRV<n>`, `LAP<n>`.
- **Enlaces WAN**: la interfaz serial del router de menor número es siempre el
  extremo `A` del enlace.

## Direccionamiento

- Red de gestión: `10.0.0.0/24`.
- Enlaces punto a punto: `10.255.<n>.0/30`, donde `<n>` es el número del router.
- VLAN de usuarios: `192.168.<vlan>.0/24`.

## Por qué existe esta skill

Sin una convención explícita, el modelo inventa nombres y el usuario acaba con
topologías donde no se sabe qué equipo es cuál. Al estar aquí, el modelo la lee
con `skills_read` (o la recibe como recurso MCP) y la respeta.
