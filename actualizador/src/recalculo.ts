import { unzipSync, zipSync } from 'fflate';

/**
 * Vacia los valores cacheados de las celdas con formula de un .xlsx.
 *
 * Por que hace falta:
 * el Excel de la Plataforma no lo guarda Excel, lo guarda Google Sheets. Las celdas
 * con formula quedan como <c t="str"><f>..</f><v>31.44 €</v></c>: el valor cacheado
 * es la CADENA YA FORMATEADA, no el numero. Y LibreOffice, al convertir, respeta ese
 * cache y no recalcula nada, asi que leerlo da "31.44 €" en vez de 31.44.
 *
 * Vaciando los <v> de las celdas que tienen <f>, LibreOffice no tiene valor que
 * respetar y se ve obligado a calcular. Medido: con esto salen numeros de verdad.
 */
export function vaciarCache(xlsx: Uint8Array): Uint8Array {
  const zip = unzipSync(xlsx);
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let tocadas = 0;

  for (const ruta of Object.keys(zip)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(ruta)) continue;
    const xml = dec.decode(zip[ruta]);

    const nuevo = xml.replace(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g, bloque => {
      if (!bloque.includes('<f')) return bloque;
      tocadas++;
      return bloque
        .replace(/<v>[\s\S]*?<\/v>/g, '')   // fuera el resultado cacheado
        .replace(/\st="(?:str|e)"/g, '');    // y fuera el "esto es texto"
    });

    zip[ruta] = enc.encode(nuevo);
  }

  if (!tocadas) throw new Error('No se encontro ninguna celda con formula: el .xlsx no tiene la forma esperada.');
  return zipSync(zip);
}
