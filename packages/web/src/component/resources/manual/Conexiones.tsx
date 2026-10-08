import { Bullets, Paragraph, Steps, SubTitle } from "./primitives";

export default function Conexiones() {
  return (
    <div className="space-y-5">
      <Paragraph>
        <strong>Conexiones</strong> es tu lista de equipos de red (routers,
        switches y simuladores). Aquí los agregas una vez para poder usarlos
        desde el Chat y la Terminal.
      </Paragraph>

      <SubTitle>Tipos de conexión que maneja</SubTitle>
      <Bullets
        items={[
          "SSH: conexión segura a equipos reales (la recomendada).",
          "Telnet: para equipos viejos que no tienen SSH.",
          "Puerto Serial: por cable físico, cuando no hay red.",
          "Simulación / API Bridge: para laboratorios virtuales (Packet Tracer y GNS3).",
        ]}
      />
      <Paragraph>
        Y acepta equipos Cisco IOS, Huawei VRP, Aruba OS, MikroTik RouterOS,
        GNS3 Server, Packet Tracer o Genérico.
      </Paragraph>

      <SubTitle>Cómo se usa</SubTitle>
      <Steps
        items={[
          {
            title: "Agrega tu equipo",
            description:
              "Pulsa Nuevo dispositivo, ponle un nombre, elige el tipo de conexión, escribe su dirección (IP) y su usuario y contraseña.",
          },
          {
            title: "Comprueba que responde",
            description:
              "Pulsa Probar conexión. Si sale el mensaje de éxito, ya quedó bien registrado.",
          },
          {
            title: "Úsalo",
            description:
              "Pulsa Terminal para abrir su consola, o pídele cosas desde el Chat.",
          },
        ]}
      />
    </div>
  );
}
