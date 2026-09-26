/**
 * Motor de calculo de la factura.
 *
 * Reimplementa la cadena de formulas del Excel "Yo pago menos de luz" de la
 * Plataforma de ForoCoches (filas 28 a 59 de la hoja Comparador).
 *
 * Se usa en dos sitios:
 *  - en la app, para calcular en el movil sin depender de nada
 *  - en el actualizador, que cada semana cruza este resultado contra el que da
 *    LibreOffice recalculando el Excel de verdad, y avisa si divergen.
 *
 * Todo en euros SIN impuestos hasta la fila 54, igual que el Excel: el hilo
 * trabaja siempre sin impuestos porque las companias publican mal los precios
 * con impuestos (post 3).
 */

/** Los cuatro tipos de compensacion de excedentes, en el orden de A70:A73. */
export const TIPOS_COMPENSACION = ['nocomp', 'legal', 'energía', 'zerofactura'] as const;
export type TipoCompensacion = (typeof TIPOS_COMPENSACION)[number];

export interface Consumo {
  dias: number;
  potP1: number;
  potP2: number;
  cPunta: number;
  cLlano: number;
  cValle: number;
  excedentes: number;
}

export interface Constantes {
  finbonsoc: number;
  IEact: number;
  contadordia: number;
  IVAact: number;
  peajeE1: number;
  peajeE2: number;
  peajeE3: number;
}

export interface TarifaCalculable {
  comercializadora: string;
  tarifa: string;
  potPuntaDia: number | null;
  potValleDia: number | null;
  ePunta: number | null;
  eLlano: number | null;
  eValle: number | null;
  excedentes: number | null;
  tipoCompensacion: string | null;
  bateriaVirtual: number | null;
  /** Descuento promocional en €/dia, sacado de la formula de la fila 56. */
  descuentoDia?: number | null;
  /** Meses que mantiene el precio. Si son <11, la tarifa no cubre periodos mas largos. */
  mantenimientoMeses?: string | null;
}

export interface Desglose {
  potenciaP1: number;
  potenciaP2: number;
  subtotalPotencia: number;
  energiaPunta: number;
  energiaLlano: number;
  energiaValle: number;
  energiaBruta: number;
  peajesEnergia: number;
  valorExcedentes: number;
  subtotalEnergia: number;
  excedenteSobrante: number;
  bonoSocial: number;
  impuestoElectrico: number;
  alquilerContador: number;
  costeBateriaVirtual: number;
  descuento: number;
  totalBruto: number;
  iva: number;
  total: number | null;
  /** Rellenado cuando la tarifa no sirve para este periodo. */
  noAplica: string | null;
}

const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function calcular(t: TarifaCalculable, c: Consumo, k: Constantes): Desglose {
  const consumoTotal = c.cPunta + c.cLlano + c.cValle;

  // Fila 28 y 29. Ojo: si el usuario no tiene potencia valle, el Excel usa la punta.
  const potenciaP1 = n(t.potPuntaDia) * c.potP1 * c.dias;
  const potenciaP2 = n(t.potValleDia) * (c.potP2 === 0 ? c.potP1 : c.potP2) * c.dias;
  const subtotalPotencia = potenciaP1 + potenciaP2;

  // Filas 31 a 33 y 36.
  const energiaPunta = n(t.ePunta) * c.cPunta;
  const energiaLlano = n(t.eLlano) * c.cLlano;
  const energiaValle = n(t.eValle) * c.cValle;
  const energiaBruta = energiaPunta + energiaLlano + energiaValle;

  // Fila 37: los peajes son iguales para todas, los fija el BOE.
  const peajesEnergia = c.cPunta * k.peajeE1 + c.cLlano * k.peajeE2 + c.cValle * k.peajeE3;

  // Fila 35: lo que te pagan por los excedentes vertidos.
  const valorExcedentes = c.excedentes * n(t.excedentes);

  // Fila 45: cuanto de esos excedentes puede descontarse, segun el tipo de compensacion.
  //  nocomp      no descuenta nada
  //  legal       descuenta, pero nunca por debajo de los peajes (los peajes se pagan igual)
  //  energía     puede dejar la energia a 0 €
  //  zerofactura puede dejar la energia a 0 € y el sobrante sigue contando en la fila 59
  const tipo = (t.tipoCompensacion ?? 'nocomp').trim().toLowerCase();
  let subtotalEnergia: number;
  switch (tipo) {
    case 'legal':       subtotalEnergia = Math.max(energiaBruta - valorExcedentes, peajesEnergia); break;
    case 'energía':
    case 'energia':
    case 'zerofactura': subtotalEnergia = Math.max(energiaBruta - valorExcedentes, 0); break;
    default:            subtotalEnergia = energiaBruta; break;
  }

  // Fila 46: excedente que sobra despues de dejar la energia a cero.
  const excedenteSobrante = Math.max(valorExcedentes - subtotalEnergia - energiaBruta, 0);

  // Filas 49 a 52.
  const bonoSocial = k.finbonsoc * c.dias;
  const impuestoElectrico = Math.max(consumoTotal * 0.001, (subtotalPotencia + subtotalEnergia + bonoSocial) * k.IEact);
  const alquilerContador = k.contadordia * c.dias;
  // La bateria virtual solo se cobra si de verdad hay excedentes (fila 53).
  const costeBateriaVirtual = t.bateriaVirtual != null && c.excedentes > 0 ? c.dias * t.bateriaVirtual : 0;

  // Filas 53, 54 y 56.
  const totalBruto = subtotalPotencia + subtotalEnergia + bonoSocial + impuestoElectrico + alquilerContador + costeBateriaVirtual;
  const iva = totalBruto * k.IVAact;
  const descuento = n(t.descuentoDia) * c.dias;
  const provisional = totalBruto + iva - descuento;

  // Fila 59: una tarifa que solo mantiene precio N meses no vale para un periodo mas largo.
  const meses = Number(t.mantenimientoMeses);
  const noAplica = Number.isFinite(meses) && meses < 11 && c.dias > meses * 31
    ? `Solo mantiene precio ${meses} meses`
    : null;

  const total = noAplica ? null
    : tipo === 'zerofactura' ? Math.max(provisional - excedenteSobrante, 0)
    : provisional;

  return {
    potenciaP1, potenciaP2, subtotalPotencia,
    energiaPunta, energiaLlano, energiaValle, energiaBruta,
    peajesEnergia, valorExcedentes, subtotalEnergia, excedenteSobrante,
    bonoSocial, impuestoElectrico, alquilerContador, costeBateriaVirtual,
    descuento, totalBruto, iva, total, noAplica,
  };
}

