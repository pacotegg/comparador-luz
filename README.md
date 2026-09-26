# Comparador de luz

Sube la factura de la luz en PDF y te dice las cinco tarifas más baratas para tu
consumo real, distinguiendo lo que pagas **el primer año** de lo que pagas **a
partir del segundo**, cuando se acaban las promociones.

Todo ocurre en tu navegador. No hay servidor, no hay cuenta, no hay analítica y
**la factura no sale de tu dispositivo**.

## Por qué

Los comparadores ordenan por el primer recibo, y una cuarta parte de las ofertas
del mercado llevan una promoción que caduca. Con un consumo normal de 3,45 kW y
100 kWh al mes:

| | Primer año | A partir del segundo |
|---|---|---|
| CHC Plan Estrella Dúo | **25,68 € (1ª)** | 36,00 € (8ª) |
| Energya VM Fórmula fija 3 periodos | 29,35 € (3ª) | **34,56 € (1ª)** |

La primera gana el ranking y sube un 40 % en febrero. La segunda es barata las
dos veces. Esta app enseña las dos cifras.

## Cómo funciona

```
factura.pdf ──> QR de la CNMC   (datos exactos, cuando la factura lo trae)
            └─> texto del PDF   (cuando no, que es lo normal)
                     │
                     v
            días, potencias P1/P2, consumo punta/llano/valle, excedentes
                     │
                     v
            motor de cálculo ──> 5 más baratas + desglose
```

El lector saca los siete campos que hacen falta. Sobre facturas reales de dos
compañías acertó 20 de 20 campos, pero son dos compañías: con otras puede fallar,
y entonces se rellenan a mano.

## Los datos

**Ofertas de la CNMC** (`datos/tarifas-cnmc.json`, incluido en el repo). Del
comparador oficial de la Comisión Nacional de los Mercados y la Competencia,
donde las comercializadoras están obligadas a registrar sus ofertas.

Su API devuelve el importe ya calculado, no los precios unitarios. Como la
factura es lineal en los consumos, los precios se despejan con sondas que mueven
una magnitud cada vez, y una sonda de control comprueba que los precios
despejados reproducen el importe oficial. Cuadran 82 de 86; las que no son
tarifas que no son lineales (la de 10 horas de Repsol, el PVPC indexado) y se
descartan.

**Tarifas de la Plataforma** (`datos/tarifas-excel.json`, **no** incluido). Salen
del Excel del hilo [Yo pago MENOS DE LUZ y DE GAS][hilo] de ForoCoches, que
mantienen a mano JavierRR, Ivansnoke, Omadón y demás colaboradores. Ese dataset
es su trabajo de selección y actualización, así que no se republica aquí. Es
además lo único que modela los **excedentes de autoconsumo**: el comparador de la
CNMC los ignora por completo.

Si lo quieres, baja el Excel del hilo y ejecuta `npm run actualizar`. La app
funciona sin él, solo que sin excedentes y con 82 ofertas en vez de 99.

[hilo]: https://forocoches.com/foro/showthread.php?t=10802238

## Uso

```bash
npm install
npm run actualizar   # descarga datos y verifica el motor (necesita LibreOffice)
npm run dev          # la app en desarrollo
npm run build        # build estático en app/dist
```

El actualizador hace tres comprobaciones y avisa si alguna falla:

- que el motor de cálculo sigue dando lo mismo que el Excel, al céntimo;
- que los precios despejados de la CNMC reproducen sus importes oficiales;
- que el precio de compensación de excedentes que publica cada comercializadora
  coincide con el que tiene el Excel.

La tercera avisa, no corrige: la compensación es un atributo de la tarifa y una
web lista varias, así que guarda la URL y el texto exactos de los que sacó el
número para que lo juzgue una persona.

## Gracias

A la Plataforma del hilo de ForoCoches, que lleva setenta y ocho volúmenes
haciendo a mano el trabajo que ningún comparador hace.

## Aviso

Esto no es asesoramiento. Comprueba los precios en la web de la comercializadora
antes de contratar nada: cambian sin avisar y a veces la misma compañía publica
cifras distintas en sitios distintos.
