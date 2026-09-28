import { aNumero, aFecha, diasEntre } from './numeros.ts';

/**
 * Lector del texto de la factura, para las que no traen QR (2 de cada 3 en la
 * muestra). Cada compania maqueta a su manera, asi que se prueban varios
 * patrones por campo y se anota CUAL acerto, para poder auditar despues por que
 * salio un numero.
 */

export interface Campo<T> { valor: T; patron: string; }
export interface Lectura {
  dias: Campo<number> | null;
  potP1: Campo<number> | null;
  potP2: Campo<number> | null;
  cPunta: Campo<number> | null;
  cLlano: Campo<number> | null;
  cValle: Campo<number> | null;
  excedentes: Campo<number> | null;
  precioExcedente: Campo<number> | null;
  totalFactura: Campo<number> | null;
  avisos: string[];
}

const N = String.raw`([\d.]+,?\d*)`;

/** Prueba patrones en orden y devuelve el primero que da un numero valido. */
function buscar(txt: string, patrones: [string, RegExp][]): Campo<number> | null {
  for (const [nombre, re] of patrones) {
    const m = txt.match(re);
    if (!m) continue;
    const v = aNumero(m[1]);
    if (v !== null) return { valor: v, patron: nombre };
  }
  return null;
}

export function leerTexto(txt: string): Lectura {
  const avisos: string[] = [];

  // --- Dias -------------------------------------------------------------
  // El "x NN Dias" del detalle es mas fiable que la cabecera: en la Nufri la
  // cabecera dice 31/03 y el detalle 35 dias, que es lo que coincide con el QR.
  // El bono social y el alquiler del contador van PRIMERO porque se facturan una
  // sola vez por el periodo entero. El "x NN Dias" del detalle va despues: cuando
  // la compania parte el periodo porque cambio de precios a mitad (Iberdrola lo
  // hace), ese patron devuelve solo el primer tramo. Medido: 25 en vez de 31.
  let dias = buscar(txt, [
    ['bono social "NN dias"', new RegExp(String.raw`[Bb]ono\s+social[^\n]*?(\d{1,3})\s*d[ií]as`)],
    ['contador "NN dias"', new RegExp(String.raw`[Aa]lquiler[^\n]*?(\d{1,3})\s*d[ií]as`)],
    ['detalle "x NN Dias"', new RegExp(String.raw`x\s*(\d{1,3})\s*[Dd][ií]as`)],
  ]);

  // Si el detalle esta partido en tramos, los tramos tienen que sumar el periodo.
  if (dias) {
    const tramos = [...txt.matchAll(new RegExp(String.raw`x\s*(\d{1,3})\s*[Dd][ií]as`, 'g'))].map(m => Number(m[1]));
    const distintos = [...new Set(tramos)];
    if (distintos.length > 1) {
      const suma = distintos.reduce((a, b) => a + b, 0);
      if (suma !== dias.valor) {
        avisos.push(`La factura parte el periodo en tramos (${distintos.join(' + ')} dias) y no suman los ${dias.valor} dias facturados. Comprueba los dias.`);
      }
    }
  }
  if (!dias) {
    const per = txt.match(new RegExp(String.raw`(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–a]\s*(\d{1,2}\/\d{1,2}\/\d{4})`));
    const d1 = aFecha(per?.[1]), d2 = aFecha(per?.[2]);
    if (d1 && d2) {
      dias = { valor: diasEntre(d1, d2), patron: 'fechas del periodo' };
      avisos.push('Los dias salen de las fechas del periodo; puede haber un dia de diferencia con lo que factura la compania.');
    }
  }

  // --- Potencias --------------------------------------------------------
  // Ojo: Nufri llama P3 a la valle, no P2.
  //
  // Y ojo con el (?!h): sin el, "P2 10 kWh" —que es un CONSUMO— casa como 10 kW
  // de potencia, porque kW es prefijo de kWh. Medido sobre una factura de Nufri
  // leida en el navegador: daba 10 kW de potencia valle en vez de 3,45. En Node
  // no salia porque ahi el QR gana y nadie llegaba a mirar el texto.
  const kW = String.raw`\s*kW(?!h)`;
  const potP1 = buscar(txt, [
    ['"Potencia punta: N kW"', new RegExp(String.raw`Potencia\s+punta\s*:?\s*${N}${kW}`, 'i')],
    ['"P1 N kW"', new RegExp(String.raw`\bP1\s+${N}${kW}`)],
  ]);
  const potP2 = buscar(txt, [
    ['"Potencia valle: N kW"', new RegExp(String.raw`Potencia\s+valle\s*:?\s*${N}${kW}`, 'i')],
    ['"P2 N kW"', new RegExp(String.raw`\bP2\s+${N}${kW}`)],
    ['"P3 N kW" (Nufri)', new RegExp(String.raw`\bP3\s+${N}${kW}`)],
  ]);

  // --- Consumos por periodo --------------------------------------------
  // TRAMPA: Iberdrola trae DOS juegos. El bueno es el resumen "Punta: N kWh".
  // El otro ("Sus consumos desagregados han sido punta: ...") es la lectura
  // estimada del contador y difiere: 203,06 frente a 226,73 en una factura real.
  const cPunta = buscar(txt, [
    ['resumen "Punta: N kWh"', new RegExp(String.raw`(?<!desagregados[^\n]{0,80})\bPunta:\s*${N}\s*kWh`)],
    ['detalle "P1 N kWh x"', new RegExp(String.raw`\bP1\s+${N}\s*kWh\s*x`)],
  ]);
  const cLlano = buscar(txt, [
    ['resumen "Llano: N kWh"', new RegExp(String.raw`(?<!desagregados[^\n]{0,80})\bLlano:\s*${N}\s*kWh`)],
    ['detalle "P2 N kWh x"', new RegExp(String.raw`\bP2\s+${N}\s*kWh\s*x`)],
  ]);
  const cValle = buscar(txt, [
    ['resumen "Valle: N kWh"', new RegExp(String.raw`(?<!desagregados[^\n]{0,80})\bValle:?\s*${N}\s*kWh`)],
    ['detalle "P3 N kWh x"', new RegExp(String.raw`\bP3\s+${N}\s*kWh\s*x`)],
  ]);

  // --- Excedentes de autoconsumo ---------------------------------------
  const excedentes = buscar(txt, [
    ['"exportada a la red"', new RegExp(String.raw`exportada\s+a\s+la\s+red\s*${N}\s*kWh`, 'i')],
    ['"energia vertida"', new RegExp(String.raw`vertida[^\n]{0,30}?${N}\s*kWh`, 'i')],
    ['"excedentes"', new RegExp(String.raw`excedentes[^\n]{0,40}?${N}\s*kWh`, 'i')],
  ]);

  // Precio al que te compensan el excedente, si la factura lo dice.
  // Iberdrola lo imprime: "Compensacion de excedentes -264,44 kWh x 0,08 €/kWh".
  const precioExcedente = buscar(txt, [
    ['"N kWh x N €/kWh" de compensacion', new RegExp(String.raw`[Cc]ompensaci[óo]n\s+de\s+excedentes[^\n]*?kWh\s*x\s*${N}\s*€\s*\/\s*kWh`)],
  ]);

  const totalFactura = buscar(txt, [
    ['"TOTAL IMPORTE FACTURA"', new RegExp(String.raw`TOTAL\s+IMPORTE\s+FACTURA\s*${N}\s*€`, 'i')],
    ['"Total Factura"', new RegExp(String.raw`Total\s+Factura\s*:?\s*${N}\s*€`, 'i')],
    ['"IMPORTE TOTAL"', new RegExp(String.raw`IMPORTE\s+TOTAL\s*:?\s*${N}\s*€`, 'i')],
  ]);

  // Coherencia: si hay un total de consumo declarado, que cuadre con la suma.
  const declarado = aNumero(txt.match(new RegExp(String.raw`Total(?:\s+consumo)?\s*(?:\(kWh\))?\s*:?\s*${N}\s*kWh`, 'i'))?.[1]
    ?? txt.match(new RegExp(String.raw`Total:\s*${N}\s*kWh`))?.[1] ?? null);
  const suma = (cPunta?.valor ?? 0) + (cLlano?.valor ?? 0) + (cValle?.valor ?? 0);
  if (declarado !== null && suma > 0 && Math.abs(declarado - suma) > 1) {
    avisos.push(`La suma de los periodos (${suma.toFixed(2)} kWh) no cuadra con el total declarado (${declarado.toFixed(2)} kWh). Revisa los consumos antes de fiarte del resultado.`);
  }

  for (const [nombre, c] of Object.entries({ dias, potP1, potP2, cPunta, cLlano, cValle })) {
    if (!c) avisos.push(`No he sabido leer: ${nombre}. Hay que meterlo a mano.`);
  }

  return { dias, potP1, potP2, cPunta, cLlano, cValle, excedentes, precioExcedente, totalFactura, avisos };
}
