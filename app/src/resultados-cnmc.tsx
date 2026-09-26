import type { ResultadoCNMC } from '@motor/motor.ts';
import { Panel, Aviso, eur } from './componentes.tsx';

/**
 * Las ofertas del comparador oficial de la CNMC, ordenadas por lo que cuestan
 * a partir del SEGUNDO ano.
 *
 * Es la diferencia importante con cualquier otro comparador: una oferta con
 * promocion de tres meses no puede ganarle a una estable solo porque el primer
 * recibo sea barato. Aqui se ven las dos cifras.
 */
export function ResultadosCNMC({ res, verificadas, excedentes }: { res: ResultadoCNMC[]; verificadas: string; excedentes: number }) {
  const conPromo = res.filter(r => r.tienePromocion).length;

  return (
    <>
      <Panel titulo="Las 5 más baratas, sin trampa">
        {excedentes > 0 && (
          <div className="mb-3">
            <Aviso>
              Tienes {excedentes.toLocaleString('es-ES')} kWh de excedentes solares y{' '}
              <strong>estas cifras los ignoran</strong>: el comparador de la CNMC no los
              modela. Salen más caras de lo que pagarías en realidad. Para compararlas con
              tus placas, usa la pestaña de las recomendadas.
            </Aviso>
          </div>
        )}
        <Aviso tono="info">
          Ordenadas por lo que pagas <strong>a partir del segundo año</strong>, no por el
          primer recibo. {conPromo} de estas {res.length} ofertas llevan una promoción que caduca.
        </Aviso>

        <ol className="mt-3 space-y-2.5">
          {res.slice(0, 5).map(r => (
            <li key={r.comercializadora + r.tarifa}
              className={`rounded-xl border p-3.5 ${r.puesto === 1
                ? 'border-emerald-400/50 bg-emerald-400/10' : 'border-[var(--color-borde)] bg-black/15'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold
                      ${r.puesto === 1 ? 'bg-emerald-400 text-slate-950' : 'bg-[var(--color-borde)]'}`}>{r.puesto}</span>
                    <span className="truncate font-semibold">{r.comercializadora}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[var(--color-tenue)]">{r.tarifa}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-bold tabular-nums">{eur(r.costeSegundoAnio)}</div>
                  <div className="text-[11px] text-[var(--color-tenue)]">al mes, estable</div>
                </div>
              </div>

              <div className="mt-2.5 flex items-center gap-3 border-t border-[var(--color-borde)] pt-2.5 text-xs">
                <span className="text-[var(--color-tenue)]">1er año</span>
                <span className="tabular-nums">{eur(r.costePrimerAnio)}</span>
                {r.tienePromocion && (
                  <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">
                    luego sube {eur(r.subida)}
                  </span>
                )}
                {r.verde && <span className="text-[11px] text-emerald-300">energía verde</span>}
                {r.penalizacion && <span className="text-[11px] text-amber-300">con penalización</span>}
                {r.soloNuevosClientes && <span className="text-[11px] text-[var(--color-tenue)]">solo nuevos clientes</span>}
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel titulo="Las que enganchan" pie={
        <>Precios despejados del comparador oficial y comprobados uno a uno contra
        él: cuadran {verificadas}. <strong>No tienen en cuenta los excedentes solares</strong>;
        para eso usa la pestaña del Excel.</>
      }>
        <p className="mb-2.5 text-xs text-[var(--color-tenue)]">
          Las más baratas del primer año, con lo que cuestan cuando se acaba la promoción:
        </p>
        <ul className="space-y-1 text-sm">
          {res.slice().sort((a, b) => a.costePrimerAnio - b.costePrimerAnio).slice(0, 5).map(r => (
            <li key={r.comercializadora + r.tarifa}
              className="flex items-center justify-between gap-3 border-b border-[var(--color-borde)]/60 py-1.5">
              <span className="min-w-0 truncate text-xs">
                {r.comercializadora} <span className="text-[var(--color-tenue)]">· {r.tarifa}</span>
              </span>
              <span className="shrink-0 whitespace-nowrap text-xs tabular-nums">
                {eur(r.costePrimerAnio)}
                <span className="text-[var(--color-tenue)]"> → </span>
                <span className={r.subida > 0.01 ? 'text-amber-300' : ''}>{eur(r.costeSegundoAnio)}</span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
