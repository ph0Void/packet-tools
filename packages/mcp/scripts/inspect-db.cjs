
const Database = require("better-sqlite3");
const path = require("node:path");

const ruta = process.argv[2] || path.join(__dirname, "..", ".packet_tools_mcp.db");
const db = new Database(ruta, { readonly: true });

const tablas = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' " +
      "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY name",
  )
  .all();

console.log(`Base de datos: ${ruta}\n`);
console.log("Tablas y filas:");
for (const { name } of tablas) {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get();
  console.log(`  ${name.padEnd(24)} ${n} fila(s)`);
}

db.close();
