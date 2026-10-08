import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-red-500">
          Pagina no Encontrada
        </h2>
        <p className="text-gray-600">
          No se encontro la pagina que solicitaste
        </p>
        <Link href="/dashboard" className="text-blue-500 underline mt-4 block">
          Regresar al inicio
        </Link>
      </div>
    </div>
  );
}
