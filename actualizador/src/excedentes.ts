/**
 * Precio de compensacion de excedentes, sacado de las webs de las propias
 * comercializadoras.
 *
 * Por que hace falta: el comparador de la CNMC no modela excedentes (medido:
 * mandarle exc=0 o exc=150 devuelve importes identicos, y 0 de sus 86 ofertas
 * vienen marcadas como de autoconsumo). El Excel de la Plataforma si los tiene,
 * pero solo para sus 17 tarifas y es un dataset curado por terceros.
 *
 * El precio publicado por una comercializadora es un hecho publico: no es de
 * nadie. Eso es lo que se busca aqui, en la fuente original.
 *
 * REGLA: lo que no se encuentre queda como `null`. Nunca se rellena con una
 * estimacion. Cada dato guarda de que URL salio y con que texto, para poder
 * comprobarlo despues.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

export interface Hallazgo {
  comercializadora: string;
  precio: number | null;
  url: string | null;
  /** El texto exacto del que se saco el numero, para poder auditarlo. */
  evidencia: string | null;
  estado: 'encontrado' | 'sin precio' | 'bloqueado' | 'error';
  paginasMiradas: number;
}

/** Patrones de compensacion. El precio puede ir antes o despues de la palabra. */
const PATRONES: RegExp[] = [
  /(?:excedente|compensaci[oó]n|vertid)\w*[^.;]{0,140}?([0-9]{1,2}[.,][0-9]{2,6})\s*(?:€|eur)\s*\/?\s*kwh/gi,
  /([0-9]{1,2}[.,][0-9]{2,6})\s*(?:€|eur)\s*\/?\s*kwh[^.;]{0,80}?(?:excedente|compensaci[oó]n|vertid)\w*/gi,
  /(?:excedente|compensaci[oó]n)\w*[^.;]{0,140}?([0-9]{1,2}[.,][0-9]{2,6})\s*(?:€|euros?)/gi,
];

function aNumero(s: string): number | null {
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  // Un precio de compensacion razonable. Fuera de esto es que hemos pillado otra cosa.
  return Number.isFinite(n) && n > 0.001 && n < 0.5 ? n : null;
}

function limpiar(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ');
}

function buscarPrecio(texto: string): { precio: number; evidencia: string } | null {
  for (const re of PATRONES) {
    re.lastIndex = 0;
    for (const m of texto.matchAll(re)) {
      const precio = aNumero(m[1]);
      if (precio !== null) return { precio, evidencia: m[0].slice(0, 160).trim() };
    }
  }
  return null;
}

/** Enlaces que suelen esconder el dato cuando no esta en la portada. */
const PISTAS = /condicion|legal|precio|tarifa|autoconsumo|excedente|solar|contrat|fichas?|informacion/i;

function enlaces(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    const href = m[1];
    if (!PISTAS.test(href)) continue;
    try {
      const u = new URL(href, base);
      if (u.origin !== new URL(base).origin) continue;   // solo dentro del mismo sitio
      if (u.pathname === new URL(base).pathname) continue;
      out.add(u.href);
    } catch { /* href basura */ }
  }
  return [...out];
}

