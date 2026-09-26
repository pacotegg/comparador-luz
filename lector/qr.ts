import jsQR from 'jsqr';
import { aNumero, aFecha, diasEntre } from './numeros.ts';

/**
 * Lector del QR de la CNMC que llevan (algunas) facturas electricas.
 *
 * Es un enlace a comparador.cnmc.gob.es con los datos del suministro en la
 * query. Cuando esta, el trabajo esta hecho: trae exactamente los campos que
 * pide el Excel.
 *
 * Medido sobre 3 facturas reales: lo lleva 1 de 3. Nufri si, Iberdrola no.
 * Asi que esto es el atajo, no el camino principal.
 */

export interface DatosQR {
  dias: number | null;
  potP1: number | null;
  potP2: number | null;
  cPunta: number | null;
  cLlano: number | null;
  cValle: number | null;
  excedentes: number | null;
  /** Potencia maxima demandada: el post #2 dice dividirla entre 1,2. */
  potenciaMaxima: number | null;
  cups: string | null;
  totalFactura: number | null;
  desde: string | null;
  hasta: string | null;
}

/** Interpreta la query del QR de la CNMC. */
export function interpretarQR(texto: string): DatosQR | null {
  if (!/comparador\.cnmc\.gob\.es/i.test(texto)) return null;
  let p: URLSearchParams;
  try { p = new URL(texto).searchParams; } catch { return null; }

  const n = (k: string) => aNumero(p.get(k));
  const desde = aFecha(p.get('iniF'));
  const hasta = aFecha(p.get('finF'));

  return {
    // El QR y la cabecera de la factura pueden discrepar en un dia. Manda el QR:
    // comprobado contra el detalle de Nufri, que dice "x 35 Dias" igual que el QR.
    dias: desde && hasta ? diasEntre(desde, hasta) : null,
    potP1: n('pP1'),
    potP2: n('pP2'),
    cPunta: n('cfP1'),
    cLlano: n('cfP2'),
    cValle: n('cfP3'),
    excedentes: n('exc'),
    potenciaMaxima: n('pmaxP1'),
    cups: p.get('cups'),
    totalFactura: n('imp'),
    desde: p.get('iniF'),
    hasta: p.get('finF'),
  };
}

/**
 * Recorre las imagenes incrustadas del PDF buscando un QR.
 * `doc` es un PDFDocumentProxy de pdfjs-dist.
 */
export async function buscarQR(doc: any, OPS: any): Promise<DatosQR | null> {
  for (let pagina = 1; pagina <= doc.numPages; pagina++) {
    const page = await doc.getPage(pagina);
    const ops = await page.getOperatorList();

    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== OPS.paintImageXObject) continue;
      const nombre = ops.argsArray[i][0];

      let img: any;
      try {
        img = await new Promise((ok, mal) => page.objs.get(nombre, (o: any) => (o ? ok(o) : mal(0))));
      } catch { continue; }
      if (!img?.width || !img?.data) continue;

      const { width: w, height: h, data } = img;
      const canales = data.length / (w * h);
      if (canales < 1 || canales > 4) continue;

      // jsQR quiere RGBA pase lo que pase.
      const rgba = new Uint8ClampedArray(w * h * 4);
      for (let k = 0; k < w * h; k++) {
        const s = k * canales;
        rgba[k * 4] = data[s];
        rgba[k * 4 + 1] = data[s + (canales > 2 ? 1 : 0)];
        rgba[k * 4 + 2] = data[s + (canales > 2 ? 2 : 0)];
        rgba[k * 4 + 3] = 255;
      }

      const qr = jsQR(rgba, w, h);
      if (!qr) continue;
      const datos = interpretarQR(qr.data);
      if (datos) return datos;
    }
  }
  return null;
}
