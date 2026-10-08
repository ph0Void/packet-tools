"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="es" className="dark">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#020617",
          color: "#e2e8f0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", display: "grid", gap: "1rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>
            Algo salió mal
          </h1>
          <p style={{ color: "#94a3b8" }}>
            Ocurrió un error inesperado en la aplicación.
          </p>
          <button
            onClick={reset}
            style={{
              margin: "0 auto",
              padding: "0.5rem 1.25rem",
              borderRadius: "0.5rem",
              border: "1px solid #22d3ee55",
              background: "rgba(34,211,238,0.1)",
              color: "#67e8f9",
              cursor: "pointer",
            }}
          >
            Intentar de nuevo
          </button>
        </div>
      </body>
    </html>
  );
}
