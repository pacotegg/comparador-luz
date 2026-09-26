/**
 * Segunda fuente: el comparador oficial de la CNMC.
 *
 * Es adonde lleva el QR de las facturas. Trae 86 ofertas de 33 comercializadoras
 * frente a las 17 del Excel, y sobre todo distingue el precio del PRIMER ano
 * (con promociones) del precio a partir del SEGUNDO, que es el que se paga de
 * verdad cuando la promocion se acaba.
 *
 * Su API solo devuelve el importe ya calculado, no los precios unitarios. Pero
 * la factura es lineal, asi que los precios se DESPEJAN con sondas que mueven
 * una magnitud cada vez. Cada consulta devuelve las 86 ofertas y los DOS
 * importes, asi que las mismas ocho consultas sirven para los dos anos.
 *
 * Por que molestarse en despejarlos: para que la app calcule en local. Si le
 * preguntaramos a la CNMC con los consumos del usuario, sus datos saldrian de
 * su dispositivo. Asi no sale nada.
 *
 * LIMITACION CONOCIDA: esto no modela los excedentes de autoconsumo. Las ofertas
 * de la CNMC se comparan como si no hubiera placas. Para excedentes vale el
 * Excel, que si los lleva.
 */

const API = 'https://comparador.cnmc.gob.es/api/publico/ofertas/electricidad';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const INICIO = Date.UTC(2026, 7, 1);

import { FACTOR_IMPUESTOS as FACTOR, costeCNMC, type PreciosCNMC } from '../../motor/motor.ts';

export interface Sonda { dias: number; potP1: number; potP2: number; cPunta: number; cLlano: number; cValle: number; }

function url(s: Sonda, codigoPostal: string): string {
  const fin = INICIO + s.dias * 86_400_000;
  const p = new URLSearchParams({
    tipoSuministro: 'E', codigoPostal,
    potencia: String(s.potP1),
    potenciaPrimeraFranja: String(s.potP1), potenciaSegundaFranja: String(s.potP2),
    potenciaTerceraFranja: String(s.potP1), potenciaCuartaFranja: String(s.potP1),
    potenciaQuintaFranja: String(s.potP1), potenciaSextaFranja: String(s.potP1),
    consumoAnualE: String(s.cPunta + s.cLlano + s.cValle), consumoAnualEOrig: '2600',
    consumoPrimeraFranja: String(s.cPunta), consumoSegundaFranja: String(s.cLlano), consumoTerceraFranja: String(s.cValle),
    consumoCuartaFranja: '0', consumoQuintaFranja: '0', consumoSextaFranja: '0',
    tarifa: '4', consumoAnualG: '0', consumoAnualGOrig: '0',
    serviciosAdicionales: '2', permanencia: '2', vivienda: 'true', factura: 'false',
    energiaAutoconsumo: '0', potenciaAutoconsumo: String(s.potP1), revisionPrecios: '2',
    importe: '0', dateInicio: String(INICIO), dateFin: String(fin), fFact: String(fin),
    tc: 'E0', bs: '0', impSA: '0', impOtros: '0', exc: '0', reg: '0',
    mecanismoAjuste: '0', importeMecanismoAjustePunta: '0', importeMecanismoAjusteLlano: '0',
    importeMecanismoAjusteValle: '0', precioConsumoMecanismoAjustePunta: '0',
    precioConsumoMecanismoAjusteLlano: '0', precioConsumoMecanismoAjusteValle: '0',
    precioConsumoMecanismoAjusteTotal: '0', mecanismoAjusteIVA: '0',
    tf: 'N', impOtrosConIE: '0', impOtrosSinIE: '0', pmaxP1: '0', pmaxP2: '0',
    dtoBS: '0', finBS: '0', ajuste: '0', impPot: '0', impEner: '0', dto: '0',
    prP1: '0', prP2: '0', prE1: '0', prE2: '0', prE3: '0',
    cfP1flex: '0', cfP2flex: '0', cambio: '0', promo: '0', verde: '0', rev: '0', trampeo: '0',
    perfilConsumo: '13', cups: '0000', autoconsumo: 'false', idAuditoriaQR: '0',
  });
  return `${API}?${p}`;
}

interface Oferta {
  id: number; comercializadora: string; oferta: string;
  importePrimerAnio: number; importeSegundoAnio: number;
  validez: string | null; penalizacion: boolean; verde: boolean; tipoRevision: number;
}

async function consultar(s: Sonda, cp: string): Promise<Map<number, Oferta>> {
  const r = await fetch(url(s, cp), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`La CNMC devolvio HTTP ${r.status}`);
  const j = await r.json();
  const arr: Oferta[] = Array.isArray(j) ? j : (Object.values(j).find(Array.isArray) as Oferta[]);
  if (!Array.isArray(arr)) throw new Error('La CNMC no devolvio una lista de ofertas.');
  return new Map(arr.map(o => [o.id, o]));
}

export type Precios = PreciosCNMC;

export interface TarifaCNMC {
  comercializadora: string; tarifa: string;
  primerAnio: Precios; segundoAnio: Precios;
  tienePromocion: boolean;
  soloNuevosClientes: boolean; penalizacion: boolean; verde: boolean;
  sospechosa: boolean;
}

