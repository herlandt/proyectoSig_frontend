// VisorDatosSIG · visualización general 2D/3D con MapLibre GL JS (compilación CSP: el worker se sirve desde el propio sitio).
// Las capas se piden por la extensión visible y el zoom, igual que en el visor 2D (/api/capas/{capa}/geojson).
'use strict';
(() => {
    const raiz = document.getElementById('mapa3d');
    if (!raiz) return;
    const el = id => document.getElementById(id);
    const lienzo = el('lienzo3d');
    if (!window.maplibregl) {
        lienzo.innerHTML = '<div class="estado-vacio">No se pudo cargar la biblioteca de mapas.</div>';
        return;
    }
    maplibregl.setWorkerUrl('/lib/maplibre-gl/maplibre-gl-csp-worker.js');

    const VACIO = { type: 'FeatureCollection', features: [] };
    const CAPAS = ['manzanas', 'lotes', 'vias', 'codigosfijos'];
    const CASILLA = { manzanas: 'capaManzanas', lotes: 'capaLotes', vias: 'capaVias', codigosfijos: 'capaCodigos' };
    const MAXIMO_ETIQUETAS = 600;
    let catalogo = null;
    let temporizador = null;
    const controladores = {};
    let popup = null;
    let marcadorBusqueda = null;
    let etiquetas = [];

    let mapa;
    try {
        mapa = new maplibregl.Map({
            container: lienzo,
            style: {
                version: 8,
                sources: {
                    osm: {
                        type: 'raster', tileSize: 256, maxzoom: 19, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>',
                    },
                    satelite: {
                        type: 'raster', tileSize: 256, maxzoom: 17,
                        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                        attribution: 'Imágenes &copy; Esri, Maxar, Earthstar Geographics',
                    },
                    manzanas: { type: 'geojson', data: VACIO },
                    lotes: { type: 'geojson', data: VACIO },
                    vias: { type: 'geojson', data: VACIO },
                    codigosfijos: { type: 'geojson', data: VACIO },
                },
                layers: [
                    { id: 'fondo', type: 'background', paint: { 'background-color': '#eef2f6' } },
                    { id: 'osm', type: 'raster', source: 'osm' },
                    { id: 'satelite', type: 'raster', source: 'satelite', layout: { visibility: 'none' } },
                    { id: 'manzanas-plano', type: 'fill', source: 'manzanas', paint: { 'fill-color': '#e9a3ad', 'fill-opacity': .45 } },
                    { id: 'manzanas-3d', type: 'fill-extrusion', source: 'manzanas', paint: { 'fill-extrusion-color': '#e9a3ad', 'fill-extrusion-height': 9, 'fill-extrusion-opacity': .75 } },
                    { id: 'manzanas-borde', type: 'line', source: 'manzanas', paint: { 'line-color': '#c2185b', 'line-width': 1 } },
                    { id: 'lotes-borde', type: 'line', source: 'lotes', paint: { 'line-color': '#B7791F', 'line-width': 1 } },
                    { id: 'vias', type: 'line', source: 'vias', layout: { 'line-join': 'round', 'line-cap': 'round' },
                        paint: { 'line-color': '#1f2a44', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 15, 3, 18, 6] } },
                    { id: 'codigos', type: 'circle', source: 'codigosfijos',
                        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2.5, 16, 5, 19, 8], 'circle-color': '#198754',
                                 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } },
                ],
            },
            center: [-60.9605, -16.3785], zoom: 14.4, pitch: 55, bearing: -18, maxPitch: 75,
            attributionControl: { compact: true, customAttribution: 'MapLibre GL JS · WGS 84 / EPSG:4326' },
        });
    } catch {
        lienzo.innerHTML = '<div class="estado-vacio">Este navegador no admite WebGL: use el visor 2D en «Información geográfica».</div>';
        return;
    }
    mapa.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    mapa.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    async function iniciar() {
        try {
            catalogo = await VisorApi.get('/api/capas');
        } catch (err) {
            avisar(err.message, 'error');
            return;
        }
        // Mismo color por estado que en el visor 2D y la leyenda.
        const color = ['match', ['get', 'Estado']];
        for (const e of catalogo.estados) color.push(e.valor, e.color);
        color.push('#6c757d');
        mapa.setPaintProperty('codigos', 'circle-color', color);
        el('selEstado').innerHTML = '<option value="">Todos los estados</option>'
            + catalogo.estados.map(e => `<option value="${e.valor}">${escaparHtml(e.nombre)}</option>`).join('');
        el('leyendaEstados').innerHTML = catalogo.estados.map(e =>
            `<span><span class="muestra-punto" style="background:${e.color}"></span>${escaparHtml(e.nombre)}</span>`).join('');
        aplicarVista(false);
        programarCarga();
    }

    function bbox() {
        const b = mapa.getBounds();
        return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
            .map((v, i) => Math.max(i % 2 ? -90 : -180, Math.min(i % 2 ? 90 : 180, v)).toFixed(6)).join(',');
    }

    function programarCarga() {
        clearTimeout(temporizador);
        temporizador = setTimeout(cargarCapas, 250);
    }

    function cargarCapas() {
        if (!catalogo) return;
        const zoom = Math.round(mapa.getZoom());
        const caja = bbox();
        const lejos = [];
        for (const id of CAPAS) {
            controladores[id]?.abort();
            const def = catalogo.capas.find(c => c.id === id);
            const visible = el(CASILLA[id]).checked;
            mapa.setLayoutProperty(capaVisual(id), 'visibility', visible ? 'visible' : 'none');
            if (!visible || !def) { mapa.getSource(id).setData(VACIO); continue; }
            if (zoom < def.zoomMinimo) {
                mapa.getSource(id).setData(VACIO);
                lejos.push(`${def.nombre} (zoom ≥ ${def.zoomMinimo})`);
                continue;
            }
            const controlador = controladores[id] = new AbortController();
            VisorApi.get(`/api/capas/${id}/geojson?bbox=${caja}&zoom=${zoom}`, { signal: controlador.signal })
                .then(fc => { if (!controlador.signal.aborted) mapa.getSource(id).setData(fc); })
                .catch(err => { if (err.name !== 'AbortError') avisar(err.message, 'error'); });
        }
        cargarDimensiones(zoom, caja, lejos);
        el('avisoZoom3d').textContent = lejos.length ? `Acerque el mapa para ver: ${lejos.join(', ')}.` : '';
    }

    /** Capa visual principal de cada fuente (para mostrarla u ocultarla). */
    const capaVisual = id => ({ manzanas: 'manzanas-borde', lotes: 'lotes-borde', vias: 'vias', codigosfijos: 'codigos' })[id];

    function borrarEtiquetas() {
        etiquetas.forEach(m => m.remove());
        etiquetas = [];
    }

    /** Dimensiones y superficie: marcadores HTML que giran con el mapa (no requieren tipografías externas). */
    function cargarDimensiones(zoom, caja, lejos) {
        controladores.dimensiones?.abort();
        if (!el('capaDimensiones').checked) { borrarEtiquetas(); return; }
        const capas = [];
        if (zoom >= 17 && el('capaManzanas').checked) capas.push('manzanas');
        if (zoom >= 18 && el('capaLotes').checked) capas.push('lotes');
        if (!capas.length) {
            borrarEtiquetas();
            lejos.push('Dimensiones y superficie (zoom ≥ 17 con manzanas, ≥ 18 con lotes)');
            return;
        }
        const controlador = controladores.dimensiones = new AbortController();
        Promise.all(capas.map(c => VisorApi.get(`/api/capas/${c}/dimensiones?bbox=${caja}&zoom=${zoom}`, { signal: controlador.signal })))
            .then(colecciones => {
                if (controlador.signal.aborted) return;
                borrarEtiquetas();
                const features = colecciones.flatMap(c => c.features).slice(0, MAXIMO_ETIQUETAS);
                for (const f of features) {
                    const div = document.createElement('div');
                    div.className = `etiqueta-dimension ${f.properties.tipo}`;
                    div.textContent = f.properties.texto;
                    etiquetas.push(new maplibregl.Marker({ element: div, rotation: -f.properties.angulo, rotationAlignment: 'map', pitchAlignment: 'map' })
                        .setLngLat(f.geometry.coordinates).addTo(mapa));
                }
            })
            .catch(err => { if (err.name !== 'AbortError') avisar(err.message, 'error'); });
    }

    function aplicarVista(animar = true) {
        const tresD = el('vista3d').checked;
        mapa.setLayoutProperty('manzanas-3d', 'visibility', tresD ? 'visible' : 'none');
        mapa.setLayoutProperty('manzanas-plano', 'visibility', tresD ? 'none' : 'visible');
        const destino = tresD ? { pitch: 55, bearing: -18 } : { pitch: 0, bearing: 0 };
        if (animar) mapa.easeTo({ ...destino, duration: 800 }); else mapa.jumpTo(destino);
    }

    function aplicarFondo() {
        const fondo = el('selFondo').value;
        mapa.setLayoutProperty('osm', 'visibility', fondo === 'osm' ? 'visible' : 'none');
        mapa.setLayoutProperty('satelite', 'visibility', fondo === 'satelite' ? 'visible' : 'none');
    }

    async function mostrarCodigo(id, lngLat) {
        popup?.remove();
        popup = new maplibregl.Popup({ maxWidth: '280px' }).setLngLat(lngLat).setHTML('<div class="small">Cargando…</div>').addTo(mapa);
        try {
            const f = await VisorApi.get(`/api/capas/codigosfijos/${encodeURIComponent(id)}`);
            const p = f.properties;
            popup.setHTML(`<div class="small"><strong>${escaparHtml(p.titulo)}</strong><br>
                Estado: ${escaparHtml(p.EstadoDescripcion ?? '')}<br>Código SIG: ${escaparHtml(p.CodF_SIG ?? '—')}<br>
                Lote: ${escaparHtml(p.NroLote ?? '—')} · ${escaparHtml(p.UV ?? '')} ${escaparHtml(p.MZA ?? '')}</div>`);
        } catch (err) {
            popup.setHTML(`<div class="small text-danger">${escaparHtml(err.message)}</div>`);
        }
    }

    async function buscar(texto) {
        const lista = el('resultadosBusqueda3d');
        lista.innerHTML = '<li class="text-body-secondary">Buscando…</li>';
        try {
            const r = await VisorApi.get(`/api/busqueda/general?texto=${encodeURIComponent(texto)}`);
            const codigos = r.grupos.filter(g => g.capa === 'codigosfijos').flatMap(g => g.entidades.features)
                .filter(f => f.geometry && f.geometry.type === 'Point').slice(0, 10);
            lista.innerHTML = codigos.length
                ? codigos.map((f, i) => `<li><button class="btn btn-link btn-sm p-0 text-start" type="button" data-i="${i}">${escaparHtml(f.properties.titulo)}</button></li>`).join('')
                : '<li class="text-body-secondary">Sin códigos fijos para esa búsqueda.</li>';
            lista.resultados = codigos;
        } catch (err) {
            lista.innerHTML = `<li class="text-danger">${escaparHtml(err.message)}</li>`;
        }
    }

    function irA(feature) {
        const [lon, lat] = feature.geometry.coordinates;
        marcadorBusqueda?.remove();
        marcadorBusqueda = new maplibregl.Marker({ color: '#ffd400' }).setLngLat([lon, lat]).addTo(mapa);
        mapa.flyTo({ center: [lon, lat], zoom: 18, duration: 1200 });
        mostrarCodigo(feature.properties.id, [lon, lat]);
    }

    mapa.on('load', iniciar);
    mapa.on('moveend', programarCarga);
    mapa.on('zoom', () => { el('indicadorZoom').textContent = `Zoom: ${mapa.getZoom().toFixed(1)}`; });
    mapa.on('click', 'codigos', e => { const f = e.features?.[0]; if (f) mostrarCodigo(f.properties.id, e.lngLat); });
    mapa.on('mouseenter', 'codigos', () => { mapa.getCanvas().style.cursor = 'pointer'; });
    mapa.on('mouseleave', 'codigos', () => { mapa.getCanvas().style.cursor = ''; });

    document.querySelectorAll('input[name="vista"]').forEach(r => r.addEventListener('change', () => aplicarVista(true)));
    el('selFondo').addEventListener('change', aplicarFondo);
    el('selEstado').addEventListener('change', () => {
        const v = el('selEstado').value;
        mapa.setFilter('codigos', v ? ['==', ['get', 'Estado'], Number(v)] : null);
    });
    Object.values(CASILLA).concat('capaDimensiones').forEach(id => el(id).addEventListener('change', cargarCapas));
    el('btnInclinada').addEventListener('click', () => mapa.easeTo({ pitch: 60, duration: 700 }));
    el('btnSuperior').addEventListener('click', () => mapa.easeTo({ pitch: 0, bearing: 0, duration: 700 }));
    el('btnLimpiar3d').addEventListener('click', () => {
        popup?.remove();
        marcadorBusqueda?.remove();
        el('resultadosBusqueda3d').innerHTML = '';
        el('textoBusqueda3d').value = '';
    });
    el('formBusqueda3d').addEventListener('submit', e => {
        e.preventDefault();
        const t = el('textoBusqueda3d').value.trim();
        if (t.length >= 2) buscar(t);
    });
    el('resultadosBusqueda3d').addEventListener('click', e => {
        const b = e.target.closest('button[data-i]');
        const lista = el('resultadosBusqueda3d');
        if (b && lista.resultados) irA(lista.resultados[Number(b.dataset.i)]);
    });
    window.addEventListener('resize', () => mapa.resize());
})();
