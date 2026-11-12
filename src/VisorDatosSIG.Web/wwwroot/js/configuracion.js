// VisorDatosSIG · configuración operativa (velocidad, minutos por parada, GPS, radio de validación, fotos y paradas).
'use strict';
(() => {
    const form = document.getElementById('formConfiguracion');
    if (!form) return;
    const campos = ['velocidadKmH', 'minutosPorParada', 'intervaloGpsSegundos', 'radioValidacionMetros', 'maximoFotos', 'maximoParadas'];
    const el = id => document.getElementById(id);
    const mensaje = (texto, tipo) => {
        el('mensajeConfiguracion').innerHTML = texto ? `<div class="alert alert-${tipo} py-2">${escaparHtml(texto)}</div>` : '';
    };

    async function cargar() {
        try {
            const c = await VisorApi.get('/api/configuracion-operativa');
            for (const k of campos) el(k).value = c[k];
        } catch (err) {
            mensaje(err.message, 'danger');
        }
    }

    form.addEventListener('submit', async e => {
        e.preventDefault();
        for (const k of campos) el(k).classList.toggle('is-invalid', !el(k).checkValidity());
        if (!form.checkValidity()) { mensaje('Revise los valores marcados: están fuera del rango permitido.', 'warning'); return; }
        const datos = Object.fromEntries(campos.map(k => [k, Number(el(k).value)]));
        el('btnGuardarConfiguracion').disabled = true;
        try {
            await VisorApi.put('/api/configuracion-operativa', datos);
            mensaje('Configuración guardada.', 'success');
            avisar('Configuración operativa guardada.', 'exito');
        } catch (err) {
            mensaje(err.message, 'danger');
        } finally {
            el('btnGuardarConfiguracion').disabled = false;
        }
    });

    cargar();
})();
