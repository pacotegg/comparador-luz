import fs from 'node:fs/promises';
import path from 'node:path';
import { leerHilo } from './hilo.ts';
import { descargar, recalcular, extraer } from './excel.ts';
import { leerCNMC } from './cnmc.ts';
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

  // Segunda fuente: el comparador oficial de la CNMC, al que lleva el QR de las
  // facturas. Trae muchas mas ofertas y, sobre todo, el precio del segundo ano,
  // que es el que se paga cuando se acaban las promociones.
  log('Consultando la CNMC...');
  let cnmc: Awaited<ReturnType<typeof leerCNMC>> | null = null;
  try {
    cnmc = await leerCNMC();
    log(`  ${cnmc.total} ofertas, precios despejados y verificados en ${cnmc.cuadran}`);
    if (cnmc.descuadre.length) log(`  AVISO: ${cnmc.descuadre.join('; ')}`);
  } catch (e: any) {
    log(`  no he podido leer la CNMC (${e.message}). Sigo solo con el Excel.`);
  }

  // Donde las dos fuentes hablan de la misma tarifa, comparar. Si discrepan, o
  // el Excel esta desactualizado o la comercializadora publica dos precios.
  const contraste: any[] = [];
  if (cnmc) {
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

    // La CNMC usa razones sociales y el Excel nombres comerciales, asi que hace
    // falta una tabla. Sin comparar tambien la comercializadora, "REPSOL Sin
    // horarios" casa con "ENERGIA NUFRI - SIN HORARIOS" y el contraste miente.
    const ALIAS: Record<string, string> = {
      chc: 'cidehcenergia', niba: 'niba', imagina: 'imaginaenergia',
      energianufri: 'energianufrisl', repsol: 'repsolcomercializadora',
      naturgy: 'naturgyclientes', endesa: 'endesa',
      comercializadorasdereferencia: 'comercializadoradereferencia',
    };

    for (const t of datos.tarifas) {
      if (t.ePunta == null) continue;
      const marca = ALIAS[norm(t.comercializadora)];
      if (!marca) continue;                       // no esta en la CNMC, nada que contrastar
      const clave = norm(t.tarifa).slice(0, 10);
      if (clave.length < 6) continue;
      const m = cnmc.tarifas.find(c =>
        !c.sospechosa && norm(c.comercializadora).includes(marca) && norm(c.tarifa).includes(clave));
      if (!m) continue;
      const dif = Math.abs(t.ePunta - m.ePunta);
      contraste.push({
        tarifa: `${t.comercializadora} ${t.tarifa}`, cnmc: `${m.comercializadora} ${m.tarifa}`,
        ePuntaExcel: t.ePunta, ePuntaCNMC: m.ePunta, diferencia: dif,
        ultimoCambioExcel: t.ultimoCambio,
      });
      if (dif > 0.002) log(`  DISCREPAN ${t.comercializadora} ${t.tarifa}: Excel ${t.ePunta} vs CNMC ${m.ePunta.toFixed(6)} (Excel visto el ${t.ultimoCambio})`);
    }
    log(`  ${contraste.length} tarifas presentes en las dos fuentes`);
  }

  await fs.mkdir(path.dirname(SALIDA), { recursive: true });
  await fs.writeFile(SALIDA, JSON.stringify({
    generado: datos.generado,
    actualizadoExcel: datos.actualizadoExcel,
    fuente: { hilo: hilo.titulo, volumen: hilo.volumen, excel: hilo.urlExcel },
    verificacion: { comparadas: res.length, divergencias: fallos.length },
    constantes: datos.constantes,
    tarifas: datos.tarifas,
    cnmc: cnmc && {
      codigoPostal: cnmc.codigoPostal,
      verificadas: `${cnmc.cuadran}/${cnmc.total}`,
      tarifas: cnmc.tarifas.filter(t => !t.sospechosa),
    },
    contraste,
  }, null, 2));
  log(`Escrito ${SALIDA}`);
}

main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
