'use strict';
(() => {
    const el = id => document.getElementById(id);
    // Identifica la vista (data-seccion); data-pagina queda solo para los botones de paginación.
    const pagina = document.querySelector('[data-seccion]')?.dataset.seccion;
    const error = (cont, err) => { cont.innerHTML = `<div class="alert alert-danger">${escaparHtml(err.message)}</div>`; };

    function paginacion(p, accion) {
        return `<nav class="d-flex align-items-center gap-2 flex-wrap mt-2" aria-label="Paginación">
            <button class="btn btn-sm btn-outline-secondary" type="button" data-${accion}="${p.pagina - 1}" ${p.pagina <= 1 ? 'disabled' : ''}>Anterior</button>
            <span class="small">Página ${p.pagina} de ${Math.max(1, p.totalPaginas)} · ${Formato.numero(p.total)} registros</span>
            <button class="btn btn-sm btn-outline-secondary" type="button" data-${accion}="${p.pagina + 1}" ${p.pagina >= p.totalPaginas ? 'disabled' : ''}>Siguiente</button></nav>`;
    }

    // ---------------------------------------------------------------- usuarios
    async function usuarios() {
        const cont = el('tablaUsuarios');
        const modal = new bootstrap.Modal(el('modalUsuario'));
        const modalClave = new bootstrap.Modal(el('modalContrasena'));
        let lista = [];
        let roles = [];

        async function cargar() {
            try {
                [lista, roles] = await Promise.all([VisorApi.get('/api/usuarios'), roles.length ? roles : VisorApi.get('/api/usuarios/roles')]);
                el('uRol').innerHTML = roles.map(r => `<option value="${escaparHtml(r.nombreRol)}">${escaparHtml(r.nombreRol)}</option>`).join('');
                cont.innerHTML = `<div class="table-responsive"><table class="table table-sm align-middle">
                    <thead><tr><th scope="col">Usuario</th><th scope="col">Nombre completo</th><th scope="col">Perfil</th><th scope="col">Rol</th><th scope="col">Estado</th><th scope="col">Acciones</th></tr></thead>
                    <tbody>${lista.map(u => `<tr>
                        <td class="fw-semibold">${escaparHtml(u.login)}</td><td>${escaparHtml(u.nombre)}</td>
                        <td>${escaparHtml(u.perfil)}</td><td>${escaparHtml(u.roles.join(', '))}</td>
                        <td>${u.activo ? '<span class="text-success"><i class="bi bi-check-circle-fill me-1" aria-hidden="true"></i>Activo</span>'
                                       : '<span class="text-danger"><i class="bi bi-slash-circle-fill me-1" aria-hidden="true"></i>Inactivo</span>'}</td>
                        <td class="text-nowrap">
                            <button class="btn btn-sm btn-link" type="button" data-editar="${u.idUsuario}">Editar<span class="visually-hidden"> ${escaparHtml(u.login)}</span></button>
                            <button class="btn btn-sm btn-link" type="button" data-clave="${u.idUsuario}">Restablecer contraseña<span class="visually-hidden"> de ${escaparHtml(u.login)}</span></button>
                            <button class="btn btn-sm btn-link ${u.activo ? 'text-danger' : 'text-success'}" type="button" data-estado="${u.idUsuario}" data-activo="${u.activo}">${u.activo ? 'Bloquear' : 'Activar'}<span class="visually-hidden"> ${escaparHtml(u.login)}</span></button>
                        </td></tr>`).join('')}</tbody></table></div>`;
            } catch (err) { error(cont, err); }
        }

        function abrir(u) {
            el('errorUsuario').classList.add('d-none');
            el('idUsuario').value = u ? u.idUsuario : '';
            el('tituloModalUsuario').textContent = u ? `Editar usuario ${u.login}` : 'Nuevo usuario';
            el('uLogin').value = u ? u.login : '';
            el('uLogin').disabled = !!u;
            el('uNombre').value = u ? u.nombre : '';
            el('uRol').value = u ? (u.roles[0] || 'Consultor') : 'Consultor';
            el('bloqueContrasena').classList.toggle('d-none', !!u);
            el('uContrasena').value = el('uConfirmar').value = '';
            modal.show();
            setTimeout(() => (u ? el('uNombre') : el('uLogin')).focus(), 300);
        }

        el('btnNuevo').addEventListener('click', () => abrir(null));
        el('formUsuario').addEventListener('submit', async e => {
            e.preventDefault();
            const id = el('idUsuario').value;
            const caja = el('errorUsuario');
            caja.classList.add('d-none');
            if (!id && el('uContrasena').value !== el('uConfirmar').value) {
                caja.textContent = 'Las contraseñas no coinciden.'; caja.classList.remove('d-none'); el('uConfirmar').focus(); return;
            }
            try {
                const datos = { login: el('uLogin').value.trim(), nombre: el('uNombre').value.trim(), rol: el('uRol').value, contrasena: el('uContrasena').value };
                if (id) await VisorApi.put(`/api/usuarios/${id}`, datos); else await VisorApi.post('/api/usuarios', datos);
                modal.hide();
                avisar(id ? 'Usuario actualizado.' : 'Usuario creado.', 'exito');
                cargar();
            } catch (err) { caja.textContent = err.message; caja.classList.remove('d-none'); }
        });

        el('formContrasena').addEventListener('submit', async e => {
            e.preventDefault();
            const caja = el('errorContrasena');
            caja.classList.add('d-none');
            if (el('rNueva').value !== el('rConfirmar').value) { caja.textContent = 'Las contraseñas no coinciden.'; caja.classList.remove('d-none'); return; }
            try {
                await VisorApi.post(`/api/usuarios/${el('rId').value}/restablecer`, { contrasena: el('rNueva').value });
                modalClave.hide();
                avisar('Contraseña restablecida.', 'exito');
            } catch (err) { caja.textContent = err.message; caja.classList.remove('d-none'); }
        });

        cont.addEventListener('click', async e => {
            const b = e.target.closest('button');
            if (!b) return;
            const id = Number(b.dataset.editar || b.dataset.clave || b.dataset.estado);
            const u = lista.find(x => x.idUsuario === id);
            if (!u) return;
            if (b.dataset.editar) abrir(u);
            if (b.dataset.clave) {
                el('rId').value = u.idUsuario; el('rLogin').textContent = u.login;
                el('rNueva').value = el('rConfirmar').value = ''; el('errorContrasena').classList.add('d-none');
                modalClave.show();
            }
            if (b.dataset.estado) {
                const activo = b.dataset.activo === 'true';
                if (!confirm(activo ? `¿Bloquear al usuario ${u.login}? No podrá iniciar sesión.` : `¿Activar al usuario ${u.login}?`)) return;
                try {
                    await VisorApi.post(`/api/usuarios/${id}/${activo ? 'bloquear' : 'activar'}`);
                    avisar(activo ? 'Usuario bloqueado.' : 'Usuario activado.', 'exito');
                    cargar();
                } catch (err) { avisar(err.message, 'error'); }
            }
        });
        cargar();
    }

    // ---------------------------------------------------------------- migraciones
    async function migraciones() {
        const cont = el('tablaMigraciones');
        const modal = new bootstrap.Modal(el('modalMigracion'));
        const colorEstado = { Completada: 'success', Revertida: 'danger', Cancelada: 'warning', Fallida: 'danger', EnCurso: 'info' };
        async function cargar(numero = 1) {
            try {
                const p = await VisorApi.get(`/api/migraciones?pagina=${numero}&tamano=20`);
                if (!p.total) { cont.innerHTML = '<div class="estado-vacio">Todavía no hay migraciones registradas.</div>'; return; }
                cont.innerHTML = `<div class="table-responsive"><table class="table table-sm table-hover align-middle">
                    <thead><tr><th>#</th><th>Fecha</th><th>Usuario</th><th>Capa → tabla</th><th>Modo</th><th>Estado</th><th class="text-end">Leídos</th><th class="text-end">Insertados</th><th class="text-end">Omitidos</th><th class="text-end">Fallidos</th><th class="text-end">Duración</th><th></th></tr></thead>
                    <tbody>${p.elementos.map(m => `<tr>
                        <td>${m.idMigracion}</td><td class="text-nowrap">${Formato.fecha(m.fechaInicio)}</td><td>${escaparHtml(m.usuario)}</td>
                        <td>${escaparHtml(m.capa)} → <code>${escaparHtml(m.tablaDestino)}</code></td><td>${escaparHtml(m.modo)}</td>
                        <td><span class="badge text-bg-${colorEstado[m.estado] || 'secondary'}">${escaparHtml(m.estado)}</span></td>
                        <td class="text-end">${Formato.numero(m.registrosLeidos)}</td><td class="text-end">${Formato.numero(m.insertados)}</td>
                        <td class="text-end">${Formato.numero(m.omitidos)}</td><td class="text-end">${Formato.numero(m.fallidos)}</td>
                        <td class="text-end text-nowrap">${m.duracionMs != null ? Formato.numero(m.duracionMs / 1000, 1) + ' s' : '—'}</td>
                        <td><button class="btn btn-sm btn-link" type="button" data-ver="${m.idMigracion}">Detalle</button></td></tr>`).join('')}</tbody></table></div>
                    ${paginacion(p, 'pagina')}`;
            } catch (err) { error(cont, err); }
        }
        cont.addEventListener('click', async e => {
            const pag = e.target.closest('[data-pagina]');
            if (pag && !pag.disabled) { cargar(Number(pag.dataset.pagina)); return; }
            const ver = e.target.closest('[data-ver]');
            if (!ver) return;
            el('detalleMigracion').innerHTML = '<div class="estado-vacio">Cargando…</div>';
            modal.show();
            try {
                const d = await VisorApi.get(`/api/migraciones/${ver.dataset.ver}`);
                const c = d.cabecera;
                el('detalleMigracion').innerHTML = `
                    <dl class="row small mb-3">
                        <dt class="col-sm-3">Archivo</dt><dd class="col-sm-9 text-break">${escaparHtml(c.archivo)}</dd>
                        <dt class="col-sm-3">Equipo / usuario</dt><dd class="col-sm-9">${escaparHtml(c.equipo || '—')} · ${escaparHtml(c.usuario)}</dd>
                        <dt class="col-sm-3">Inicio / fin</dt><dd class="col-sm-9">${Formato.fecha(c.fechaInicio)} → ${Formato.fecha(c.fechaFin)}</dd>
                        <dt class="col-sm-3">Resultado</dt><dd class="col-sm-9">${escaparHtml(c.mensaje || '')}</dd>
                    </dl>
                    <h3 class="h6">Incidencias registradas (${d.detalle.length})</h3>
                    ${d.detalle.length ? `<div class="table-responsive"><table class="table table-sm"><thead><tr><th>Nivel</th><th>Fila (FID)</th><th>Campo</th><th>Valor</th><th>Mensaje</th></tr></thead>
                    <tbody>${d.detalle.map(x => `<tr><td>${escaparHtml(x.nivel)}</td><td>${x.fila ?? '—'}</td><td>${escaparHtml(x.campo || '—')}</td><td class="text-break">${escaparHtml(x.valor || '—')}</td><td>${escaparHtml(x.mensaje)}</td></tr>`).join('')}</tbody></table></div>`
                    : '<p class="text-body-secondary">Sin incidencias.</p>'}`;
            } catch (err) { error(el('detalleMigracion'), err); }
        });
        cargar();
    }

    // ---------------------------------------------------------------- bitácora
    async function bitacora() {
        const cont = el('tablaBitacora');
        let texto = '';
        async function cargar(numero = 1) {
            try {
                const p = await VisorApi.get(`/api/bitacora?pagina=${numero}&tamano=25&texto=${encodeURIComponent(texto)}`);
                if (!p.total) { cont.innerHTML = '<div class="estado-vacio">Sin registros para el criterio indicado.</div>'; return; }
                cont.innerHTML = `<div class="table-responsive"><table class="table table-sm align-middle">
                    <thead><tr><th>Fecha</th><th>Usuario</th><th>Evento</th><th>Resultado</th><th>IP</th><th>Detalle</th></tr></thead>
                    <tbody>${p.elementos.map(r => `<tr><td class="text-nowrap">${Formato.fecha(r.fecha)}</td><td>${escaparHtml(r.login || '—')}</td>
                        <td>${escaparHtml(r.evento)}</td><td>${r.exito ? '<span class="text-success">Éxito</span>' : '<span class="text-danger">Fallo</span>'}</td>
                        <td>${escaparHtml(r.ip || '—')}</td><td>${escaparHtml(r.detalle || '')}</td></tr>`).join('')}</tbody></table></div>${paginacion(p, 'pagina')}`;
            } catch (err) { error(cont, err); }
        }
        el('formBitacora').addEventListener('submit', e => { e.preventDefault(); texto = el('textoBitacora').value.trim(); cargar(1); });
        cont.addEventListener('click', e => { const b = e.target.closest('[data-pagina]'); if (b && !b.disabled) cargar(Number(b.dataset.pagina)); });
        cargar();
    }

    // ---------------------------------------------------------------- catálogo
    async function capas() {
        const cont = el('catalogoCapas');
        try {
            const c = await VisorApi.get('/api/capas');
            cont.innerHTML = c.capas.map(k => `
                <div class="col-12 col-lg-6"><div class="panel p-3 h-100">
                    <h2 class="h5 d-flex align-items-center gap-2"><span class="muestra" style="border-color:${k.color};background:${k.colorRelleno}33"></span>${escaparHtml(k.nombre)}</h2>
                    <dl class="row small mb-2">
                        <dt class="col-5">Geometría</dt><dd class="col-7">${escaparHtml(k.tipoGeometria)}</dd>
                        <dt class="col-5">Registros</dt><dd class="col-7">${Formato.numero(k.registros)}</dd>
                        <dt class="col-5">Zoom mínimo de carga</dt><dd class="col-7">${k.zoomMinimo}</dd>
                        <dt class="col-5">Estilo</dt><dd class="col-7"><code>${escaparHtml(k.color)}</code> · relleno ${Math.round(k.opacidadRelleno * 100)} %</dd>
                        <dt class="col-5">Extensión</dt><dd class="col-7 text-break">${k.extension ? `${k.extension.minX.toFixed(5)}, ${k.extension.minY.toFixed(5)} → ${k.extension.maxX.toFixed(5)}, ${k.extension.maxY.toFixed(5)}` : '—'}</dd>
                    </dl>
                    <div class="table-responsive"><table class="table table-sm mb-0"><thead><tr><th>Campo</th><th>Tipo</th><th>Buscable</th><th>En tabla</th></tr></thead>
                    <tbody>${k.campos.map(f => `<tr><td>${escaparHtml(f.etiqueta)} <code class="small">${escaparHtml(f.clave)}</code></td><td>${escaparHtml(f.tipo)}</td>
                        <td>${f.buscable ? 'Sí' : 'No'}</td><td>${f.enTabla ? 'Sí' : 'No'}</td></tr>`).join('')}</tbody></table></div>
                </div></div>`).join('');
        } catch (err) { error(cont, err); }
    }

    ({ usuarios, migraciones, bitacora, capas })[pagina]?.();
})();
