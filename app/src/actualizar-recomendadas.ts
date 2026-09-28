import { leerExcelDelHilo } from '@lector/excel-hilo.ts';

/**
 * Refresca las tarifas RECOMENDADAS bajandose el Excel del hilo.
 *
 * Las 82 de la CNMC se publican y el APK las pone al dia solo. Las 17 del Excel
 * no se publican —es el dataset curado de la Plataforma— asi que dentro del APK
 * se quedaban congeladas el dia que se compilo. Aqui el aparato se descarga el
 * MISMO fichero que el post #3 pide descargar a todo el mundo, y lo lee.
 *
 * Solo funciona en el APK: Dropbox no manda cabecera CORS, asi que un navegador
 * no puede pedirlo. Capacitor hace la peticion nativa y se la salta.
 */

const GUARDADO = 'luzapp.recomendadas';

export interface Recomendadas {
  actualizadoExcel: string | null;
  constantes: any;
  tarifas: any[];
  /** Cuando se bajo, para poder decir "ya estaban al dia". */
  descargado: string;
}

export const esApp = () => typeof (window as any).Capacitor !== 'undefined';

/** Lo ultimo que se descargo, si es que se descargo algo. */
export function guardadas(): Recomendadas | null {
  try {
    const s = localStorage.getItem(GUARDADO);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

export type Resultado =
  | { estado: 'actualizado'; datos: Recomendadas; cambios: number }
  | { estado: 'sin cambios'; datos: Recomendadas }
  | { estado: 'error'; motivo: string };

/** Descarga nativa, sin CORS. Devuelve los bytes del .xlsx. */
async function descargar(url: string): Promise<Uint8Array> {
  const Cap = (window as any).Capacitor;
  const http = Cap?.Plugins?.CapacitorHttp;
  if (!http) throw new Error('solo se puede desde la app instalada');

  const r = await http.request({ url, method: 'GET', responseType: 'arraybuffer' });
  if (r.status !== 200) throw new Error(`el servidor respondio ${r.status}`);

  // CapacitorHttp devuelve el binario en base64.
  const b64 = typeof r.data === 'string' ? r.data : '';
  if (!b64) throw new Error('la descarga vino vacia');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * ¿Es el mismo precio? Con tolerancia, NO con ===.
 *
 * LibreOffice guarda un digito menos que el que sale al calcular la formula en
 * JavaScript, asi que los mismos precios difieren en ~3e-17. Comparando estricto
 * el boton decia "han cambiado 3 tarifas" cada vez que se pulsaba, aunque el
 * fichero fuera identico. Medido el 28/09/2026 sobre G9, S9 y U9.
 */
const mismoPrecio = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  return (a ?? null) === (b ?? null);
};

/** Cuenta cuantas tarifas han cambiado de precio respecto a las que ya teniamos. */
function cuantasCambian(nuevas: any[], viejas: any[] | undefined): number {
  if (!viejas?.length) return nuevas.length;
  let n = 0;
  for (const t of nuevas) {
    const v = viejas.find(x => x.comercializadora === t.comercializadora && x.tarifa === t.tarifa);
    if (!v) { n++; continue; }
    for (const c of ['potPuntaDia', 'potValleDia', 'ePunta', 'eLlano', 'eValle', 'excedentes', 'descuentoDia']) {
      if (!mismoPrecio(v[c], t[c])) { n++; break; }
    }
  }
  return n;
}

export async function actualizarRecomendadas(url: string, actuales: any[] | undefined): Promise<Resultado> {
  try {
    const bytes = await descargar(url);
    const leido = leerExcelDelHilo(bytes);
    if (!leido.tarifas.length) return { estado: 'error', motivo: 'el fichero no traia ninguna tarifa' };

    const cambios = cuantasCambian(leido.tarifas, actuales);
    const datos: Recomendadas = { ...leido, descargado: new Date().toISOString() };
    try { localStorage.setItem(GUARDADO, JSON.stringify(datos)); } catch { /* sin sitio: da igual */ }

    return cambios ? { estado: 'actualizado', datos, cambios } : { estado: 'sin cambios', datos };
  } catch (e: any) {
    return { estado: 'error', motivo: e?.message ?? 'no he podido descargarlo' };
  }
}
