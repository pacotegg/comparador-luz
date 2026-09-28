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
  /** Solo lo rellenan las tarifas de un periodo, que no desglosan punta/llano/valle. */
  consumoTotal: Campo<number> | null;
  precioExcedente: Campo<number> | null;
  totalFactura: Campo<number> | null;
  avisos: string[];
}

const N = String.raw`([\d.]+,?\d*)`;

/**
 * Prueba patrones en orden y devuelve el primero que da un numero PLAUSIBLE.
 *
 * Lo de plausible no es adorno: una lamina didactica que explica las partes de
 * una factura trae "Alquiler equipos de medida: 00 dias x 000 €/dia", y de ahi
 * salia `dias = 0`. Un cero se cuela como dato bueno y revienta el calculo, que
 * es peor que no leer nada: al menos un null se ve y se rellena a mano.
 *
 * Si una coincidencia no es plausible se sigue buscando dentro del mismo
 * patron, que a veces la buena esta mas adelante.
 */
function buscar(txt: string, patrones: [string, RegExp][], plausible?: (v: number) => boolean): Campo<number> | null {
  for (const [nombre, re] of patrones) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of txt.matchAll(global)) {
      const v = aNumero(m[1]);
      if (v === null) continue;
      if (plausible && !plausible(v)) continue;
      return { valor: v, patron: nombre };
    }
  }
  return null;
}

/** Rangos con los que se descarta una lectura absurda. */
const ES_DIAS = (v: number) => v >= 1 && v <= 400;
const ES_POTENCIA = (v: number) => v > 0 && v <= 100;
const ES_CONSUMO = (v: number) => v >= 0 && v <= 200_000;

/**
 * Recorta el texto a la parte de ELECTRICIDAD cuando la factura trae tambien gas.
 *
 * Medido sobre una factura de Naturgy (28/09/2026): la seccion de gas va primero
 * y tiene sus propios dias y su propio "Alquiler de contador". Sin recortar, el
 * lector devolvia 125 dias —los del gas— en vez de los 30 de la luz. Y sin
 * avisar de nada, que es lo peor: un numero plausible y equivocado multiplica la
 * factura por cuatro.
 */
function soloElectricidad(txt: string): { texto: string; recortado: boolean } {
  const inicio = txt.search(/consumo\s+electricidad|tarifa\s+por\s+uso\s+luz|detalle\s+de\s+la\s+factura\s+de\s+electricidad/i);
  const hayGas = /total\s+gas|consumo\s+gas|tarifa\s+\w*\s*gas/i.test(txt);
  if (inicio < 0 || !hayGas) return { texto: txt, recortado: false };

  const resto = txt.slice(inicio);
  const fin = resto.search(/base\s+imponible|total\s+a\s+pagar/i);
  return { texto: fin > 0 ? resto.slice(0, fin) : resto, recortado: true };
}

