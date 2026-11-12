// VisorDatosSIG · visor cartográfico (Leaflet).
// - Las capas se piden al servidor por extensión visible (bbox) y zoom: nunca se cargan completas.
// - Selección sincronizada mapa ↔ tabla de resultados (RF-CON-07/08) y resaltado persistente (RF-VIS-10).
'use strict';
(() => {
    const ORDEN_PANELES = ['manzanas', 'lotes', 'vias', 'codigosfijos', 'resultados', 'resaltado'];
    const TAMANO_PAGINA = 20;
    const esMovil = () => window.matchMedia('(max-width: 991.98px)').matches;

    const el = id => document.getElementById(id);
    const visor = el('visor');
    const estadoMapa = el('estadoMapa');

    let catalogo, mapa;
    const capas = new Map();            // id -> { def, capa, visible, estado: 'ok'|'cargando'|'fueraDeZoom'|'error', truncado, controlador }
    const estados = new Map();          // valor -> simbología de estado del servicio
    const avisos = new Map();           // clave -> { html }
    let capaResultados, capaResaltado;
    let seleccion = null;               // { capa, id }
    let fichaSeleccion = null;          // última ficha para volver a abrirla sin consultar ni perder la selección
    let consulta = null;                // { tipo: 'general'|'filtros', ... }
    let temporizador = null;
    let solicitudSeleccion = 0;         // identificación y selección comparten la última intención
    let solicitudConsulta = 0;          // búsqueda general y filtros comparten resultados

    // ------------------------------------------------------------------ simbología

    const SIMBOLO_ESTADO = {
        1: { radius: 5, color: '#ffffff', weight: 1.5, fillOpacity: 0.95 },
        2: { radius: 6, color: '#FD7E14', weight: 3, fillColor: '#ffffff', fillOpacity: 1 },
        3: { radius: 6, color: '#58151c', weight: 2, fillOpacity: 0.95, dashArray: '2,2' },
        4: { radius: 5, color: '#8D6E63', weight: 2, fillOpacity: 0.35 },
        5: { radius: 6, color: '#ffffff', weight: 2, fillOpacity: 1 },
    };

    function estiloPunto(estado) {
        const e = estados.get(Number(estado)) || estados.get(1);
        return Object.assign({ fillColor: e ? e.color : '#198754' }, SIMBOLO_ESTADO[estado] || SIMBOLO_ESTADO[1]);
    }

    // Puntos más chicos al alejar el mapa para que no se fundan en una mancha.
    function factorZoom() {
        const z = mapa ? mapa.getZoom() : 16;
        return z <= 14 ? 0.5 : z === 15 ? 0.7 : z === 16 ? 0.85 : 1;
    }

    function estiloPuntoEnMapa(estado) {
        const s = estiloPunto(estado);
        const f = factorZoom();
        return Object.assign({}, s, { radius: Math.max(2, s.radius * f), weight: f < 0.7 ? Math.min(s.weight, 1.5) : s.weight });
    }

    function simboloEstadoSvg(valor, tam = 14) {
        const s = estiloPunto(valor);
        const r = tam / 2 - 2;
        return `<svg width="${tam}" height="${tam}" viewBox="0 0 ${tam} ${tam}" aria-hidden="true" focusable="false">
            <circle cx="${tam / 2}" cy="${tam / 2}" r="${r}" fill="${s.fillColor}" fill-opacity="${s.fillOpacity}"
             stroke="${s.color === '#ffffff' ? '#444' : s.color}" stroke-width="${Math.min(s.weight, 3)}" ${s.dashArray ? 'stroke-dasharray="2,1.5"' : ''}/></svg>`;
    }

    function estiloCapa(def) {
        if (def.tipoGeometria === 'Línea') return { color: def.color, weight: 2, opacity: 0.9, interactive: false };
        return {
            color: def.color, weight: def.id === 'lotes' ? 1 : 2, opacity: 0.9,
            fillColor: def.colorRelleno, fillOpacity: def.opacidadRelleno, interactive: false,
        };
    }

    function muestra(def) {
        if (def.tipoGeometria === 'Línea') return `<span class="muestra-linea" style="border-color:${def.color}"></span>`;
        if (def.tipoGeometria === 'Punto') return `<span class="muestra-punto" style="background:${def.color}"></span>`;
        return `<span class="muestra" style="border-color:${def.color};background:${def.colorRelleno}33"></span>`;
    }

    const COLOR_RESULTADOS = '#C2185B';

    // ------------------------------------------------------------------ arranque

    async function iniciar() {
        try {
            catalogo = await VisorApi.get('/api/capas');
        } catch (err) {
            ponerAviso('catalogo', `<span class="chip text-danger"><i class="bi bi-exclamation-octagon me-1"></i>${escaparHtml(err.message)}
                <button class="btn btn-link btn-sm p-0 ms-2" data-accion="recargar">Reintentar</button></span>`);
            estadoMapa.querySelector('[data-accion="recargar"]')?.addEventListener('click', () => location.reload());
            return;
        }
        catalogo.estados.forEach(e => estados.set(e.valor, e));
        crearMapa();
        crearCapas();
        construirListaCapas();
        construirLeyenda();
        const urbana = catalogo.capas.find(c => c.id === 'manzanas')?.extension || catalogo.extensionGeneral;
        irAExtension(urbana);
        mapa.on('moveend', programarCarga);
        mapa.on('zoomend', () => {
            const c = capas.get('codigosfijos');
            if (c) c.capa.eachLayer(m => m.setStyle && m.setStyle(estiloPuntoEnMapa(m.feature.properties.Estado)));
        });
        enlazarEventos();
        await procesarParametros();
        programarCarga();
    }

    function crearMapa() {
        mapa = L.map('mapa', { zoomControl: false, preferCanvas: true, minZoom: 10, maxZoom: 20, tapTolerance: 15 });
        ORDEN_PANELES.forEach((p, i) => { mapa.createPane('p-' + p).style.zIndex = String(410 + i * 10); });

        L.control.zoom({ position: 'topright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(mapa);
        // Mapas base gratuitos compatibles con Leaflet (RF-VIS-01), con su atribución.
        const bases = {
            'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 20, maxNativeZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>',
            }),
            'Calles (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 20, maxNativeZoom: 19,
                attribution: 'Mapa &copy; Esri, HERE, Garmin, &copy; colaboradores de OpenStreetMap',
            }),
            // En San Ignacio de Velasco Esri solo tiene imagen hasta el zoom 17; más cerca se amplía esa.
            'Satélite (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 20, maxNativeZoom: 17,
                attribution: 'Imágenes &copy; Esri, Maxar, Earthstar Geographics',
            }),
        };
        // Una preferencia de una versión anterior (p. ej. CARTO, que ahora exige clave) se reemplaza.
        let nombreBase = Preferencias.leer('visor.mapaBase');
        if (!bases[nombreBase]) {
            nombreBase = 'OpenStreetMap';
            Preferencias.guardar('visor.mapaBase', nombreBase);
        }
        bases[nombreBase].addTo(mapa);
        L.control.layers(bases, null, { position: 'topright' }).addTo(mapa);
        mapa.on('baselayerchange', e => { Preferencias.guardar('visor.mapaBase', e.name); quitarAviso('base'); });

        // Si el servidor de mosaicos no responde, se pasa a otro proveedor sin perder las capas del sistema.
        Object.entries(bases).forEach(([nombre, capa]) => {
            let errores = 0;
            capa.on('tileload', () => { errores = 0; });
            capa.on('tileerror', () => {
                if (++errores !== 6 || !mapa.hasLayer(capa)) return;
                const alternativa = nombre === 'Calles (Esri)' ? 'OpenStreetMap' : 'Calles (Esri)';
                mapa.removeLayer(capa);
                bases[alternativa].addTo(mapa);
                ponerAviso('base', `<span class="chip"><i class="bi bi-cloud-slash me-1"></i>El mapa base «${escaparHtml(nombre)}» no respondió; se cambió a «${escaparHtml(alternativa)}». Las capas del sistema siguen visibles.</span>`);
            });
        });

        L.control.scale({ imperial: false, position: 'bottomright' }).addTo(mapa);

        const Coordenadas = L.Control.extend({
            options: { position: 'bottomleft' },
            onAdd() {
                const div = L.DomUtil.create('div', 'coordenadas-mapa');
                div.setAttribute('aria-live', 'off');
                div.textContent = 'Lat —, Lon —';
                return div;
            },
        });
        const coordenadas = new Coordenadas().addTo(mapa);
        const mostrarCoordenadas = e => {
            coordenadas.getContainer().textContent = `Lat ${e.latlng.lat.toFixed(6)}, Lon ${e.latlng.lng.toFixed(6)}`;
        };
        mapa.on('mousemove', mostrarCoordenadas);
        mapa.on('click', mostrarCoordenadas);

        const Boton = L.Control.extend({
            options: { position: 'topright' },
            initialize(opciones) { L.setOptions(this, opciones); },
            onAdd() {
                const c = L.DomUtil.create('div', `leaflet-bar ${this.options.clase}`);
                const a = L.DomUtil.create('a', '', c);
                a.href = '#';
                a.title = this.options.titulo;
                a.setAttribute('role', 'button');
                a.setAttribute('aria-label', this.options.titulo);
                a.innerHTML = `<i class="bi ${this.options.icono}" aria-hidden="true"></i>`;
                L.DomEvent.on(a, 'click', ev => { L.DomEvent.stop(ev); this.options.accion(); });
                L.DomEvent.disableClickPropagation(c);
                return c;
            },
        });
        new Boton({ clase: 'leaflet-control-extension', titulo: 'Ver toda el área', icono: 'bi-house', accion: () => irAExtension(catalogo.extensionGeneral) }).addTo(mapa);
        new Boton({ clase: 'leaflet-control-limpiar', titulo: 'Quitar selección', icono: 'bi-eraser', accion: limpiarSeleccion }).addTo(mapa);

        capaResultados = L.geoJSON(null, {
            pane: 'p-resultados',
            style: () => ({ color: COLOR_RESULTADOS, weight: 3, fillColor: COLOR_RESULTADOS, fillOpacity: 0.12, dashArray: '6,4' }),
            pointToLayer: (f, ll) => L.circleMarker(ll, { pane: 'p-resultados', radius: 8, color: COLOR_RESULTADOS, weight: 3, fillColor: '#fff', fillOpacity: 0.6 }),
            onEachFeature: (f, capa) => capa.on('click', ev => {
                L.DomEvent.stop(ev);
                seleccionar(f.properties.capa, f.properties.id, { acercar: false });
            }),
        }).addTo(mapa);
        capaResaltado = L.geoJSON(null, {
            pane: 'p-resaltado', interactive: false,
            style: () => ({ color: '#ffd400', weight: 5, opacity: 1, fillColor: '#ffd400', fillOpacity: 0.18 }),
            pointToLayer: (f, ll) => L.circleMarker(ll, { pane: 'p-resaltado', radius: 12, color: '#000', weight: 3, fillColor: '#ffd400', fillOpacity: 0.55, interactive: false }),
        }).addTo(mapa);

        // El doble clic acerca el mapa: se espera un instante para no identificar en ese caso.
        let esperaClic = null;
        mapa.on('click', e => { clearTimeout(esperaClic); esperaClic = setTimeout(() => identificar(e), 280); });
        mapa.on('dblclick', () => clearTimeout(esperaClic));
        const redimensionar = () => setTimeout(() => mapa.invalidateSize(), 260);
        window.addEventListener('visor:redimension', redimensionar);
        window.addEventListener('resize', redimensionar);
    }

    function crearCapas() {
        let guardadas = null;
        try {
            const preferencia = JSON.parse(Preferencias.leer('visor.capasVisibles') || 'null');
            if (Array.isArray(preferencia))
                guardadas = preferencia.filter(id => catalogo.capas.some(c => c.id === id));
        } catch { /* una preferencia inválida usa las capas visibles por defecto */ }
        for (const def of [...catalogo.capas].sort((a, b) => a.orden - b.orden)) {
            const pane = 'p-' + def.id;
            const capa = L.geoJSON(null, {
                pane,
                style: () => estiloCapa(def),
                pointToLayer: (f, ll) => L.circleMarker(ll, Object.assign({ pane, interactive: false }, estiloPuntoEnMapa(f.properties.Estado))),
            });
            const visible = guardadas ? guardadas.includes(def.id) : def.visiblePorDefecto;
            capas.set(def.id, { def, capa, visible, estado: 'ok', truncado: false, controlador: null });
            if (visible) capa.addTo(mapa);
        }
    }

    // ------------------------------------------------------------------ carga por extensión

    function programarCarga() {
        clearTimeout(temporizador);
        temporizador = setTimeout(cargarCapas, 250);
    }

    function cargarCapas() {
        const zoom = Math.round(mapa.getZoom());
        const b = mapa.getBounds().pad(0.15);
        const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
            .map((v, i) => Math.max(i % 2 ? -90 : -180, Math.min(i % 2 ? 90 : 180, v)).toFixed(6)).join(',');
        for (const [id, c] of capas) {
            if (c.controlador) c.controlador.abort();
            if (!c.visible) { c.estado = 'ok'; continue; }
            if (zoom < c.def.zoomMinimo) {
                c.capa.clearLayers();
                c.estado = 'fueraDeZoom';
                continue;
            }
            cargarCapa(id, c, bbox, zoom);
        }
        actualizarEstado();
    }

    async function cargarCapa(id, c, bbox, zoom) {
        c.controlador = new AbortController();
        c.estado = 'cargando';
        actualizarEstado();
        try {
            const fc = await VisorApi.get(`/api/capas/${id}/geojson?bbox=${bbox}&zoom=${zoom}`, { signal: c.controlador.signal });
            c.capa.clearLayers();
            c.capa.addData(fc);
            c.truncado = fc.truncado;
            c.estado = fc.fueraDeZoom ? 'fueraDeZoom' : 'ok';
        } catch (err) {
            if (err.name === 'AbortError') return;
            c.estado = 'error';
            c.error = err.message;
        }
        actualizarEstado();
    }

    function actualizarEstado() {
        const lista = [...capas.values()].filter(c => c.visible);
        const html = [];
        if (lista.some(c => c.estado === 'cargando'))
            html.push('<span class="chip"><span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Cargando capas…</span>');
        const fuera = lista.filter(c => c.estado === 'fueraDeZoom');
        if (fuera.length)
            html.push(`<span class="chip"><i class="bi bi-zoom-in me-1" aria-hidden="true"></i>Acerque el mapa para ver: ${fuera.map(c => `${escaparHtml(c.def.nombre)} (zoom ≥ ${c.def.zoomMinimo})`).join(', ')}</span>`);
        lista.filter(c => c.estado === 'ok' && c.truncado).forEach(c =>
            html.push(`<span class="chip"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>${escaparHtml(c.def.nombre)}: se muestra una parte; acerque el mapa para ver todo.</span>`));
        lista.filter(c => c.estado === 'error').forEach(c =>
            html.push(`<span class="chip text-danger"><i class="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>No se pudo cargar ${escaparHtml(c.def.nombre)}.
                <button class="btn btn-link btn-sm p-0 ms-1 align-baseline" type="button" data-accion="reintentar">Reintentar</button></span>`));
        for (const a of avisos.values()) html.push(a);
        estadoMapa.innerHTML = html.join('');
        construirLeyenda();
        actualizarNotasCapas();
    }

    function ponerAviso(clave, html) { avisos.set(clave, html); if (mapa) actualizarEstado(); else estadoMapa.innerHTML = html; }
    function quitarAviso(clave) { avisos.delete(clave); actualizarEstado(); }

    // ------------------------------------------------------------------ capas y leyenda

    function construirListaCapas() {
        el('listaCapas').innerHTML = [...capas.values()].map(({ def, visible }) => `
            <div class="form-check">
                <input class="form-check-input" type="checkbox" id="capa-${def.id}" data-capa="${def.id}" ${visible ? 'checked' : ''}>
                <label class="form-check-label d-flex align-items-center gap-2" for="capa-${def.id}">${muestra(def)} ${escaparHtml(def.nombre)}</label>
                <span class="nota" id="nota-${def.id}">${Formato.numero(def.registros)}</span>
            </div>`).join('');
    }

    function actualizarNotasCapas() {
        for (const [id, c] of capas) {
            const nota = el('nota-' + id);
            if (!nota) continue;
            nota.textContent = c.visible && c.estado === 'fueraDeZoom' ? `zoom ≥ ${c.def.zoomMinimo}` : Formato.numero(c.def.registros);
        }
    }

    function construirLeyenda() {
        const items = [];
        for (const { def, visible, estado } of capas.values()) {
            if (!visible) continue;
            const nota = estado === 'fueraDeZoom' ? ' <span class="text-body-secondary small">(acerque para ver)</span>' : '';
            if (def.id === 'codigosfijos') {
                items.push(`<li>${muestra(def)} <span>${escaparHtml(def.nombre)}${nota}</span></li>`);
                catalogo.estados.forEach(e => items.push(`<li class="sub">${simboloEstadoSvg(e.valor)} <span>${escaparHtml(e.nombre)}</span></li>`));
            } else {
                items.push(`<li>${muestra(def)} <span>${escaparHtml(def.nombre)}${nota}</span></li>`);
            }
        }
        if (consulta) items.push(`<li><span class="muestra" style="border-color:${COLOR_RESULTADOS};border-style:dashed"></span> <span>Resultados de la consulta</span></li>`);
        if (seleccion) items.push('<li><span class="muestra" style="border-color:#ffd400;background:#ffd40055"></span> <span>Entidad seleccionada</span></li>');
        el('leyenda').innerHTML = items.join('') || '<li class="text-body-secondary small">No hay capas visibles.</li>';
    }

    // ------------------------------------------------------------------ identificación y selección

    async function identificar(e) {
        const solicitud = ++solicitudSeleccion;
        const visibles = [...capas.values()].filter(c => c.visible).map(c => c.def.id);
        if (!visibles.length) { avisar('Active al menos una capa para identificar entidades.', 'advertencia'); return; }
        const zoom = Math.round(mapa.getZoom());
        mostrarDetalleCargando();
        try {
            const r = await VisorApi.get(`/api/identificar?lon=${e.latlng.lng.toFixed(7)}&lat=${e.latlng.lat.toFixed(7)}&zoom=${zoom}&capas=${visibles.join(',')}`);
            if (solicitud !== solicitudSeleccion) return;
            if (!r.grupos.length) {
                limpiarResaltado();
                mostrarDetalleHtml('<div class="estado-vacio"><i class="bi bi-geo fs-3 d-block mb-2" aria-hidden="true"></i>No hay entidades en este punto.</div>');
                return;
            }
            const primero = r.grupos[0].entidades.features[0];
            aplicarSeleccion(primero, r.grupos, { acercar: false });
        } catch (err) {
            if (solicitud !== solicitudSeleccion) return;
            mostrarDetalleHtml(`<div class="alert alert-danger mb-0">${escaparHtml(err.message)}</div>`);
        }
    }

    async function seleccionar(capa, id, opciones = {}) {
        const solicitud = ++solicitudSeleccion;
        mostrarDetalleCargando();
        try {
            const f = await VisorApi.get(`/api/capas/${encodeURIComponent(capa)}/${encodeURIComponent(id)}`);
            if (solicitud !== solicitudSeleccion) return;
            aplicarSeleccion(f, opciones.grupos || null, opciones);
        } catch (err) {
            if (solicitud !== solicitudSeleccion) return;
            mostrarDetalleHtml(`<div class="alert alert-danger mb-0">${escaparHtml(err.message)}</div>`);
        }
    }

    function aplicarSeleccion(feature, grupos, { acercar = true } = {}) {
        seleccion = { capa: feature.properties.capa, id: feature.properties.id };
        capaResaltado.clearLayers();
        capaResaltado.addData(feature);
        if (acercar) acercarA(capaResaltado);
        renderDetalle(feature, grupos);
        marcarFila();
        construirLeyenda();
    }

    function acercarA(capa) {
        const limites = capa.getBounds();
        if (!limites.isValid()) return;
        // En móvil el panel inferior cubre ~55 % de la pantalla: se reserva ese espacio abajo.
        const abajo = esMovil() ? Math.round(window.innerHeight * 0.5) : 40;
        if (limites.getNorthEast().equals(limites.getSouthWest())) {
            const zoom = Math.max(mapa.getZoom(), 18);
            const punto = mapa.project(limites.getCenter(), zoom).add([0, (abajo - 40) / 2]);
            mapa.setView(mapa.unproject(punto, zoom), zoom);
        } else {
            mapa.fitBounds(limites, { paddingTopLeft: [40, 40], paddingBottomRight: [40, abajo], maxZoom: 19 });
        }
    }

    function limpiarResaltado() {
        capaResaltado.clearLayers();
        seleccion = null;
        fichaSeleccion = null;
        actualizarBotonDetalle();
        marcarFila();
        construirLeyenda();
    }

    function limpiarSeleccion() {
        solicitudSeleccion++;
        limpiarResaltado();
        ocultarDetalle();
    }

    // ------------------------------------------------------------------ panel de detalle

    function esCampoTecnico(campo) {
        return /^Id/i.test(campo.clave) || ['OSMID', 'OBJECTID', 'CodF_SIG', 'CodF_SQL', 'Longitud', 'Latitud', 'SRID'].includes(campo.clave);
    }

    function formatearValor(campo, valor, props) {
        if (valor === null || valor === undefined || valor === '') return '<span class="text-body-secondary">—</span>';
        switch (campo.tipo) {
            case 'Estado': return `<span class="badge-estado">${simboloEstadoSvg(valor)}${escaparHtml(props.EstadoDescripcion || valor)}</span>`;
            case 'Fecha': return escaparHtml(Formato.fecha(valor));
            case 'Numero': return escaparHtml(campo.clave.startsWith('Id') || campo.clave === 'CodFijo' || campo.clave === 'CodF_SQL' || campo.clave === 'OBJECTID' ? valor : Formato.numero(valor));
            case 'Decimal': {
                if (campo.clave === 'Longitud' || campo.clave === 'Latitud') return Number(valor).toFixed(6);
                const unidad = campo.clave === 'Superficie' ? 'm²' : campo.clave === 'LongitudMetros' ? 'm' : '';
                const sufijo = unidad && !campo.etiqueta.includes(`(${unidad})`) ? ` ${unidad}` : '';
                return escaparHtml(Formato.numero(valor, 2) + sufijo);
            }
            default: return escaparHtml(valor);
        }
    }

    function renderDetalle(feature, grupos) {
        const p = feature.properties;
        const def = capas.get(p.capa)?.def || catalogo.capas.find(c => c.id === p.capa);
        fichaSeleccion = { feature, grupos };
        const fila = c => `<tr><th scope="row">${escaparHtml(c.etiqueta)}</th><td>${formatearValor(c, p[c.clave], p)}</td></tr>`;
        const filas = def.campos.filter(c => !esCampoTecnico(c)).map(fila).join('');
        const filasTecnicas = def.campos.filter(esCampoTecnico).map(fila).join('');
        let coincidentes = '';
        if (grupos && grupos.length) {
            coincidentes = `<h3 class="titulo-panel">Entidades coincidentes</h3><div class="list-group list-group-flush small">` +
                grupos.map(g => g.entidades.features.map(f => {
                    const activa = f.properties.capa === p.capa && f.properties.id === p.id;
                    return `<button type="button" class="list-group-item list-group-item-action d-flex gap-2 align-items-center ${activa ? 'active' : ''}"
                        data-accion="coincidente" data-capa="${escaparHtml(f.properties.capa)}" data-id="${f.properties.id}" ${activa ? 'aria-current="true"' : ''}>
                        <span class="badge text-bg-light">${escaparHtml(g.nombre)}</span><span class="text-truncate">${escaparHtml(f.properties.titulo)}</span></button>`;
                }).join('')).join('') + '</div>';
            ultimosGrupos = grupos;
        }
        mostrarDetalleHtml(`
            <div class="d-flex align-items-start gap-2 mb-2">${muestra(def)}
                <div class="min-w-0"><div class="small text-body-secondary">${escaparHtml(def.nombreSingular)}</div>
                <div class="fw-semibold">${escaparHtml(p.titulo)}</div></div></div>
            <div class="d-flex gap-2 mb-3">
                <button class="btn btn-primario btn-sm flex-fill" type="button" data-accion="acercar"><i class="bi bi-zoom-in me-1" aria-hidden="true"></i>Acercar</button>
                <button class="btn btn-outline-secondary btn-sm flex-fill" type="button" data-accion="limpiar"><i class="bi bi-eraser me-1" aria-hidden="true"></i>Quitar selección</button>
            </div>
            <table class="table table-sm tabla-atributos mb-3"><tbody>${filas}</tbody></table>
            <details class="border rounded p-2 mb-3">
                <summary class="fw-semibold small">Datos técnicos</summary>
                <table class="table table-sm tabla-atributos mt-2 mb-0"><tbody>
                    <tr><th scope="row">Capa</th><td>${escaparHtml(def.nombre)}</td></tr>${filasTecnicas}
                    <tr><th scope="row">SRID</th><td>4326 (WGS 84)</td></tr>
                </tbody></table>
            </details>${coincidentes}`);
    }
    let ultimosGrupos = null;

    function mostrarDetalleCargando() {
        mostrarDetalleHtml('<div class="estado-vacio"><span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Consultando…</div>');
    }

    function mostrarDetalleHtml(html) {
        el('contenidoDetalle').innerHTML = html;
        if (esMovil()) bootstrap.Offcanvas.getOrCreateInstance(el('panelDetalle')).show();
        else if (!visor.classList.contains('con-detalle')) {
            visor.classList.add('con-detalle');
            window.dispatchEvent(new Event('visor:redimension'));
        }
        actualizarBotonDetalle();
    }

    function ocultarDetalle() {
        // Cerrar la ficha también cancela una consulta pendiente, sin quitar el resaltado actual.
        solicitudSeleccion++;
        if (esMovil()) bootstrap.Offcanvas.getOrCreateInstance(el('panelDetalle')).hide();
        if (visor.classList.contains('con-detalle')) {
            visor.classList.remove('con-detalle');
            window.dispatchEvent(new Event('visor:redimension'));
        }
        actualizarBotonDetalle();
    }

    function actualizarBotonDetalle() {
        const panel = el('panelDetalle');
        const visible = esMovil() ? panel.classList.contains('show') || panel.classList.contains('showing') : visor.classList.contains('con-detalle');
        const boton = el('btnVerDetalle');
        boton.classList.toggle('d-none', !seleccion || visible);
        boton.setAttribute('aria-expanded', String(visible));
    }

    function mostrarCapas(titulo = 'tituloCapas') {
        const panel = el('panelCapas');
        if (esMovil()) {
            ocultarDetalle();
            if (panel.classList.contains('show')) el(titulo).focus();
            else {
                panel.addEventListener('shown.bs.offcanvas', () => el(titulo).focus(), { once: true });
                bootstrap.Offcanvas.getOrCreateInstance(panel).show();
            }
            return;
        }
        if (window.matchMedia('(max-width: 1399.98px)').matches) ocultarDetalle();
        visor.classList.remove('sin-capas');
        window.dispatchEvent(new Event('visor:redimension'));
        el(titulo).focus();
    }

    // ------------------------------------------------------------------ resultados y consultas

    function mostrarResultados() {
        const panel = el('panelResultados');
        if (esMovil()) {
            ocultarDetalle();
            bootstrap.Offcanvas.getOrCreateInstance(panel).show();
        }
        else { panel.classList.remove('oculto'); window.dispatchEvent(new Event('visor:redimension')); }
    }

    function alternarResultados() {
        const panel = el('panelResultados');
        if (esMovil()) {
            if (panel.classList.contains('show')) bootstrap.Offcanvas.getOrCreateInstance(panel).hide();
            else mostrarResultados();
            return;
        }
        panel.classList.toggle('oculto');
        window.dispatchEvent(new Event('visor:redimension'));
    }

    function marcarFila() {
        document.querySelectorAll('#contenidoResultados tr.fila-seleccionada').forEach(tr => {
            tr.classList.remove('fila-seleccionada');
            tr.setAttribute('aria-selected', 'false');
        });
        if (!seleccion) return;
        const fila = document.querySelector(`#contenidoResultados tr[data-clave="${seleccion.capa}.${seleccion.id}"]`);
        if (fila) {
            fila.classList.add('fila-seleccionada');
            fila.setAttribute('aria-selected', 'true');
            fila.scrollIntoView({ block: 'nearest' });
        }
    }

    function actualizarChip(texto) {
        el('chipConsulta').classList.toggle('d-none', !texto);
        el('textoConsulta').textContent = texto || '';
    }

    function dibujarResultados(features, ajustar, extension) {
        capaResultados.clearLayers();
        capaResultados.addData({ type: 'FeatureCollection', features: features.filter(f => f.geometry) });
        if (!ajustar) return;
        if (extension) {
            const sw = L.latLng(extension.minY, extension.minX), ne = L.latLng(extension.maxY, extension.maxX);
            if (sw.equals(ne)) mapa.setView(sw, 18); else mapa.fitBounds(L.latLngBounds(sw, ne), { padding: [40, 40], maxZoom: 18 });
        } else acercarA(capaResultados);
    }

    async function buscarGeneral(texto) {
        const solicitud = ++solicitudConsulta;
        consulta = { tipo: 'general', texto };
        actualizarUrl({ texto });
        el('btnExportar').classList.add('d-none');
        el('tituloResultados').textContent = 'Resultados de la búsqueda';
        el('contenidoResultados').innerHTML = '<div class="estado-vacio"><span class="spinner-border spinner-border-sm me-2"></span>Buscando…</div>';
        mostrarResultados();
        try {
            const r = await VisorApi.get(`/api/busqueda/general?texto=${encodeURIComponent(texto)}`);
            if (solicitud !== solicitudConsulta) return;
            const total = r.grupos.reduce((s, g) => s + g.entidades.features.length, 0);
            actualizarChip(`Búsqueda «${texto}» · ${total} coincidencia(s) mostrada(s)`);
            el('tituloResultados').textContent = `Resultados de «${texto}» (${total} mostrados)`;
            if (!total) {
                el('contenidoResultados').innerHTML = `<div class="estado-vacio"><i class="bi bi-search fs-3 d-block mb-2" aria-hidden="true"></i>Sin resultados para «${escaparHtml(texto)}». Pruebe con otro texto o revise la ortografía.</div>`;
                capaResultados.clearLayers();
                return;
            }
            el('contenidoResultados').innerHTML = r.grupos.map(g => `
                <h3 class="h6 mt-2">${escaparHtml(g.nombre)} <span class="badge text-bg-secondary">${g.entidades.features.length}</span></h3>
                ${g.hayMas && g.capa !== 'codigosfijos' ? `<p class="small mb-2">Primeras 25 coincidencias. <a href="/Consultas?${escaparHtml(new URLSearchParams({ capa: g.capa, textoGeneral: texto }).toString())}">Ver más en Consultas</a></p>` : ''}
                ${g.limiteAlcanzado ? '<p class="small mb-2">Se muestran los primeros 100.</p>' : ''}
                <div class="table-responsive"><table class="table table-sm table-hover tabla-resultados mb-3" role="grid">
                <thead><tr><th scope="col">Entidad</th><th scope="col">Detalle</th><th scope="col"><span class="visually-hidden">Acción</span></th></tr></thead><tbody>
                ${g.entidades.features.map(f => filaGeneral(f)).join('')}</tbody></table></div>`).join('');
            dibujarResultados(r.grupos.flatMap(g => g.entidades.features), true, null);
            construirLeyenda();
        } catch (err) {
            if (solicitud !== solicitudConsulta) return;
            el('contenidoResultados').innerHTML = `<div class="alert alert-danger">${escaparHtml(err.message)}</div>`;
        }
    }

    function filaGeneral(f) {
        const p = f.properties;
        let detalle = '';
        if (p.capa === 'codigosfijos') detalle = `<span class="badge-estado">${simboloEstadoSvg(p.Estado)}${escaparHtml(p.EstadoDescripcion || '')}</span> ${[p.UV, p.MZA, p.NroLote].filter(Boolean).map(escaparHtml).join(' · ')}`;
        else if (p.capa === 'vias') detalle = escaparHtml(p.TipoVia || '');
        else if (p.capa === 'lotes') detalle = escaparHtml(p.NroLote || '');
        else if (p.capa === 'manzanas') detalle = escaparHtml(p.UV_MZA || '');
        return `<tr data-clave="${escaparHtml(p.capa)}.${p.id}" data-capa="${escaparHtml(p.capa)}" data-id="${p.id}" tabindex="0" aria-selected="false">
            <td>${escaparHtml(p.titulo)}</td><td class="small">${detalle}</td>
            <td class="text-end"><button class="btn btn-sm btn-outline-primary" type="button" data-accion="ver" aria-label="Acercar a ${escaparHtml(p.titulo)}"><i class="bi bi-zoom-in" aria-hidden="true"></i></button></td></tr>`;
    }

    async function consultarFiltros(capaId, filtros, pagina = 1, orden = null, desc = false, ajustar = true, textoGeneral = null) {
        const solicitud = ++solicitudConsulta;
        const def = catalogo.capas.find(c => c.id === capaId);
        if (!def) { avisar('La capa indicada no existe.', 'error'); return; }
        consulta = { tipo: 'filtros', capa: capaId, filtros, pagina, orden, desc, textoGeneral };
        actualizarUrl({ capa: capaId, filtros: JSON.stringify(filtros), textoGeneral });
        const parametros = new URLSearchParams({ capa: capaId, filtros: JSON.stringify(filtros) });
        if (orden) { parametros.set('orden', orden); parametros.set('desc', String(desc)); }
        if (textoGeneral) parametros.set('textoGeneral', textoGeneral);
        el('btnExportar').classList.add('d-none');
        el('contenidoResultados').innerHTML = '<div class="estado-vacio"><span class="spinner-border spinner-border-sm me-2"></span>Consultando…</div>';
        mostrarResultados();
        try {
            const r = await VisorApi.get(`/api/busqueda?${parametros}&pagina=${pagina}&tamano=${TAMANO_PAGINA}&geometria=true`);
            if (solicitud !== solicitudConsulta) return;
            const descripcion = filtros.map(x => {
                const campo = def.campos.find(c => c.clave === x.campo);
                const valor = campo?.tipo === 'Estado' ? (estados.get(Number(x.valor))?.nombre || x.valor) : x.valor;
                return `${campo?.etiqueta || x.campo} ${x.operador} «${valor}»`;
            }).join(' y ');
            const cantidad = r.resultados.features.length;
            const desde = cantidad ? (pagina - 1) * TAMANO_PAGINA + 1 : 0;
            const hasta = cantidad ? Math.min(r.total, desde + cantidad - 1) : 0;
            const criterio = [textoGeneral ? `«${textoGeneral}»` : '', descripcion].filter(Boolean).join(' y ') || 'todos';
            actualizarChip(`${def.nombre} · Mostrando ${Formato.numero(desde)}–${Formato.numero(hasta)} de ${Formato.numero(r.total)} · ${criterio}`);
            el('tituloResultados').textContent = `${def.nombre} (${Formato.numero(r.total)})`;
            const exportar = el('btnExportar');
            exportar.href = `/api/busqueda/csv?${parametros}`;
            exportar.classList.toggle('d-none', r.total === 0);
            if (!r.total) {
                el('contenidoResultados').innerHTML = '<div class="estado-vacio"><i class="bi bi-funnel fs-3 d-block mb-2" aria-hidden="true"></i>Sin resultados con los filtros indicados. Modifique o limpie los filtros.</div>';
                capaResultados.clearLayers();
                return;
            }
            const columnas = def.campos.filter(c => c.enTabla && !esCampoTecnico(c));
            const cabecera = columnas.map(c => {
                if (!c.ordenable) return `<th scope="col">${escaparHtml(c.etiqueta)}</th>`;
                const activo = orden === c.clave;
                const icono = activo ? (desc ? 'bi-sort-down' : 'bi-sort-up') : 'bi-arrow-down-up';
                return `<th scope="col" aria-sort="${activo ? (desc ? 'descending' : 'ascending') : 'none'}"><button class="orden" type="button" data-accion="ordenar" data-campo="${c.clave}">${escaparHtml(c.etiqueta)} <i class="bi ${icono}" aria-hidden="true"></i></button></th>`;
            }).join('');
            const filas = r.resultados.features.map(ft => {
                const p = ft.properties;
                return `<tr data-clave="${p.capa}.${p.id}" data-capa="${p.capa}" data-id="${p.id}" tabindex="0" aria-selected="false">
                    ${columnas.map(c => `<td>${formatearValor(c, p[c.clave], p)}</td>`).join('')}
                    <td class="text-end"><button class="btn btn-sm btn-outline-primary" type="button" data-accion="ver" aria-label="Acercar"><i class="bi bi-zoom-in" aria-hidden="true"></i></button></td></tr>`;
            }).join('');
            el('contenidoResultados').innerHTML = `
                <div class="table-responsive"><table class="table table-sm table-hover tabla-resultados mb-2" role="grid">
                <thead><tr>${cabecera}<th scope="col"><span class="visually-hidden">Acción</span></th></tr></thead><tbody>${filas}</tbody></table></div>
                <nav class="d-flex align-items-center gap-2 flex-wrap" aria-label="Paginación de resultados">
                    <button class="btn btn-sm btn-outline-secondary" type="button" data-accion="pagina" data-pagina="${pagina - 1}" ${pagina <= 1 ? 'disabled' : ''}>Anterior</button>
                    <span class="small">Página ${pagina} de ${r.totalPaginas} · ${Formato.numero(r.total)} entidades</span>
                    <button class="btn btn-sm btn-outline-secondary" type="button" data-accion="pagina" data-pagina="${pagina + 1}" ${pagina >= r.totalPaginas ? 'disabled' : ''}>Siguiente</button>
                </nav>`;
            dibujarResultados(r.resultados.features, ajustar, ajustar ? r.extension : null);
            marcarFila();
            construirLeyenda();
        } catch (err) {
            if (solicitud !== solicitudConsulta) return;
            el('contenidoResultados').innerHTML = `<div class="alert alert-danger">${escaparHtml(err.message)}</div>`;
        }
    }

    function limpiarConsulta() {
        solicitudConsulta++;
        consulta = null;
        capaResultados.clearLayers();
        actualizarChip(null);
        el('contenidoResultados').innerHTML = '<div class="estado-vacio">No hay una consulta activa. Use la búsqueda o la página de Consultas.</div>';
        el('btnExportar').classList.add('d-none');
        el('textoBusqueda').value = '';
        actualizarUrl({});
        construirLeyenda();
    }

    function actualizarUrl(parametros) {
        const u = new URL(location.href);
        ['texto', 'capa', 'filtros', 'textoGeneral', 'id', 'panel'].forEach(k => u.searchParams.delete(k));
        Object.entries(parametros).forEach(([k, v]) => v && u.searchParams.set(k, v));
        history.replaceState(null, '', u);
    }

    function irAExtension(ext) {
        if (!ext) { mapa.setView([-16.38, -60.96], 14); return; }
        mapa.fitBounds([[ext.minY, ext.minX], [ext.maxY, ext.maxX]], { padding: [20, 20] });
    }

    async function procesarParametros() {
        const q = new URLSearchParams(location.search);
        const panel = q.get('panel');
        if (panel === 'capas' || panel === 'herramientas') {
            mostrarCapas(panel === 'capas' ? 'tituloCapas' : 'tituloHerramientas');
        }
        if (q.get('texto')) {
            el('textoBusqueda').value = q.get('texto');
            await buscarGeneral(q.get('texto'));
        } else if (q.get('capa') && (q.get('filtros') || q.get('textoGeneral'))) {
            let filtros = [];
            try { filtros = JSON.parse(q.get('filtros') || '[]'); } catch { avisar('Los filtros de la dirección no son válidos.', 'error'); }
            await consultarFiltros(q.get('capa'), filtros, 1, null, false, true, q.get('textoGeneral'));
        }
        if (q.get('capa') && q.get('id')) await seleccionar(q.get('capa'), q.get('id'), { acercar: true });
    }

    // ------------------------------------------------------------------ eventos

    function enlazarEventos() {
        el('listaCapas').addEventListener('change', e => {
            const id = e.target.dataset.capa;
            if (!id) return;
            const c = capas.get(id);
            c.visible = e.target.checked;
            if (c.visible) c.capa.addTo(mapa); else { mapa.removeLayer(c.capa); c.capa.clearLayers(); }
            Preferencias.guardar('visor.capasVisibles', JSON.stringify([...capas.values()].filter(x => x.visible).map(x => x.def.id)));
            cargarCapas();
        });

        el('formBusqueda').addEventListener('submit', e => {
            e.preventDefault();
            const texto = el('textoBusqueda').value.trim();
            if (texto.length < 2) { avisar('Escriba al menos 2 caracteres para buscar.', 'advertencia'); el('textoBusqueda').focus(); return; }
            buscarGeneral(texto);
        });

        el('btnExtension').addEventListener('click', () => irAExtension(catalogo.extensionGeneral));
        el('btnLimpiar').addEventListener('click', limpiarSeleccion);
        el('btnVerResultados').addEventListener('click', alternarResultados);
        el('btnResultadosMovil').addEventListener('click', alternarResultados);
        el('btnCapas').addEventListener('click', () => {
            if (esMovil()) {
                const panel = el('panelCapas');
                if (panel.classList.contains('show')) bootstrap.Offcanvas.getOrCreateInstance(panel).hide();
                else mostrarCapas();
                return;
            }
            if (visor.classList.contains('con-detalle') && window.matchMedia('(max-width: 1399.98px)').matches) {
                mostrarCapas();
                return;
            }
            visor.classList.toggle('sin-capas');
            window.dispatchEvent(new Event('visor:redimension'));
        });
        el('btnCerrarResultados').addEventListener('click', () => {
            if (esMovil()) bootstrap.Offcanvas.getOrCreateInstance(el('panelResultados')).hide();
            else { el('panelResultados').classList.add('oculto'); window.dispatchEvent(new Event('visor:redimension')); }
        });
        el('btnCerrarDetalle').addEventListener('click', () => {
            ocultarDetalle();
            if (!esMovil()) (seleccion ? el('btnVerDetalle') : el('textoBusqueda')).focus();
        });
        el('btnVerDetalle').addEventListener('click', () => {
            if (fichaSeleccion) renderDetalle(fichaSeleccion.feature, fichaSeleccion.grupos);
            if (!esMovil()) el('btnCerrarDetalle').focus();
        });
        // Cancelar antes de la animación evita que una respuesta pendiente reabra la ficha.
        el('panelDetalle').addEventListener('hide.bs.offcanvas', () => { solicitudSeleccion++; });
        el('panelDetalle').addEventListener('hidden.bs.offcanvas', () => {
            actualizarBotonDetalle();
            if (el('panelDetalle').contains(document.activeElement)) (seleccion ? el('btnVerDetalle') : el('textoBusqueda')).focus();
        });
        window.addEventListener('resize', actualizarBotonDetalle);
        el('btnQuitarConsulta').addEventListener('click', limpiarConsulta);

        el('menuLateral').addEventListener('click', e => {
            const enlace = e.target.closest('a[href]');
            if (!enlace || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
            const url = new URL(enlace.href, location.href);
            if (url.origin !== location.origin) return;
            const panel = url.pathname.toLowerCase() === '/visor' ? url.searchParams.get('panel') : null;
            const resultados = url.pathname.toLowerCase() === '/consultas' && url.hash === '#resultados';
            if (!['capas', 'herramientas'].includes(panel) && !resultados) return;
            e.preventDefault();
            const abrir = () => {
                if (resultados) mostrarResultados();
                else mostrarCapas(panel === 'herramientas' ? 'tituloHerramientas' : 'tituloCapas');
            };
            const menu = el('menuLateral');
            if (esMovil() && menu.classList.contains('show')) {
                menu.addEventListener('hidden.bs.offcanvas', abrir, { once: true });
                bootstrap.Offcanvas.getOrCreateInstance(menu).hide();
            } else abrir();
        });

        estadoMapa.addEventListener('click', e => {
            const accion = e.target.closest('[data-accion]')?.dataset.accion;
            if (accion === 'reintentar') cargarCapas();
            if (accion === 'recargar') location.reload();
        });

        el('contenidoDetalle').addEventListener('click', e => {
            const b = e.target.closest('[data-accion]');
            if (!b) return;
            if (b.dataset.accion === 'acercar') acercarA(capaResaltado);
            if (b.dataset.accion === 'limpiar') limpiarSeleccion();
            if (b.dataset.accion === 'coincidente') seleccionar(b.dataset.capa, b.dataset.id, { acercar: false, grupos: ultimosGrupos });
        });

        const resultados = el('contenidoResultados');
        resultados.addEventListener('click', e => {
            const b = e.target.closest('[data-accion]');
            if (b?.dataset.accion === 'pagina' && consulta?.tipo === 'filtros') {
                consultarFiltros(consulta.capa, consulta.filtros, Number(b.dataset.pagina), consulta.orden, consulta.desc, false, consulta.textoGeneral);
                return;
            }
            if (b?.dataset.accion === 'ordenar' && consulta?.tipo === 'filtros') {
                const campo = b.dataset.campo;
                const desc = consulta.orden === campo ? !consulta.desc : false;
                consultarFiltros(consulta.capa, consulta.filtros, 1, campo, desc, false, consulta.textoGeneral);
                return;
            }
            const fila = e.target.closest('tr[data-clave]');
            if (fila) {
                seleccionar(fila.dataset.capa, fila.dataset.id, { acercar: true });
                if (esMovil()) bootstrap.Offcanvas.getOrCreateInstance(el('panelResultados')).hide();
            }
        });
        resultados.addEventListener('keydown', e => {
            const fila = e.target.closest('tr[data-clave]');
            if (fila && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); seleccionar(fila.dataset.capa, fila.dataset.id, { acercar: true }); }
        });
    }

    iniciar();
})();
