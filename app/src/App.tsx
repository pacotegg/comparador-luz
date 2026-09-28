import { useEffect, useMemo, useState } from 'react';
import { ranking, rankingCNMC, type Consumo, type Constantes, type TarifaCalculable, type Resultado, type OfertaCNMC } from '@motor/motor.ts';
import { leerPDF, type Resultado as Lectura } from './pdf.ts';
import { Panel, Campo, Boton, Aviso, ZonaPDF, eur, kwh } from './componentes.tsx';
import { ResultadosCNMC } from './resultados-cnmc.tsx';
import { actualizarRecomendadas, guardadas, esApp, type Resultado as ResActualizar } from './actualizar-recomendadas.ts';

/** Datos del comparador oficial. Siempre presentes: van en el repo publico. */
interface DatosCNMC {
  generado: string;
  /** Enlace publico al Excel del hilo, para que el APK lo refresque solo. */
  excelDelHilo?: string;
  verificadas: string;
  tarifas: OfertaCNMC[];
}

/**
 * Dataset curado de la Plataforma de ForoCoches. NO va en el repo publico: es su
 * trabajo de seleccion y actualizacion, y ademas es lo unico que modela los
 * excedentes solares. Quien lo quiera, que baje el Excel del hilo y ejecute
 * `npm run actualizar`. La app funciona sin el, solo que sin excedentes.
 */
interface DatosExcel {
  actualizadoExcel: string;
  fuente: { hilo: string; volumen: string; excel: string };
  verificacion: { comparadas: number; divergencias: number };
  constantes: Constantes;
  tarifas: (TarifaCalculable & { ultimoCambio: string | null; nota: string | null; permanencia: string | null })[];
}

type Fuente = 'excel' | 'cnmc';

/**
 * Donde vive la copia al dia de las tarifas. La actualiza sola la tarea del
 * HTPC cada dos dias. El APK la consulta para no quedarse congelado con los
 * datos del dia que se compilo.
 */
const PUBLICADO = 'https://pacotegg.github.io/comparador-luz';

/** Repartos por defecto, sacados del post #3 y de la celda D34 del Excel. */
const REPARTOS = [
  { nombre: '25 / 25 / 50', texto: 'El que recomienda el post #3 si no conoces tu reparto', p: [0.25, 0.25, 0.50] },
  { nombre: '28 / 26 / 46', texto: 'El que se aplica en España si el contador no registra periodos', p: [0.28, 0.26, 0.46] },
];

const VACIO: Consumo = { dias: 30, potP1: 0, potP2: 0, cPunta: 0, cLlano: 0, cValle: 0, excedentes: 0 };

