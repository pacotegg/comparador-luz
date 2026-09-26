import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { leerFactura, type Resultado } from '@lector/lector.ts';

// El worker se empaqueta con la app: asi funciona sin conexion y sin pedirle
// nada a ningun CDN, que ademas seria un tercero mirando lo que haces.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Lee una factura. El fichero se queda en la memoria de esta pestana:
 * no hay servidor al que subirlo, la app es puro HTML y JS estatico.
 */
export async function leerPDF(fichero: File): Promise<Resultado> {
  const bytes = new Uint8Array(await fichero.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  try {
    return await leerFactura(doc, pdfjs.OPS);
  } finally {
    await doc.destroy();
  }
}

export type { Resultado };
