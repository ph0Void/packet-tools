"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarDominios = registrarDominios;
const ToolRegistry_1 = require("../core/ToolRegistry.js");
const packetTracer_1 = require("./packetTracer/index.js");
const gns3_1 = require("./gns3/index.js");
const serial_1 = require("./serial/index.js");
const telnet_1 = require("./telnet/index.js");
const ssh_1 = require("./ssh/index.js");
const plan_1 = require("./plan/index.js");
const skills_1 = require("./skills/index.js");
const MODULOS = [
    packetTracer_1.moduloPacketTracer,
    gns3_1.moduloGns3,
    serial_1.moduloSerial,
    telnet_1.moduloTelnet,
    ssh_1.moduloSsh,
    plan_1.moduloPlanes,
    skills_1.moduloSkills,
];
let yaRegistrados = false;
function registrarDominios() {
    if (yaRegistrados)
        return;
    for (const modulo of MODULOS) {
        ToolRegistry_1.toolRegistry.registrar(modulo);
    }
    yaRegistrados = true;
}
//# sourceMappingURL=registro.js.map