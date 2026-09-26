// Localiza el Excel vigente en el hilo de ForoCoches.
// La fuente de las tarifas NO es ninguna API: son JavierRR, Ivansnoke y Omadon
// mirando a mano las webs de las comercializadoras. Aqui solo recogemos su trabajo.

export const URL_HILO = 'https://forocoches.com/foro/showthread.php?t=10802238';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

export interface Hilo {
  /** El HTML del hilo, que lleva tambien la URL oficial de cada tarifa. */
  html: string;
  urlExcel: string;
  titulo: string;
  volumen: string | null;
  aviso: string | null;
}

export async function leerHilo(url = URL_HILO): Promise<Hilo> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' } });
  if (!r.ok) throw new Error(`El hilo devolvio HTTP ${r.status}`);
  const html = await r.text();

  const titulo = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() ?? '';
  const volumen = titulo.match(/VOL\.?\s+([IVXLC]+)/i)?.[1] ?? null;

  // Solo los enlaces completos: el texto visible del post los abrevia con "..."
  const enlaces = [...html.matchAll(/https:\/\/www\.dropbox\.com\/scl\/fi\/[^\s"'<>]+/g)]
    .map(m => m[0].replace(/&amp;/g, '&'))
    .filter(u => !u.includes('...') && /\.xlsx/i.test(u));

  if (!enlaces.length) {
    throw new Error('No hay ningun enlace .xlsx de Dropbox en el hilo. Puede que hayan cambiado de sitio el Excel, o que el hilo ya no sea el vigente.');
  }

  // El token st= caduca; rlkey no. Nos quedamos con rlkey y forzamos descarga directa.
  const bruto = new URL(enlaces[0]);
  const urlExcel = `${bruto.origin}${bruto.pathname}?rlkey=${bruto.searchParams.get('rlkey')}&dl=1`;

  // El hilo se renueva por volumenes: cuando abren el siguiente, este se queda congelado.
  let aviso: string | null = null;
  if (/cerrado|closed/i.test(titulo)) aviso = 'El hilo parece cerrado.';

  return { html, urlExcel, titulo, volumen, aviso };
}
