import net from "node:net";

const [, , host = "127.0.0.1", portArg = "5001", username = "-", password = "-", waitArg = "10000", mode = ""] =
  process.argv;

const limit = Number(waitArg) || 10000;
const sendReturn = mode === "cr";
let received = "";

const socket = net.createConnection({ host, port: Number(portArg) });
socket.setEncoding("utf8");
socket.on("data", (chunk) => {
  received += chunk;
});
socket.on("error", (error) => {
  console.log("ERROR de conexion: " + error.message);
  process.exit(2);
});

if (username !== "-") {
  socket.on("data", function onLogin(chunk: string) {
    if (/[Uu]sername\s*:/i.test(received)) {
      socket.write(username + "\r\n");
      setTimeout(() => {
        if (password !== "-") socket.write(password + "\r\n");
        socket.off("data", onLogin);
      }, 400);
    }
  });
}

if (sendReturn) setTimeout(() => socket.write("\r"), limit * 0.6);

setTimeout(() => {
  socket.destroy();
  const clean = received.replace(/[\ufff0-\uffff]/g, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);

  console.log("=== " + host + ":" + portArg + "  (" + limit + " ms" + (sendReturn ? ", con CR" : "") + ") ===");
  console.log("bytes: " + Buffer.byteLength(received, "utf8") + "  lineas: " + lines.length);
  console.log("--- ultimas 12 ---");
  for (const line of lines.slice(-12)) console.log("  | " + line.replace(/\r/g, ""));

  const trimmed = clean.replace(/\s+$/, "");
  console.log("--- diagnostico ---");
  console.log("  pide login : " + /[Uu]sername\s*:/i.test(clean));
  console.log("  press ret  : " + /press return to get started/i.test(clean));
  console.log("  paginador  : " + /--more--|---- more ----|-more-|\[q\|quit\]/i.test(clean));
  const prompt = trimmed.match(/([\w.\-\/]+(?:\([\w\- ]+\))?[>#])\s*$/);
  console.log("  prompt     : " + (prompt ? JSON.stringify(prompt[1]) : "(ninguno)"));
  process.exit(0);
}, limit);
