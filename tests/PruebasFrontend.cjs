'use strict';
// Pruebas de regresión sin dependencias: node --test FrontendSIG/tests/PruebasFrontend.cjs
// Ejecutan los scripts reales con DOM/API mínimos; la revisión visual se hace en navegador.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const scripts = path.join(__dirname, '../src/VisorDatosSIG.Web/wwwroot/js');
const esperar = () => new Promise(resolve => setImmediate(resolve));
const escapar = texto => String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function entorno(busqueda = '') {
    const nodos = new Map();
    const solicitudes = [];
    let recargas = 0;
    class Elemento {
        constructor(id, tagName = 'DIV') {
            this.id = id; this.tagName = tagName; this.value = ''; this.textContent = ''; this.href = '#';
            this.eventos = {}; this.dataset = {}; this.html = ''; this.atributos = {};
            const clases = new Set();
            this.classList = {
                add: (...nombres) => nombres.forEach(n => clases.add(n)),
                remove: (...nombres) => nombres.forEach(n => clases.delete(n)),
                contains: n => clases.has(n),
                toggle: (n, activo = !clases.has(n)) => activo ? clases.add(n) : clases.delete(n),
            };
        }
        set innerHTML(html) {
            this.html = html;
            if (this.tagName === 'SELECT') this.value = html.match(/<option value="([^"]*)"/)?.[1] || '';
            if (this.id === 'contenedorValor') {
                const tag = html.includes('<select') ? 'SELECT' : 'INPUT';
                nodos.set('valor', new Elemento('valor', tag));
            }
            for (const m of html.matchAll(/<(button)\b[^>]*\bid="([^"]+)"/g))
                nodos.set(m[2], new Elemento(m[2], 'BUTTON'));
            if (html.includes('data-accion="recargar"')) this.reintentar = new Elemento('', 'BUTTON');
        }
        get innerHTML() { return this.html; }
        addEventListener(tipo, fn) { (this.eventos[tipo] ||= []).push(fn); }
        emitir(tipo, datos = {}) { for (const fn of this.eventos[tipo] || []) fn({ target: this, preventDefault() {}, ...datos }); }
        setAttribute(clave, valor) { this.atributos[clave] = valor; }
        querySelector(selector) { return selector === '[data-accion="recargar"]' ? this.reintentar : null; }
        focus() {}
        remove() { nodos.delete(this.id); }
        scrollIntoView() {}
    }
    const el = id => nodos.get(id);
    const crear = (id, tag = 'DIV') => { const n = new Elemento(id, tag); nodos.set(id, n); return n; };
    const ids = ['estadoPanel', 'tarjetasCapas', 'ultimaActualizacion', 'resumenEstados', 'contenidoResultados',
        'contenedorValor', 'errorValor', 'filtrosActivos', 'tituloResultados', 'btnCsv', 'btnMapa', 'btnAgregar',
        'formFiltro', 'btnBuscar', 'btnLimpiar', 'resultados', 'visor', 'estadoMapa', 'chipConsulta', 'textoConsulta',
        'btnExportar', 'panelResultados', 'contenidoDetalle', 'panelDetalle', 'leyenda', 'textoBusqueda'];
    ids.forEach(id => crear(id));
    ['selCapa', 'selCampo', 'selOperador'].forEach(id => crear(id, 'SELECT'));
    const ctx = {
        document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null },
        location: { search: busqueda, href: 'http://localhost/Visor' + busqueda, reload: () => recargas++ },
        history: { replaceState(_estado, _titulo, url) { ctx.location.href = String(url); } },
        window: { matchMedia: () => ({ matches: false }), dispatchEvent() {} },
        URL, URLSearchParams, Event, console, setTimeout, clearTimeout,
        escaparHtml: escapar, Formato: { numero: n => String(n), fecha: n => String(n) },
        avisar() {}, Preferencias: { leer: () => null },
        VisorApi: { get(url) { return new Promise((resolve, reject) => solicitudes.push({ url, resolve, reject })); } },
    };
    vm.createContext(ctx);
    return { ctx, el, solicitudes, recargas: () => recargas, ejecutar(nombre) {
        return vm.runInContext(fs.readFileSync(path.join(scripts, nombre), 'utf8'), ctx, { filename: nombre });
    } };
}

