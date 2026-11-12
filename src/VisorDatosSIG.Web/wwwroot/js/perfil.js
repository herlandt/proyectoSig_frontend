'use strict';
(async () => {
    const el = id => document.getElementById(id);
    try {
        const p = await VisorApi.get('/api/cuenta/perfil');
        el('datosPerfil').innerHTML = `
            <dt class="col-sm-4">Usuario</dt><dd class="col-sm-8">${escaparHtml(p.login)}</dd>
            <dt class="col-sm-4">Nombre completo</dt><dd class="col-sm-8">${escaparHtml(p.nombre)}</dd>
            <dt class="col-sm-4">Perfil</dt><dd class="col-sm-8">${escaparHtml(p.perfil)}</dd>
            <dt class="col-sm-4">Roles</dt><dd class="col-sm-8">${escaparHtml(p.roles.join(', '))}</dd>
            <dt class="col-sm-4">Registrado</dt><dd class="col-sm-8">${Formato.fecha(p.fechaRegistro)}</dd>`;
    } catch (err) { el('datosPerfil').innerHTML = `<dd class="col-12 text-danger">${escaparHtml(err.message)}</dd>`; }

    el('formClave').addEventListener('submit', async e => {
        e.preventDefault();
        const msg = el('mensajeClave');
        const mostrar = (t, tipo) => { msg.className = `alert alert-${tipo}`; msg.textContent = t; };
        if (el('claveNueva').value !== el('claveConfirmar').value) { mostrar('Las contraseñas nuevas no coinciden.', 'danger'); el('claveConfirmar').focus(); return; }
        try {
            await VisorApi.post('/api/cuenta/contrasena', { actual: el('claveActual').value, nueva: el('claveNueva').value });
            e.target.reset();
            mostrar('Contraseña actualizada correctamente.', 'success');
        } catch (err) { mostrar(err.message, 'danger'); }
    });
})();
