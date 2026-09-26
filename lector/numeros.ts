/**
 * Numeros en formato espanol tal y como vienen en las facturas:
 * "6,9"  "1.176,50"  "0,08621400"  "113,25"
 * El punto es separador de millares y la coma es el decimal.
 */
export function aNumero(s: string | null | undefined): number | null {
  if (!s) return null;
  const limpio = s.trim().replace(/\s/g, '');
  // Si hay coma, manda la coma: los puntos son millares.
  const normal = limpio.includes(',')
    ? limpio.replace(/\./g, '').replace(',', '.')
    : limpio;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** Fechas dd/mm/aaaa o aaaa-mm-dd. */
export function aFecha(s: string | null | undefined): Date | null {
  if (!s) return null;
  let m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

/** Dias entre dos fechas, como los cuenta una factura (ambos extremos). */
export function diasEntre(desde: Date, hasta: Date): number {
  return Math.round((hasta.getTime() - desde.getTime()) / 86_400_000);
}
