// rotas.js
export let partidaLocalizacao = null;
export let moradasEntregas = [];
export let rotaOtimizada = [];
let googleMap = null;
let googleMarkers = [];
let googleRoutePolyline = null;
let autocompleteWidget = null;

export function inicializarGoogleAutocomplete(callback) {
    const input = document.getElementById('busca-morada');
    if (!input || typeof google === 'undefined') return;

    autocompleteWidget = new google.maps.places.Autocomplete(input, {
        componentRestrictions: { country: ['pt', 'es'] },
        fields: ['geometry', 'formatted_address']
    });

    autocompleteWidget.addListener('place_changed', () => {
        const place = autocompleteWidget.getPlace();
        if (!place.geometry) return;
        
        const morada = {
            id: 'm_' + Date.now(),
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
            address: place.formatted_address
        };
        callback(morada);
        input.value = "";
    });
}

export function desenharMapaGoogle(mapElement, partida, rotas) {
    if (!googleMap) {
        googleMap = new google.maps.Map(mapElement, {
            zoom: 13,
            center: { lat: partida.lat, lng: partida.lng },
            mapTypeControl: false, streetViewControl: false, fullscreenControl: false
        });
    }

    googleMarkers.forEach(m => m.setMap(null)); googleMarkers = [];
    if (googleRoutePolyline) googleRoutePolyline.setMap(null);

    const path = [];
    const bounds = new google.maps.LatLngBounds();
    const startPos = new google.maps.LatLng(partida.lat, partida.lng);
    
    path.push(startPos); bounds.extend(startPos);
    googleMarkers.push(new google.maps.Marker({ position: startPos, map: googleMap, label: "P" }));

    rotas.forEach((p, i) => {
        const pos = new google.maps.LatLng(p.lat, p.lng);
        path.push(pos); bounds.extend(pos);
        googleMarkers.push(new google.maps.Marker({ position: pos, map: googleMap, label: (i + 1).toString() }));
    });

    googleRoutePolyline = new google.maps.Polyline({ path, strokeColor: "#2563EB", strokeWeight: 4 });
    googleRoutePolyline.setMap(googleMap);
    googleMap.fitBounds(bounds);
}

export function calcularDistanciaHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}