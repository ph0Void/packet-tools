interface Espera {

  clave: string;

  exclusivo: boolean;
  tarea: () => unknown;
  resolver: (valor: any) => void;
  rechazar: (error: any) => void;
}

export class SerializadorPorClave {
  private readonly cola: Espera[] = [];

  private readonly clavesOcupadas = new Set<string>();
  private activos = 0;
  private exclusivoActivo = false;

  public encolar<T>(clave: string, tarea: () => Promise<T> | T): Promise<T> {
    return this.registrar(clave, false, tarea);
  }

  public encolarExclusivo<T>(
    clave: string,
    tarea: () => Promise<T> | T,
  ): Promise<T> {
    return this.registrar(clave, true, tarea);
  }

  public get pendientes(): number {
    return this.cola.length;
  }

  public get enCurso(): number {
    return this.activos;
  }

  public get clavesActivas(): string[] {
    return Array.from(this.clavesOcupadas);
  }

  private registrar<T>(
    clave: string,
    exclusivo: boolean,
    tarea: () => Promise<T> | T,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.cola.push({
        clave,
        exclusivo,
        tarea,
        resolver: resolve,
        rechazar: reject,
      });
      this.conceder();
    });
  }

  private conceder(): void {
    while (this.cola.length > 0) {
      const espera = this.cola[0];
      if (espera.exclusivo) {

        if (this.activos > 0) return;
      } else {
        if (this.exclusivoActivo) return;

        if (this.cola.some((pendiente) => pendiente.exclusivo)) return;

        if (this.clavesOcupadas.has(espera.clave)) return;
      }

      this.cola.shift();
      this.activos += 1;
      if (espera.exclusivo) this.exclusivoActivo = true;
      else this.clavesOcupadas.add(espera.clave);
      this.ejecutar(espera);
    }

    if (this.cola.length === 0 && this.activos === 0) this.clavesOcupadas.clear();
  }

  private ejecutar(espera: Espera): void {
    Promise.resolve()
      .then(() => espera.tarea())
      .then(
        (valor: any) => {
          espera.resolver(valor);
          this.liberar(espera);
        },
        (error: any) => {

          espera.rechazar(error);
          this.liberar(espera);
        },
      );
  }

  private liberar(espera: Espera): void {
    if (espera.exclusivo) this.exclusivoActivo = false;
    else this.clavesOcupadas.delete(espera.clave);
    this.activos -= 1;
    this.conceder();
  }
}
