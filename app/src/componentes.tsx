import { useRef, useState, type ReactNode } from 'react';

export const eur = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
export const kwh = (n: number) => `${n.toLocaleString('es-ES', { maximumFractionDigits: 2 })} kWh`;

export function Panel({ titulo, pie, children }: { titulo?: string; pie?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-borde)] bg-[var(--color-panel)]/70 backdrop-blur">
      {titulo && (
        <h2 className="px-5 pt-4 pb-3 text-sm font-semibold uppercase tracking-wider text-[var(--color-tenue)]">
          {titulo}
        </h2>
      )}
      <div className="px-5 pb-5">{children}</div>
      {pie && <div className="border-t border-[var(--color-borde)] px-5 py-3 text-xs text-[var(--color-tenue)]">{pie}</div>}
    </section>
  );
}

export function Campo({
  etiqueta, ayuda, unidad, valor, onChange, origen, paso = 'any',
}: {
  etiqueta: string; ayuda?: string; unidad: string;
  valor: number | null; onChange: (v: number | null) => void;
  origen?: 'qr' | 'texto' | null; paso?: string;
}) {
  const marca = origen === 'qr' ? { t: 'QR', c: 'bg-emerald-400/15 text-emerald-300' }
    : origen === 'texto' ? { t: 'PDF', c: 'bg-sky-400/15 text-sky-300' }
    : null;

  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-sm text-[var(--color-tinta)]">
        {etiqueta}
        {marca && <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${marca.c}`}>{marca.t}</span>}
      </span>
      <div className="relative">
        <input
          type="number" inputMode="decimal" step={paso}
          value={valor ?? ''}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
          className="w-full rounded-lg border border-[var(--color-borde)] bg-black/25 px-3 py-2.5 pr-14
                     text-right text-base tabular-nums outline-none transition
                     focus:border-[var(--color-acento)] focus:ring-2 focus:ring-[var(--color-acento)]/25"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-tenue)]">
          {unidad}
        </span>
      </div>
      {ayuda && <span className="mt-1 block text-xs leading-snug text-[var(--color-tenue)]">{ayuda}</span>}
    </label>
  );
}

export function Boton({ children, onClick, tipo = 'normal', disabled }: {
  children: ReactNode; onClick?: () => void; tipo?: 'normal' | 'suave'; disabled?: boolean;
}) {
  const estilo = tipo === 'normal'
    ? 'bg-[var(--color-acento)] text-slate-950 hover:bg-sky-300'
    : 'border border-[var(--color-borde)] text-[var(--color-tenue)] hover:border-[var(--color-acento)] hover:text-[var(--color-tinta)]';
  return (
    <button onClick={onClick} disabled={disabled}
      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-40 ${estilo}`}>
      {children}
    </button>
  );
}

export function Aviso({ tono = 'aviso', children }: { tono?: 'aviso' | 'bien' | 'info'; children: ReactNode }) {
  const c = tono === 'bien' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
    : tono === 'info' ? 'border-sky-400/30 bg-sky-400/10 text-sky-200'
    : 'border-amber-400/30 bg-amber-400/10 text-amber-200';
  return <div className={`rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed ${c}`}>{children}</div>;
}

export function ZonaPDF({ onFichero, cargando }: { onFichero: (f: File) => void; cargando: boolean }) {
  const [encima, setEncima] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  return (
    <div
      onDragOver={e => { e.preventDefault(); setEncima(true); }}
      onDragLeave={() => setEncima(false)}
      onDrop={e => {
        e.preventDefault(); setEncima(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFichero(f);
      }}
      onClick={() => input.current?.click()}
      className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-9 text-center transition
        ${encima ? 'border-[var(--color-acento)] bg-sky-400/10' : 'border-[var(--color-borde)] hover:border-[var(--color-acento)]/60'}`}
    >
      <input ref={input} type="file" accept="application/pdf" hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) onFichero(f); e.target.value = ''; }} />
      {cargando ? (
        <p className="text-sm text-[var(--color-tenue)]">Leyendo la factura…</p>
      ) : (
        <>
          <p className="text-base font-medium">Arrastra aquí tu factura en PDF</p>
          <p className="mt-1 text-sm text-[var(--color-tenue)]">o toca para elegirla</p>
          <p className="mx-auto mt-3 max-w-sm text-xs leading-relaxed text-[var(--color-tenue)]">
            No se sube a ningún sitio. Esta app no tiene servidor: el PDF se lee
            dentro de tu navegador y se olvida al cerrar.
          </p>
        </>
      )}
    </div>
  );
}
