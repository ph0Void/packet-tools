import { Paragraph, Steps, SubTitle } from "./primitives";

export default function DatosRag() {
  return (
    <div className="space-y-5">
      <Paragraph>
        <strong>Datos</strong> es la biblioteca del asistente: aquí subes
        manuales y documentos (PDF o texto) para que el Chat pueda consultarlos
        y responderte con base en ellos.
      </Paragraph>

      <SubTitle>Cómo se usa</SubTitle>
      <Steps
        items={[
          {
            title: "Sube tu documento",
            description:
              "Arrastra tu archivo a la zona punteada o pulsa para elegirlo. Acepta PDF y texto de hasta 25 MB.",
          },
          {
            title: "Ponle un nombre claro",
            description:
              "Escribe un título que lo identifique, por ejemplo “Manual del router”.",
          },
          {
            title: "Pregunta desde el Chat",
            description:
              "En el Chat escribe @rag junto a tu pregunta para que busque la respuesta en tus documentos.",
          },
        ]}
      />
    </div>
  );
}