export default function App() {
  const [cnmc, setCnmc] = useState<DatosCNMC | null>(null);
  const [excel, setExcel] = useState<DatosExcel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consumo, setConsumo] = useState<Consumo>(VACIO);
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [cargando, setCargando] = useState(false);
  const [todas, setTodas] = useState(false);
  const [detalle, setDetalle] = useState<string | null>(null);
  // Cuando la factura no es 2.0TD el ranking no aplica y no se ensenya, salvo
  // que se pida a proposito.
  const [verAunqueNoAplique, setVerAunqueNoAplique] = useState(false);
  const [fuente, setFuente] = useState<Fuente>('cnmc');
  const [refrescando, setRefrescando] = useState(false);
  const [avisoRefresco, setAvisoRefresco] = useState<ResActualizar | null>(null);

  useEffect(() => {
    /**
     * Las tarifas se buscan primero en la copia PUBLICADA y, si no hay red, se
     * usa la que viene dentro.
     *
     * Hace falta por el APK: empaqueta los datos al compilar y se quedarian
     * congelados para siempre, mientras que la web se renueva en cada
     * despliegue. Con esto el APK tambien se pone al dia solo.
     *
     * No se envia nada tuyo: es pedir un fichero publico, igual que abrir una
     * pagina. Si no hay red, funciona con lo que lleva dentro.
     */
    // Solo el APK va a buscarlos fuera. La web ya sirve su propia copia, que se
    // renueva en cada despliegue; si tirase de la publicada, en desarrollo
    // taparia los cambios locales y ademas pediria dos veces lo mismo.
    const cargar = async (nombre: string) => {
      const donde = esApp() ? [`${PUBLICADO}/${nombre}`, `./${nombre}`] : [`./${nombre}`];
      for (const url of donde) {
        try {
          const r = await fetch(url, { cache: 'no-cache' });
          if (r.ok) return await r.json();
        } catch { /* se prueba la siguiente */ }
      }
      return null;
    };

    cargar('tarifas-cnmc.json')
      .then(d => { if (d) setCnmc(d); else setError('No he podido cargar las ofertas de la CNMC.'); });

    // Si el Excel del hilo ya se descargo alguna vez, eso manda sobre la copia
    // que viene dentro del paquete, que envejece desde el dia que se compilo.
    const bajadas = guardadas();
    if (bajadas) { setExcel(bajadas as any); setFuente('excel'); }

    // Opcional a proposito: en el despliegue publico este fichero no existe.
    fetch('./tarifas-excel.json')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && !bajadas) { setExcel(d); setFuente('excel'); } })
      .catch(() => { /* sin Excel se trabaja solo con la CNMC */ });
  }, []);

  const total = consumo.cPunta + consumo.cLlano + consumo.cValle;
  const listo = consumo.dias > 0 && consumo.potP1 > 0 && total > 0;

  const resultados = useMemo<Resultado[]>(
    () => (excel && listo ? ranking(excel.tarifas, consumo, excel.constantes) : []),
    [excel, consumo, listo],
  );

  // Las de la CNMC se ordenan por el SEGUNDO ano: es lo que se paga cuando la
  // promocion caduca. Ordenarlas por el primero premia a las ofertas gancho.
  const resultadosCNMC = useMemo(
    () => (cnmc && listo ? rankingCNMC(cnmc.tarifas, consumo, 'segundo') : []),
    [cnmc, consumo, listo],
  );

  async function subir(f: File) {
    setCargando(true); setError(null);
    try {
      const r = await leerPDF(f);
      setLectura(r);
      // Si la tarifa es de un solo precio, la factura no desglosa por periodos:
      // solo da el total. Se reparte con el 25/25/50 que recomienda el post #3 y
      // se avisa, porque es una estimacion nuestra y no un dato de la factura.
      const sinDesglose = r.consumoTotalSinDesglose;
      const reparto = sinDesglose ? {
        cPunta: +(sinDesglose * 0.25).toFixed(2),
        cLlano: +(sinDesglose * 0.25).toFixed(2),
        cValle: +(sinDesglose * 0.50).toFixed(2),
      } : null;

      setConsumo(c => ({
        dias: r.campos.dias ?? c.dias,
        potP1: r.campos.potP1 ?? c.potP1,
        potP2: r.campos.potP2 ?? c.potP2,
        cPunta: r.campos.cPunta ?? reparto?.cPunta ?? c.cPunta,
        cLlano: r.campos.cLlano ?? reparto?.cLlano ?? c.cLlano,
        cValle: r.campos.cValle ?? reparto?.cValle ?? c.cValle,
        excedentes: r.campos.excedentes ?? c.excedentes,
      }));
    } catch (e: any) {
      setError(`No he podido leer ese PDF: ${e.message}`);
    } finally {
      setCargando(false);
    }
  }

  function repartir(p: number[]) {
    if (!total) return;
    setConsumo(c => ({ ...c, cPunta: +(total * p[0]).toFixed(2), cLlano: +(total * p[1]).toFixed(2), cValle: +(total * p[2]).toFixed(2) }));
  }

  const org = (k: keyof Consumo) => lectura?.origen[k as never] ?? null;

  return (
    <div className="mx-auto min-h-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Comparador de luz</h1>
        <p className="mt-1.5 text-sm text-[var(--color-tenue)]">
          {excel
            ? <>Con las tarifas del Excel de la Plataforma de ForoCoches, actualizado el {new Date(excel.actualizadoExcel).toLocaleDateString('es-ES')}.</>
            : <>Con las ofertas registradas en el comparador oficial de la CNMC.</>}
        </p>
      </header>

      {error && <div className="mb-5"><Aviso>{error}</Aviso></div>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
        <div className="min-w-0 space-y-5">
          <ZonaPDF onFichero={subir} cargando={cargando} />

          {lectura && (
            <Panel titulo="Qué he leído">
              <div className="space-y-2.5">
                <Aviso tono={lectura.tieneQR ? 'bien' : 'info'}>
                  {lectura.tieneQR
                    ? 'Esta factura trae el QR de la CNMC: los datos vienen exactos, no interpretados.'
                    : 'Esta factura no trae QR, así que he leído el texto. Comprueba los números antes de fiarte.'}
                </Aviso>
                {lectura.potenciaSugerida && (
                  <Aviso tono="info">
                    Tu punto máximo del año fue {lectura.potenciaMaxima} kW. El post #2 recomienda
                    dividirlo entre 1,2: te bastaría con <strong>{lectura.potenciaSugerida} kW</strong>.
                    Bajar 1 kW son unos 55 € al año.
                  </Aviso>
                )}
                {lectura.consumoTotalSinDesglose && (
                  <Aviso>
                    Tu tarifa es de un solo precio, así que la factura no dice cuánto
                    gastaste en cada periodo: solo el total, {lectura.consumoTotalSinDesglose} kWh.
                    Lo he repartido 25 / 25 / 50 como recomienda el post #3, pero{' '}
                    <strong>es una estimación mía, no un dato tuyo</strong>. Si tu
                    distribuidora te da el desglose real, mételo a mano.
                  </Aviso>
                )}
                {lectura.avisos.map((a, i) => <Aviso key={i}>{a}</Aviso>)}
              </div>
            </Panel>
          )}

          <Panel
            titulo="Tus datos"
            pie={<>Están en tu factura. Si no los encuentras, el post #2 dice que los puedes bajar de tu distribuidora.</>}
          >
            <div className="grid grid-cols-2 gap-3.5">
              <Campo etiqueta="Días facturados" unidad="días" paso="1" valor={consumo.dias} origen={org('dias')}
                onChange={v => setConsumo(c => ({ ...c, dias: v ?? 0 }))} />
              <div />
              <Campo etiqueta="Potencia punta" unidad="kW" valor={consumo.potP1} origen={org('potP1')}
                onChange={v => setConsumo(c => ({ ...c, potP1: v ?? 0 }))} />
              <Campo etiqueta="Potencia valle" unidad="kW" valor={consumo.potP2} origen={org('potP2')}
                onChange={v => setConsumo(c => ({ ...c, potP2: v ?? 0 }))} />
              <Campo etiqueta="Energía punta" unidad="kWh" valor={consumo.cPunta} origen={org('cPunta')}
                onChange={v => setConsumo(c => ({ ...c, cPunta: v ?? 0 }))} />
              <Campo etiqueta="Energía llano" unidad="kWh" valor={consumo.cLlano} origen={org('cLlano')}
                onChange={v => setConsumo(c => ({ ...c, cLlano: v ?? 0 }))} />
              <Campo etiqueta="Energía valle" unidad="kWh" valor={consumo.cValle} origen={org('cValle')}
                onChange={v => setConsumo(c => ({ ...c, cValle: v ?? 0 }))} />
              <Campo etiqueta="Excedentes solares" ayuda="0 si no tienes placas" unidad="kWh"
                valor={consumo.excedentes} origen={org('excedentes')}
                onChange={v => setConsumo(c => ({ ...c, excedentes: v ?? 0 }))} />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-borde)] pt-4">
              <span className="mr-1 text-xs text-[var(--color-tenue)]">
                ¿No sabes tu reparto? Total: <strong className="text-[var(--color-tinta)]">{kwh(total)}</strong>
              </span>
              {REPARTOS.map(r => (
                <Boton key={r.nombre} tipo="suave" onClick={() => repartir(r.p)} disabled={!total}>{r.nombre}</Boton>
              ))}
            </div>
          </Panel>
        </div>

        <div className="min-w-0 space-y-5">
          {!listo ? (
            <Panel>
              <p className="py-8 text-center text-sm text-[var(--color-tenue)]">
                Sube tu factura o rellena los días, la potencia punta y algún consumo
                para ver las mejores tarifas.
              </p>
            </Panel>
          ) : (
            <>
              <div className="flex gap-1.5 rounded-xl border border-[var(--color-borde)] bg-black/20 p-1">
                {([['excel', 'Recomendadas', excel ? `${excel.tarifas.length} del Excel` : 'sin el Excel'],
                   ['cnmc', 'Todas', `${cnmc?.tarifas.length ?? 0} de la CNMC`]] as const).map(([k, t, sub]) => (
                  <button key={k} onClick={() => setFuente(k)} disabled={k === 'excel' && !excel}
                    className={`min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-sm transition disabled:opacity-30
                      ${fuente === k ? 'bg-[var(--color-acento)] font-semibold text-slate-950' : 'text-[var(--color-tenue)] hover:text-[var(--color-tinta)]'}`}>
                    {t}<span className={`ml-1.5 text-[11px] ${fuente === k ? 'text-slate-700' : ''}`}>{sub}</span>
                  </button>
                ))}
              </div>

              {lectura?.peajeNoDomestico && !verAunqueNoAplique ? (
                <Panel titulo="Esta comparación no te sirve">
                  <Aviso>
                    Tu factura es de una tarifa <strong>{lectura.peajeNoDomestico}</strong>, con
                    seis periodos. Este comparador solo lleva tarifas domésticas{' '}
                    <strong>2.0TD</strong>, de tres periodos y hasta 15 kW, así que{' '}
                    <strong>ninguna de las {(excel?.tarifas.length ?? 0) + (cnmc?.tarifas.length ?? 0)} que
                    tiene le aplica a este suministro</strong>. Un ranking aquí sería
                    un número bonito y equivocado.
                  </Aviso>
                  <div className="mt-3">
                    <Boton tipo="suave" onClick={() => setVerAunqueNoAplique(true)}>
                      Enséñamelo igualmente
                    </Boton>
                  </div>
                </Panel>
              ) : fuente === 'cnmc' || !excel ? (
                <ResultadosCNMC res={resultadosCNMC} verificadas={cnmc?.verificadas ?? '?'} excedentes={consumo.excedentes} />
              ) : (
              <>
              <Panel titulo="Las 5 más baratas para ti">
                <ol className="space-y-2.5">
                  {resultados.slice(0, 5).map(r => {
                    const t = excel!.tarifas.find(x => x.comercializadora === r.comercializadora && x.tarifa === r.tarifa);
                    const id = r.comercializadora + r.tarifa;
                    return (
                      <li key={id} className={`rounded-xl border p-3.5 transition
                        ${r.puesto === 1 ? 'border-emerald-400/50 bg-emerald-400/10' : 'border-[var(--color-borde)] bg-black/15'}`}>
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
                            <div className="text-lg font-bold tabular-nums">{eur(r.total!)}</div>
                            {r.diferencia > 0 && <div className="text-xs text-[var(--color-tenue)]">+{eur(r.diferencia)}</div>}
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--color-tenue)]">
                          {t?.permanencia && <span>Permanencia: {t.permanencia}</span>}
                          {t?.ultimoCambio && <span>Precios vistos el {new Date(t.ultimoCambio).toLocaleDateString('es-ES')}</span>}
                          {r.valorExcedentes > 0 && <span className="text-emerald-300">Excedentes: −{eur(r.valorExcedentes)}</span>}
                          <button className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-tinta)]"
                            onClick={() => setDetalle(detalle === id ? null : id)}>
                            {detalle === id ? 'ocultar desglose' : 'ver desglose'}
                          </button>
                        </div>

                        {detalle === id && (
                          <dl className="mt-3 space-y-1 border-t border-[var(--color-borde)] pt-3 text-xs tabular-nums">
                            {[
                              ['Potencia', r.subtotalPotencia], ['Energía', r.subtotalEnergia],
                              ['Financiación bono social', r.bonoSocial], ['Impuesto eléctrico', r.impuestoElectrico],
                              ['Alquiler del contador', r.alquilerContador],
                              ...(r.costeBateriaVirtual ? [['Batería virtual', r.costeBateriaVirtual]] : []),
                              ...(r.descuento ? [['Descuento promocional', -r.descuento]] : []),
                              ['IVA', r.iva],
                            ].map(([k, v]) => (
                              <div key={k as string} className="flex justify-between">
                                <dt className="text-[var(--color-tenue)]">{k}</dt><dd>{eur(v as number)}</dd>
                              </div>
                            ))}
                            <div className="flex justify-between border-t border-[var(--color-borde)] pt-1 font-semibold">
                              <dt>Total</dt><dd>{eur(r.total!)}</dd>
                            </div>
                          </dl>
                        )}

                        {t?.nota && <p className="mt-2 text-[11px] leading-snug text-amber-300/80">{t.nota}</p>}
                      </li>
                    );
                  })}
                </ol>
              </Panel>

              <Panel pie={
                <>
                  Precios sin impuestos, como manda el hilo: las compañías publican mal los
                  precios con impuestos. El total sí los lleva.{' '}
                  {excel && `Motor verificado contra el Excel: ${excel.verificacion.comparadas - excel.verificacion.divergencias}/${excel.verificacion.comparadas}.`}
                </>
              }>
                <div className="flex flex-wrap items-center gap-2">
                  <Boton tipo="suave" onClick={() => setTodas(t => !t)}>
                    {todas ? 'Ocultar' : `Ver las ${resultados.length} tarifas`}
                  </Boton>

                  {/* Solo en el APK: en la web estos datos se renuevan con el
                      despliegue, y ademas Dropbox no deja pedirlo desde un
                      navegador (no manda cabecera CORS). */}
                  {esApp() && cnmc?.excelDelHilo && (
                    <Boton tipo="suave" disabled={refrescando} onClick={async () => {
                      setRefrescando(true); setAvisoRefresco(null);
                      const r = await actualizarRecomendadas(cnmc.excelDelHilo!, excel?.tarifas);
                      if (r.estado !== 'error') setExcel(r.datos as any);
                      setAvisoRefresco(r);
                      setRefrescando(false);
                    }}>
                      {refrescando ? 'Descargando…' : 'Buscar tarifas nuevas'}
                    </Boton>
                  )}
                </div>

                {avisoRefresco && (
                  <div className="mt-3">
                    <Aviso tono={avisoRefresco.estado === 'error' ? 'aviso' : 'bien'}>
                      {avisoRefresco.estado === 'actualizado'
                        ? `Actualizadas: han cambiado ${avisoRefresco.cambios} tarifa${avisoRefresco.cambios === 1 ? '' : 's'} respecto a las que tenías.`
                        : avisoRefresco.estado === 'sin cambios'
                        ? 'Ya estaban al día: no hay nada nuevo que descargar.'
                        : `No he podido actualizarlas: ${avisoRefresco.motivo}.`}
                    </Aviso>
                  </div>
                )}
                {todas && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {resultados.slice(5).map(r => (
                      <li key={r.comercializadora + r.tarifa} className="flex justify-between gap-3 border-b border-[var(--color-borde)]/60 py-1.5">
                        <span className="min-w-0 truncate">
                          <span className="mr-2 text-xs text-[var(--color-tenue)]">{r.puesto}</span>
                          {r.comercializadora} <span className="text-[var(--color-tenue)]">· {r.tarifa}</span>
                        </span>
                        <span className="shrink-0 tabular-nums">{eur(r.total!)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              </>
              )}
            </>
          )}
        </div>
      </div>

      <footer className="mt-10 text-center text-xs leading-relaxed text-[var(--color-tenue)]">
        Datos del hilo <em>Yo pago MENOS DE LUZ y DE GAS</em> de ForoCoches, mantenido a mano
        por JavierRR, Ivansnoke y Omadón. Tu factura no sale de este dispositivo.
        {cnmc?.generado && (
          <>
            <br />
            Tarifas descargadas el {new Date(cnmc.generado).toLocaleDateString('es-ES')}. Se
            revisan cada dos días.
          </>
        )}
      </footer>
    </div>
  );
}
