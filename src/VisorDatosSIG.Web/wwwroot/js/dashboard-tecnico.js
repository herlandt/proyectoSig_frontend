// VisorDatosSIG · dashboard técnico: indicadores del día y avance por trabajador (cortes y reconexiones).
'use strict';
(() => {
    const raiz = document.getElementById('dashboardTecnico');
    if (!raiz) return;
    const el = id => document.getElementById(id);
    const dos = n => String(n).padStart(2, '0');
    const d = new Date();
    el('dia').value = `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
    let vigente = 0;

    const tile = (etiqueta, valor, detalle, icono) => `<div class="col"><div class="kpi">
        <div class="etiqueta"><i class="bi ${icono}" aria-hidden="true"></i>${escaparHtml(etiqueta)}</div>
        <div class="valor">${Formato.numero(valor)}</div>
        <div class="detalle">${escaparHtml(detalle)}</div></div></div>`;

    async function cargar() {
        const s = ++vigente;
        raiz.style.opacity = '.6';   // se conserva lo anterior mientras llega lo nuevo
        try {
            const r = await VisorApi.get(`/api/monitoreo/resumen?dia=${encodeURIComponent(el('dia').value)}`);
            if (s !== vigente) return;
            el('kpisOperativos').innerHTML = [
                tile('Rutas activas', r.asignacionesActivas, 'Asignaciones pendientes o en curso', 'bi-signpost-split'),
                tile('Paradas pendientes', r.pendientes, `${Formato.numero(r.cortesPendientes)} cortes · ${Formato.numero(r.reconexionesPendientes)} reconexiones`, 'bi-hourglass-split'),
                tile('Realizadas en el día', r.realizadasHoy, 'Cortes o reconexiones hechos', 'bi-check2-circle'),
                tile('Observadas en el día', r.observadasHoy, 'No realizadas (casa cerrada, etc.)', 'bi-eye'),
                tile('Fuera del radio', r.fueraDeRadioHoy, 'Guardadas lejos del código fijo', 'bi-exclamation-triangle'),
            ].join('');
            const filas = r.trabajadores;
            if (!filas.length) {
                el('tablaTrabajadores').innerHTML = '<div class="estado-vacio">No hay usuarios con rol Cortador o Reconexion.</div>';
                return;
            }
            el('tablaTrabajadores').innerHTML = `<div class="table-responsive"><table class="table table-sm align-middle">
                <thead><tr><th scope="col">Trabajador</th><th scope="col">Rol</th><th scope="col" class="text-end">Pendientes</th>
                    <th scope="col" class="text-end">Realizadas</th><th scope="col" class="text-end">Observadas</th>
                    <th scope="col" class="text-end">Fuera del radio</th><th scope="col">Avance del día</th><th scope="col">Último registro</th></tr></thead>
                <tbody>${filas.map(t => {
                    const hechas = t.realizadas + t.observadas;
                    const total = hechas + t.pendientes;
                    const avance = total > 0 ? Math.round(hechas / total * 100) : 0;
                    return `<tr><td class="fw-semibold">${escaparHtml(t.nombre)}</td><td>${escaparHtml(t.rol)}</td>
                        <td class="text-end">${Formato.numero(t.pendientes)}</td><td class="text-end">${Formato.numero(t.realizadas)}</td>
                        <td class="text-end">${Formato.numero(t.observadas)}</td>
                        <td class="text-end">${t.fueraDeRadio ? `<span class="alerta-radio">${Formato.numero(t.fueraDeRadio)}</span>` : '0'}</td>
                        <td><div class="d-flex align-items-center gap-2"><div class="medidor flex-fill" role="progressbar" aria-valuenow="${avance}"
                            aria-valuemin="0" aria-valuemax="100" aria-label="Avance de ${escaparHtml(t.nombre)}"><span style="width:${avance}%"></span></div>
                            <span class="small">${avance} %</span></div></td>
                        <td class="small text-nowrap">${t.ultimaEjecucion ? escaparHtml(Formato.fecha(t.ultimaEjecucion)) : '—'}</td></tr>`;
                }).join('')}</tbody></table></div>`;
        } catch (err) {
            if (s === vigente) el('tablaTrabajadores').innerHTML = `<div class="alert alert-danger">${escaparHtml(err.message)}</div>`;
        } finally {
            if (s === vigente) raiz.style.opacity = '';
        }
    }

    el('formDia').addEventListener('submit', e => { e.preventDefault(); cargar(); });
    cargar();
    setInterval(() => { if (!document.hidden) cargar(); }, 60000);
})();
