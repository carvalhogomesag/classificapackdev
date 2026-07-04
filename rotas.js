// rotas.js

let googleMap = null;
let googleMarkers = [];
let googleRoutePolyline = null;
let autocompleteWidget = null;

/**
 * Inicializa o widget do Google Places Autocomplete para moradas em Portugal e Espanha
 */
export function inicializarGoogleAutocomplete(buscaMoradaInput, callback) {
    if (typeof google === 'undefined' || !google.maps || !google.maps.places || !buscaMoradaInput) return;

    autocompleteWidget = new google.maps.places.Autocomplete(buscaMoradaInput, {
        componentRestrictions: { country: ['pt', 'es'] },
        fields: ['geometry', 'formatted_address']
    });

    autocompleteWidget.addListener('place_changed', () => {
        const place = autocompleteWidget.getPlace();
        if (!place.geometry || !place.geometry.location) {
            alert("Morada não encontrada. Selecione uma opção válida da lista da Google.");
            return;
        }

        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();
        const address = place.formatted_address;

        callback({ id: 'm_' + Date.now() + Math.random().toString(36).substr(2, 5), lat, lng, address });
    });
}

/**
 * Traduz coordenadas GPS obtidas pelo navegador numa morada legível (Reverse Geocoding)
 */
export function obterEnderecoPorGPSGoogle(lat, lng, callback) {
    if (typeof google === 'undefined' || !google.maps) {
        callback(null);
        return;
    }

    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat: parseFloat(lat), lng: parseFloat(lng) } }, (results, status) => {
        if (status === "OK" && results[0]) {
            callback({
                lat: parseFloat(lat),
                lng: parseFloat(lng),
                address: results[0].formatted_address
            });
        } else {
            callback(null);
        }
    });
}

/**
 * Calcula a distância em linha reta entre duas coordenadas geográficas (em km)
 */
export function calcularDistanciaHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Desenha a rota otimizada no Mapa da Google com algoritmo de Jitter para evitar sobreposição
 */
export function desenharMapaGoogle(mapElement, partida, rotas) {
    if (typeof google === 'undefined' || !mapElement || !partida) return;

    if (!googleMap) {
        googleMap = new google.maps.Map(mapElement, {
            zoom: 14,
            center: { lat: partida.lat, lng: partida.lng },
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false
        });
        window.googleMapInstance = googleMap;
    }

    limparMapaVisual();

    const path = [];
    const bounds = new google.maps.LatLngBounds();
    const posicoesOcupadas = [];

    // Função interna para afastar ligeiramente os marcadores sobrepostos
    function evitarSobreposicao(lat, lng) {
        let finalLat = lat;
        let finalLng = lng;
        const margemDiferenca = 0.00003; // Tolerância de igualdade
        const deslocamento = 0.00008; // Afastamento de segurança (~10 metros)

        while (posicoesOcupadas.some(pos => 
            Math.abs(pos.lat - finalLat) < margemDiferenca && 
            Math.abs(pos.lng - finalLng) < margemDiferenca
        )) {
            finalLat += (Math.random() - 0.5) * deslocamento;
            finalLng += (Math.random() - 0.5) * deslocamento;
        }

        posicoesOcupadas.push({ lat: finalLat, lng: finalLng });
        return new google.maps.LatLng(finalLat, finalLng);
    }

    // Desenhar Ponto de Partida
    const startPos = evitarSobreposicao(partida.lat, partida.lng);
    path.push(startPos);
    bounds.extend(startPos);

    const partidaMarker = new google.maps.Marker({
        position: startPos,
        map: googleMap,
        label: { text: "P", color: "#FFFFFF", fontWeight: "bold" },
        title: "Ponto de Partida",
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillColor: "#DC2626",
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: "#FFFFFF"
        }
    });
    googleMarkers.push(partidaMarker);

    // Desenhar Entregas
    rotas.forEach((p, i) => {
        const pos = evitarSobreposicao(p.lat, p.lng);
        path.push(pos);
        bounds.extend(pos);

        const m = new google.maps.Marker({
            position: pos,
            map: googleMap,
            label: { text: (i + 1).toString(), color: "#FFFFFF", fontWeight: "bold" },
            title: p.address,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 14,
                fillColor: "#2563EB",
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: "#FFFFFF"
            }
        });
        googleMarkers.push(m);
    });

    googleRoutePolyline = new google.maps.Polyline({
        path: path,
        geodesic: true,
        strokeColor: "#2563EB",
        strokeOpacity: 0.8,
        strokeWeight: 4
    });
    googleRoutePolyline.setMap(googleMap);
    googleMap.fitBounds(bounds);
}

/**
 * Limpa os marcadores e a linha de rota desenhada no mapa
 */
export function limparMapaVisual() {
    googleMarkers.forEach(m => m.setMap(null));
    googleMarkers = [];
    if (googleRoutePolyline) {
        googleRoutePolyline.setMap(null);
        googleRoutePolyline = null;
    }
}

/**
 * Recalcula os limites do mapa para enquadrar os pontos (disponível globalmente para o ui.js)
 */
window.ajustarLimitesMapaGoogle = () => {
    if (!googleMap || !window.partidaLocalizacao || !window.rotaOtimizada || window.rotaOtimizada.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(new google.maps.LatLng(window.partidaLocalizacao.lat, window.partidaLocalizacao.lng));
    window.rotaOtimizada.forEach(p => bounds.extend(new google.maps.LatLng(p.lat, p.lng)));
    googleMap.fitBounds(bounds);
};