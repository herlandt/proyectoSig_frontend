'use strict';
(() => {
    const form = document.getElementById('formAcceso');
    const mensaje = document.getElementById('mensajeAcceso');
    const boton = document.getElementById('btnIngresar');
    const spinner = boton.querySelector('.spinner-border');
    const login = document.getElementById('login');
    const contrasena = document.getElementById('contrasena');
    const params = new URLSearchParams(location.search);

    const mostrar = (texto, tipo) => {
        mensaje.className = `alert alert-${tipo}`;
        mensaje.textContent = texto;
    };
    const irAlDestino = () => {
        const destino = form.dataset.returnUrl || '/';
        location.href = destino.startsWith('/') && !destino.startsWith('//') ? destino : '/';
    };
    if (params.get('expirada')) mostrar('Su sesión expiró por inactividad. Ingrese nuevamente.', 'warning');
    if (params.get('salida')) mostrar('Sesión cerrada correctamente.', 'success');
    login.focus();

    // Acceso rápido de demostración: la API solo lo ofrece en Development; si no existe (404), no se muestra nada.
    const ICONOS_DEMO = { Administrador: 'bi-shield-lock', Consultor: 'bi-person' };
    VisorApi.get('/api/autenticacion/demo', { sinRedireccion: true }).then(r => {
        if (!r?.perfiles?.length) return;
        const cont = document.getElementById('botonesDemo');
        cont.innerHTML = r.perfiles.map(p => `<button class="btn btn-outline-secondary" type="button" data-perfil="${escaparHtml(p)}">
            <i class="bi ${ICONOS_DEMO[p] || 'bi-person'} me-2" aria-hidden="true"></i>Entrar como ${escaparHtml(p)}</button>`).join('');
        document.getElementById('accesoDemo').classList.remove('d-none');
        cont.addEventListener('click', async e => {
            const b = e.target.closest('[data-perfil]');
            if (!b) return;
            cont.querySelectorAll('button').forEach(x => { x.disabled = true; });
            try {
                await VisorApi.post('/api/autenticacion/demo', { perfil: b.dataset.perfil }, { sinCsrf: true, sinRedireccion: true });
                irAlDestino();
            } catch (err) {
                mostrar(err.message || 'No se pudo iniciar la sesión de demostración.', 'danger');
                cont.querySelectorAll('button').forEach(x => { x.disabled = false; });
            }
        });
    }).catch(() => { /* sin acceso de demostración */ });

    document.getElementById('verContrasena').addEventListener('click', e => {
        const visible = contrasena.type === 'text';
        contrasena.type = visible ? 'password' : 'text';
        e.currentTarget.setAttribute('aria-pressed', String(!visible));
        e.currentTarget.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
        e.currentTarget.querySelector('i').className = visible ? 'bi bi-eye' : 'bi bi-eye-slash';
    });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        login.classList.toggle('is-invalid', !login.value.trim());
        contrasena.classList.toggle('is-invalid', !contrasena.value);
        if (!login.value.trim() || !contrasena.value) {
            (login.value.trim() ? contrasena : login).focus();
            return;
        }
        boton.disabled = true;
        spinner.classList.remove('d-none');
        try {
            await VisorApi.post('/api/autenticacion/iniciar', { login: login.value.trim(), contrasena: contrasena.value },
                { sinCsrf: true, sinRedireccion: true });
            irAlDestino();
        } catch (err) {
            mostrar(err.message || 'No se pudo iniciar sesión.', 'danger');
            contrasena.value = '';
            contrasena.focus();
        } finally {
            boton.disabled = false;
            spinner.classList.add('d-none');
        }
    });
})();
