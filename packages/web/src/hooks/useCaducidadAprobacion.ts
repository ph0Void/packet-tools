"use client";

import { useEffect, useState } from "react";
import {
  instanteDeCaducidad,
  proximoCambioCaducidad,
  textoCaducidad,
  type CaducidadAprobacion,
} from "@/component/chat/card/toolOutput";

type Oyente = () => void;

const oyentes = new Map<number, Oyente>();

const plazos = new Map<number, number>();

let siguienteId = 1;
let temporizador: ReturnType<typeof setTimeout> | null = null;

const ESPERA_MINIMA_MS = 250;

function reprogramar(): void {
  if (temporizador !== null) {
    clearTimeout(temporizador);
    temporizador = null;
  }
  if (oyentes.size === 0) return;

  const ahora = Date.now();
  let espera = Number.POSITIVE_INFINITY;
  for (const expira of plazos.values()) {
    const cambio = proximoCambioCaducidad(expira, ahora);
    if (cambio < espera) espera = cambio;
  }

  if (!Number.isFinite(espera)) return;

  temporizador = setTimeout(disparar, Math.max(espera, ESPERA_MINIMA_MS));
}

function disparar(): void {
  temporizador = null;
  for (const oyente of [...oyentes.values()]) oyente();
  reprogramar();
}

export function useCaducidadAprobacion(
  expiresAt: string | null | undefined,
): CaducidadAprobacion | null {
  const [caducidad, setCaducidad] = useState<CaducidadAprobacion | null>(() =>
    textoCaducidad(expiresAt),
  );

  useEffect(() => {
    const medir = (): CaducidadAprobacion | null => textoCaducidad(expiresAt);

    const fijar = (siguiente: CaducidadAprobacion | null) =>
      setCaducidad((previo) =>
        previo?.texto === siguiente?.texto &&
        previo?.expirada === siguiente?.expirada
          ? previo
          : siguiente,
      );

    fijar(medir());

    const expira = instanteDeCaducidad(expiresAt);
    if (expira === null || expira <= Date.now()) return;

    const id = siguienteId++;
    oyentes.set(id, () => fijar(medir()));
    plazos.set(id, expira);
    reprogramar();

    return () => {
      oyentes.delete(id);
      plazos.delete(id);
      reprogramar();
    };
  }, [expiresAt]);

  return caducidad;
}