export function leerTexto(textoCompleto: string): Lectura {
  const avisos: string[] = [];
  const { texto: txt, recortado } = soloElectricidad(textoCompleto);
  if (recortado) {
    avisos.push('Es una factura de gas y electricidad: solo se han leido los datos de la parte electrica.');
  }

  // --- Dias -------------------------------------------------------------
  // El "x NN Dias" del detalle es mas fiable que la cabecera: en la Nufri la
  // cabecera dice 31/03 y el detalle 35 dias, que es lo que coincide con el QR.
  // El bono social y el alquiler del contador van PRIMERO porque se facturan una
  // sola vez por el periodo entero. El "x NN Dias" del detalle va despues: cuando
  // la compania parte el periodo porque cambio de precios a mitad (Iberdrola lo
  // hace), ese patron devuelve solo el primer tramo. Medido: 25 en vez de 31.
  // "(32 dias)" del periodo de facturacion (Endesa) es lo mas explicito que hay:
  // lo dice la propia compania y no depende de ninguna linea del detalle.
  //
  // Y los dias pueden venir con decimales: Naturgy escribe "30,00 dias" en la
  // linea del bono social, asi que el numero no puede ser solo digitos.
  let dias = buscar(txt, [
    ['"(NN dias)" del periodo', new RegExp(String.raw`\(\s*(\d{1,3})\s*d[ií]as\s*\)`, 'i')],
    ['bono social "NN dias"', new RegExp(String.raw`[Bb]ono\s+[Ss]ocial[^\n]*?${N}\s*d[ií]as`)],
    ['contador "NN dias"', new RegExp(String.raw`[Aa]lquiler[^\n]*?${N}\s*d[ií]as`)],
    ['detalle "x NN Dias"', new RegExp(String.raw`x\s*(\d{1,3})\s*[Dd][ií]as`)],
    ['"NN dias" del contrato', new RegExp(String.raw`[Cc]ontrato\s*:?\s*(\d{1,3})\s*d[ií]as`)],
  ], ES_DIAS);

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
    // Endesa: "Potencias contratadas: punta 3,450 kW; valle 3,450 kW"
    ['"contratadas: punta N kW" (Endesa)', new RegExp(String.raw`contratadas\s*:?\s*punta\s*${N}${kW}`, 'i')],
    ['"Pot.Punta N kW" (Endesa)', new RegExp(String.raw`Pot\.?\s*Punta\s+${N}${kW}`, 'i')],
    // Naturgy: "Termino de potencia P1 (4,400 kW)" — el kW va DENTRO del parentesis
    ['"potencia P1 (N kW)" (Naturgy)', new RegExp(String.raw`potencia\s+P1\s*\(\s*${N}${kW}`, 'i')],
    ['"P1 N kW"', new RegExp(String.raw`\bP1\s+${N}${kW}`)],
  ], ES_POTENCIA);
  const potP2 = buscar(txt, [
    ['"Potencia valle: N kW"', new RegExp(String.raw`Potencia\s+valle\s*:?\s*${N}${kW}`, 'i')],
    ['"; valle N kW" (Endesa)', new RegExp(String.raw`contratadas[^\n]*?valle\s*${N}${kW}`, 'i')],
    ['"Pot.Valle N kW" (Endesa)', new RegExp(String.raw`Pot\.?\s*Valle\s+${N}${kW}`, 'i')],
    ['"potencia P2 (N kW)" (Naturgy)', new RegExp(String.raw`potencia\s+P2\s*\(\s*${N}${kW}`, 'i')],
    ['"P2 N kW"', new RegExp(String.raw`\bP2\s+${N}${kW}`)],
    ['"P3 N kW" (Nufri)', new RegExp(String.raw`\bP3\s+${N}${kW}`)],
  ], ES_POTENCIA);

  // --- Consumos por periodo --------------------------------------------
  // TRAMPA: Iberdrola trae DOS juegos. El bueno es el resumen "Punta: N kWh".
  // El otro ("Sus consumos desagregados han sido punta: ...") es la lectura
  // estimada del contador y difiere: 203,06 frente a 226,73 en una factura real.
  //
  // Endesa no pone los periodos en el detalle —su tarifa Tempo Happy factura por
  // "horas Happy", "promocion" y "resto"— pero si trae la tabla de peajes y
  // cargos, que es la de verdad: "Punta 13.437 13.557 1 0 120", donde el ultimo
  // numero es el consumo. Es lo unico de esa factura que sirve para comparar.
  const tablaATR = (periodo: string) =>
    new RegExp(String.raw`\b${periodo}\s+[\d.,]+\s+[\d.,]+\s+\d+\s+\d+\s+${N}`, 'i');

  const cPunta = buscar(txt, [
    ['resumen "Punta: N kWh"', new RegExp(String.raw`(?<!desagregados[^\n]{0,80})\bPunta:\s*${N}\s*kWh`)],
    ['detalle "P1 N kWh x"', new RegExp(String.raw`\bP1\s+${N}\s*kWh\s*x`)],
    ['tabla de peajes (Endesa)', tablaATR('Punta')],
  ], ES_CONSUMO);
  const cLlano = buscar(txt, [
    ['resumen "Llano: N kWh"', new RegExp(String.raw`(?<!desagregados[^\n]{0,80})\bLlano:\s*${N}\s*kWh`)],
    ['detalle "P2 N kWh x"', new RegExp(String.raw`\bP2\s+${N}\s*kWh\s*x`)],
    ['tabla de peajes (Endesa)', tablaATR('Llano')],
  ], ES_CONSUMO);
  const cValle = buscar(txt, [
    ['resumen "Valle: N kWh"', new RegExp(String.raw`(?<!desagregados[^\n]{0,80})\bValle:?\s*${N}\s*kWh`)],
    ['detalle "P3 N kWh x"', new RegExp(String.raw`\bP3\s+${N}\s*kWh\s*x`)],
    ['tabla de peajes (Endesa)', tablaATR('Valle')],
  ], ES_CONSUMO);

  // Consumo total, para las tarifas de un solo periodo que no desglosan nada
  // (Naturgy Por Uso Luz: "Consumo electricidad 64 kWh"). Sin el reparto, la app
  // no puede comparar: hay que ofrecerle al usuario uno de los repartos por
  // defecto del post #3.
  const consumoTotal = buscar(txt, [
    ['"Consumo electricidad N kWh"', new RegExp(String.raw`Consumo\s+electricidad\s+${N}\s*kWh`, 'i')],
    ['"Consumo total N kWh"', new RegExp(String.raw`Consumo\s+total\s+${N}\s*kWh`, 'i')],
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

  return { dias, potP1, potP2, cPunta, cLlano, cValle, excedentes, consumoTotal, precioExcedente, totalFactura, avisos };
}
