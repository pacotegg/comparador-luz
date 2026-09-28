import { unzipSync } from 'fflate';

/**
 * Lee el Excel de la Plataforma de ForoCoches EN EL DISPOSITIVO.
 *
 * Por que existe esto, si el actualizador ya lo hace en el HTPC: porque su
 * resultado NO se publica —es el dataset curado de la Plataforma— y por tanto
 * el APK no tiene de donde refrescarlo. Se quedaba congelado con las 17 tarifas
 * del dia en que se compilo.
 *
 * Aqui el aparato se baja el MISMO fichero que el hilo le dice a todo el mundo
 * que se descargue, y lo lee. No se republica nada de nadie: cada uno descarga
 * su copia, que es justo lo que las instrucciones del post #3 piden hacer.
 *
 * El actualizador del HTPC recalcula con LibreOffice, que en un movil no hay.
 * No hace falta: de todas las celdas que necesita el motor solo 19 son formula,
 * y son de tres clases —aritmetica de literales, referencia a otra celda, y
 * referencia mas o menos un numero—. Con eso basta un evaluador de veinte
 * lineas. Medido sobre el Excel del 24/09/2026.
 */

// ---------------------------------------------------------------------------
// Lectura del .xlsx
// ---------------------------------------------------------------------------

interface Celda { v: string | null; f: string | null; esTexto: boolean; }

