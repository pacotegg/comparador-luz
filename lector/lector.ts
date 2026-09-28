import { buscarQR, type DatosQR } from './qr.ts';
import { leerTexto, type Lectura } from './texto.ts';

/**
 * Lee una factura en PDF y saca los siete campos que pide el Excel.
 *
 * Orden: primero el QR de la CNMC (datos estructurados, sin ambiguedad) y
 * despues el texto, que rellena lo que falte. Nunca al reves: el QR gana
 * siempre que exista, porque el texto de la cabecera puede discrepar.
 *
 * Todo ocurre en el navegador de quien sube la factura. El PDF no se envia
 * a ningun sitio.
 */

export interface Campos {
  dias: number | null;
  potP1: number | null;
  potP2: number | null;
  cPunta: number | null;
  cLlano: number | null;
  cValle: number | null;
  excedentes: number | null;
}

export type Origen = 'qr' | 'texto' | null;

export interface Resultado {
  campos: Campos;
  origen: Record<keyof Campos, Origen>;
  /** Como se leyo cada campo del texto, para poder auditarlo. */
  patrones: Partial<Record<keyof Campos, string>>;
  potenciaMaxima: number | null;
  /**
   * Consumo total cuando la factura NO desglosa por periodos (tarifas de un
   * solo precio, como la Por Uso Luz de Naturgy). Sin reparto no se puede
   * comparar: la app tiene que ofrecer uno de los repartos por defecto.
   */
  consumoTotalSinDesglose: number | null;
  /**
   * Rellenado cuando la factura NO es de una tarifa domestica 2.0TD. Ninguna de
   * las tarifas del comparador le aplica, asi que la app no debe ensenyar un
   * ranking como si nada.
   */
  peajeNoDomestico: string | null;
  potenciaSugerida: number | null;
  totalFactura: number | null;
  cups: string | null;
  tieneQR: boolean;
  completa: boolean;
  avisos: string[];
}

const CAMPOS: (keyof Campos)[] = ['dias', 'potP1', 'potP2', 'cPunta', 'cLlano', 'cValle', 'excedentes'];

/** Texto plano del PDF, reconstruyendo las lineas por su coordenada Y. */
export async function extraerTexto(doc: any): Promise<string> {
  let salida = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const lineas = new Map<number, [number, string][]>();
    for (const it of tc.items as any[]) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5]);
      if (!lineas.has(y)) lineas.set(y, []);
      lineas.get(y)!.push([it.transform[4], it.str]);
    }
    for (const y of [...lineas.keys()].sort((a, b) => b - a)) {
      salida += lineas.get(y)!.sort((a, b) => a[0] - b[0]).map(x => x[1]).join(' ').trim() + '\n';
    }
  }
  return salida;
}

export async function leerFactura(doc: any, OPS: any): Promise<Resultado> {
  const avisos: string[] = [];

  const texto = await extraerTexto(doc);
  if (texto.replace(/\s/g, '').length < 400) {
    avisos.push('Este PDF casi no tiene texto: parece escaneado. Habria que leerlo con OCR, que todavia no esta puesto.');
  }
  const t: Lectura = leerTexto(texto);

  let qr: DatosQR | null = null;
  try { qr = await buscarQR(doc, OPS); } catch { /* el QR es un extra, no un requisito */ }

  const campos = {} as Campos;
  const origen = {} as Record<keyof Campos, Origen>;
  const patrones: Partial<Record<keyof Campos, string>> = {};

  for (const k of CAMPOS) {
    const vQR = qr ? (qr as any)[k] : null;
    if (typeof vQR === 'number' && Number.isFinite(vQR)) {
      campos[k] = vQR; origen[k] = 'qr'; continue;
    }
    const c = (t as any)[k];
    if (c) { campos[k] = c.valor; origen[k] = 'texto'; patrones[k] = c.patron; }
    else { campos[k] = null; origen[k] = null; }
  }

  // Sin excedentes leidos en ningun sitio, lo normal es que no haya placas.
  if (campos.excedentes === null) { campos.excedentes = 0; origen.excedentes = null; }

  // Avisos del texto, solo para lo que el QR no haya resuelto ya.
  for (const a of t.avisos) {
    const m = a.match(/No he sabido leer: (\w+)/);
    if (m && origen[m[1] as keyof Campos] === 'qr') continue;
    avisos.push(a);
  }

  const potenciaMaxima = qr?.potenciaMaxima ?? null;
  // Post #2, paso 2: la potencia a contratar es el pico maximo dividido entre 1,2.
  const potenciaSugerida = potenciaMaxima ? Math.round((potenciaMaxima / 1.2) * 100) / 100 : null;

  const faltan = CAMPOS.filter(k => k !== 'excedentes' && campos[k] === null);
  if (faltan.length) avisos.push(`Faltan ${faltan.length} campos por rellenar a mano.`);

  return {
    campos, origen, patrones,
    potenciaMaxima, potenciaSugerida,
    consumoTotalSinDesglose:
      campos.cPunta === null && campos.cLlano === null && campos.cValle === null
        ? (t.consumoTotal?.valor ?? null) : null,
    peajeNoDomestico: t.peajeNoDomestico,
    totalFactura: qr?.totalFactura ?? t.totalFactura?.valor ?? null,
    cups: qr?.cups ?? null,
    tieneQR: qr !== null,
    completa: faltan.length === 0,
    avisos,
  };
}
