/**
 * Segunda fuente: el comparador oficial de la CNMC.
 *
 * Es donde lleva el QR de las facturas. Tiene 86 ofertas de 33 comercializadoras
 * frente a las 17 del Excel, y sobre todo distingue el precio del PRIMER ano
 * (con promociones) del precio a partir del SEGUNDO (el de verdad).
 *
 * Su API solo devuelve el importe ya calculado, no los precios unitarios. Pero
 * la factura es lineal en los consumos, asi que los precios se DESPEJAN con unas
 * pocas consultas de sonda. Cada consulta devuelve las 86 ofertas, asi que con
 * seis sondas tenemos los precios de todas.
 *
 * Por que molestarse en despejarlos: para que la app pueda calcular en local.
 * Si preguntaramos a la CNMC con los consumos del usuario, sus datos saldrian
 * de su dispositivo. Asi no sale nada.
 */

const API = 'https://comparador.cnmc.gob.es/api/publico/ofertas/electricidad';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

/** 2026-08-01 -> 2026-08-31, 30 dias justos. */
const INICIO = Date.UTC(2026, 7, 1);
const DIAS_SONDA = 30;
const FIN = INICIO + DIAS_SONDA * 86_400_000;

export interface Sonda { potP1: number; potP2: number; cPunta: number; cLlano: number; cValle: number; }

