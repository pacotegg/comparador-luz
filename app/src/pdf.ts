import type { Resultado } from '@lector/lector.ts';

/**
 * Lee una factura en PDF. El fichero se queda en la memoria de esta pestana:
 * no hay servidor al que subirlo, la app es puro HTML y JS estatico.
 *
 * pdf.js se carga SOLO al soltar el primer PDF. Son 800 KB que la mayoria de
 * la gente no llega a necesitar: quien mete los datos a mano no descarga nada
 * de esto, y en el movil se nota.
 */
export async function leerPDF(fichero: File): Promise<Resultado> {
  const [pdfjs, worker, lector] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    import('@lector/lector.ts'),
  ]);

  // El worker se empaqueta con la app: funciona sin conexion y sin pedirle nada
  // a ningun CDN, que ademas seria un tercero mirando lo que haces.
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const bytes = new Uint8Array(await fichero.arrayBuffer());

  // OJO: en pdf.js 6 quien tiene destroy() es la TAREA de carga, no el
  // documento. doc.destroy es undefined y llamarlo aborta la lectura entera
  // con "destroy is not a function". En la build legacy que se usa en Node si
  // existe, asi que el fallo solo aparece en el navegador.
  const tarea = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  try {
    const doc = await tarea.promise;
    return await lector.leerFactura(doc, pdfjs.OPS);
  } finally {
    await tarea.destroy();
  }
}

export type { Resultado };