const campoEstado = { clave: 'Estado', etiqueta: 'Estado', buscable: true, enTabla: true, tipo: 'Estado', operadores: ['igual'] };
const campoTexto = { clave: 'Nombre', etiqueta: 'Nombre', buscable: true, enTabla: true, tipo: 'Texto', operadores: ['contiene'] };
const catalogo = {
    capas: [
        { id: 'codigosfijos', nombre: 'Códigos fijos', nombreSingular: 'Código', campos: [campoEstado, campoTexto], registros: 100, visiblePorDefecto: true, orden: 1 },
        { id: 'vias', nombre: 'Vías', nombreSingular: 'Vía', campos: [campoTexto], registros: 40, visiblePorDefecto: false, orden: 2 },
    ],
    estados: [{ valor: 1, nombre: 'Activo', color: '#198754' }, { valor: 3, nombre: 'Cortado', color: '#dc3545' }],
    conteoPorEstado: { 1: 80, 3: 20 },
};
const feature = (capa, id, titulo = id) => ({ type: 'Feature', geometry: null, properties: { capa, id, titulo, Nombre: titulo, Estado: 3 } });
const resultado = (capa, titulo, total = 1) => ({ total, totalPaginas: 1, resultados: { features: [feature(capa, 1, titulo)] } });

async function consultas(busqueda = '') {
    const t = entorno(busqueda);
    const iniciado = t.ejecutar('consultas.js');
    t.solicitudes[0].resolve(catalogo);
    await iniciado;
    return t;
}

function visor() {
    const t = entorno();
    const capasDibujadas = [];
    const capa = () => ({ clearLayers() {}, addData() {}, getBounds: () => ({ isValid: () => false }), addTo() { return this; } });
    t.ctx.L = { geoJSON() { const c = capa(); capasDibujadas.push(c); return c; } };
    t.ctx.catalogoPrueba = catalogo;
    t.ctx.capaPrueba = capa;
    t.ctx.mapaPrueba = { getZoom: () => 16 };
    const fuente = fs.readFileSync(path.join(scripts, 'visor.js'), 'utf8');
    // Expone funciones privadas solamente dentro del contexto de pruebas, sin modificar el script servido.
    const instrumentada = fuente.replace('    iniciar();', `
        catalogo = catalogoPrueba; mapa = mapaPrueba;
        capaResultados = capaPrueba(); capaResaltado = capaPrueba();
        globalThis.prueba = { iniciar, identificar, seleccionar, limpiarSeleccion, buscarGeneral,
            consultarFiltros, limpiarConsulta, crearCapas, seleccion: () => seleccion,
            visibles: () => [...capas.values()].filter(c => c.visible).map(c => c.def.id) };`);
    vm.runInContext(instrumentada, t.ctx, { filename: 'visor.js' });
    t.ctx.prueba.crearCapas();
    return { ...t, acciones: t.ctx.prueba };
}

test('Buscar aplica Estado sin Agregar; Limpiar vacía editor y no vuelve a aplicar el filtro', async () => {
    const t = await consultas();
    t.el('valor').value = '3';
    t.el('btnBuscar').emitir('click');
    const p = new URL(t.solicitudes[1].url, 'http://localhost').searchParams;
    assert.deepEqual(JSON.parse(p.get('filtros')), [{ campo: 'Estado', operador: 'igual', valor: '3' }]);
    assert.equal(t.el('valor').value, '');
    t.solicitudes[1].resolve(resultado('codigosfijos', 'Cortado'));
    await esperar();
    t.el('valor').value = '1';
    t.el('btnLimpiar').emitir('click');
    assert.equal(t.el('valor').value, '');
    t.el('btnBuscar').emitir('click');
    assert.equal(new URL(t.solicitudes[2].url, 'http://localhost').searchParams.get('filtros'), '[]');
});