function url(s: Sonda, codigoPostal: string): string {
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
    importe: '0', dateInicio: String(INICIO), dateFin: String(FIN), fFact: String(FIN),
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

export interface Oferta {
  id: number; comercializadora: string; oferta: string;
  importePrimerAnio: number; importeSegundoAnio: number;
  validez: string | null; penalizacion: boolean; verde: boolean;
  tienePrecioUnico: string; tipoRevision: number;
}

async function consultar(s: Sonda, cp: string): Promise<Map<number, Oferta>> {
  const r = await fetch(url(s, cp), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`La CNMC devolvio HTTP ${r.status}`);
  const j = await r.json();
  const arr: Oferta[] = Array.isArray(j) ? j : Object.values(j).find(Array.isArray) as Oferta[];
  if (!Array.isArray(arr)) throw new Error('La CNMC no devolvio una lista de ofertas.');
  return new Map(arr.map(o => [o.id, o]));
}

export interface TarifaCNMC {
  comercializadora: string; tarifa: string;
  potPuntaDia: number; potValleDia: number;
  ePunta: number; eLlano: number; eValle: number;
  /** Lo que cuesta el primer ano y lo que cuesta despues, en la sonda de referencia. */
  importePrimerAnio: number; importeSegundoAnio: number;
  promocion: number;
  soloNuevosClientes: boolean; penalizacion: boolean; verde: boolean;
  /** true si los precios despejados no reproducen el importe de la CNMC. */
  sospechosa: boolean;
}

/**
 * Los precios se despejan del importe CON impuestos, asi que hay que quitarlos
 * para dejarlos como el Excel, que siempre habla sin impuestos.
 * El margen de energia y potencia arrastra el impuesto electrico y el IVA.
 */
const IE = 0.0511269632;
const IVA = 0.21;
const FACTOR = (1 + IVA) * (1 + IE);

export async function leerCNMC(codigoPostal = '28001') {
  // El segundo ano es el precio de verdad: sin promociones que caducan.
  // El PVPC lo devuelve a 0 porque es indexado y no tiene precio a futuro:
  // en ese caso vale el primero, que no lleva promocion ninguna.
  const imp = (o: Oferta | undefined) =>
    o ? (o.importeSegundoAnio || o.importePrimerAnio) : NaN;

  // MEDIDO: la CNMC filtra las ofertas por la potencia contratada. Sondeando a
  // 1 kW devuelve 76 ofertas y 28 marcas; a 3,45 kW devuelve 86 y 33, y aparece
  // Endesa. Por eso las sondas van todas sobre un perfil realista y solo se
  // mueve UNA magnitud cada vez: asi el conjunto de ofertas no cambia y las
  // diferencias son comparables.
  const base: Sonda = { potP1: 3.45, potP2: 3.45, cPunta: 22, cLlano: 22, cValle: 56 };
  const sondas: [string, Sonda][] = [
    ['base',   base],
    ['potP1',  { ...base, potP1: base.potP1 + 1 }],
    ['potP2',  { ...base, potP2: base.potP2 + 1 }],
    ['punta',  { ...base, cPunta: base.cPunta + 100 }],
    ['llano',  { ...base, cLlano: base.cLlano + 100 }],
    ['valle',  { ...base, cValle: base.cValle + 100 }],
  ];

  const res = new Map<string, Map<number, Oferta>>();
  for (const [nombre, s] of sondas) {
    res.set(nombre, await consultar(s, codigoPostal));
    await new Promise(r => setTimeout(r, 400)); // sin apurar a un servicio publico
  }

  const b = res.get('base')!;

  // Si una sonda devuelve otro conjunto de ofertas, las diferencias no son
  // comparables y los precios despejados no valdrian nada.
  const descuadre: string[] = [];
  for (const [nombre, m] of res) {
    if (nombre === 'base') continue;
    if (m.size !== b.size) descuadre.push(`${nombre}: ${m.size} ofertas frente a ${b.size} de la base`);
  }

  const tarifas: TarifaCNMC[] = [];

  for (const [id, o] of b) {
    const v = (k: string) => imp(res.get(k)!.get(id));
    const b0 = imp(o);
    if (![b0, v('potP1'), v('potP2'), v('punta'), v('llano'), v('valle')].every(Number.isFinite)) continue;

    // Cada sonda cambia UNA cosa; la diferencia aisla ese precio.
    const potPuntaDia = (v('potP1') - b0) / (DIAS_SONDA * FACTOR);
    const potValleDia = (v('potP2') - b0) / (DIAS_SONDA * FACTOR);
    const ePunta = (v('punta') - b0) / (100 * FACTOR);
    const eLlano = (v('llano') - b0) / (100 * FACTOR);
    const eValle = (v('valle') - b0) / (100 * FACTOR);

    tarifas.push({
      comercializadora: o.comercializadora, tarifa: o.oferta,
      potPuntaDia, potValleDia, ePunta, eLlano, eValle,
      importePrimerAnio: o.importePrimerAnio, importeSegundoAnio: o.importeSegundoAnio,
      promocion: Math.max(o.importeSegundoAnio - o.importePrimerAnio, 0),
      soloNuevosClientes: /nuevos clientes/i.test(o.validez ?? ''),
      penalizacion: o.penalizacion, verde: o.verde,
      sospechosa: false,
      _id: id,
    } as TarifaCNMC & { _id: number });
  }

  // --- Sonda de CONTROL -------------------------------------------------
  // Una consulta mas, con valores realistas que no se parecen a ninguna sonda.
  // Si los precios despejados no reproducen el importe que devuelve la CNMC, esa
  // oferta no es lineal (tramos, tarifa plana, minimos) y no vale despejarla.
  const control: Sonda = { potP1: 5.5, potP2: 4.6, cPunta: 71, cLlano: 58, cValle: 133 };
  const real = await consultar(control, codigoPostal);
  // Todo lo que no depende de potencia ni de consumo (contador, bono social,
  // descuentos fijos). Se obtiene restando de la sonda base lo que si depende.
  const parteFija = (t: TarifaCNMC & { _id: number }) =>
    imp(b.get(t._id)) - FACTOR * (
      (t.potPuntaDia * base.potP1 + t.potValleDia * base.potP2) * DIAS_SONDA +
      t.ePunta * base.cPunta + t.eLlano * base.cLlano + t.eValle * base.cValle
    );

  let cuadran = 0;
  for (const t of tarifas as (TarifaCNMC & { _id: number })[]) {
    const esperado = imp(real.get(t._id));
    if (!Number.isFinite(esperado)) { t.sospechosa = true; continue; }
    const prediccion = parteFija(t) + FACTOR * (
      (t.potPuntaDia * control.potP1 + t.potValleDia * control.potP2) * DIAS_SONDA +
      t.ePunta * control.cPunta + t.eLlano * control.cLlano + t.eValle * control.cValle
    );
    t.sospechosa = Math.abs(prediccion - esperado) > 0.15;
    if (!t.sospechosa) cuadran++;
  }

  for (const t of tarifas as any[]) delete t._id;

  return { codigoPostal, consultadas: sondas.length + 1, tarifas, cuadran, total: tarifas.length, descuadre };
}
