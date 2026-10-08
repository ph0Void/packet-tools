import { Paragraph, Steps, SubTitle } from "./primitives";

export default function Alertas() {
  return (
    <div className="space-y-5">
      <Paragraph>
        <strong>Alertas</strong> es donde se anotan los problemas de la red (por
        ejemplo, un equipo que no responde). Cada aviso tiene un nivel de
        importancia: crítico, alto, medio o bajo.
      </Paragraph>

      <SubTitle>Cómo se usa</SubTitle>
      <Steps
        items={[
          {
            title: "Reporta un problema",
            description:
              "Pulsa Nueva Alerta, escribe qué está pasando y elige qué tan grave es.",
          },
          {
            title: "Busca y filtra",
            description:
              "Usa el buscador o los filtros para encontrar un aviso por su gravedad o estado.",
          },
          {
            title: "Marca como resuelta",
            description:
              "Cuando el problema quede arreglado, pulsa Resolver. Si vuelve a fallar, puedes reabrirla.",
          },
        ]}
      />
    </div>
  );
}
