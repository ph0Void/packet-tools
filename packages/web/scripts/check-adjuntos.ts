import {
  esImagenServible,
  tieneContenidoServible,
  urlDeAdjunto,
} from "../src/component/chat/adjuntos";

let failures = 0;
let total = 0;

function check(name: string, condition: boolean, detail?: string): void {
  total += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

section("urlDeAdjunto (única vía de lectura del contenido)");

check(
  "ruta relativa del endpoint de descarga",
  urlDeAdjunto("abc123") === "/api/chats/attachments/abc123",
  urlDeAdjunto("abc123"),
);
check(
  "no usa el backend absoluto (el rewrite de Next + cookie de sesión)",
  !urlDeAdjunto("abc123").includes("http"),
);
check(
  "el id va escapado (un id no puede inyectar segmentos de ruta)",
  urlDeAdjunto("a/b?c=1") === "/api/chats/attachments/a%2Fb%3Fc%3D1",
  urlDeAdjunto("a/b?c=1"),
);

section("tieneContenidoServible");

check(
  "con id hay contenido que pedir",
  tieneContenidoServible({ id: "a1", fileName: "topo.png" }),
);
check(
  "sin id no se puede pedir nada (fila sin adjunto persistido)",
  !tieneContenidoServible({ fileName: "captura.png" }),
);
check(
  "un id vacío tampoco",
  !tieneContenidoServible({ id: "", fileName: "captura.png" }),
);
check(
  "un id null tampoco",
  !tieneContenidoServible({ id: null, fileName: "captura.png" }),
);
check(
  "`fileUrl` con contenido NO habilita la vista histórica (D6 lo dejó en NULL)",
  !tieneContenidoServible({
    fileUrl: "data:image/png;base64,AAAA",
    fileName: "captura.png",
  }),
);

section("esImagenServible (miniatura o ficha)");

check(
  "fileType IMAGE es miniatura",
  esImagenServible({ id: "a1", fileType: "IMAGE", fileName: "topo.png" }),
);
check(
  "fileType DOCUMENT es ficha, aunque el mime diga image/*",
  !esImagenServible({
    id: "a1",
    fileType: "DOCUMENT",
    mimeType: "image/png",
    fileName: "notas.pdf",
  }),
);
check(
  "sin fileType, un mime de imagen decide",
  esImagenServible({
    id: "a1",
    mimeType: "image/webp",
    fileName: "captura.webp",
  }),
);
check(
  "sin fileType, un mime de texto es ficha",
  !esImagenServible({
    id: "a1",
    mimeType: "application/pdf",
    fileName: "manual.pdf",
  }),
);
check(
  "el mime se compara sin distinguir mayúsculas ni espacios",
  esImagenServible({ id: "a1", mimeType: " IMAGE/PNG ", fileName: "x" }),
);
check(
  "sin fileType ni mime no se inventa una miniatura",
  !esImagenServible({ id: "a1", fileName: "sin-tipo" }),
);

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} · ${total - failures}/${total} checks en verde`,
);
process.exit(failures === 0 ? 0 : 1);