async function traer(url: string): Promise<{ texto: string; html: string; status: number }> {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9', Accept: 'text/html,application/xhtml+xml,application/pdf,*/*' },
    redirect: 'follow',
  });
  const tipo = r.headers.get('content-type') ?? '';
  if (tipo.includes('pdf')) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await getDocument({ data: new Uint8Array(await r.arrayBuffer()), useSystemFonts: true }).promise;
    let t = '';
    for (let p = 1; p <= Math.min(doc.numPages, 12); p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      t += (tc.items as any[]).map(i => i.str).join(' ') + ' ';
    }
    await doc.destroy();
    return { texto: t.replace(/\s+/g, ' '), html: '', status: r.status };
  }
  const html = await r.text();
  return { texto: limpiar(html), html, status: r.status };
}

/** Busca el precio en una web, siguiendo hasta `maxPaginas` enlaces internos. */
export async function buscarEn(comercializadora: string, inicio: string, maxPaginas = 6): Promise<Hallazgo> {
  const vistas = new Set<string>();
  const cola = [inicio];
  let status0 = 0;

  while (cola.length && vistas.size < maxPaginas) {
    const url = cola.shift()!;
    if (vistas.has(url)) continue;
    vistas.add(url);

    let r;
    try { r = await traer(url); }
    catch { continue; }
    if (!status0) status0 = r.status;
    if (r.status >= 400) continue;

    const hallado = buscarPrecio(r.texto);
    if (hallado) {
      return { comercializadora, precio: hallado.precio, url, evidencia: hallado.evidencia, estado: 'encontrado', paginasMiradas: vistas.size };
    }
    if (r.html && cola.length + vistas.size < maxPaginas) {
      for (const e of enlaces(r.html, url)) if (!vistas.has(e)) cola.push(e);
    }
    await new Promise(x => setTimeout(x, 300)); // sin machacar a nadie
  }

  return {
    comercializadora, precio: null, url: null, evidencia: null,
    estado: status0 === 403 || status0 === 429 ? 'bloqueado' : status0 ? 'sin precio' : 'error',
    paginasMiradas: vistas.size,
  };
}

// ---------------------------------------------------------------------------
// Contraste contra el Excel
//
// No sustituye al Excel: lo vigila. Cada semana comprueba lo que dice la web de
// la comercializadora y avisa cuando no cuadra con lo que tiene el Excel.
//
// Por que no sirve como fuente: la compensacion es un atributo de la TARIFA, no
// de la comercializadora, y una misma web lista varias. Medido: esluz.es anuncia
// "excedentes a 0,10 EUR/kWh" mientras que la tarifa que recoge el Excel no
// compensa. El numero era real; era de otro producto. Por eso esto avisa, no
// corrige.
// ---------------------------------------------------------------------------

/** Dominio oficial de cada comercializadora del Excel. */
const DOMINIOS: Record<string, string> = {
  'CHC': 'chcenergia.es',
  'ENERGIA NUFRI': 'energianufri.com',
  'GANA ENERGÍA': 'ganaenergia.com',
  'ESLUZ': 'esluz.es',
  'IMAGINA': 'imaginaenergia.com',
  'NIBA': 'niba.es',
  'Iberdrola': 'iberdrola.es',
  'Naturgy': 'naturgy.es',
  'Endesa': 'endesa.com',
  'REPSOL': 'repsol.es',
  'Total Energies': 'totalenergies.es',
};

const IMAGENES = /postimg|ibb\.co|imgur|imgbb|\.(png|jpe?g|gif|webp|css|js)(\?|$)/i;

/**
 * Saca del hilo la URL oficial de cada tarifa. Vienen del mismo sitio que el
 * Excel, asi que si la Plataforma cambia un enlace, esto lo sigue solo.
 */
export function urlsDelHilo(htmlHilo: string): string[] {
  return [...new Set([...htmlHilo.matchAll(/href=["']([^"'#]+)/gi)].map(m => m[1]))]
    .filter(u => /^https?:/i.test(u) && !IMAGENES.test(u) && !/forocoches/i.test(u));
}

/** Elige la URL que mejor encaja con una tarifa concreta. */
function urlDe(comercializadora: string, tarifa: string, urls: string[]): string | null {
  const dom = DOMINIOS[comercializadora];
  if (!dom) return null;
  const candidatas = urls.filter(u => u.includes(dom));
  if (!candidatas.length) return null;
  if (candidatas.length === 1) return candidatas[0];

  // Varias del mismo dominio (Gana tiene dos): gana la que comparte palabras
  // con el nombre de la tarifa.
  const palabras = tarifa.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{3,}/g) ?? [];
  let mejor = candidatas[0], puntos = -1;
  for (const u of candidatas) {
    const p = palabras.filter(w => u.toLowerCase().includes(w)).length;
    if (p > puntos) { puntos = p; mejor = u; }
  }
  return mejor;
}

export interface Contraste extends Hallazgo {
  tarifa: string;
  excel: number | null;
  cuadra: boolean | null;
}

export async function contrastarExcedentes(
  tarifas: { comercializadora: string; tarifa: string; excedentes: number | null }[],
  htmlHilo: string,
): Promise<Contraste[]> {
  const urls = urlsDelHilo(htmlHilo);
  const salida: Contraste[] = [];

  for (const t of tarifas) {
    const url = urlDe(t.comercializadora, t.tarifa, urls);
    if (!url) continue;
    const h = await buscarEn(t.comercializadora, url);
    salida.push({
      ...h, tarifa: t.tarifa, excel: t.excedentes,
      cuadra: h.precio === null || t.excedentes === null ? null : Math.abs(h.precio - t.excedentes) < 0.0005,
    });
  }
  return salida;
}
