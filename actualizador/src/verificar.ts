import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { recalcular, extraer } from './excel.ts';
import { ranking, type Consumo } from '../../motor/motor.ts';

/**
 * El arbitro. Mete unos datos de consumo en el Excel de verdad, deja que
 * LibreOffice lo recalcule, y compara su fila 59 contra lo que dice nuestro motor.
 *
 * Es la mitad "Excel como verificador" de la decision de arquitectura: la app
 * calcula sola y rapido, pero una vez por semana comprobamos que no se ha
 * desviado de la fuente. Si divergen, el fallo es nuestro.
 */
export async function calcularConExcel(xlsxOriginal: string, c: Consumo, dirTrabajo: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxOriginal);
  const ws = wb.getWorksheet('Comparador')!;

  ws.getCell('C27').value = c.dias;
  ws.getCell('C28').value = c.potP1;
  ws.getCell('C29').value = c.potP2;
  ws.getCell('C31').value = c.cPunta;
  ws.getCell('C32').value = c.cLlano;
  ws.getCell('C33').value = c.cValle;
  ws.getCell('C35').value = c.excedentes;

  await fs.mkdir(dirTrabajo, { recursive: true });
  const conDatos = path.join(dirTrabajo, 'con-datos.xlsx');
  await wb.xlsx.writeFile(conDatos);

  return extraer(await recalcular(conDatos, path.join(dirTrabajo, 'salida')));
}

export interface Divergencia {
  comercializadora: string; tarifa: string; motor: number; excel: number; diferencia: number;
}

/** Devuelve solo las tarifas en las que motor y Excel no coinciden al centimo. */
export async function comparar(xlsxOriginal: string, c: Consumo, dirTrabajo: string) {
  const d = await calcularConExcel(xlsxOriginal, c, dirTrabajo);
  const res = ranking(d.tarifas, c, d.constantes);

  const divergencias: Divergencia[] = [];
  for (const r of res) {
    const t = d.tarifas.find(x => x.comercializadora === r.comercializadora && x.tarifa === r.tarifa);
    if (!t || t.totalPublicado == null || r.total == null) continue;
    const diferencia = Math.abs(r.total - t.totalPublicado);
    if (diferencia >= 0.005) {
      divergencias.push({ comercializadora: r.comercializadora, tarifa: r.tarifa, motor: r.total, excel: t.totalPublicado, diferencia });
    }
  }
  return { comparadas: res.length, divergencias, ranking: res, datos: d };
}
