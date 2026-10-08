import { Callout, Paragraph, Steps, SubTitle } from "./primitives";

export default function Chat() {
  return (
    <div className="space-y-5">
      <Paragraph>
        <strong>Chat</strong> es tu asistente con inteligencia artificial. Le
        escribes lo que necesitas con palabras normales (por ejemplo, “revisa si
        el router responde”) y él se encarga de hacerlo o explicarte cómo.
      </Paragraph>

      <SubTitle>Cómo se usa</SubTitle>
      <Steps
        items={[
          {
            title: "Escribe lo que necesitas",
            description:
              "En la caja de texto de abajo describe tu problema o pregunta y pulsa enviar.",
          },
          {
            title: "Responde a sus preguntas",
            description:
              "Si te pide confirmar o elegir un equipo, pulsa el botón que te muestra.",
          },
          {
            title: "Revisa el resultado",
            description:
              "Lee la respuesta y usa el botón Copiar si quieres guardarla.",
          },
        ]}
      />

      <Callout variant="tip" title="Consejo">
        Puedes mencionar un equipo con @ (por ejemplo @Router1), pedir que
        busque en tus documentos con @rag o en internet con @web.
      </Callout>
    </div>
  );
}
