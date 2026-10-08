import { Paragraph, Steps, SubTitle } from "./primitives";

export default function Tareas() {
  return (
    <div className="space-y-5">
      <Paragraph>
        <strong>Automatizaciones</strong> sirve para dejar trabajos programados:
        le dices al sistema qué hacer y cuándo, y él lo ejecuta solo (por
        ejemplo, “revisa los equipos cada lunes a las 8”).
      </Paragraph>

      <SubTitle>Cómo se usa</SubTitle>
      <Steps
        items={[
          {
            title: "Programa la tarea",
            description:
              "Pulsa Programar Tarea, ponle un nombre y elige el día y la hora.",
          },
          {
            title: "Describe qué debe hacer",
            description:
              "Escribe con tus palabras lo que quieres que haga, como si se lo pidieras a una persona.",
          },
          {
            title: "Actívala",
            description:
              "Deja el interruptor en activo y guarda. Si la necesitas ya, usa Ejecutar Ahora.",
          },
        ]}
      />
    </div>
  );
}
