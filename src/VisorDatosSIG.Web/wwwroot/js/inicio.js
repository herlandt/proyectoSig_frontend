// VisorDatosSIG · dashboard general: indicadores, distribución porcentual y cantidad de códigos fijos por estado.
// Los colores de estado son los del mapa (fijos por la simbología), así que la identidad nunca depende solo del color:
// cada marca lleva el nombre del estado, la forma de su símbolo y el valor visible sin pasar el puntero.
'use strict';
(async () => {
    const estado = document.getElementById('estadoPanel');
    const tarjetas = document.getElementById('tarjetasCapas');
    const acciones = { lotes: 'Consultar lotes', manzanas: 'Consultar manzanas', codigosfijos: 'Consultar códigos fijos', vias: 'Consultar vías' };

    function muestra(capa) {
        if (capa.tipoGeometria === 'Línea') return `<span class="muestra-linea" style="border-color:${capa.color}"></span>`;
        if (capa.tipoGeometria === 'Punto') return `<span class="muestra-punto" style="background:${capa.color}"></span>`;
        return `<span class="muestra" style="border-color:${capa.color};background:${capa.colorRelleno}33"></span>`;
    }

    /** Símbolo del estado con su forma (círculo, triángulo, cuadrado, rombo, cruz): segunda codificación además del color. */
    function simbolo(forma, color, tam = 14) {
        const c = tam / 2, m = 1.5, f = tam - m;
        const borde = 'stroke="#ffffff" stroke-width="1.5"';
        const figura = {
            triangulo: `<polygon points="${c},${m} ${f},${f} ${m},${f}" fill="${color}" ${borde}/>`,
            cuadrado: `<rect x="${m}" y="${m}" width="${f - m}" height="${f - m}" rx="1.5" fill="${color}" ${borde}/>`,
            rombo: `<polygon points="${c},${m} ${f},${c} ${c},${f} ${m},${c}" fill="${color}" ${borde}/>`,
            cruz: `<path d="M${c - 2.5},${m}h5v${c - m - 2.5}h${c - m - 2.5}v5h-${c - m - 2.5}v${c - m - 2.5}h-5v-${c - m - 2.5}h-${c - m - 2.5}v-5h${c - m - 2.5}z" fill="${color}"/>`,
        }[forma] || `<circle cx="${c}" cy="${c}" r="${c - m}" fill="${color}" ${borde}/>`;
        return `<svg class="simbolo-estado" width="${tam}" height="${tam}" viewBox="0 0 ${tam} ${tam}" aria-hidden="true" focusable="false">${figura}</svg>`;
    }

    const porcentaje = (n, total) => total > 0 ? n / total * 100 : 0;
    const textoPorcentaje = p => `${Formato.numero(p, 2)} %`;

    function indicadores(estados, conteos, total) {
        const cont = document.getElementById('kpisEstados');
        if (!cont) return;
        cont.innerHTML = `<div class="col"><div class="kpi kpi-principal">
                <div class="etiqueta">Total de códigos fijos</div>
                <div class="valor">${Formato.numero(total)}</div>
                <div class="detalle">100 % del registro</div></div></div>`
            + estados.map(e => `<div class="col"><div class="kpi">
                <div class="etiqueta">${simbolo(e.forma, e.color)}${escaparHtml(e.nombre)}</div>
                <div class="valor">${Formato.numero(conteos[e.valor])}</div>
                <div class="detalle">${textoPorcentaje(porcentaje(conteos[e.valor], total))} del total</div></div></div>`).join('');
    }

    function dona(estados, conteos, total) {
        const cont = document.getElementById('graficoDona');
        if (!cont || total <= 0) return;
        const r = 80, grosor = 26, circunferencia = 2 * Math.PI * r, separacion = 2;
        let inicio = 0;
        const segmentos = estados.map(e => {
            const largo = conteos[e.valor] / total * circunferencia;
            const visible = Math.max(largo - separacion, largo > 0 ? 1 : 0);   // 2 px de superficie entre segmentos
            const s = `<circle class="segmento" cx="100" cy="100" r="${r}" fill="none" stroke="${e.color}" stroke-width="${grosor}"
                stroke-dasharray="${visible.toFixed(2)} ${(circunferencia - visible).toFixed(2)}" stroke-dashoffset="${(-inicio).toFixed(2)}"
                transform="rotate(-90 100 100)" tabindex="0" role="img"
                aria-label="${escaparHtml(e.nombre)}: ${Formato.numero(conteos[e.valor])} (${textoPorcentaje(porcentaje(conteos[e.valor], total))})"
                data-valor="${Formato.numero(conteos[e.valor])} · ${textoPorcentaje(porcentaje(conteos[e.valor], total))}" data-etiqueta="${escaparHtml(e.nombre)}"></circle>`;
            inicio += largo;
            return s;
        }).join('');
        cont.innerHTML = `<svg viewBox="0 0 200 200" role="group" aria-label="Distribución porcentual por estado">
            <circle cx="100" cy="100" r="${r}" fill="none" stroke="#eef1f4" stroke-width="${grosor}"></circle>${segmentos}
            <text x="100" y="98" text-anchor="middle" font-size="26" font-weight="700" fill="#1d2733">${Formato.numero(total)}</text>
            <text x="100" y="120" text-anchor="middle" font-size="12" fill="#5c6875">códigos fijos</text></svg>`;
    }

    function barras(estados, conteos, total) {
        const cont = document.getElementById('graficoBarras');
        if (!cont) return;
        const maximo = Math.max(...estados.map(e => conteos[e.valor]), 1);
        cont.innerHTML = estados.map(e => {
            const ancho = conteos[e.valor] / maximo * 100;
            const valor = `${Formato.numero(conteos[e.valor])}`;
            return `<div class="nombre">${simbolo(e.forma, e.color)}${escaparHtml(e.nombre)}</div>
                <div class="pista"><div class="barra" style="width:calc(${ancho.toFixed(2)}% - 4rem);background:${e.color}" tabindex="0" role="img"
                    aria-label="${escaparHtml(e.nombre)}: ${valor} códigos fijos"
                    data-valor="${valor} · ${textoPorcentaje(porcentaje(conteos[e.valor], total))}" data-etiqueta="${escaparHtml(e.nombre)}"></div>
                    <span class="valor">${valor}</span></div>`;
        }).join('');
    }

    /** Un solo tooltip para la dona y las barras: el valor primero, el estado después. También con el teclado (foco). */
    function activarTooltips() {
        let tip = null;
        const mostrar = (marca, x, y) => {
            if (!tip) {
                tip = document.createElement('div');
                tip.className = 'tooltip-grafico';
                tip.setAttribute('role', 'tooltip');
                document.body.appendChild(tip);
            }
            tip.replaceChildren();
            const fuerte = document.createElement('strong');
            fuerte.textContent = marca.dataset.valor;
            tip.append(fuerte, document.createTextNode(marca.dataset.etiqueta));
            tip.style.left = `${x + 14}px`;
            tip.style.top = `${y + 14}px`;
            tip.hidden = false;
        };
        const ocultar = () => { if (tip) tip.hidden = true; };
        for (const id of ['graficoDona', 'graficoBarras']) {
            const cont = document.getElementById(id);
            if (!cont) continue;
            cont.addEventListener('pointermove', ev => {
                const marca = ev.target.closest('[data-valor]');
                if (marca) mostrar(marca, ev.clientX, ev.clientY); else ocultar();
            });
            cont.addEventListener('pointerleave', ocultar);
            cont.addEventListener('focusin', ev => {
                const marca = ev.target.closest('[data-valor]');
                if (!marca) return;
                const r = marca.getBoundingClientRect();
                mostrar(marca, r.left + r.width / 2, r.top);
            });
            cont.addEventListener('focusout', ocultar);
        }
    }

    try {
        const catalogo = await VisorApi.get('/api/capas');
        tarjetas.innerHTML = catalogo.capas.map(c => `
            <div class="col-6">
                <a class="tarjeta-capa d-block p-3 text-decoration-none text-reset" href="/Consultas?capa=${encodeURIComponent(c.id)}">
                    <div class="d-flex align-items-center gap-2 fw-semibold">${muestra(c)} ${escaparHtml(c.nombre)}</div>
                    <div class="valor">${Formato.numero(c.registros)}</div>
                    <div class="small text-body-secondary">registros en total</div>
                    <div class="small text-primario mt-2">${acciones[c.id] || 'Consultar registros'} <i class="bi bi-arrow-right" aria-hidden="true"></i></div>
                </a>
            </div>`).join('');
        document.getElementById('ultimaActualizacion').textContent = catalogo.ultimaActualizacion
            ? `Última actualización de datos: ${Formato.fecha(catalogo.ultimaActualizacion)}`
            : 'Todavía no se cargaron datos.';
        const fecha = document.getElementById('fechaActualizado');
        if (fecha) fecha.textContent = catalogo.ultimaActualizacion ? Formato.fecha(catalogo.ultimaActualizacion) : 'Sin migraciones';
        // Los conteos llegan agregados en el catálogo; un fallo de este bloque no oculta las capas.
        const lista = document.getElementById('resumenEstados');
        try {
            if (!catalogo.conteoPorEstado) throw new Error('No se pudieron obtener los conteos por estado.');
            const conteos = {};
            for (const e of catalogo.estados) {
                conteos[e.valor] = catalogo.conteoPorEstado[e.valor];
                if (!Number.isFinite(conteos[e.valor])) throw new Error('No se pudieron obtener los conteos por estado.');
            }
            const total = catalogo.estados.reduce((n, e) => n + conteos[e.valor], 0);
            // La lista es también la vista en tabla del gráfico: estado, cantidad (con enlace al mapa) y porcentaje.
            lista.innerHTML = catalogo.estados.map(e => {
                const filtros = encodeURIComponent(JSON.stringify([{ campo: 'Estado', operador: 'igual', valor: String(e.valor) }]));
                return `<li data-estado="${e.valor}">
                    ${simbolo(e.forma, e.color)}<span>${escaparHtml(e.nombre)}</span>
                    <span class="ms-auto fw-semibold cantidad"><a href="/Visor?capa=codigosfijos&filtros=${filtros}" title="Ver en el mapa">${Formato.numero(conteos[e.valor])}</a></span>
                    <span class="porcentaje">${textoPorcentaje(porcentaje(conteos[e.valor], total))}</span></li>`;
            }).join('');
            indicadores(catalogo.estados, conteos, total);
            dona(catalogo.estados, conteos, total);
            barras(catalogo.estados, conteos, total);
            activarTooltips();
        } catch (err) {
            lista.innerHTML = `<li class="alert alert-danger" role="alert">${escaparHtml(err.message)}
                <button class="btn btn-sm btn-outline-danger ms-2" type="button" id="btnReintentarEstados">Reintentar</button></li>`;
            document.getElementById('btnReintentarEstados')?.addEventListener('click', () => location.reload());
        }
        estado.remove();
    } catch (err) {
        estado.className = 'alert alert-danger';
        estado.innerHTML = `<i class="bi bi-exclamation-octagon me-2" aria-hidden="true"></i>${escaparHtml(err.message)}
            <button class="btn btn-sm btn-outline-danger ms-auto" type="button" id="btnReintentarPanel">Reintentar</button>`;
        document.getElementById('btnReintentarPanel')?.addEventListener('click', () => location.reload());
    }
})();