test('Consultas ignora respuestas y errores viejos, y cambios de capa invalidan resultados y enlaces', async () => {
    const t = await consultas();
    t.el('btnBuscar').emitir('click');
    t.el('btnBuscar').emitir('click');
    t.solicitudes[2].resolve(resultado('codigosfijos', 'Reciente'));
    await esperar();
    const actual = t.el('contenidoResultados').innerHTML;
    t.solicitudes[1].reject(new Error('Respuesta obsoleta'));
    await esperar();
    assert.equal(t.el('contenidoResultados').innerHTML, actual);
    assert.ok(!t.el('btnCsv').classList.contains('d-none'));
    t.el('btnBuscar').emitir('click');
    t.el('selCapa').value = 'vias'; t.el('selCapa').emitir('change');
    t.solicitudes[3].resolve(resultado('codigosfijos', 'Anterior'));
    await esperar();
    assert.equal(t.el('tituloResultados').textContent, 'Resultados');
    assert.match(t.el('contenidoResultados').innerHTML, /esta capa/);
    assert.equal(t.el('btnCsv').href, '#');
    assert.equal(t.el('btnMapa').href, '#');
});

test('Enlaces usan filtros aplicados; quitar un filtro invalida la respuesta en curso', async () => {
    const t = await consultas();
    t.el('valor').value = '3'; t.el('btnBuscar').emitir('click');
    t.el('valor').value = '1'; // editar el borrador no cambia la consulta en curso
    t.solicitudes[1].resolve(resultado('codigosfijos', 'Cortado'));
    await esperar();
    for (const id of ['btnCsv', 'btnMapa']) {
        const p = new URL(t.el(id).href, 'http://localhost').searchParams;
        assert.equal(JSON.parse(p.get('filtros'))[0].valor, '3');
    }
    t.el('valor').value = ''; t.el('btnBuscar').emitir('click');
    const quitar = { dataset: { quitar: '0' } };
    t.el('filtrosActivos').emitir('click', { target: { closest: selector => selector === '[data-quitar]' ? quitar : null } });
    t.solicitudes[2].resolve(resultado('codigosfijos', 'Obsoleto'));
    await esperar();
    assert.match(t.el('contenidoResultados').innerHTML, /Filtros modificados: presione Buscar/);
    assert.ok(t.el('btnCsv').classList.contains('d-none'));
    assert.ok(t.el('btnMapa').classList.contains('d-none'));
});

test('textoGeneral conserva su criterio en búsqueda, CSV y mapa', async () => {
    const t = await consultas('?capa=vias&textoGeneral=San%20Jos%C3%A9');
    assert.equal(new URL(t.solicitudes[1].url, 'http://localhost').searchParams.get('textoGeneral'), 'San José');
    t.solicitudes[1].resolve(resultado('vias', 'San José'));
    await esperar();
    for (const id of ['btnCsv', 'btnMapa'])
        assert.equal(new URL(t.el(id).href, 'http://localhost').searchParams.get('textoGeneral'), 'San José');
});

test('Inicio usa un GET; errores de conteo quedan en su bloque y el catálogo puede reintentarse', async () => {
    const t = entorno(); const cargado = t.ejecutar('inicio.js');
    t.solicitudes[0].resolve(catalogo); await cargado;
    assert.equal(t.solicitudes.length, 1);
    assert.match(t.el('resumenEstados').innerHTML, />80<\/a>/);
    assert.equal(t.el('estadoPanel'), undefined);
    const fallido = entorno(); const incompleto = fallido.ejecutar('inicio.js');
    fallido.solicitudes[0].resolve({ ...catalogo, conteoPorEstado: null }); await incompleto;
    assert.match(fallido.el('resumenEstados').innerHTML, /No se pudieron obtener/);
    assert.match(fallido.el('tarjetasCapas').innerHTML, /Códigos fijos/);
    fallido.el('btnReintentarEstados').emitir('click'); assert.equal(fallido.recargas(), 1);
    const sinApi = entorno(); const falloCatalogo = sinApi.ejecutar('inicio.js');
    sinApi.solicitudes[0].reject(new Error('No disponible')); await falloCatalogo;
    sinApi.el('btnReintentarPanel').emitir('click'); assert.equal(sinApi.recargas(), 1);
});

