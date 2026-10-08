import { CodeBlock, InlineCode, Paragraph, SimpleTable, SubTitle } from "./primitives";

const CISCO = [
  { command: "show ip interface brief", description: "Ver interfaces, su IP y si están activas." },
  { command: "show running-config", description: "Ver la configuración actual del equipo." },
  { command: "show ip route", description: "Ver por dónde sale el tráfico (rutas)." },
  { command: "show vlan brief", description: "Ver las redes internas (VLAN) creadas." },
  { command: "copy running-config startup-config", description: "Guardar lo configurado para que no se borre." },
  { command: "ping 8.8.8.8", description: "Probar si hay conexión a internet." },
];

const MIKROTIK = [
  { command: "/ip address print", description: "Ver las direcciones IP del equipo." },
  { command: "/ip route print", description: "Ver las rutas de salida." },
  { command: "/interface print", description: "Ver las interfaces y su estado." },
  { command: "/system identity set name=Router-1", description: "Ponerle nombre al equipo." },
  { command: "/user set admin password=NuevaClave", description: "Cambiar la contraseña." },
  { command: "ping 8.8.8.8", description: "Probar si hay conexión." },
];

const HUAWEI = [
  { command: "display ip interface brief", description: "Ver interfaces, su IP y si están activas." },
  { command: "display current-configuration", description: "Ver la configuración actual." },
  { command: "display ip routing-table", description: "Ver la tabla de rutas." },
  { command: "display vlan", description: "Ver las redes internas (VLAN)." },
  { command: "save", description: "Guardar la configuración." },
  { command: "ping 8.8.8.8", description: "Probar si hay conexión." },
];

const ARUBA = [
  { command: "show interfaces brief", description: "Ver interfaces y su estado." },
  { command: "show running-config", description: "Ver la configuración actual." },
  { command: "show ip route", description: "Ver las rutas de salida." },
  { command: "show vlan", description: "Ver las redes internas (VLAN)." },
  { command: "write memory", description: "Guardar la configuración." },
  { command: "ping 8.8.8.8", description: "Probar si hay conexión." },
];

function VendorBlock({
  rows,
  copyLabel,
}: {
  rows: { command: string; description: string }[];
  copyLabel: string;
}) {
  return (
    <div className="space-y-3">
      <SimpleTable
        headers={["Comando", "Para qué sirve"]}
        rows={rows.map((item) => [
          <InlineCode key={item.command}>{item.command}</InlineCode>,
          item.description,
        ])}
      />
      <CodeBlock
        code={rows.map((item) => item.command).join("\n")}
        label={copyLabel}
      />
    </div>
  );
}

export default function Anexos() {
  return (
    <div className="space-y-5">
      <Paragraph>
        <strong>Anexos</strong>: los comandos más usados por marca, explicados
        con palabras sencillas. Cada lista trae su botón de copiar para
        pegarlos en la Terminal o pedirle al Chat que los ejecute.
      </Paragraph>

      <SubTitle>Cisco (IOS)</SubTitle>
      <VendorBlock rows={CISCO} copyLabel="Copiar comandos de Cisco" />

      <SubTitle>MikroTik (RouterOS)</SubTitle>
      <VendorBlock rows={MIKROTIK} copyLabel="Copiar comandos de MikroTik" />

      <SubTitle>Huawei (VRP)</SubTitle>
      <VendorBlock rows={HUAWEI} copyLabel="Copiar comandos de Huawei" />

      <SubTitle>Aruba (ArubaOS / CX)</SubTitle>
      <VendorBlock rows={ARUBA} copyLabel="Copiar comandos de Aruba" />
    </div>
  );
}
