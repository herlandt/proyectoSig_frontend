// VisorDatosSIG · mapa base común de las pantallas de la parte 2 (asignación, monitoreo, ejecución).
// Mismos mapas base que el visor (OpenStreetMap, calles y satélite de Esri) y la misma preferencia guardada.
'use strict';

const CENTRO_SAN_IGNACIO = [-16.3785, -60.9605];

function crearMapaBase(idElemento, { centro = CENTRO_SAN_IGNACIO, zoom = 15, controlCapas = true } = {}) {
    const mapa = L.map(idElemento, { zoomControl: false, preferCanvas: true }).setView(centro, zoom);
    L.control.zoom({ position: 'topright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(mapa);
    const bases = {
        'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 20, maxNativeZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>',
        }),
        'Calles (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 20, maxNativeZoom: 19, attribution: 'Mapa &copy; Esri, HERE, Garmin, &copy; colaboradores de OpenStreetMap',
        }),
        'Satélite (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 20, maxNativeZoom: 17, attribution: 'Imágenes &copy; Esri, Maxar, Earthstar Geographics',
        }),
    };
    let nombre = Preferencias.leer('visor.mapaBase');
    if (!bases[nombre]) nombre = 'OpenStreetMap';
    bases[nombre].addTo(mapa);
    if (controlCapas) L.control.layers(bases, null, { position: 'topright' }).addTo(mapa);
    mapa.on('baselayerchange', e => Preferencias.guardar('visor.mapaBase', e.name));
    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(mapa);
    window.addEventListener('resize', () => setTimeout(() => mapa.invalidateSize(), 200));
    return mapa;
}

/** Marcador redondo con el número de la parada en la ruta. */
function iconoNumero(numero, clase = '') {
    return L.divIcon({
        className: `marcador-numero ${clase}`, html: `<span>${escaparHtml(String(numero))}</span>`,
        iconSize: [26, 26], iconAnchor: [13, 13], tooltipAnchor: [12, 0],
    });
}

/** Marcador del punto de partida de la ruta. */
function iconoPartida() {
    return L.divIcon({
        className: 'marcador-partida', html: '<span><i class="bi bi-flag-fill" aria-hidden="true"></i></span>',
        iconSize: [30, 30], iconAnchor: [15, 15],
    });
}

/** [lon, lat] (formato de la API) → [lat, lon] (formato de Leaflet). */
const aLatLng = p => [p[1], p[0]];

function formatoDistancia(metros) {
    if (!Number.isFinite(metros)) return '—';
    return metros >= 1000 ? `${Formato.numero(metros / 1000, 2)} km` : `${Formato.numero(metros)} m`;
}

function formatoDuracion(minutos) {
    if (!Number.isFinite(minutos)) return '—';
    const h = Math.floor(minutos / 60), m = Math.round(minutos % 60);
    return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