test('Visor reintenta catálogo y tolera preferencias corruptas o ids desconocidos', async () => {
    const t = visor();
    for (const valor of ['{', '{}', '"vias"']) {
        t.ctx.Preferencias.leer = () => valor; t.acciones.crearCapas();
        assert.deepEqual(Array.from(t.acciones.visibles()), ['codigosfijos']);
    }
    t.ctx.Preferencias.leer = () => '["vias","inexistente"]'; t.acciones.crearCapas();
    assert.deepEqual(Array.from(t.acciones.visibles()), ['vias']);
    const carga = t.acciones.iniciar(); t.solicitudes[0].reject(new Error('Sin catálogo')); await carga;
    t.el('estadoMapa').querySelector('[data-accion="recargar"]').emitir('click');
    assert.equal(t.recargas(), 1);
});

test('Identificar y seleccionar comparten vigencia; limpiar invalida respuestas y errores pendientes', async () => {
    const t = visor();
    const primera = t.acciones.identificar({ latlng: { lng: -60, lat: -16 } });
    const segunda = t.acciones.seleccionar('vias', 2);
    t.solicitudes[1].resolve(feature('vias', 2, 'Reciente')); await segunda;
    t.solicitudes[0].resolve({ grupos: [{ entidades: { features: [feature('vias', 1, 'Antigua')] } }] }); await primera;
    assert.equal(t.acciones.seleccion().id, 2);
    const tercera = t.acciones.seleccionar('vias', 3);
    t.acciones.limpiarSeleccion(); t.solicitudes[2].resolve(feature('vias', 3)); await tercera;
    assert.equal(t.acciones.seleccion(), null);
    assert.ok(!t.el('visor').classList.contains('con-detalle'));
    const cuarta = t.acciones.identificar({ latlng: { lng: -60, lat: -16 } });
    t.acciones.limpiarSeleccion(); t.solicitudes[3].reject(new Error('Antiguo')); await cuarta;
    assert.ok(!t.el('visor').classList.contains('con-detalle'));
});

test('Búsqueda general y filtros comparten vigencia; limpiar invalida consultas pendientes', async () => {
    const t = visor();
    const antigua = t.acciones.buscarGeneral('anterior');
    const actual = t.acciones.consultarFiltros('vias', [], 1, null, false, false, 'San José');
    t.solicitudes[1].resolve(resultado('vias', 'Vigente', 45)); await actual;
    t.solicitudes[0].resolve({ grupos: [] }); await antigua;
    assert.match(t.el('contenidoResultados').innerHTML, /Vigente/);
    assert.match(t.el('textoConsulta').textContent, /Mostrando 1–1 de 45/);
    assert.equal(new URL(t.el('btnExportar').href, 'http://localhost').searchParams.get('textoGeneral'), 'San José');
    const limpiar = t.acciones.buscarGeneral('pendiente'); t.acciones.limpiarConsulta();
    t.solicitudes[2].reject(new Error('Antiguo')); await limpiar;
    assert.match(t.el('contenidoResultados').innerHTML, /No hay una consulta activa/);
    assert.ok(t.el('chipConsulta').classList.contains('d-none'));
});

test('Búsqueda general avisa límites 25/100 y enlaza al criterio equivalente', async () => {
    const t = visor(); const busqueda = t.acciones.buscarGeneral('San José');
    t.solicitudes[0].resolve({ grupos: [
        { capa: 'vias', nombre: 'Vías', hayMas: true, entidades: { features: [feature('vias', 1)] } },
        { capa: 'codigosfijos', nombre: 'Códigos fijos', limiteAlcanzado: true, entidades: { features: [feature('codigosfijos', 2)] } },
    ] }); await busqueda;
    const html = t.el('contenidoResultados').innerHTML;
    assert.match(html, /Primeras 25 coincidencias/);
    assert.match(html, /Se muestran los primeros 100/);
    assert.match(html, /capa=vias&amp;textoGeneral=San\+Jos%C3%A9/);
    assert.doesNotMatch(html, /Consultas\?capa=codigosfijos/);
});
