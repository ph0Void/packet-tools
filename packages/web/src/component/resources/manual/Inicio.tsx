import { Paragraph, Steps, SubTitle } from "./primitives";

export default function Inicio() {
  return (
    <div className="space-y-5">
      <Paragraph>
        <strong>Inicio</strong> es la pantalla principal. Aquí ves de un vistazo
        cómo está tu red: cuántos equipos están conectados, si hay avisos
        pendientes y accesos directos a lo más usado.
      </Paragraph>

      <SubTitle>Cómo se usa</SubTitle>
      <Steps
        items={[
          {
            title: "Mira el resumen",
            description:
              "Las tarjetas de arriba te dicen lo esencial: equipos conectados, avisos sin atender, tareas programadas y usuarios.",
          },
          {
            title: "Usa los accesos directos",
            description:
              "Pulsa Terminal, Chat o Dispositivos para ir directo a lo que necesites sin buscar en el menú.",
          },
          {
            title: "Revisa los avisos recientes",
            description:
              "Abajo verás los últimos avisos. Si hay alguno en rojo, atiéndelo primero.",
          },
        ]}
      />
    </div>
  );
}
