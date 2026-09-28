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
 * Saca un objeto de imagen del PDF. En el navegador `objs.get(nombre)` devuelve
 * el objeto directamente; en Node hay que pasarle una funcion.
 */
async function objeto(page: any, nombre: string): Promise<any> {
  try {
    const o = page.objs.get(nombre);
    if (o) return o;
  } catch { /* todavia no resuelto: se prueba con funcion */ }

  // OJO con el tiempo limite: si el objeto no llega nunca, esa funcion no se
  // llama nunca y la promesa se queda colgada para siempre. Medido en el
  // WebView de Android: la app se quedaba en "Leyendo la factura..." sin dar
  // error ni terminar. El QR es un atajo, no puede bloquear la lectura.
  return new Promise(ok => {
    const reloj = setTimeout(() => ok(null), 3000);
    try {
      page.objs.get(nombre, (o: any) => { clearTimeout(reloj); ok(o ?? null); });
    } catch { clearTimeout(reloj); ok(null); }
  });
}

/**
 * Pixeles en RGBA, que es lo unico que entiende jsQR.
 *
 * OJO: pdf.js NO devuelve lo mismo en los dos sitios. En Node da `data` con los
 * pixeles crudos; en el navegador da un `bitmap` (ImageBitmap) y `data` viene
 * vacio. Comprobar solo `data` hacia que en el navegador se saltara TODAS las
 * imagenes y no se encontrara nunca un QR, mientras en Node funcionaba.
 */
async function aRGBA(img: any): Promise<Uint8ClampedArray | null> {
  const { width: w, height: h } = img;

  if (img.bitmap && typeof OffscreenCanvas !== 'undefined') {
    const lienzo = new OffscreenCanvas(w, h);
    const ctx = lienzo.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img.bitmap, 0, 0);
    return ctx.getImageData(0, 0, w, h).data;
  }

  const data = img.data;
  if (!data) return null;
  const canales = data.length / (w * h);
  if (canales < 1 || canales > 4) return null;

  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let k = 0; k < w * h; k++) {
    const s = k * canales;
    rgba[k * 4] = data[s];
    rgba[k * 4 + 1] = data[s + (canales > 2 ? 1 : 0)];
    rgba[k * 4 + 2] = data[s + (canales > 2 ? 2 : 0)];
    rgba[k * 4 + 3] = 255;
  }
  return rgba;
}

/**
 * Recorre las imagenes incrustadas del PDF buscando un QR.
 * `doc` es un PDFDocumentProxy de pdfjs-dist.
 */
/** Tiempo maximo que se le dedica a buscar el QR antes de tirar del texto. */
const PRESUPUESTO_MS = 12_000;

export async function buscarQR(doc: any, OPS: any): Promise<DatosQR | null> {
  const limite = Date.now() + PRESUPUESTO_MS;

  for (let pagina = 1; pagina <= doc.numPages; pagina++) {
    if (Date.now() > limite) return null;
    const page = await doc.getPage(pagina);
    const ops = await page.getOperatorList();

    for (let i = 0; i < ops.fnArray.length; i++) {
      if (Date.now() > limite) return null;
      if (ops.fnArray[i] !== OPS.paintImageXObject) continue;
      const nombre = ops.argsArray[i][0];

      const img = await objeto(page, nombre);
      if (!img?.width) continue;

      const rgba = await aRGBA(img);
      if (!rgba) continue;

      const { width: w, height: h } = img;
      const qr = jsQR(rgba, w, h);
      if (!qr) continue;
      const datos = interpretarQR(qr.data);
      if (datos) return datos;
    }
  }
  return null;
}
