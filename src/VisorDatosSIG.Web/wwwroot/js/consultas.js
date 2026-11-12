'use strict';
(async () => {
    const el = id => document.getElementById(id);
    const NOMBRES_OPERADOR = {
        contiene: 'contiene', empieza: 'empieza con', igual: 'igual a', distinto: 'distinto de',
        mayor: 'mayor que', menor: 'menor que', mayorigual: 'mayor o igual', menorigual: 'menor o igual',
    };
    const MAX_FILTROS = 5;
    const OPCIONES = {
        codigosfijos: { etiqueta: 'Código fijo o titular', ejemplo: 'Ej.: un código fijo o el apellido del titular.', rapidos: ['Estado', 'UV', 'MZA'] },
        lotes: { etiqueta: 'Código de lote', ejemplo: 'Ej.: L03. También puede buscar solo por unidad vecinal o manzana.', rapidos: ['UV', 'MZA'] },
        manzanas: { etiqueta: 'Manzana o unidad vecinal', ejemplo: 'Escriba parte de la referencia, o use los filtros de ubicación.', rapidos: ['UV', 'MZA'] },
        vias: { etiqueta: 'Nombre de la vía', ejemplo: 'Escriba parte del nombre de la calle o avenida.', rapidos: ['TipoVia'] },
    };
    const esTecnico = c => /^Id/.test(c.clave) || ['OSMID', 'OBJECTID', 'CodF_SIG', 'CodF_SQL'].includes(c.clave);
    let catalogo;
    let filtros = [];
    let estado = { pagina: 1, orden: null, desc: false };
    let solicitudVigente = 0;
    let textoGeneral = '';

    try { catalogo = await VisorApi.get('/api/capas'); }
    catch (err) {
        el('contenidoResultados').innerHTML = `<div class="alert alert-danger">${escaparHtml(err.message)} <button class="btn btn-outline-danger btn-sm" id="reintentarCatalogo" type="button">Reintentar</button></div>`;
        el('reintentarCatalogo').addEventListener('click', () => location.reload());
        return;
    }
    if (!catalogo.capas.length) {
        el('contenidoResultados').innerHTML = '<div class="estado-vacio">No hay capas disponibles para consultar.</div>';
        return;
    }

    const capa = () => catalogo.capas.find(c => c.id === el('selCapa').value);
    const campo = () => capa().campos.find(c => c.clave === el('selCampo').value);

    el('selCapa').innerHTML = catalogo.capas.map(c => `<option value="${c.id}">${escaparHtml(c.nombre)}</option>`).join('');
    const q = new URLSearchParams(location.search);
    textoGeneral = q.get('textoGeneral') || '';
    if (catalogo.capas.some(c => c.id === 'codigosfijos')) el('selCapa').value = 'codigosfijos';
    if (q.get('capa') && catalogo.capas.some(c => c.id === q.get('capa'))) el('selCapa').value = q.get('capa');

    function llenarCampos() {
        const campos = capa().campos.filter(c => c.buscable);
        const opciones = lista => lista.map(c => `<option value="${c.clave}">${escaparHtml(c.etiqueta)}</option>`).join('');
        el('selCampo').innerHTML = `<optgroup label="Datos habituales">${opciones(campos.filter(c => !esTecnico(c)))}</optgroup>` +
            `<optgroup label="Identificadores técnicos (uso avanzado)">${opciones(campos.filter(esTecnico))}</optgroup>`;
        const config = OPCIONES[capa().id] || { etiqueta: 'Buscar', ejemplo: 'Escriba parte del dato que desea encontrar.', rapidos: [] };
        el('etiquetaBusqueda').textContent = config.etiqueta;
        el('textoGeneral').placeholder = config.etiqueta;
        el('ayudaBusqueda').textContent = `${config.ejemplo} Use al menos 2 caracteres; deje vacío para ver todos.`;
        el('filtrosRapidos').innerHTML = config.rapidos.map(clave => {
            const c = campos.find(x => x.clave === clave);
            if (!c) return '';
            const ayuda = c.tipo === 'Estado' ? '' : `<div class="form-text">${clave === 'TipoVia' ? 'Puede escribir parte del tipo de vía.' : 'Dato completo.'}</div>`;
            const entrada = c.tipo === 'Estado'
                ? `<select class="form-select" id="rapido-${clave}" data-rapido="${clave}"><option value="">Todos los estados</option>${catalogo.estados.map(e => `<option value="${e.valor}">${escaparHtml(e.nombre)}</option>`).join('')}</select>`
                : `<input class="form-control" id="rapido-${clave}" data-rapido="${clave}" maxlength="100" placeholder="Opcional" />`;
            return `<div class="${['UV', 'MZA'].includes(clave) ? 'col-6' : 'col-12'} col-md-4"><label class="form-label" for="rapido-${clave}">${escaparHtml(c.etiqueta)}</label>${entrada}${ayuda}</div>`;
        }).join('');
        llenarOperadores();
    }

    function filtrosRapidos() {
        return [...el('filtrosRapidos').querySelectorAll('[data-rapido]')].filter(c => c.value.trim()).map(c => ({
            campo: c.dataset.rapido, operador: c.dataset.rapido === 'TipoVia' ? 'contiene' : 'igual', valor: c.value.trim(),
        }));
    }

    const todosFiltros = () => [...filtrosRapidos(), ...filtros];

    function llenarOperadores() {
        const c = campo();
        el('selOperador').innerHTML = c.operadores.map(o => `<option value="${o}">${NOMBRES_OPERADOR[o] || o}</option>`).join('');
        // Para el estado del servicio se ofrece una lista cerrada de valores.
        const contenedor = el('contenedorValor');
        if (c.tipo === 'Estado') {
            contenedor.innerHTML = `<label class="form-label" for="valor">${escaparHtml(c.etiqueta)}</label>
                <select class="form-select" id="valor" aria-describedby="errorValor"><option value="">Seleccione un estado</option>${catalogo.estados.map(e => `<option value="${e.valor}">${escaparHtml(e.nombre)}</option>`).join('')}</select>`;
        } else {
            contenedor.innerHTML = `<label class="form-label" for="valor">${escaparHtml(c.etiqueta)}</label>
                <input class="form-control" id="valor" maxlength="100" inputmode="${c.tipo === 'Texto' ? 'text' : 'numeric'}" aria-describedby="errorValor" />`;
        }
        el('errorValor').textContent = '';
    }

    function textoFiltro(f) {
        const def = capa().campos.find(c => c.clave === f.campo);
        let valor = f.valor;
        if (def?.tipo === 'Estado') valor = catalogo.estados.find(e => String(e.valor) === String(f.valor))?.nombre || valor;
        return `${def?.etiqueta || f.campo} ${NOMBRES_OPERADOR[f.operador] || f.operador} «${valor}»`;
    }

    function pintarFiltros() {
        const texto = textoGeneral ? `<span class="filtro-activo">${escaparHtml(el('etiquetaBusqueda').textContent)}: «${escaparHtml(textoGeneral)}»<button class="btn btn-sm" type="button" data-quitar-texto aria-label="Quitar texto de búsqueda"><i class="bi bi-x-lg" aria-hidden="true"></i></button></span>` : '';
        const rapidos = filtrosRapidos().map(f => `<span class="filtro-activo">${escaparHtml(textoFiltro(f))}<button class="btn btn-sm" type="button" data-quitar-rapido="${f.campo}" aria-label="Quitar filtro ${escaparHtml(textoFiltro(f))}"><i class="bi bi-x-lg" aria-hidden="true"></i></button></span>`).join('');
        el('filtrosActivos').innerHTML = filtros.length || textoGeneral || rapidos
            ? '<span class="small text-body-secondary me-1">Criterios de búsqueda:</span>' + texto + rapidos + filtros.map((f, i) =>
                `<span class="filtro-activo">${escaparHtml(textoFiltro(f))}<button class="btn btn-sm" type="button" data-quitar="${i}" aria-label="Quitar filtro ${escaparHtml(textoFiltro(f))}"><i class="bi bi-x-lg" aria-hidden="true"></i></button></span>`).join('')
            : '<span class="small text-body-secondary">Sin filtros: se muestran todos los registros de esta capa.</span>';
    }

    function agregarFiltro() {
        const valor = el('valor').value.trim();
        el('errorValor').textContent = '';
        if (!valor) { el('errorValor').textContent = 'Indique un valor para el filtro.'; el('valor').focus(); return false; }
        if (campo().tipo === 'Numero' && el('selOperador').value !== 'contiene' && !/^-?\d+$/.test(valor)) {
            el('errorValor').textContent = 'Este campo espera un número entero.'; el('valor').focus(); return false;
        }
        if (todosFiltros().length >= MAX_FILTROS) { el('errorValor').textContent = `Puede combinar hasta ${MAX_FILTROS} condiciones, incluidos los filtros de arriba. Quite una para agregar otra.`; return false; }
        filtros.push({ campo: el('selCampo').value, operador: el('selOperador').value, valor });
        el('valor').value = '';
        pintarFiltros();
        invalidarResultados('Filtros modificados: presione Buscar');
        return true;
    }

    function ocultarEnlaces() {
        for (const id of ['btnCsv', 'btnMapa']) {
            el(id).classList.add('d-none');
            el(id).href = '#';
        }
    }

    function invalidarResultados(mensaje) {
        solicitudVigente++;
        el('contenidoResultados').setAttribute('aria-busy', 'false');
        ocultarEnlaces();
        el('tituloResultados').textContent = 'Resultados';
        el('contenidoResultados').innerHTML = `<div class="estado-vacio">${escaparHtml(mensaje)}</div>`;
    }

    function parametros(def, aplicados, ordenAplicado, textoAplicado) {
        const p = new URLSearchParams({ capa: def.id, filtros: JSON.stringify(aplicados) });
        if (ordenAplicado.orden) { p.set('orden', ordenAplicado.orden); p.set('desc', String(ordenAplicado.desc)); }
        if (textoAplicado) p.set('textoGeneral', textoAplicado);
        return p;
    }

    function formatear(c, v, p) {
        if (v === null || v === undefined || v === '') return '<span class="text-body-secondary">—</span>';
        if (c.tipo === 'Estado') {
            const e = catalogo.estados.find(x => x.valor === v);
            return `<span class="badge-estado"><span class="muestra-punto" style="background:${e?.color}"></span>${escaparHtml(p.EstadoDescripcion || v)}</span>`;
        }
        if (c.tipo === 'Decimal') {
            const unidad = c.clave === 'Superficie' ? 'm²' : c.clave === 'LongitudMetros' ? 'm' : '';
            return escaparHtml(Formato.numero(v, 2) + (unidad && !c.etiqueta.includes(`(${unidad})`) ? ` ${unidad}` : ''));
        }
        if (c.tipo === 'Fecha') return escaparHtml(Formato.fecha(v));
        return escaparHtml(v);
    }

    async function buscar() {
        textoGeneral = el('textoGeneral').value.trim();
        el('errorBusqueda').textContent = '';
        el('textoGeneral').removeAttribute('aria-invalid');
        if (textoGeneral && (textoGeneral.length < 2 || textoGeneral.length > 100)) {
            invalidarResultados('Corrija los criterios y vuelva a buscar.');
            el('errorBusqueda').textContent = 'Escriba entre 2 y 100 caracteres, o deje la búsqueda vacía para consultar todos.';
            el('textoGeneral').setAttribute('aria-invalid', 'true');
            el('textoGeneral').focus();
            return;
        }
        if (todosFiltros().length > MAX_FILTROS) {
            invalidarResultados('Quite alguna condición y vuelva a buscar.');
            el('errorBusqueda').textContent = `Puede combinar hasta ${MAX_FILTROS} condiciones. Quite alguna y vuelva a buscar.`;
            return;
        }
        // Una condición puede aplicarse directamente con Buscar, sin un clic adicional.
        if (el('valor').value.trim() && !agregarFiltro()) { el('filtrosAvanzados').open = true; return; }
        const solicitud = ++solicitudVigente;
        const def = capa();
        const aplicados = todosFiltros();
        const ordenAplicado = { ...estado };
        const textoAplicado = textoGeneral;
        ocultarEnlaces();
        const cont = el('contenidoResultados');
        el('tituloResultados').textContent = `Buscando en ${def.nombre}…`;
        pintarFiltros();
        cont.setAttribute('aria-busy', 'true');
        cont.innerHTML = '<div class="estado-vacio"><span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Consultando…</div>';
        try {
            const p = parametros(def, aplicados, ordenAplicado, textoAplicado);
            const url = new URL(location.href);
            url.search = p.toString();
            url.searchParams.set('pagina', String(ordenAplicado.pagina));
            if (el('filtrosAvanzados').open) url.searchParams.set('modo', 'filtros');
            history.replaceState(null, '', url);
            const r = await VisorApi.get(`/api/busqueda?${p}&pagina=${ordenAplicado.pagina}&tamano=20`);
            if (solicitud !== solicitudVigente) return;
            if (r.total > 0 && ordenAplicado.pagina > r.totalPaginas) {
                estado.pagina = Math.max(1, r.totalPaginas);
                return buscar();
            }
            el('tituloResultados').textContent = `${Formato.numero(r.total)} ${r.total === 1 ? 'resultado' : 'resultados'} · ${def.nombre}`;
            el('btnCsv').href = `/api/busqueda/csv?${p}`;
            el('btnMapa').href = `/Visor?${new URLSearchParams({ capa: def.id, filtros: JSON.stringify(aplicados), ...(textoAplicado ? { textoGeneral: textoAplicado } : {}) })}`;
            el('btnCsv').classList.toggle('d-none', r.total === 0);
            el('btnMapa').classList.toggle('d-none', r.total === 0);
            if (!r.total) {
                cont.innerHTML = '<div class="estado-vacio"><i class="bi bi-search fs-3 d-block mb-2" aria-hidden="true"></i>No encontramos coincidencias. Pruebe con parte del nombre o código, o quite alguna condición.<div class="mt-3"><button class="btn btn-outline-primary" type="button" data-limpiar>Limpiar búsqueda y ver todos</button></div></div>';
                return;
            }
            const columnas = def.campos.filter(c => c.enTabla && !esTecnico(c));
            const cab = columnas.map(c => {
                if (!c.ordenable) return `<th scope="col">${escaparHtml(c.etiqueta)}</th>`;
                const activo = ordenAplicado.orden === c.clave;
                return `<th scope="col" aria-sort="${activo ? (ordenAplicado.desc ? 'descending' : 'ascending') : 'none'}"><button class="orden" type="button" data-orden="${c.clave}">${escaparHtml(c.etiqueta)}
                    <i class="bi ${activo ? (ordenAplicado.desc ? 'bi-sort-down' : 'bi-sort-up') : 'bi-arrow-down-up'}" aria-hidden="true"></i></button></th>`;
            }).join('');
            const filas = r.resultados.features.map(f => {
                const p2 = f.properties;
                return `<tr>${columnas.map(c => `<td>${formatear(c, p2[c.clave], p2)}</td>`).join('')}
                    <td class="text-end text-nowrap"><a class="btn btn-sm btn-outline-primary" href="/Visor?capa=${def.id}&id=${p2.id}">Ver en mapa</a></td></tr>`;
            }).join('');
            cont.innerHTML = `<div class="table-responsive"><table class="table table-sm table-hover align-middle">
                <thead><tr>${cab}<th scope="col"><span class="visually-hidden">Acción</span></th></tr></thead><tbody>${filas}</tbody></table></div>
                <nav class="d-flex align-items-center gap-2 flex-wrap" aria-label="Paginación">
                    <button class="btn btn-sm btn-outline-secondary" type="button" data-pagina="${ordenAplicado.pagina - 1}" ${ordenAplicado.pagina <= 1 ? 'disabled' : ''}>Anterior</button>
                    <span class="small">${Formato.numero((ordenAplicado.pagina - 1) * 20 + 1)}–${Formato.numero(Math.min(ordenAplicado.pagina * 20, r.total))} de ${Formato.numero(r.total)} · Página ${ordenAplicado.pagina} de ${r.totalPaginas}</span>
                    <button class="btn btn-sm btn-outline-secondary" type="button" data-pagina="${ordenAplicado.pagina + 1}" ${ordenAplicado.pagina >= r.totalPaginas ? 'disabled' : ''}>Siguiente</button>
                </nav>`;
        } catch (err) {
            if (solicitud !== solicitudVigente) return;
            el('tituloResultados').textContent = `Resultados · ${def.nombre}`;
            cont.innerHTML = `<div class="alert alert-danger">${escaparHtml(err.message)} <button class="btn btn-outline-danger btn-sm" type="button" data-reintentar>Reintentar</button></div>`;
        } finally {
            if (solicitud === solicitudVigente) cont.setAttribute('aria-busy', 'false');
        }
    }

    el('selCapa').addEventListener('change', () => {
        filtros = []; textoGeneral = ''; estado = { pagina: 1, orden: null, desc: false };
        el('textoGeneral').value = '';
        llenarCampos(); pintarFiltros();
        buscar();
    });
    el('selCampo').addEventListener('change', llenarOperadores);
    el('btnAgregar').addEventListener('click', agregarFiltro);
    el('formFiltro').addEventListener('submit', e => { e.preventDefault(); estado.pagina = 1; buscar(); });
    el('formFiltro').addEventListener('input', e => {
        if (e.target.id !== 'textoGeneral' && e.target.id !== 'valor' && !e.target.dataset.rapido) return;
        textoGeneral = el('textoGeneral').value.trim();
        el('errorBusqueda').textContent = '';
        el('errorValor').textContent = '';
        el('textoGeneral').removeAttribute('aria-invalid');
        pintarFiltros();
        invalidarResultados('Búsqueda modificada. Pulse Buscar para actualizar los resultados.');
    });
    function limpiar() {
        filtros = []; textoGeneral = ''; estado = { pagina: 1, orden: null, desc: false };
        el('textoGeneral').value = '';
        el('filtrosRapidos').querySelectorAll('[data-rapido]').forEach(c => { c.value = ''; });
        el('valor').value = '';
        el('errorValor').textContent = '';
        pintarFiltros();
        buscar();
        el('textoGeneral').focus();
    }
    el('btnLimpiar').addEventListener('click', limpiar);
    el('filtrosActivos').addEventListener('click', e => {
        const b = e.target.closest('[data-quitar]');
        const quitarTexto = e.target.closest('[data-quitar-texto]');
        const quitarRapido = e.target.closest('[data-quitar-rapido]');
        if (b || quitarTexto || quitarRapido) {
            if (b) filtros.splice(Number(b.dataset.quitar), 1);
            if (quitarTexto) { textoGeneral = ''; el('textoGeneral').value = ''; }
            if (quitarRapido) el('rapido-' + quitarRapido.dataset.quitarRapido).value = '';
            estado.pagina = 1;
            pintarFiltros();
            invalidarResultados('Filtros modificados: presione Buscar');
            el('btnBuscar').focus();
        }
    });
    el('contenidoResultados').addEventListener('click', e => {
        if (e.target.closest('[data-limpiar]')) { limpiar(); return; }
        if (e.target.closest('[data-reintentar]')) { buscar(); return; }
        const o = e.target.closest('[data-orden]');
        if (o) { estado.desc = estado.orden === o.dataset.orden ? !estado.desc : false; estado.orden = o.dataset.orden; estado.pagina = 1; buscar(); return; }
        const p = e.target.closest('[data-pagina]');
        if (p && !p.disabled) { estado.pagina = Number(p.dataset.pagina); buscar(); el('resultados').focus(); }
    });

    // Los accesos de esta pantalla abren su sección sin descartar la consulta.
    document.querySelectorAll('.menu a[href]').forEach(a => a.addEventListener('click', e => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
        const destino = new URL(a.href);
        if (destino.pathname.toLowerCase() !== '/consultas' || destino.searchParams.has('capa')) return;
        e.preventDefault();
        const abrir = () => {
            if (destino.hash === '#resultados') {
                el('resultados').scrollIntoView({ block: 'start' });
                el('resultados').focus();
            } else {
                el('filtrosAvanzados').open = destino.searchParams.get('modo') === 'filtros';
                el(el('filtrosAvanzados').open ? 'selCampo' : 'textoGeneral').focus();
            }
        };
        const menu = a.closest('.offcanvas-lg');
        if (menu?.classList.contains('show')) {
            menu.addEventListener('hidden.bs.offcanvas', abrir, { once: true });
            bootstrap.Offcanvas.getOrCreateInstance(menu).hide();
        } else abrir();
    }));

    llenarCampos();
    el('textoGeneral').value = textoGeneral;
    let enlaceValido = true;
    try {
        const iniciales = JSON.parse(q.get('filtros') || '[]');
        if (!Array.isArray(iniciales) || iniciales.length > MAX_FILTROS || iniciales.some(f => {
            const c = capa().campos.find(c => c.clave === f?.campo && c.buscable);
            return !c || !c.operadores.includes(f.operador) || typeof f.valor !== 'string' || !f.valor.trim() || f.valor.length > 100;
        })) throw new Error('Filtros no válidos');
        for (const f of iniciales) {
            const rapido = el('rapido-' + f.campo);
            const operador = f.campo === 'TipoVia' ? 'contiene' : 'igual';
            const estadoValido = f.campo !== 'Estado' || catalogo.estados.some(e => String(e.valor) === f.valor);
            if (rapido && !rapido.value && f.operador === operador && estadoValido) rapido.value = f.valor;
            else filtros.push(f);
        }
        if (q.has('capa') && !catalogo.capas.some(c => c.id === q.get('capa'))) throw new Error('Capa no válida');
        const orden = capa().campos.find(c => c.clave === q.get('orden') && c.ordenable);
        const pagina = Number(q.get('pagina') || 1);
        estado = { pagina: Number.isInteger(pagina) && pagina >= 1 && pagina <= 100000 ? pagina : 1, orden: orden?.clave || null, desc: q.get('desc') === 'true' };
    } catch {
        enlaceValido = false;
        invalidarResultados('No pudimos recuperar los filtros de este enlace. Limpie la búsqueda o indique nuevos criterios.');
        el('errorBusqueda').textContent = 'Revise los criterios del enlace antes de buscar.';
    }
    pintarFiltros();
    el('controlesBusqueda').disabled = false;
    el('filtrosAvanzados').open = q.get('modo') === 'filtros' || filtros.length > 0;
    if (q.get('modo') === 'filtros') el('selCampo').focus();
    if (enlaceValido) await buscar();
    if (location.hash === '#resultados') el('resultados').focus();
})();
