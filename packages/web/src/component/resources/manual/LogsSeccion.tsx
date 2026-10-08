import { Paragraph, Steps, SubTitle } from "./primitives";

export default function LogsSeccion() {
  return (
    <div className="space-y-5">
      <Paragraph>
        <strong>Logs</strong> es el diario del sistema: aquí queda anotado todo
        lo importante que pasa (quién se conectó, qué tarea se ejecutó, si algo
        falló). Sirve para revisar qué ocurrió.
      </Paragraph>

      <SubTitle>Cómo se usa</SubTitle>
      <Steps
        items={[
          {
            title: "Busca lo que pasó",
            description:
              "Escribe una palabra en el buscador (por ejemplo, el nombre de un equipo) o filtra por tipo.",
          },
          {
            title: "Lee el detalle",
            description:
              "Cada fila dice la fecha y qué sucedió. Si algo salió mal, aparecerá marcado como error.",
          },
          {
            title: "Descarga si lo necesitas",
            description:
              "Usa Exportar para guardar la lista y enviarla o guardarla como respaldo.",
          },
        ]}
      />
    </div>
  );
}
