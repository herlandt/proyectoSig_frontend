// VisorDatosSIG · monitoreo del personal: posición en vivo y reproducción del recorrido del día.
// El recorrido llega ya ajustado a las calles (Dijkstra entre posiciones consecutivas, en la API).
'use strict';
(() => {
    const raiz = document.getElementById('monitoreo');
    if (!raiz) return;
    const el = id => document.getElementById(id);
    const INTERVALO_VIVO = 30000;
    const NOMBRE_TIPO = { Corte: 'Corte', Reconexion: 'Reconexión' };

    const mapa = crearMapaBase('mapa');
    const capaRecorridos = L.layerGroup().addTo(mapa);
    const capaVivo = L.layerGroup().addTo(mapa);
    let recorridos = [];
    let seleccionado = null;
    let vigente = 0;
    let temporizadorVivo = null;

    // Reproducción
    let pasos = [];
    let indice = 0;
    let reproduciendo = false;
    let temporizador = null;
    let marcadorMovil = null;

    const dos = n => String(n).padStart(2, '0');
    const hoyLocal = () => { const d = new Date(); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`; };
    const hora = f => new Date(f).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const esHoy = () => el('fecha').value === hoyLocal();
    el('fecha').value = hoyLocal();

    async function cargarTrabajadores() {
        try {
            const [cortadores, reconectadores] = await Promise.all([
                VisorApi.get('/api/asignaciones/trabajadores?tipo=Corte'),
                VisorApi.get('/api/asignaciones/trabajadores?tipo=Reconexion'),
            ]);
            const todos = new Map();
            for (const t of [...cortadores, ...reconectadores]) todos.set(t.idUsuario, t);
            el('selTrabajador').innerHTML = '<option value="">Todos</option>' + [...todos.values()]
                .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
                .map(t => `<option value="${t.idUsuario}">${escaparHtml(t.nombre)} (${escaparHtml(t.login)})</option>`).join('');
        } catch (err) {
            avisar(err.message, 'error');
        }
    }

    async function cargar() {
        const s = ++vigente;
        detener();
        const params = new URLSearchParams({ fecha: el('fecha').value, actividad: el('selActividad').value });
        if (el('selTrabajador').value) params.set('trabajador', el('selTrabajador').value);
        el('resumen').textContent = 'Cargando…';
        try {
            const datos = await VisorApi.get(`/api/monitoreo/recorridos?${params}`);
            if (s !== vigente) return;
            recorridos = datos;
            const posiciones = recorridos.reduce((n, r) => n + r.posiciones.length, 0);
            const distancia = recorridos.reduce((n, r) => n + r.distanciaEnRedMetros, 0);
            el('resumen').innerHTML = `<strong>${recorridos.length}</strong> recorrido(s) · <strong>${Formato.numero(posiciones)}</strong> posiciones · `
                + `Fecha consultada: <strong>${escaparHtml(el('fecha').value)}</strong> · `
                + (esHoy() ? `Actualización automática: ${INTERVALO_VIVO / 1000} s · ` : '')
                + `${formatoDistancia(distancia)} recorridos por las calles`;
            pintarLista();
            dibujar();
            seleccionar(recorridos.find(r => r.posiciones.length > 1) ?? recorridos[0] ?? null);
        } catch (err) {
            if (s === vigente) el('resumen').textContent = err.message;
        }
        programarVivo();
    }

    function pintarLista() {
        const lista = el('listaRecorridos');
        if (!recorridos.length) {
            lista.innerHTML = '<p class="small text-body-secondary mb-0">No hay recorridos registrados con estos filtros.</p>';
            return;
        }
        lista.innerHTML = recorridos.map((r, i) => {
            const realizadas = r.paradas.length;
            const tipos = [...new Set(r.paradas.map(p => NOMBRE_TIPO[p.tipo] || p.tipo))].join(', ') || 'Sin paradas registradas';
            const ultima = r.posiciones.length ? `Última posición: ${hora(r.posiciones[r.posiciones.length - 1].fechaHora)}` : 'Sin posiciones GPS';
            return `<button class="tarjeta-recorrido" type="button" data-i="${i}" aria-pressed="false">
                <div class="fw-bold">${escaparHtml(r.nombre)}</div>
                <div class="small">${escaparHtml(tipos)} · ${r.posiciones.length} puntos · ${realizadas} parada(s)</div>
                <div class="small text-body-secondary">${ultima} · ${formatoDistancia(r.distanciaEnRedMetros)}</div></button>`;
        }).join('');
    }

    function dibujar() {
        capaRecorridos.clearLayers();
        const limites = L.latLngBounds([]);
        for (const r of recorridos) {
            const elegido = r === seleccionado;
            if (r.trazadoEnRed.length > 1) {
                const linea = L.polyline(r.trazadoEnRed.map(aLatLng), { color: elegido ? '#1c6fd1' : '#7c8a99', weight: elegido ? 5 : 3, opacity: elegido ? .9 : .6 });
                linea.addTo(capaRecorridos);
                limites.extend(linea.getBounds());
            }
            for (const p of r.paradas) {
                const observada = p.resultado === 'Observado';
                L.circleMarker(aLatLng(p.punto), { radius: 7, color: '#ffffff', weight: 2, fillColor: observada ? '#212529' : '#FD7E14', fillOpacity: 1 })
                    .bindTooltip(`#${p.orden} · ${NOMBRE_TIPO[p.tipo] || p.tipo} ${escaparHtml(String(p.codFijo ?? ''))} · ${escaparHtml(p.titular || '')}<br>`
                        + `${escaparHtml(p.resultado)} a las ${hora(p.fechaEjecucion)}${p.dentroDelRadio === false ? ' · <strong>fuera del radio</strong>' : ''}`)
                    .addTo(capaRecorridos);
                limites.extend(aLatLng(p.punto));
            }
        }
        if (limites.isValid()) mapa.fitBounds(limites, { padding: [40, 40], maxZoom: 17 });
    }

    function seleccionar(recorrido) {
        detener();
        seleccionado = recorrido;
        document.querySelectorAll('.tarjeta-recorrido').forEach(b => {
            const activa = recorridos[Number(b.dataset.i)] === recorrido;
            b.classList.toggle('activa', activa);
            b.setAttribute('aria-pressed', String(activa));
        });
        dibujar();
        prepararPasos();
    }

    /** Pasos de la reproducción: posiciones GPS en orden y, entre ellas, las paradas registradas a su hora. */
    function prepararPasos() {
        pasos = [];
        indice = 0;
        if (marcadorMovil) { marcadorMovil.remove(); marcadorMovil = null; }
        const r = seleccionado;
        if (!r || r.posiciones.length < 2) { el('reproductor').classList.add('d-none'); return; }
        const eventos = [
            ...r.posiciones.map(p => ({ fecha: new Date(p.fechaHora).getTime(), punto: aLatLng(p.punto) })),
            ...r.paradas.map(p => ({ fecha: new Date(p.fechaEjecucion).getTime(), punto: aLatLng(p.punto), parada: p })),
        ].sort((a, b) => a.fecha - b.fecha);
        pasos = eventos;
        el('avance').max = String(pasos.length - 1);
        el('avance').value = '0';
        el('reproductor').classList.remove('d-none');
        marcadorMovil = L.circleMarker(pasos[0].punto, { radius: 9, color: '#ffffff', weight: 3, fillColor: '#146c43', fillOpacity: 1 }).addTo(capaVivo);
        mostrarPaso();
    }

    function mostrarPaso() {
        const paso = pasos[indice];
        if (!paso) return;
        marcadorMovil?.setLatLng(paso.punto);
        el('avance').value = String(indice);
        const siguiente = pasos.slice(indice + 1).find(p => p.parada);
        const descripcion = p => `${NOMBRE_TIPO[p.parada.tipo] || p.parada.tipo} ${p.parada.codFijo ?? ''}`;
        el('estadoReproduccion').textContent = `${indice + 1}/${pasos.length} · ${hora(paso.fecha)} · `
            + (paso.parada ? `Detenido en ${descripcion(paso)}` : siguiente ? `En recorrido hacia ${descripcion(siguiente)}` : 'Recorrido terminado');
    }

    function avanzar() {
        if (!reproduciendo) return;
        if (indice >= pasos.length - 1) { detener(); return; }
        indice++;
        mostrarPaso();
        const velocidad = Number(el('selVelocidad').value) || 1;
        const pausa = pasos[indice].parada ? Number(el('selPausa').value) : 0;
        temporizador = setTimeout(avanzar, 600 / velocidad + pausa);
    }

    function reproducir() {
        if (!pasos.length) return;
        if (reproduciendo) { detener(); return; }
        if (indice >= pasos.length - 1) indice = 0;
        reproduciendo = true;
        el('btnReproducir').innerHTML = '<i class="bi bi-pause-fill me-1" aria-hidden="true"></i><span>Pausar</span>';
        avanzar();
    }

    function detener() {
        reproduciendo = false;
        clearTimeout(temporizador);
        el('btnReproducir').innerHTML = '<i class="bi bi-play-fill me-1" aria-hidden="true"></i><span>Reproducir</span>';
    }

    async function actualizarVivo() {
        try {
            const vivos = await VisorApi.get('/api/monitoreo/en-vivo');
            capaVivo.eachLayer(c => { if (c !== marcadorMovil) capaVivo.removeLayer(c); });
            for (const v of vivos) {
                L.marker([v.lat, v.lon], {
                    icon: L.divIcon({ className: 'marcador-trabajador', html: `<span><i class="bi bi-person-fill" aria-hidden="true"></i>${escaparHtml(v.nombre)}</span>`, iconSize: null }),
                    keyboard: false,
                }).bindTooltip(`${escaparHtml(v.rol)} · ${hora(v.fechaHora)} · ${v.pendientes} pendiente(s) · ${v.realizadas} realizada(s) hoy`).addTo(capaVivo);
            }
            el('enVivo').innerHTML = vivos.length
                ? vivos.map(v => `<li class="mb-1"><i class="bi bi-geo-alt-fill text-success me-1" aria-hidden="true"></i><strong>${escaparHtml(v.nombre)}</strong>
                    · ${hora(v.fechaHora)} · ${v.pendientes} pendiente(s), ${v.realizadas} realizada(s)</li>`).join('')
                : '<li class="text-body-secondary">Sin posiciones recientes.</li>';
        } catch (err) {
            el('enVivo').innerHTML = `<li class="text-danger">${escaparHtml(err.message)}</li>`;
        }
    }

    function programarVivo() {
        clearInterval(temporizadorVivo);
        if (!esHoy()) { el('enVivo').innerHTML = '<li class="text-body-secondary">La posición en vivo solo se muestra para hoy.</li>'; return; }
        actualizarVivo();
        // Sin reproducción en curso se recarga todo (cargar vuelve a programar); durante la reproducción, solo la posición en vivo.
        temporizadorVivo = setInterval(() => {
            if (document.hidden) return;
            if (reproduciendo) actualizarVivo(); else cargar();
        }, INTERVALO_VIVO);
    }

    el('formMonitoreo').addEventListener('submit', e => { e.preventDefault(); cargar(); });
    el('listaRecorridos').addEventListener('click', e => {
        const b = e.target.closest('.tarjeta-recorrido');
        if (b) seleccionar(recorridos[Number(b.dataset.i)]);
    });
    el('btnReproducir').addEventListener('click', reproducir);
    el('btnReiniciar').addEventListener('click', () => { detener(); indice = 0; mostrarPaso(); });
    el('avance').addEventListener('input', () => { indice = Number(el('avance').value); mostrarPaso(); });

    cargarTrabajadores();
    cargar();
})();
