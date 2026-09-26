import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { vaciarCache } from './recalculo.ts';

const ejecutar = promisify(execFile);
// Barras normales a proposito: con contrabarras, cualquier edicion del fichero
// se las come y el spawn revienta con ENOENT. Windows acepta las dos.
const SOFFICE = 'C:/Program Files/LibreOffice/program/soffice.exe';

// El Excel publicado NO lo guarda Excel: guarda las formulas con el valor cacheado
// ya formateado ("31.44 €", t="str"). Leerlo sin recalcular da cadenas, no numeros.
// Por eso pasa siempre por LibreOffice antes de tocarlo.
export async function recalcular(entrada: string, dirSalida: string): Promise<string> {
  await fs.mkdir(dirSalida, { recursive: true });

  // Sin vaciar el cache, LibreOffice respeta los valores cacheados y NO recalcula.
  // Comprobado: convirtiendo el fichero tal cual sale "0.089434 €" en vez de 0.089434.
  // En subcarpeta propia: si lo dejamos junto a la salida, LibreOffice escribe
  // encima de su propia entrada porque conserva el nombre del fichero.
  const dirEntrada = path.join(dirSalida, 'entrada');
  await fs.mkdir(dirEntrada, { recursive: true });
  const sinCache = path.join(dirEntrada, path.basename(entrada));
  await fs.writeFile(sinCache, vaciarCache(await fs.readFile(entrada)));
  entrada = sinCache;

  await ejecutar(SOFFICE, ['--headless', '--norestore', '--convert-to', 'xlsx', '--outdir', dirSalida, entrada]);
  const salida = path.join(dirSalida, path.basename(entrada));
  const st = await fs.stat(salida).catch(() => null);
  if (!st?.size) throw new Error(`LibreOffice no genero ${salida}`);
  return salida;
}

export async function descargar(url: string, destino: string): Promise<number> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Dropbox devolvio HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 50_000) throw new Error(`Descarga sospechosamente pequena: ${buf.length} bytes`);
  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(destino, buf);
  return buf.length;
}

const COLS = ['E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U'];
const num = (v: any): number | null => {
  const n = typeof v === 'object' && v !== null ? (v.result ?? v.value) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const txt = (v: any): string | null => {
  const s = typeof v === 'object' && v !== null ? (v.result ?? v.text ?? v.value) : v;
  if (s === null || s === undefined) return null;
  return String(s).replace(/\s+/g, ' ').trim() || null;
};

export interface Tarifa {
  col: string; comercializadora: string; tarifa: string;
  permanencia: string | null; potenciaMaxima: number | null; mantenimientoMeses: string | null;
  empresas: string | null; potPuntaDia: number | null; potValleDia: number | null;
  periodos: number | null; ePunta: number | null; eLlano: number | null; eValle: number | null;
  excedentes: number | null; tipoCompensacion: string | null; bateriaVirtual: number | null;
  ultimoCambio: string | null; nota: string | null; limiteConsumo: string | null;
  descuentoDia: number | null; totalPublicado: number | null;
}

/**
 * Saca el descuento promocional que va INCRUSTADO en la formula de la fila 56.
 * Gana (x2) y CHC llevan "-(10/30*diasfct)", que son los 10 €/mes del codigo
 * DESC100 y de la promo de CHC. Las demas no llevan nada.
 * Se extrae de la formula en vez de codificarlo para enterarnos si lo cambian.
 */
function descuentoDia(celda: any): number | null {
  const f = typeof celda === 'object' && celda !== null ? celda.formula : null;
  if (typeof f !== 'string') return null;
  const m = f.match(/-\s*\(\s*([\d.]+)\s*\/\s*([\d.]+)\s*\*\s*diasfct\s*\)/i);
  if (!m) return null;
  const d = Number(m[1]) / Number(m[2]);
  return Number.isFinite(d) ? d : null;
}

export async function extraer(xlsx: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsx);
  const ws = wb.getWorksheet('Comparador');
  if (!ws) throw new Error('El libro no tiene la hoja "Comparador". Ha cambiado el formato.');
  const c = (ref: string) => ws.getCell(ref).value;

  const tarifas: Tarifa[] = COLS.map(col => ({
    col,
    comercializadora: txt(c(`${col}3`)) ?? '?',
    tarifa: txt(c(`${col}4`)) ?? '?',
    permanencia: txt(c(`${col}5`)),
    potenciaMaxima: num(c(`${col}6`)),
    mantenimientoMeses: txt(c(`${col}7`)),
    empresas: txt(c(`${col}8`)),
    potPuntaDia: num(c(`${col}9`)),
    potValleDia: num(c(`${col}10`)),
    periodos: num(c(`${col}13`)),
    ePunta: num(c(`${col}14`)),
    eLlano: num(c(`${col}15`)),
    eValle: num(c(`${col}16`)),
    excedentes: num(c(`${col}17`)),
    tipoCompensacion: txt(c(`${col}18`)),
    bateriaVirtual: num(c(`${col}19`)),
    ultimoCambio: (() => { const v: any = c(`${col}20`); return v instanceof Date ? v.toISOString().slice(0,10) : txt(v); })(),
    nota: [txt(c(`${col}21`)), txt(c(`${col}22`))].filter(Boolean).join(' | ') || null,
    limiteConsumo: txt(c(`${col}23`)),
    descuentoDia: descuentoDia(c(`${col}56`)),
    totalPublicado: num(c(`${col}59`)),
  }));

  return {
    generado: new Date().toISOString(),
    actualizadoExcel: (() => { const v: any = c('B1'); return v instanceof Date ? v.toISOString().slice(0,10) : txt(v); })(),
    // Constantes reguladas, con los nombres definidos del propio libro
    constantes: {
      finbonsoc: num(c('C49')), IEact: num(c('C50')), contadordia: num(c('C51')), IVAact: num(c('C54')),
      ppuntaboe: num(c('AA5')), pvalleboe: num(c('AA6')), margenComercial: num(c('AA7')),
      peajeE1: num(c('AA8')), peajeE2: num(c('AA9')), peajeE3: num(c('AA10')),
      precioMedioPVPC: num(c('V18')),
    },
    // Datos de ejemplo que trae el fichero: sirven de test de regresion del motor
    ejemplo: {
      dias: num(c('C27')), potP1: num(c('C28')), potP2: num(c('C29')),
      cPunta: num(c('C31')), cLlano: num(c('C32')), cValle: num(c('C33')), excedentes: num(c('C35')),
    },
    tarifas,
  };
}
