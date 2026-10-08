import {
  InlineCode,
  Paragraph,
  SimpleTable,
  Steps,
  SubTitle,
} from "./primitives";

export default function Usuarios() {
  return (
    <div className="space-y-5">
      <Paragraph>
        <strong>Usuarios</strong> es la lista de personas que pueden entrar al
        sistema. Solo el administrador la ve y es quien crea o quita cuentas.
      </Paragraph>

      <SubTitle>Cómo se usa</SubTitle>
      <Steps
        items={[
          {
            title: "Crea una cuenta",
            description:
              "Pulsa Registrar Operador, escribe el nombre, la contraseña y elige su rol.",
          },
          {
            title: "Cambia o quita cuentas",
            description:
              "Usa el lápiz para cambiar la contraseña o el rol, y la papelera para eliminar.",
          },
        ]}
      />

      <SubTitle>Roles y permisos</SubTitle>
      <Paragraph>
        Hay 3 tipos de usuario, del que menos puede al que más puede:{" "}
        <InlineCode>USER</InlineCode>, <InlineCode>STAFF</InlineCode> y{" "}
        <InlineCode>ADMIN</InlineCode>. Cada nivel incluye lo del anterior.
      </Paragraph>
      <SimpleTable
        headers={["Qué puede hacer", "USER", "STAFF", "ADMIN"]}
        rows={[
          ["Ver el sistema", "Sí", "Sí", "Sí"],
          ["Usar el Chat y ver sus propios avisos", "Sí", "Sí", "Sí"],
          ["Usar la Terminal (solo mirar)", "Sí", "Sí", "Sí"],
          ["Agregar y manejar equipos", "—", "Sí", "Sí"],
          ["Programar tareas automáticas", "—", "Sí", "Sí"],
          ["Ver los avisos de todos", "—", "Sí", "Sí"],
          ["Subir documentos a Datos", "—", "Sí", "Sí"],
          ["Aprobar lo que hace el asistente", "—", "Sí", "Sí"],
          ["Manejar usuarios, modelos y borrar registros", "—", "—", "Sí"],
        ]}
      />
      <Paragraph>
        El menú cambia según tu rol: <InlineCode>Datos</InlineCode>,{" "}
        <InlineCode>Usuarios</InlineCode> y <InlineCode>Configuración</InlineCode>{" "}
        solo las ven los <InlineCode>ADMIN</InlineCode>.
      </Paragraph>
    </div>
  );
}
