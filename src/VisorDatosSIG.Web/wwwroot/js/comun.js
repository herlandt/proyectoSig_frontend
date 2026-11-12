// VisorDatosSIG · utilidades comunes del navegador.
// El navegador NUNCA habla con SQL Server: todo pasa por /api (proxy al backend).
'use strict';

class ErrorApi extends Error {
    constructor(mensaje, estado, datos) { super(mensaje); this.estado = estado; this.datos = datos; }
}

const VisorApi = {
    _csrf: null,

    async tokenCsrf() {
        if (!this._csrf) {
            const r = await fetch('/api/autenticacion/csrf', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            this._csrf = (await r.json()).token;
        }
        return this._csrf;
    },

    async solicitar(url, opciones = {}) {
        const metodo = (opciones.method || 'GET').toUpperCase();
        const cabeceras = Object.assign({ Accept: 'application/json' }, opciones.headers || {});
        let cuerpo = opciones.body;
        if (metodo !== 'GET') {
            if (!opciones.sinCsrf) cabeceras['X-CSRF-TOKEN'] = await this.tokenCsrf();
            if (cuerpo !== undefined && typeof cuerpo !== 'string') {
                cabeceras['Content-Type'] = 'application/json';
                cuerpo = JSON.stringify(cuerpo);
            }
        }
        const r = await fetch(url, { method: metodo, headers: cabeceras, body: cuerpo, credentials: 'same-origin', signal: opciones.signal });
        if (r.status === 401 && !opciones.sinRedireccion) {
            const volver = encodeURIComponent(location.pathname + location.search);
            location.href = `/Cuenta/Login?expirada=1&returnUrl=${volver}`;
            throw new ErrorApi('La sesión expiró.', 401);
        }
        if (r.status === 204) return null;
        const tipo = r.headers.get('content-type') || '';
        const datos = tipo.includes('json') ? await r.json() : await r.text();
        if (!r.ok) {
            const mensaje = (datos && (datos.detail || datos.title)) || `Error de comunicación (${r.status}).`;
            throw new ErrorApi(mensaje, r.status, datos);
        }
        return datos;
    },

    get(url, opciones) { return this.solicitar(url, opciones); },
    post(url, cuerpo, opciones = {}) { return this.solicitar(url, { ...opciones, method: 'POST', body: cuerpo }); },
    put(url, cuerpo) { return this.solicitar(url, { method: 'PUT', body: cuerpo }); },
};

const Formato = {
    numero(v, decimales = 0) {
        if (v === null || v === undefined || v === '') return '—';
        return Number(v).toLocaleString('es-BO', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
    },
    fecha(v) {
        if (!v) return '—';
        const d = new Date(v);
        return isNaN(d) ? v : d.toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' });
    },
    texto(v) { return v === null || v === undefined || v === '' ? '—' : String(v); },
};

function escaparHtml(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Aviso no intrusivo (toast). tipo: info | exito | error | advertencia */
function avisar(mensaje, tipo = 'info') {
    const colores = { info: 'text-bg-primary', exito: 'text-bg-success', error: 'text-bg-danger', advertencia: 'text-bg-warning' };
    const iconos = { info: 'bi-info-circle', exito: 'bi-check-circle', error: 'bi-exclamation-octagon', advertencia: 'bi-exclamation-triangle' };
    const contenedor = document.getElementById('avisos');
    if (!contenedor) { alert(mensaje); return; }
    const el = document.createElement('div');
    el.className = `toast align-items-center border-0 ${colores[tipo] || colores.info}`;
    el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    el.innerHTML = `<div class="d-flex"><div class="toast-body"><i class="bi ${iconos[tipo] || iconos.info} me-2" aria-hidden="true"></i>${escaparHtml(mensaje)}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Cerrar"></button></div>`;
    contenedor.appendChild(el);
    const t = new bootstrap.Toast(el, { delay: tipo === 'error' ? 7000 : 4000 });
    el.addEventListener('hidden.bs.toast', () => el.remove());
    t.show();
}

/** Lectura/escritura tolerante de preferencias locales (puede fallar en modo privado). */
const Preferencias = {
    leer(clave) { try { return localStorage.getItem(clave); } catch { return null; } },
    guardar(clave, valor) { try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ } },
};

document.addEventListener('DOMContentLoaded', () => {
    // Cerrar sesión (cabecera y menú).
    document.querySelectorAll('[data-accion="salir"]').forEach(b => b.addEventListener('click', async () => {
        try { await VisorApi.post('/api/autenticacion/cerrar', undefined, { sinRedireccion: true }); } catch { /* se redirige igual */ }
        location.href = '/Cuenta/Login?salida=1';
    }));

    // Menú lateral colapsable en escritorio (preferencia recordada).
    const btn = document.getElementById('btnColapsarMenu');
    if (btn) {
        const aplicar = colapsado => {
            document.body.classList.toggle('menu-colapsado', colapsado);
            btn.setAttribute('aria-expanded', String(!colapsado));
            window.dispatchEvent(new Event('visor:redimension'));
        };
        // En el visor el menú arranca contraído (más espacio para el mapa) salvo que el usuario elija otra cosa.
        const preferencia = Preferencias.leer('visor.menuColapsado');
        aplicar(preferencia === null ? document.body.classList.contains('pagina-visor') : preferencia === '1');
        btn.addEventListener('click', () => {
            const nuevo = !document.body.classList.contains('menu-colapsado');
            Preferencias.guardar('visor.menuColapsado', nuevo ? '1' : '0');
            aplicar(nuevo);
        });
    }
});
