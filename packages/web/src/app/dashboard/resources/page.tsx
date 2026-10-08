import UserManual from "@/component/resources/UserManual";

export const metadata = {
  title: "Packet Tools - Manual de Usuario y Recursos",
  description: "Centro de documentación con cheat sheets, plantillas y referencias",
};

export default function PageResources() {
  return (
    <div className="space-y-6 text-foreground p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Manual del usuario
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Guía paso a paso para configurar y operar todas las pestañas de Packet
          Tools.
        </p>
      </div>

      <UserManual />
    </div>
  );
}
