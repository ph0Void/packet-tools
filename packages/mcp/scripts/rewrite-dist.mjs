
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raizPaquete = path.resolve(aqui, "..");
const dist = path.join(raizPaquete, "dist");


function aRelativo(desdeArchivo, rutaDestinoAbsoluta) {
  let relativo = path.relative(path.dirname(desdeArchivo), rutaDestinoAbsoluta);
  relativo = relativo.split(path.sep).join("/");
  if (!relativo.startsWith(".")) relativo = `./${relativo}`;
  return relativo;
}


async function listarJs(directorio) {
  const encontrados = [];
  for (const entrada of await readdir(directorio)) {
    const completo = path.join(directorio, entrada);
    const info = await stat(completo);
    if (info.isDirectory()) {
      encontrados.push(...(await listarJs(completo)));
    } else if (entrada.endsWith(".js")) {
      encontrados.push(completo);
    }
  }
  return encontrados;
}


async function resolverModulo(rutaSinExtension) {
  const comoFichero = `${rutaSinExtension}.js`;
  try {
    await stat(comoFichero);
    return comoFichero;
  } catch {
    
  }
  const comoIndice = path.join(rutaSinExtension, "index.js");
  try {
    await stat(comoIndice);
    return comoIndice;
  } catch {
    return null;
  }
}

async function main() {
  let archivos;
  try {
    archivos = await listarJs(dist);
  } catch {
    console.error(
      "[rewrite-dist] No existe dist/. Ejecuta `tsc` antes que este script.",
    );
    process.exit(1);
  }

  let reescritos = 0;

  for (const archivo of archivos) {
    const original = await readFile(archivo, "utf8");
    let contenido = original;

    
    for (const coincidencia of [...contenido.matchAll(/["']@\/([^"']+)["']/g)]) {
      const subruta = coincidencia[1];
      const destino = await resolverModulo(path.join(dist, subruta));
      if (!destino) {
        console.warn(
          `[rewrite-dist] No se pudo resolver "@/ ${subruta}" desde ${path.relative(dist, archivo)}`,
        );
        continue;
      }
      contenido = contenido.replace(
        coincidencia[0],
        `"${aRelativo(archivo, destino)}"`,
      );
    }

    
    for (const coincidencia of [...contenido.matchAll(/["'](\.\.?\/[^"']+)["']/g)]) {
      const especificador = coincidencia[1];
      if (path.extname(especificador)) continue;
      const base = path.resolve(path.dirname(archivo), especificador);
      const destino = await resolverModulo(base);
      if (!destino) continue;
      contenido = contenido.replace(
        `"${especificador}"`,
        `"${aRelativo(archivo, destino)}"`,
      );
    }

    if (contenido !== original) {
      await writeFile(archivo, contenido, "utf8");
      reescritos++;
    }
  }

  await writeFile(
    path.join(dist, "package.json"),
    `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `[rewrite-dist] ${reescritos} de ${archivos.length} archivos reescritos. dist/ listo para 'node dist/app.js'.`,
  );
}

main().catch((error) => {
  console.error("[rewrite-dist] Falló:", error);
  process.exit(1);
});
