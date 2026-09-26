import fs from 'node:fs/promises';
import path from 'node:path';
import { leerHilo } from './hilo.ts';
import { descargar, recalcular, extraer } from './excel.ts';
import { leerCNMC } from './cnmc.ts';
import { contrastarExcedentes } from './excedentes.ts';
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
const TMP = path.join(RAIZ, 'tmp', 'actualizar');

// Dos ficheros a proposito, y los dos van tambien a app/public/ para el build:
//
//  - tarifas-cnmc.json   PUBLICO. Datos del comparador oficial de la CNMC:
//                        precios que las comercializadoras estan obligadas a
//                        registrar. Hechos publicos, se pueden republicar.
//
//  - tarifas-excel.json  LOCAL, fuera de git. Es el dataset CURADO de la
//                        Plataforma de ForoCoches: su seleccion, su trabajo de
//                        actualizacion y su modelo de excedentes. Usarlo uno
//                        mismo es justo para lo que lo publican; republicarlo
//                        en un servicio abierto es otra cosa. Quien quiera esa
//                        parte, que se baje el Excel del hilo y ejecute esto.
const SALIDA_CNMC = path.join(RAIZ, 'datos', 'tarifas-cnmc.json');
const SALIDA_EXCEL = path.join(RAIZ, 'datos', 'tarifas-excel.json');
const PUBLIC = path.join(RAIZ, 'app', 'public');

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
  const previo = await fs.readFile(SALIDA_EXCEL, 'utf8').then(JSON.parse).catch(() => null);
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
      const dif = Math.abs(t.ePunta - m.segundoAnio.ePunta);
      contraste.push({
        tarifa: `${t.comercializadora} ${t.tarifa}`, cnmc: `${m.comercializadora} ${m.tarifa}`,
        ePuntaExcel: t.ePunta, ePuntaCNMC: m.segundoAnio.ePunta, diferencia: dif,
        ultimoCambioExcel: t.ultimoCambio,
      });
      if (dif > 0.002) log(`  DISCREPAN ${t.comercializadora} ${t.tarifa}: Excel ${t.ePunta} vs CNMC ${m.segundoAnio.ePunta.toFixed(6)} (Excel visto el ${t.ultimoCambio})`);
    }
    log(`  ${contraste.length} tarifas presentes en las dos fuentes`);
  }

  // Contraste de excedentes: mira la web oficial de cada tarifa y avisa si no
  // dice lo que dice el Excel. No corrige nada: la compensacion es un atributo
  // de la tarifa y una web lista varias, asi que el numero puede ser de otro
  // producto. Por eso se guarda la evidencia textual y decide el humano.
  log('Contrastando excedentes contra las webs oficiales...');
  let excedentes: Awaited<ReturnType<typeof contrastarExcedentes>> = [];
  try {
    excedentes = await contrastarExcedentes(datos.tarifas as any, hilo.html);
    const conDato = excedentes.filter(e => e.cuadra !== null);
    const discrepan = conDato.filter(e => !e.cuadra);
    log(`  ${conDato.length}/${excedentes.length} tarifas con precio en su web, ${conDato.length - discrepan.length} coinciden`);
    for (const d of discrepan) {
      log(`  REVISAR ${d.comercializadora} ${d.tarifa}: web ${d.precio} vs Excel ${d.excel}`);
      log(`     "${d.evidencia}"  (${d.url})`);
    }
  } catch (e: any) {
    log(`  no he podido contrastar (${e.message})`);
  }

  await fs.mkdir(path.join(RAIZ, 'datos'), { recursive: true });
  await fs.mkdir(PUBLIC, { recursive: true });

  const escribir = async (destino: string, copia: string, contenido: unknown) => {
    const txt = JSON.stringify(contenido, null, 2);
    await fs.writeFile(destino, txt);
    await fs.writeFile(path.join(PUBLIC, copia), txt);
  };

  if (cnmc) {
    await escribir(SALIDA_CNMC, 'tarifas-cnmc.json', {
      generado: datos.generado,
      fuente: 'Comparador oficial de ofertas de la CNMC',
      codigoPostal: cnmc.codigoPostal,
      verificadas: `${cnmc.cuadran}/${cnmc.total}`,
      tarifas: cnmc.tarifas.filter(t => !t.sospechosa),
    });
    log(`Escrito ${SALIDA_CNMC}`);
  }

  await escribir(SALIDA_EXCEL, 'tarifas-excel.json', {
    generado: datos.generado,
    actualizadoExcel: datos.actualizadoExcel,
    fuente: { hilo: hilo.titulo, volumen: hilo.volumen, excel: hilo.urlExcel },
    verificacion: { comparadas: res.length, divergencias: fallos.length },
    constantes: datos.constantes,
    tarifas: datos.tarifas,
    contraste,
    contrasteExcedentes: excedentes,
  });
  log(`Escrito ${SALIDA_EXCEL} (local, fuera de git)`);
}

main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
