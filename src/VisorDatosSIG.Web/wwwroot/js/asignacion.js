// VisorDatosSIG · asignación de cortes y reconexiones con ruta óptima (Dijkstra sobre dbo.Vias, calculada en la API).
'use strict';
(() => {
    const raiz = document.getElementById('asignacion');
    if (!raiz) return;
    const tipo = raiz.dataset.tipo;                       // 'Corte' | 'Reconexion'
    const el = id => document.getElementById(id);
    const nombreTrabajador = tipo === 'Corte' ? 'cortador' : 'reconectador';
    const colorCandidato = tipo === 'Corte' ? '#FD7E14' : '#DC3545';   // mismos colores de estado que el visor

    const mapa = crearMapaBase('mapa');
    const capaCandidatos = L.layerGroup().addTo(mapa);
    const capaActiva = L.layerGroup().addTo(mapa);
    const capaPropuesta = L.layerGroup().addTo(mapa);
    const sel = el('selTrabajador');
    let trabajadores = [];
    let activa = null;           // ruta guardada del trabajador (null si no tiene)
    let propuesta = null;        // ruta calculada y aún no guardada
    let partida = null;
    let marcadorPartida = null;
    let vigente = 0;             // solo se aplica la respuesta de la última solicitud

    const trabajadorActual = () => trabajadores.find(t => String(t.idUsuario) === sel.value) || null;
    const etiquetaCodigo = x => escaparHtml(String(x.codFijo ?? x.idCodigo));

    function mensaje(texto, tipoAlerta = 'info', esHtml = false) {
        el('mensaje').innerHTML = texto
            ? `<div class="alert alert-${tipoAlerta} py-2 mb-0">${esHtml ? texto : escaparHtml(texto)}</div>`
            : '';
    }

    function ocupado(si) {
        el('btnCalcular').disabled = si;
        el('btnGuardar').disabled = si || !propuesta;
    }

    async function cargarTrabajadores(mantenerSeleccion) {
        try {
            const previo = mantenerSeleccion ? sel.value : '';
            trabajadores = await VisorApi.get(`/api/asignaciones/trabajadores?tipo=${tipo}`);
            sel.innerHTML = `<option value="">-- Seleccione un ${nombreTrabajador} --</option>` + trabajadores.map(t =>
                `<option value="${t.idUsuario}">${escaparHtml(t.nombre)} (${escaparHtml(t.login)}) · ${t.pendientes} pendiente(s)</option>`).join('');
            if (previo && trabajadores.some(t => String(t.idUsuario) === previo)) sel.value = previo;
            if (!trabajadores.length)
                mensaje(`No hay usuarios activos con el rol ${tipo === 'Corte' ? 'Cortador' : 'Reconexion'}. Créelos en Administración → Usuarios.`, 'warning');
        } catch (err) {
            mensaje(err.message, 'danger');
        }
    }

    async function cargarCandidatos() {
        try {
            const lista = await VisorApi.get(`/api/asignaciones/candidatos?tipo=${tipo}`);
            capaCandidatos.clearLayers();
            for (const c of lista) {
                L.circleMarker(aLatLng(c.punto), { radius: 4, color: '#ffffff', weight: 1, fillColor: colorCandidato, fillOpacity: .9 })
                    .bindTooltip(`Código ${etiquetaCodigo(c)} · ${escaparHtml(c.nombre || 'Sin nombre')}`)
                    .addTo(capaCandidatos);
            }
            el('disponibles').textContent =
                `${Formato.numero(lista.length)} código(s) ${tipo === 'Corte' ? '«Para Corte»' : '«Cortado»'} sin asignar (puntos ${tipo === 'Corte' ? 'naranjas' : 'rojos'} en el mapa).`;
            if (lista.length && !partida)
                mapa.fitBounds(L.latLngBounds(lista.map(c => aLatLng(c.punto))), { padding: [30, 30], maxZoom: 16 });
        } catch (err) {
            mensaje(err.message, 'danger');
        }
    }

    async function cargarActiva() {
        const t = trabajadorActual();
        activa = null;
        capaActiva.clearLayers();
        actualizarPendientes();
        if (!t) { pintarLista(null, 'activa'); return; }
        const solicitud = ++vigente;
        try {
            const a = await VisorApi.get(`/api/asignaciones/activa?tipo=${tipo}&trabajador=${t.idUsuario}`);
            if (solicitud !== vigente) return;
            activa = a;              // la API responde 204 (null) si no tiene ruta activa
            actualizarPendientes();
            if (!propuesta) {
                dibujarActiva();
                pintarLista(activa ? activa.paradas : null, 'activa');
            }
        } catch (err) {
            if (solicitud === vigente) mensaje(err.message, 'danger');
        }
    }

    function actualizarPendientes() {
        const pendientes = activa ? activa.paradas.filter(p => p.estado === 'Pendiente').length : 0;
        const realizadas = activa ? activa.paradas.length - pendientes : 0;
        el('pendientes').innerHTML = `Pendientes actuales: <strong>${pendientes}</strong>`
            + (activa ? ` · ${realizadas} realizada(s) · ruta de ${formatoDistancia(activa.distanciaMetros)}` : '');
        el('btnAnular').classList.toggle('d-none', !activa);
    }

    function dibujarActiva() {
        capaActiva.clearLayers();
        if (!activa) return;
        for (const p of activa.paradas) {
            if (p.tramo && p.tramo.length > 1)
                L.polyline(p.tramo.map(aLatLng), { color: '#1c6fd1', weight: 3, opacity: .5 }).addTo(capaActiva);
            L.marker(aLatLng(p.punto), { icon: iconoNumero(p.orden, p.estado === 'Pendiente' ? '' : 'realizada'), keyboard: false })
                .bindTooltip(`#${p.orden} · Código ${etiquetaCodigo(p)} · ${escaparHtml(p.nombre || '')} · ${escaparHtml(p.estado)}`)
                .addTo(capaActiva);
        }
    }

    function dibujarPropuesta() {
        capaActiva.clearLayers();
        capaPropuesta.clearLayers();
        const p = propuesta;
        if (p.trazado.length > 1)
            L.polyline(p.trazado.map(aLatLng), { color: '#1c6fd1', weight: 4, opacity: .9 }).addTo(capaPropuesta);
        for (const x of p.paradas) {
            // Tramo final de la calle a la casa: punteado, porque no va por una vía.
            L.polyline([aLatLng(x.enRed), aLatLng(x.punto)], { color: '#1c6fd1', weight: 2, dashArray: '4 4' }).addTo(capaPropuesta);
            L.marker(aLatLng(x.punto), { icon: iconoNumero(x.orden, x.eraPendiente ? 'pendiente-previo' : ''), keyboard: false })
                .bindTooltip(`#${x.orden} · Código ${etiquetaCodigo(x)} · ${escaparHtml(x.nombre || '')} · tramo ${formatoDistancia(x.distanciaTramo)}`
                    + (x.eraPendiente ? ' · ya estaba pendiente' : ''))
                .addTo(capaPropuesta);
        }
        const limites = L.latLngBounds(p.trazado.map(aLatLng));
        if (limites.isValid()) mapa.fitBounds(limites, { padding: [40, 40], maxZoom: 17 });
    }

    function pintarLista(paradas, origen) {
        const lista = el('listaParadas');
        el('tituloLista').textContent = origen === 'propuesta' ? 'Ruta propuesta (aún sin guardar)' : 'Asignaciones pendientes del usuario';
        if (!paradas || !paradas.length) {
            lista.innerHTML = `<li class="text-body-secondary">${trabajadorActual() ? 'El usuario no tiene paradas asignadas.' : `Seleccione un ${nombreTrabajador}.`}</li>`;
            el('resumenRuta').textContent = '';
            lista.paradas = [];
            return;
        }
        lista.paradas = paradas;
        lista.innerHTML = paradas.map((x, i) => {
            const realizada = x.estado && x.estado !== 'Pendiente';
            return `<li tabindex="0" data-i="${i}" class="${realizada ? 'realizada' : ''}">
                <span class="num">#${x.orden}</span>
                <span>${etiquetaCodigo(x)} - ${escaparHtml(x.nombre || 'Sin nombre')}${x.eraPendiente ? ' <span class="badge text-bg-light border">pendiente</span>' : ''}${realizada ? ` <span class="badge text-bg-secondary">${escaparHtml(x.estado)}</span>` : ''}</span>
                <span class="dist">${formatoDistancia(x.distanciaTramo)}</span></li>`;
        }).join('');
        el('resumenRuta').textContent = `${paradas.length} parada(s)`;
    }

    function acercarAParada(evento) {
        const li = evento.target.closest('li[data-i]');
        const lista = el('listaParadas');
        if (!li || !lista.paradas) return;
        const x = lista.paradas[Number(li.dataset.i)];
        if (x) mapa.setView(aLatLng(x.punto), Math.max(mapa.getZoom(), 18));
    }

    function fijarPartida(latlng) {
        partida = latlng;
        if (!marcadorPartida) {
            marcadorPartida = L.marker(latlng, { icon: iconoPartida(), draggable: true, title: 'Punto de partida', zIndexOffset: 1000 }).addTo(mapa);
            marcadorPartida.on('dragend', () => fijarPartida(marcadorPartida.getLatLng()));
        } else {
            marcadorPartida.setLatLng(latlng);
        }
        el('textoPartida').textContent = `${latlng.lat.toFixed(8)}, ${latlng.lng.toFixed(8)}`;
        el('avisoMapa').classList.add('d-none');
        invalidarPropuesta();
    }

    /** Cualquier cambio de datos obliga a recalcular antes de guardar. */
    function invalidarPropuesta() {
        if (propuesta) {
            propuesta = null;
            capaPropuesta.clearLayers();
            dibujarActiva();
            pintarLista(activa ? activa.paradas : null, 'activa');
        }
        el('btnGuardar').disabled = true;
    }

    function solicitud() {
        const t = trabajadorActual();
        if (!t) throw new Error(`Seleccione un ${nombreTrabajador}.`);
        if (!partida) throw new Error('Marque en el mapa el punto de partida.');
        const cantidad = Number(el('cantidad').value);
        if (!Number.isInteger(cantidad) || cantidad < 0) throw new Error('La cantidad debe ser un número entero mayor o igual a 0.');
        return { tipo, idTrabajador: t.idUsuario, cantidad, lat: partida.lat, lon: partida.lng };
    }

    async function calcular() {
        let datos;
        try { datos = solicitud(); } catch (err) { mensaje(err.message, 'warning'); return; }
        const s = ++vigente;
        ocupado(true);
        mensaje('Calculando la ruta por las calles…');
        try {
            const p = await VisorApi.post('/api/asignaciones/calcular', datos);
            if (s !== vigente) return;
            propuesta = p;
            dibujarPropuesta();
            pintarLista(p.paradas, 'propuesta');
            const excluidas = p.excluidas.length
                ? ` ${p.excluidas.length} código(s) quedaron fuera por estar a más de 500 m de una vía.` : '';
            mensaje(`Ruta calculada con la red local de vías (Dijkstra): <strong>${p.paradas.length}</strong> parada(s) `
                + `(${p.nuevas} nueva(s) y ${p.pendientesPrevios} pendiente(s)) · ${formatoDistancia(p.distanciaMetros)} · `
                + `≈ ${formatoDuracion(p.duracionMin)}. Revise el orden antes de guardar.${escaparHtml(excluidas)}`, 'success', true);
        } catch (err) {
            if (s === vigente) mensaje(err.message, 'danger');
        } finally {
            if (s === vigente) ocupado(false);
        }
    }

    async function guardar() {
        let datos;
        try { datos = solicitud(); } catch (err) { mensaje(err.message, 'warning'); return; }
        if (!propuesta) return;
        const s = ++vigente;
        ocupado(true);
        try {
            const r = await VisorApi.post('/api/asignaciones', datos);
            if (s !== vigente) return;
            propuesta = null;
            capaPropuesta.clearLayers();
            avisar(`Asignación guardada: ${r.propuesta.paradas.length} parada(s).`, 'exito');
            mensaje('Asignación guardada. El trabajador ya la ve en su aplicación móvil.', 'success');
            await Promise.all([cargarTrabajadores(true), cargarCandidatos()]);
            await cargarActiva();
        } catch (err) {
            if (s === vigente) mensaje(err.message, 'danger');
        } finally {
            if (s === vigente) ocupado(false);
        }
    }

    async function anular() {
        if (!activa) return;
        const t = trabajadorActual();
        if (!confirm(`¿Anular la asignación activa de ${t ? t.nombre : 'este usuario'}? Las paradas pendientes quedarán libres para reasignarse.`)) return;
        try {
            await VisorApi.post(`/api/asignaciones/${activa.idAsignacion}/anular`);
            avisar('Asignación anulada.', 'exito');
            invalidarPropuesta();
            await Promise.all([cargarTrabajadores(true), cargarCandidatos()]);
            await cargarActiva();
        } catch (err) {
            mensaje(err.message, 'danger');
        }
    }

    mapa.on('click', e => fijarPartida(e.latlng));
    sel.addEventListener('change', () => { invalidarPropuesta(); mensaje(''); cargarActiva(); });
    el('cantidad').addEventListener('input', invalidarPropuesta);
    el('btnCalcular').addEventListener('click', calcular);
    el('btnGuardar').addEventListener('click', guardar);
    el('btnAnular').addEventListener('click', anular);
    el('listaParadas').addEventListener('click', acercarAParada);
    el('listaParadas').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); acercarAParada(e); } });

    cargarTrabajadores(false);
    cargarCandidatos();
})();