function leerHoja(xlsx: Uint8Array): { celda: (ref: string) => Celda | null } {
  const zip = unzipSync(xlsx);
  const dec = new TextDecoder();

  const hojaRuta = Object.keys(zip).find(k => /^xl\/worksheets\/sheet1\.xml$/.test(k));
  if (!hojaRuta) throw new Error('El fichero no parece un Excel: no tiene xl/worksheets/sheet1.xml');
  const xml = dec.decode(zip[hojaRuta]);

  // Cadenas compartidas: los textos no van en la celda, van en una tabla aparte.
  const compartidas: string[] = [];
  const ss = zip['xl/sharedStrings.xml'];
  if (ss) {
    for (const m of dec.decode(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      compartidas.push(desescapar([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
    }
  }

  const bloques = xml.match(/<c r="[A-Z]+\d+"[^>]*\/>|<c r="[A-Z]+\d+"[^>]*>[\s\S]*?<\/c>/g) ?? [];

  // Formulas COMPARTIDAS: xlsx las guarda una sola vez. La celda maestra lleva
  // el texto y un si="N"; las vecinas solo <f t="shared" si="N"/>, vacio. Sin
  // esto, F9, F10 y S10 salian null.
  const maestras = new Map<string, string>();
  for (const b of bloques) {
    const si = b.match(/<f[^>]*\bsi="(\d+)"/)?.[1];
    const texto = b.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1];
    if (si && texto && texto.trim()) maestras.set(si, desescapar(texto));
  }

  const mapa = new Map<string, Celda>();
  for (const b of bloques) {
    const ref = b.match(/<c r="([A-Z]+\d+)"/)?.[1];
    if (!ref) continue;

    let f = b.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1] ?? null;
    if (f) f = desescapar(f);
    if (!f || !f.trim()) {
      const si = b.match(/<f[^>]*\bsi="(\d+)"/)?.[1];
      const maestra = si ? maestras.get(si) : undefined;
      // Una formula compartida es RELATIVA: sus referencias se desplazan segun
      // la distancia a la maestra. Copiarla tal cual solo vale si no tiene
      // ninguna. Si la tiene, se deja vacia antes que dar un numero falso.
      f = maestra && !/[A-Z]{1,3}\d+/.test(maestra) ? maestra : null;
    }

    const v = b.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? null;
    const tipo = b.match(/<c[^>]*\st="([^"]+)"/)?.[1] ?? null;
    mapa.set(ref, {
      v: tipo === 's' && v !== null ? (compartidas[Number(v)] ?? null) : v,
      f,
      esTexto: tipo === 's' || tipo === 'str',
    });
  }
  return { celda: (ref: string) => mapa.get(ref) ?? null };
}

const desescapar = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ---------------------------------------------------------------------------
// Evaluador
// ---------------------------------------------------------------------------

/**
 * Resuelve las formulas simples del Excel. A proposito NO entiende funciones:
 * si aparece una (IF, MAX, CONCATENATE...) devuelve null y el campo se queda
 * vacio, que es mejor que inventarse un numero.
 */
function evaluar(formula: string, valor: (ref: string) => number | null, profundidad = 0): number | null {
  if (profundidad > 8) return null;                       // referencias circulares
  let f = formula.trim().replace(/^[+=]/, '');
  if (!f || /[A-Za-z]{2,}\s*\(/.test(f)) return null;     // lleva una funcion

  // Sustituir referencias (A1, $A$1) por su valor.
  let fallo = false;
  const expr = f.replace(/\$?([A-Z]{1,3})\$?(\d{1,5})/g, (_, col, fila) => {
    const v = valor(col + fila);
    if (v === null) { fallo = true; return '0'; }
    return '(' + v + ')';
  });
  if (fallo) return null;

  // Solo numeros, operadores y parentesis: nada que pueda ejecutar algo.
  if (!/^[\d\s().+\-*/]+$/.test(expr)) return null;
  try {
    const r = Function('"use strict";return (' + expr + ')')();
    return typeof r === 'number' && Number.isFinite(r) ? r : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Extraccion
// ---------------------------------------------------------------------------

const COLS = ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'];

export interface TarifasDelHilo {
  actualizadoExcel: string | null;
  constantes: Record<string, number | null>;
  tarifas: any[];
}

export function leerExcelDelHilo(xlsx: Uint8Array): TarifasDelHilo {
  const { celda } = leerHoja(xlsx);

  const num = (ref: string, prof = 0): number | null => {
    const c = celda(ref);
    if (!c) return null;
    if (c.f) return evaluar(c.f, r => num(r, prof + 1), prof);
    if (c.v === null) return null;
    const n = Number(c.v);
    return Number.isFinite(n) ? n : null;
  };

  const txt = (ref: string): string | null => {
    const c = celda(ref);
    if (!c) return null;
    const s = (c.v ?? '').toString().replace(/\s+/g, ' ').trim();
    return s || null;
  };

  /** El descuento promocional va incrustado en la formula de la fila 56. */
  const descuentoDia = (col: string): number | null => {
    const f = celda(col + '56')?.f;
    const m = f?.match(/-\s*\(\s*([\d.]+)\s*\/\s*([\d.]+)\s*\*\s*diasfct\s*\)/i);
    if (!m) return null;
    const d = Number(m[1]) / Number(m[2]);
    return Number.isFinite(d) ? d : null;
  };

  const tarifas = COLS.map(col => ({
    col,
    comercializadora: txt(col + '3') ?? '?',
    tarifa: txt(col + '4') ?? '?',
    permanencia: txt(col + '5'),
    potenciaMaxima: num(col + '6'),
    mantenimientoMeses: txt(col + '7'),
    potPuntaDia: num(col + '9'),
    potValleDia: num(col + '10'),
    periodos: num(col + '13'),
    ePunta: num(col + '14'),
    eLlano: num(col + '15'),
    eValle: num(col + '16'),
    excedentes: num(col + '17'),
    tipoCompensacion: txt(col + '18'),
    bateriaVirtual: num(col + '19'),
    ultimoCambio: fechaExcel(num(col + '20')),
    nota: [txt(col + '21'), txt(col + '22')].filter(Boolean).join(' | ') || null,
    limiteConsumo: txt(col + '23'),
    descuentoDia: descuentoDia(col),
  }));

  return {
    actualizadoExcel: fechaExcel(Math.max(...tarifas.map(t => fechaNum(t.ultimoCambio)).filter(Boolean))),
    constantes: {
      finbonsoc: num('C49'), IEact: num('C50'), contadordia: num('C51'), IVAact: num('C54'),
      ppuntaboe: num('AA5'), pvalleboe: num('AA6'), margenComercial: num('AA7'),
      peajeE1: num('AA8'), peajeE2: num('AA9'), peajeE3: num('AA10'),
      precioMedioPVPC: num('V18'),
    },
    tarifas,
  };
}

/** Las fechas de Excel son dias desde el 30/12/1899. */
function fechaExcel(serie: number | null): string | null {
  if (!serie || !Number.isFinite(serie) || serie < 1) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + serie * 86_400_000);
  return d.toISOString().slice(0, 10);
}
const fechaNum = (iso: string | null): number =>
  iso ? (Date.parse(iso + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86_400_000 : 0;
