import fs from 'node:fs/promises';
import path from 'node:path';
import { leerHilo } from './hilo.ts';
import { descargar, recalcular, extraer } from './excel.ts';
import { ranking } from '../../motor/motor.ts';

/**
 * Actualizador semanal.
 *
 * Las tarifas NO salen de ninguna API: las meten a mano JavierRR, Ivansnoke y
 * Omadon en el Excel del post #3 del hilo de ForoCoches. Esto recoge su trabajo,
 * lo convierte en un JSON que la app puede leer, y comprueba que nuestro motor
 * sigue dando lo mismo que el Excel.
 *
 * Uso:  node actualizador/src/index.ts
 */

const RAIZ = path.resolve(import.meta.dirname, '../..');
const SALIDA = path.join(RAIZ, 'datos', 'tarifas.json');
const TMP = path.join(RAIZ, 'tmp', 'actualizar');

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  log('Leyendo el hilo...');
  const hilo = await leerHilo();
  log(`  volumen ${hilo.volumen}`);
  if (hilo.aviso) log(`  AVISO: ${hilo.aviso}`);

  const xlsx = path.join(TMP, 'comparador.xlsx');
  log('Descargando el Excel...');
  const bytes = await descargar(hilo.urlExcel, xlsx);
  log(`  ${bytes} bytes`);

  log('Recalculando con LibreOffice...');
  const datos = await extraer(await recalcular(xlsx, path.join(TMP, 'recalc')));
  log(`  Excel actualizado el ${datos.actualizadoExcel}`);
  log(`  ${datos.tarifas.length} tarifas`);

  // Verificacion: nuestro motor contra la fila 59 del Excel, con sus propios
  // datos de ejemplo. Si esto falla, el Excel ha cambiado de logica.
  log('Verificando el motor contra el Excel...');
  const res = ranking(datos.tarifas, datos.ejemplo, datos.constantes as any);
  const fallos = res.filter(r => {
    const t = datos.tarifas.find(x => x.comercializadora === r.comercializadora && x.tarifa === r.tarifa);
    return t?.totalPublicado != null && r.total != null && Math.abs(r.total - t.totalPublicado) >= 0.005;
  });
  if (fallos.length) {
    log(`  !! ${fallos.length} tarifas no cuadran. El motor se ha desviado del Excel:`);
    for (const f of fallos) log(`     ${f.comercializadora} ${f.tarifa}: motor ${f.total?.toFixed(2)}`);
  } else {
    log(`  ${res.length}/${res.length} al centimo`);
  }

  // Diff contra lo que ya teniamos, para saber que ha cambiado esta semana.
  const previo = await fs.readFile(SALIDA, 'utf8').then(JSON.parse).catch(() => null);
  if (previo) {
    const antes = new Map(previo.tarifas.map((t: any) => [t.comercializadora + '|' + t.tarifa, t]));
    let cambios = 0;
    for (const t of datos.tarifas) {
      const p: any = antes.get(t.comercializadora + '|' + t.tarifa);
      if (!p) { log(`  NUEVA: ${t.comercializadora} ${t.tarifa}`); cambios++; continue; }
      for (const k of ['ePunta', 'eLlano', 'eValle', 'potPuntaDia', 'potValleDia', 'excedentes'] as const) {
        if (p[k] !== t[k]) { log(`  CAMBIA ${t.comercializadora} ${t.tarifa}: ${k} ${p[k]} -> ${t[k]}`); cambios++; }
      }
    }
    log(cambios ? `  ${cambios} cambios` : '  sin cambios respecto a la semana pasada');
  }

  await fs.mkdir(path.dirname(SALIDA), { recursive: true });
  await fs.writeFile(SALIDA, JSON.stringify({
    generado: datos.generado,
    actualizadoExcel: datos.actualizadoExcel,
    fuente: { hilo: hilo.titulo, volumen: hilo.volumen, excel: hilo.urlExcel },
    verificacion: { comparadas: res.length, divergencias: fallos.length },
    constantes: datos.constantes,
    tarifas: datos.tarifas,
  }, null, 2));
  log(`Escrito ${SALIDA}`);
}

main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
