// VisorDatosSIG · revisión de lo registrado en campo (resultado, lectura, observación, fotos y validación GPS).
'use strict';
(() => {
    const raiz = document.getElementById('ejecucion');
    if (!raiz) return;
    const tipo = raiz.dataset.tipo;
    const el = id => document.getElementById(id);
    const TAMANO = 20;
    let pagina = 1;
    let elementos = [];
    let vigente = 0;
    let mapaDetalle = null;
    let capaDetalle = null;

    const dos = n => String(n).padStart(2, '0');
    const fechaLocal = d => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
    const hace = dias => { const d = new Date(); d.setDate(d.getDate() - dias); return d; };
    el('desde').value = fechaLocal(hace(7));
    el('hasta').value = fechaLocal(new Date());

    async function cargarTrabajadores() {
        try {
            const lista = await VisorApi.get(`/api/asignaciones/trabajadores?tipo=${tipo}`);
            el('selTrabajador').innerHTML = '<option value="">Todos</option>'
                + lista.map(t => `<option value="${t.idUsuario}">${escaparHtml(t.nombre)} (${escaparHtml(t.login)})</option>`).join('');
        } catch (err) {
            avisar(err.message, 'error');
        }
    }

    async function cargar() {
        const s = ++vigente;
        const p = new URLSearchParams({ tipo, pagina: String(pagina), tamano: String(TAMANO), soloAlertas: String(el('soloAlertas').checked) });
        if (el('desde').value) p.set('desde', el('desde').value);
        if (el('hasta').value) p.set('hasta', el('hasta').value);
        if (el('selTrabajador').value) p.set('trabajador', el('selTrabajador').value);
        const cont = el('contenidoResultados');
        cont.style.opacity = '.55';   // se conserva la tabla anterior mientras llega la nueva
        try {
            const r = await VisorApi.get(`/api/ejecuciones?${p}`);
            if (s !== vigente) return;
            elementos = r.elementos;
            el('tituloResultados').textContent = `Registros: ${Formato.numero(r.total)}`;
            if (!r.total) {
                cont.innerHTML = '<div class="estado-vacio"><i class="bi bi-clipboard fs-3 d-block mb-2" aria-hidden="true"></i>No hay registros con estos filtros.</div>';
                return;
            }
            cont.innerHTML = `<div class="table-responsive"><table class="table table-sm table-hover align-middle">
                <thead><tr><th scope="col">Fecha y hora</th><th scope="col">Trabajador</th><th scope="col">#</th><th scope="col">Código fijo</th>
                    <th scope="col">Titular</th><th scope="col">Resultado</th><th scope="col" class="text-end">Lectura</th>
                    <th scope="col">Observación</th><th scope="col">Ubicación al guardar</th><th scope="col" class="text-center">Fotos</th>
                    <th scope="col"><span class="visually-hidden">Acción</span></th></tr></thead>
                <tbody>${elementos.map((e, i) => fila(e, i)).join('')}</tbody></table></div>
                <nav class="d-flex align-items-center gap-2" aria-label="Paginación">
                    <button class="btn btn-sm btn-outline-secondary" type="button" data-ir="${pagina - 1}" ${pagina <= 1 ? 'disabled' : ''}>Anterior</button>
                    <span class="small">Página ${pagina} de ${Math.max(1, r.totalPaginas)}</span>
                    <button class="btn btn-sm btn-outline-secondary" type="button" data-ir="${pagina + 1}" ${pagina >= r.totalPaginas ? 'disabled' : ''}>Siguiente</button>
                </nav>`;
        } catch (err) {
            if (s === vigente) cont.innerHTML = `<div class="alert alert-danger">${escaparHtml(err.message)}</div>`;
        } finally {
            if (s === vigente) cont.style.opacity = '';
        }
    }

    function fila(e, i) {
        const ubicacion = e.distanciaAlPuntoMetros == null ? '—'
            : e.dentroDelRadio
                ? `<i class="bi bi-check-circle-fill text-success me-1" aria-hidden="true"></i>${formatoDistancia(e.distanciaAlPuntoMetros)} del punto`
                : `<span class="alerta-radio"><i class="bi bi-exclamation-triangle-fill me-1" aria-hidden="true"></i>${formatoDistancia(e.distanciaAlPuntoMetros)}: fuera del radio</span>`;
        const resultado = e.resultado === 'Observado'
            ? '<span class="badge text-bg-dark">Observado</span>'
            : `<span class="badge text-bg-success">${escaparHtml(e.resultado)}</span>`;
        return `<tr>
            <td class="text-nowrap">${escaparHtml(Formato.fecha(e.fechaEjecucion))}</td>
            <td>${escaparHtml(e.trabajador)}</td>
            <td>${e.orden}</td>
            <td>${escaparHtml(String(e.codFijo ?? e.idCodigo))}</td>
            <td>${escaparHtml(e.titular || '')}</td>
            <td>${resultado}</td>
            <td class="text-end">${e.lectura == null ? '—' : Formato.numero(e.lectura, 0)}</td>
            <td>${escaparHtml(e.observacion || '')}</td>
            <td class="small">${ubicacion}</td>
            <td class="text-center">${e.fotos}</td>
            <td><button class="btn btn-sm btn-outline-primary" type="button" data-detalle="${i}">Ver</button></td></tr>`;
    }

    async function verDetalle(e) {
        el('tituloDetalle').textContent = `#${e.orden} · Código ${e.codFijo ?? e.idCodigo} · ${e.titular || ''}`;
        const dato = (titulo, valor) => `<dt class="col-5">${titulo}</dt><dd class="col-7">${valor}</dd>`;
        el('datosDetalle').innerHTML = [
            dato('Resultado', escaparHtml(e.resultado)),
            dato('Trabajador', escaparHtml(e.trabajador)),
            dato('Registrado', escaparHtml(Formato.fecha(e.fechaEjecucion))),
            dato('Hora del celular', escaparHtml(e.fechaDispositivo ? Formato.fecha(e.fechaDispositivo) : '—')),
            dato('N.º de medidor', escaparHtml(e.numeroMedidor || '—')),
            dato('Lectura', e.lectura == null ? '—' : Formato.numero(e.lectura, 0)),
            dato('Observación', escaparHtml(e.observacion || '—')),
            dato('Precisión GPS', e.precisionMetros == null ? '—' : `${Formato.numero(e.precisionMetros)} m`),
            dato('Distancia al punto', e.distanciaAlPuntoMetros == null ? '—'
                : `${formatoDistancia(e.distanciaAlPuntoMetros)} ${e.dentroDelRadio ? '(dentro del radio)' : '<span class="alerta-radio">(fuera del radio)</span>'}`),
        ].join('');

        const modal = bootstrap.Modal.getOrCreateInstance(el('modalDetalle'));
        modal.show();
        // El mapa se arma cuando el modal ya es visible (Leaflet necesita el tamaño del contenedor).
        el('modalDetalle').addEventListener('shown.bs.modal', () => dibujarDetalle(e), { once: true });

        const galeria = el('fotosDetalle');
        galeria.innerHTML = '<span class="small text-body-secondary">Cargando…</span>';
        try {
            const fotos = await VisorApi.get(`/api/ejecuciones/${e.idDetalle}/fotos`);
            galeria.innerHTML = fotos.length
                ? fotos.map((f, i) => `<a href="/api/ejecuciones/fotos/${f.idFoto}" target="_blank" rel="noopener">
                    <img src="/api/ejecuciones/fotos/${f.idFoto}" alt="Fotografía ${i + 1} de la evidencia" loading="lazy" /></a>`).join('')
                : '<span class="small text-body-secondary">Sin fotografías.</span>';
        } catch (err) {
            galeria.innerHTML = `<span class="text-danger small">${escaparHtml(err.message)}</span>`;
        }
    }

    function dibujarDetalle(e) {
        if (!mapaDetalle) {
            mapaDetalle = crearMapaBase('mapaDetalle', { zoom: 18, controlCapas: false });
            capaDetalle = L.layerGroup().addTo(mapaDetalle);
        }
        mapaDetalle.invalidateSize();
        capaDetalle.clearLayers();
        const codigo = aLatLng(e.punto);
        L.circleMarker(codigo, { radius: 8, color: '#ffffff', weight: 2, fillColor: '#FD7E14', fillOpacity: 1 })
            .bindTooltip('Código fijo', { permanent: true, direction: 'top' }).addTo(capaDetalle);
        const puntos = [codigo];
        if (e.ubicacion) {
            const gps = aLatLng(e.ubicacion);
            puntos.push(gps);
            if (e.precisionMetros) L.circle(gps, { radius: e.precisionMetros, color: '#1c6fd1', weight: 1, fillOpacity: .1 }).addTo(capaDetalle);
            L.circleMarker(gps, { radius: 7, color: '#ffffff', weight: 2, fillColor: '#1c6fd1', fillOpacity: 1 })
                .bindTooltip('GPS al guardar', { permanent: true, direction: 'bottom' }).addTo(capaDetalle);
            L.polyline([codigo, gps], { color: e.dentroDelRadio ? '#198754' : '#b45309', weight: 2, dashArray: '5 5' }).addTo(capaDetalle);
        }
        mapaDetalle.fitBounds(L.latLngBounds(puntos), { padding: [40, 40], maxZoom: 19 });
        el('leyendaMapa').textContent = e.ubicacion
            ? `Naranja: código fijo · Azul: GPS al guardar (círculo = precisión). Distancia: ${formatoDistancia(e.distanciaAlPuntoMetros)}.`
            : 'No hay ubicación registrada.';
    }

    el('formFiltros').addEventListener('submit', ev => { ev.preventDefault(); pagina = 1; cargar(); });
    el('contenidoResultados').addEventListener('click', ev => {
        const ir = ev.target.closest('[data-ir]');
        if (ir && !ir.disabled) { pagina = Number(ir.dataset.ir); cargar(); return; }
        const ver = ev.target.closest('[data-detalle]');
        if (ver) verDetalle(elementos[Number(ver.dataset.detalle)]);
    });

    cargarTrabajadores();
    cargar();
})();
