import net from "node:net";

const [, , host = "127.0.0.1", portArg = "5001", command = "show version", username = "-", password = "-", waitArg = "12000"] =
  process.argv;

let received = "";
const socket = net.createConnection({ host, port: Number(portArg) });
socket.setEncoding("utf8");
socket.on("data", (chunk) => {
  received += chunk;
});
socket.on("error", (error) => {
  console.log("ERROR: " + error.message);
  process.exit(2);
});

const limit = Number(waitArg) || 12000;

socket.on("connect", () => {
  setTimeout(() => socket.write("\r"), 800);
  setTimeout(() => socket.write(command + "\r"), 2500);
  if (username !== "-") setTimeout(() => socket.write(username + "\r\n"), 1800);
  if (password !== "-") setTimeout(() => socket.write(password + "\r\n"), 2400);
});

setTimeout(() => {
  socket.destroy();
  const clean = received.replace(/[\ufff0-\uffff]/g, "").replace(/\r/g, "");
  console.log("=== comando: " + JSON.stringify(command));
  console.log("--- ultimas 16 lineas ---");
  for (const line of clean.split("\n").filter((x) => x.trim()).slice(-16)) console.log("  | " + line);
  console.log("--- veredicto ---");
  console.log("  invalid input : " + /invalid input/i.test(clean));
  console.log("  pager         : " + /--more--|-more-|more-\s*-+/i.test(clean));
  process.exit(0);
}, limit);
