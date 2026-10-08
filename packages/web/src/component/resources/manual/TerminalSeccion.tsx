import { Bullets, Paragraph, Steps, SubTitle } from "./primitives";

export default function TerminalSeccion() {
  return (
    <div className="space-y-5">
      <Paragraph>
        <strong>Terminal</strong> es una ventana directa a tu equipo, como si
        estuvieras frente a él escribiendo comandos. Lo que escribes llega al
        equipo y su respuesta aparece en pantalla.
      </Paragraph>
      <Paragraph>
        Soporta conexiones por <strong>SSH</strong> (segura, la recomendada),{" "}
        <strong>Telnet</strong> (equipos viejos) y <strong>puerto Serial</strong>{" "}
        (cable físico). Los laboratorios virtuales (GNS3 y Packet Tracer) no se
        abren aquí: se usan desde el Chat.
      </Paragraph>

      <SubTitle>Cómo se usa</SubTitle>
      <Steps
        items={[
          {
            title: "Elige el equipo",
            description:
              "Selecciona uno de tu lista y pulsa Conectar. Verás el aviso En línea cuando esté listo.",
          },
          {
            title: "Escribe y lee",
            description:
              "Escribe lo que quieras consultar y lee la respuesta del equipo en la ventana.",
          },
          {
            title: "Desconecta al terminar",
            description:
              "Pulsa Desconectar cuando acabes para liberar la conexión.",
          },
        ]}
      />

      <SubTitle>Si no tienes equipo guardado</SubTitle>
      <Bullets
        items={[
          "Pulsa Manual y conéctate escribiendo la dirección, el usuario y la contraseña, sin guardar nada.",
          "Para cable serie elige el puerto (por ejemplo COM3) y la velocidad (normalmente 9600).",
        ]}
      />
    </div>
  );
}