// ---------------------------------------------------------------------------
// Ofertas de la CNMC
//
// Vienen con los precios ya despejados del comparador oficial (ver
// actualizador/src/cnmc.ts). Su modelo es distinto al del Excel: en vez de
// reconstruir la factura concepto a concepto, traen la parte fija por dia y la
// constante ya calculadas, con impuestos incluidos.
//
// NO modelan excedentes de autoconsumo: se comparan como si no hubiera placas.
// Para excedentes vale el Excel.
// ---------------------------------------------------------------------------

/** El margen de potencia y energia arrastra impuesto electrico e IVA. */
export const FACTOR_IMPUESTOS = (1 + 0.21) * (1 + 0.0511269632);

export interface PreciosCNMC {
  potPuntaDia: number; potValleDia: number;
  ePunta: number; eLlano: number; eValle: number;
  fijoDia: number; constante: number;
}

export function costeCNMC(p: PreciosCNMC, c: Consumo): number {
  return p.constante
    + p.fijoDia * c.dias
    + FACTOR_IMPUESTOS * (
      (p.potPuntaDia * c.potP1 + p.potValleDia * c.potP2) * c.dias
      + p.ePunta * c.cPunta + p.eLlano * c.cLlano + p.eValle * c.cValle
    );
}

export interface OfertaCNMC {
  comercializadora: string; tarifa: string;
  primerAnio: PreciosCNMC; segundoAnio: PreciosCNMC;
  tienePromocion: boolean; soloNuevosClientes: boolean; penalizacion: boolean; verde: boolean;
}

export interface ResultadoCNMC extends OfertaCNMC {
  costePrimerAnio: number; costeSegundoAnio: number; subida: number; puesto: number;
}

/**
 * Ordena las ofertas de la CNMC. `por` decide que precio manda:
 * 'segundo' es el honesto (lo que se paga cuando caduca la promocion).
 */
export function rankingCNMC(ofertas: OfertaCNMC[], c: Consumo, por: 'primero' | 'segundo' = 'segundo'): ResultadoCNMC[] {
  const res = ofertas.map(o => {
    const costePrimerAnio = costeCNMC(o.primerAnio, c);
    const costeSegundoAnio = costeCNMC(o.segundoAnio, c);
    return { ...o, costePrimerAnio, costeSegundoAnio, subida: costeSegundoAnio - costePrimerAnio, puesto: 0 };
  }).filter(r => Number.isFinite(r.costeSegundoAnio) && r.costeSegundoAnio > 0);

  res.sort((a, b) => (por === 'primero' ? a.costePrimerAnio - b.costePrimerAnio : a.costeSegundoAnio - b.costeSegundoAnio));
  res.forEach((r, i) => { r.puesto = i + 1; });
  return res;
}

export interface Resultado extends Desglose {
  comercializadora: string;
  tarifa: string;
  puesto: number;
  diferencia: number;
}

/** Calcula todas las tarifas y las devuelve ordenadas de mas barata a mas cara. */
export function ranking(tarifas: TarifaCalculable[], c: Consumo, k: Constantes): Resultado[] {
  const res = tarifas
    .map(t => ({ ...calcular(t, c, k), comercializadora: t.comercializadora, tarifa: t.tarifa, puesto: 0, diferencia: 0 }))
    .filter(r => r.total != null)
    .sort((a, b) => a.total! - b.total!);

  const mejor = res[0]?.total ?? 0;
  res.forEach((r, i) => { r.puesto = i + 1; r.diferencia = r.total! - mejor; });
  return res;
}