export async function leerCNMC(codigoPostal = '28001') {
  // MEDIDO: la CNMC filtra las ofertas por potencia contratada. A 1 kW devuelve
  // 76 ofertas y 28 marcas; a 3,45 kW devuelve 86 y 33, y aparece Endesa. Por eso
  // las sondas van sobre un perfil realista y solo se mueve UNA magnitud cada vez.
  const base: Sonda = { dias: 30, potP1: 3.45, potP2: 3.45, cPunta: 22, cLlano: 22, cValle: 56 };
  const DIAS_2 = 35;
  const sondas: [string, Sonda][] = [
    ['base',  base],
    ['potP1', { ...base, potP1: base.potP1 + 1 }],
    ['potP2', { ...base, potP2: base.potP2 + 1 }],
    ['punta', { ...base, cPunta: base.cPunta + 100 }],
    ['llano', { ...base, cLlano: base.cLlano + 100 }],
    ['valle', { ...base, cValle: base.cValle + 100 }],
    ['dias',  { ...base, dias: DIAS_2 }],
  ];

  const res = new Map<string, Map<number, Oferta>>();
  for (const [nombre, s] of sondas) {
    res.set(nombre, await consultar(s, codigoPostal));
    await new Promise(r => setTimeout(r, 400)); // sin apurar a un servicio publico
  }
  const b = res.get('base')!;

  // Si una sonda devuelve otro conjunto de ofertas, las diferencias no son
  // comparables y los precios despejados no valdrian nada.
  const descuadre = [...res].filter(([n, m]) => n !== 'base' && m.size !== b.size)
    .map(([n, m]) => `${n}: ${m.size} ofertas frente a ${b.size}`);

  /** Despeja los precios de una oferta para el ano que indique `imp`. */
  function despejar(id: number, imp: (o: Oferta) => number): Precios | null {
    const v = (k: string) => { const o = res.get(k)!.get(id); return o ? imp(o) : NaN; };
    const b0 = v('base');
    const vals = [b0, v('potP1'), v('potP2'), v('punta'), v('llano'), v('valle'), v('dias')];
    if (!vals.every(Number.isFinite)) return null;

    const potPuntaDia = (v('potP1') - b0) / (base.dias * FACTOR);
    const potValleDia = (v('potP2') - b0) / (base.dias * FACTOR);
    const ePunta = (v('punta') - b0) / (100 * FACTOR);
    const eLlano = (v('llano') - b0) / (100 * FACTOR);
    const eValle = (v('valle') - b0) / (100 * FACTOR);

    // Al alargar el periodo crecen dos cosas: la potencia (ya conocida) y la
    // parte fija por dia. Lo que sobra tras descontar la potencia es esa parte.
    const potPorDia = FACTOR * (potPuntaDia * base.potP1 + potValleDia * base.potP2);
    const fijoDia = (v('dias') - b0) / (DIAS_2 - base.dias) - potPorDia;

    // Y lo que queda sin explicar es constante: descuentos de importe fijo.
    const constante = b0
      - fijoDia * base.dias
      - potPorDia * base.dias
      - FACTOR * (ePunta * base.cPunta + eLlano * base.cLlano + eValle * base.cValle);

    return { potPuntaDia, potValleDia, ePunta, eLlano, eValle, fijoDia, constante };
  }

  const tarifas: (TarifaCNMC & { _id: number })[] = [];
  for (const [id, o] of b) {
    // El PVPC devuelve el segundo ano a 0 porque es indexado y no tiene precio a
    // futuro: en ese caso vale el primero, que no lleva promocion ninguna.
    const seg = despejar(id, x => x.importeSegundoAnio || x.importePrimerAnio);
    const pri = despejar(id, x => x.importePrimerAnio);
    if (!seg || !pri) continue;

    tarifas.push({
      _id: id, comercializadora: o.comercializadora, tarifa: o.oferta,
      primerAnio: pri, segundoAnio: seg,
      tienePromocion: o.importeSegundoAnio > o.importePrimerAnio + 0.01,
      soloNuevosClientes: /nuevos clientes/i.test(o.validez ?? ''),
      penalizacion: o.penalizacion, verde: o.verde,
      sospechosa: false,
    });
  }

  // --- Sonda de CONTROL -------------------------------------------------
  // Una consulta mas, con valores que no se parecen a ninguna sonda (otros dias,
  // otras potencias, otro reparto). Si los precios despejados no reproducen el
  // importe de la CNMC, esa oferta no es lineal y no vale despejarla.
  const control: Sonda = { dias: 37, potP1: 5.5, potP2: 4.6, cPunta: 71, cLlano: 58, cValle: 133 };
  const real = await consultar(control, codigoPostal);

  let cuadran = 0;
  for (const t of tarifas) {
    const o = real.get(t._id);
    const esperado = o ? (o.importeSegundoAnio || o.importePrimerAnio) : NaN;
    if (!Number.isFinite(esperado)) { t.sospechosa = true; continue; }
    t.sospechosa = Math.abs(costeCNMC(t.segundoAnio, control) - esperado) > 0.15;
    if (!t.sospechosa) cuadran++;
  }

  for (const t of tarifas as any[]) delete t._id;
  return { codigoPostal, consultadas: sondas.length + 1, tarifas: tarifas as TarifaCNMC[], cuadran, total: tarifas.length, descuadre };
}
