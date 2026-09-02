/**
 * js/maps.js
 * Versão v77.4 - Com Integração da Base Oficial CTT (CP7_DATABASE) como Verdade Absoluta,
 *                Pinos Laranjas, Borda Preta e Bouncing para Novas Paragens por Confirmar
 * Faz: Gere a integração total com a Google Maps Platform (desenho de mapas com marcadores coloridos,
 *      dispersão em espiral, validação de CP7 contra a base oficial CTT, pino saltitante laranja com bordas
 *      pretas para novas adições e balões de informação ricos).
 * Depende de: Nenhuns módulos externos (comunicação direta com o SDK do Google Maps e window.CP7_DATABASE).
 */

let googleMap = null;
let googleMarkers = [];
let googleRoutePolyline = null;
let autocompleteWidget = null;
let autocompleteWidgetTriagem = null;
let googleInfoWindow = null;

/**
 * Utilitário interno: extrai o CP7 de uma lista de address_components do Google Maps
 */
function extrairCodigoPostalGoogle(components) {
    if (!Array.isArray(components)) return "";
    for (const comp of components) {
        if (comp.types && comp.types.includes('postal_code')) {
            const raw = comp.long_name || comp.short_name || "";
            const clean = raw.replace(/\D/g, '');
            if (clean.length === 7) {
                return `${clean.substring(0, 4)}-${clean.substring(4, 7)}`;
            }
            return raw;
        }
    }
    return "";
}

/**
 * Inicializa o widget do Google Places Autocomplete para moradas em Portugal e Espanha (Rotas)
 * Cruza o resultado com a base oficial CTT (window.CP7_DATABASE) para máxima precisão.
 */
export function inicializarGoogleAutocomplete(buscaMoradaInput, callback) {
    if (typeof google === 'undefined' || !google.maps || !google.maps.places || !buscaMoradaInput) return;

    autocompleteWidget = new google.maps.places.Autocomplete(buscaMoradaInput, {
        componentRestrictions: { country: ['pt', 'es'] },
        fields: ['geometry', 'formatted_address', 'address_components']
    });

    autocompleteWidget.addListener('place_changed', () => {
        const place = autocompleteWidget.getPlace();
        if (!place.geometry || !place.geometry.location) {
            alert("Morada não encontrada. Selecione uma opção válida da lista da Google.");
            return;
        }

        let lat = place.geometry.location.lat();
        let lng = place.geometry.location.lng();
        let address = place.formatted_address;

        // Verificação contra a Verdade Absoluta CTT
        const cp7 = extrairCodigoPostalGoogle(place.address_components);
        if (cp7 && window.CP7_DATABASE && window.CP7_DATABASE[cp7]) {
            const officialData = window.CP7_DATABASE[cp7];
            const ruaOficial = officialData.rua || officialData.street || officialData.nome || "";
            const locOficial = officialData.localidade || officialData.locality || "";
            const concelhoOficial = officialData.concelho || officialData.municipality || "";

            if (ruaOficial) {
                // Se o Google não tiver rua detalhada ou houver divergência, padroniza com a artéria oficial CTT
                if (!address.toLowerCase().includes(ruaOficial.toLowerCase())) {
                    address = `${ruaOficial}, ${cp7} ${locOficial || concelhoOficial}`.trim();
                }
            }

            // Se existirem coordenadas calibradas oficiais e o Place for genérico, assegura a precisão
            if (typeof officialData.lat === 'number' && typeof officialData.lng === 'number' && officialData.lat !== 0 && officialData.lng !== 0) {
                // Preserva a precisão da artéria calibrada
                lat = officialData.lat;
                lng = officialData.lng;
            }
        }

        callback({ id: 'm_' + Date.now() + Math.random().toString(36).substr(2, 5), lat, lng, address });
    });
}

/**
 * Inicializa o widget do Google Places Autocomplete para procurar Códigos Postais por moradas (Triagem)
 * Garante enriquecimento oficial CTT em 0ms.
 */
export function inicializarGoogleAutocompleteTriagem(buscaMoradaInput, callback) {
    if (typeof google === 'undefined' || !google.maps || !google.maps.places || !buscaMoradaInput) return;

    autocompleteWidgetTriagem = new google.maps.places.Autocomplete(buscaMoradaInput, {
        componentRestrictions: { country: ['pt', 'es'] },
        fields: ['address_components', 'formatted_address']
    });

    autocompleteWidgetTriagem.addListener('place_changed', () => {
        const place = autocompleteWidgetTriagem.getPlace();
        if (!place.address_components) {
            callback(null, null);
            return;
        }

        let postalCode = extrairCodigoPostalGoogle(place.address_components);
        let address = place.formatted_address || "";

        // Se encontrou CP7, valida na base oficial CTT
        if (postalCode && window.CP7_DATABASE && window.CP7_DATABASE[postalCode]) {
            const officialData = window.CP7_DATABASE[postalCode];
            const ruaOficial = officialData.rua || officialData.street || officialData.nome || "";
            const locOficial = officialData.localidade || officialData.locality || "";
            if (ruaOficial) {
                address = `${ruaOficial}, ${postalCode} ${locOficial}`.trim();
            }
        }

        callback(postalCode, address);
    });
}

/**
 * Traduz coordenadas GPS obtidas pelo navegador numa morada legível (Reverse Geocoding)
 * com enriquecimento automático pela base oficial CTT.
 */
export function obterEnderecoPorGPSGoogle(lat, lng, callback) {
    if (typeof google === 'undefined' || !google.maps) {
        callback(null);
        return;
    }

    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat: parseFloat(lat), lng: parseFloat(lng) } }, (results, status) => {
        if (status === "OK" && results[0]) {
            let finalAddress = results[0].formatted_address;
            const postalCode = extrairCodigoPostalGoogle(results[0].address_components);

            if (postalCode && window.CP7_DATABASE && window.CP7_DATABASE[postalCode]) {
                const officialData = window.CP7_DATABASE[postalCode];
                const ruaOficial = officialData.rua || officialData.street || officialData.nome || "";
                const locOficial = officialData.localidade || officialData.locality || "";
                if (ruaOficial) {
                    finalAddress = `${ruaOficial}, ${postalCode} ${locOficial}`.trim();
                }
            }

            callback({
                lat: parseFloat(lat),
                lng: parseFloat(lng),
                address: finalAddress
            });
        } else {
            callback(null);
        }
    });
}

/**
 * Calcula a distância em linha reta entre duas coordenadas geográficas (em km) usando Haversine
 */
export function calcularDistanciaHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Desenha a rota otimizada no Mapa da Google com algoritmo de espiral de dispersão e balões de informação ao clicar
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

    if (!googleInfoWindow) {
        googleInfoWindow = new google.maps.InfoWindow();
    }

    const path = [];
    const bounds = new google.maps.LatLngBounds();
    const posicoesOcupadas = [];

    // Algoritmo de dispersão em espiral para evitar sobreposição de pinos no mesmo endereço
    function evitarSobreposicao(lat, lng) {
        let finalLat = lat;
        let finalLng = lng;
        const margemDiferenca = 0.0001; 
        const deslocamento = 0.0002;   

        let count = 0;
        while (posicoesOcupadas.some(pos => 
            Math.abs(pos.lat - finalLat) < margemDiferenca && 
            Math.abs(pos.lng - finalLng) < margemDiferenca
        )) {
            count++;
            const angle = count * 1.2; 
            const radius = deslocamento * (1 + count * 0.1);
            finalLat = lat + Math.sin(angle) * radius;
            finalLng = lng + Math.cos(angle) * radius;
        }

        posicoesOcupadas.push({ lat: finalLat, lng: finalLng });
        return new google.maps.LatLng(finalLat, finalLng);
    }

    // Ponto de Partida
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

    partidaMarker.addListener('click', () => {
        googleInfoWindow.setContent(`
            <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 12px; padding: 4px; line-height: 1.4; max-width: 220px;">
                <div style="font-weight: 800; color: #DC2626; font-size: 13px; text-transform: uppercase; margin-bottom: 2px;">
                    🚩 Ponto de Partida
                </div>
                <div style="color: #374151; font-weight: 600;">${partida.address}</div>
            </div>
        `);
        googleInfoWindow.open(googleMap, partidaMarker);
    });

    googleMarkers.push(partidaMarker);

    // Paragens / Entregas
    rotas.forEach((p, i) => {
        const pos = evitarSobreposicao(p.lat, p.lng);
        path.push(pos);
        bounds.extend(pos);

        let pinoColor = "#2563EB"; 
        let bounceAnimation = null;
        let strokeColor = "#FFFFFF";
        let strokeWeight = 2;

        if (p.isNewUnconfirmed) {
            pinoColor = "#F97316"; // Laranja vibrante para novas paragens não confirmadas
            bounceAnimation = google.maps.Animation.BOUNCE; // Pino saltitante
            strokeColor = "#000000"; // Borda preta marcada
            strokeWeight = 3;
        } else if (p.status === "Entregue") {
            pinoColor = "#10B981"; 
        } else if (p.status === "Falhou" || p.status === "Failed") {
            pinoColor = "#EF4444"; 
        }

        const m = new google.maps.Marker({
            position: pos,
            map: googleMap,
            label: { 
                text: (i + 1).toString(), 
                color: "#FFFFFF", 
                fontWeight: "bold" 
            },
            title: p.address,
            animation: bounceAnimation,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 15,
                fillColor: pinoColor,
                fillOpacity: 1,
                strokeWeight: strokeWeight,
                strokeColor: strokeColor
            }
        });

        // BALÃO INFORMATIVO RICO AO CLICAR NO PINO DA ROTA
        m.addListener('click', () => {
            const isRecolha = p.tipoOperacao === "Recolha";
            const opColor = isRecolha ? "#7C3AED" : "#2563EB";
            const opLabel = isRecolha ? "Recolha" : "Entrega";
            
            let statusBadge = `<span style="background: #DBEAFE; color: #1E40AF; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 800;">Pendente</span>`;
            if (p.isNewUnconfirmed) {
                statusBadge = `<span style="background: #FFEDD5; color: #C2410C; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 800;">⚠️ Por Confirmar</span>`;
            } else if (p.status === "Entregue") {
                statusBadge = `<span style="background: #D1FAE5; color: #065F46; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 800;">✓ Entregue</span>`;
            } else if (p.status === "Falhou" || p.status === "Failed") {
                statusBadge = `<span style="background: #FEE2E2; color: #991B1B; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 800;">✗ Falhou</span>`;
            }

            const brickText = p.brickName ? `<div style="font-size: 11px; color: #2563EB; font-weight: 700; margin-top: 3px;">📦 Estante: ${p.brickName}</div>` : '';
            const obsText = p.observation ? `<div style="font-size: 10px; color: #4B5563; font-style: italic; background: #FEF3C7; padding: 4px; border-radius: 4px; margin-top: 4px;">💬 ${p.observation}</div>` : '';

            // Botão adicional de confirmação se o pino estiver por confirmar
            const confirmBtnHtml = p.isNewUnconfirmed ? `
                <button onclick="if(typeof window.confirmarPosicaoParagem === 'function') { window.confirmarPosicaoParagem('${p.id}'); }" style="background: #10B981; color: #FFFFFF; border: none; padding: 6px 8px; border-radius: 6px; font-size: 10px; font-weight: 800; cursor: pointer; width: 100%; margin-bottom: 4px;">
                    ✓ Confirmar Posição Atual
                </button>
            ` : '';

            googleInfoWindow.setContent(`
                <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 12px; padding: 4px; line-height: 1.4; max-width: 240px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
                        <span style="background: ${pinoColor}; color: #FFFFFF; font-weight: 900; font-size: 11px; padding: 2px 6px; border-radius: 9999px;">
                            #${i + 1}
                        </span>
                        <span style="background: ${opColor}15; color: ${opColor}; font-weight: 800; font-size: 10px; border: 1px solid ${opColor}40; padding: 1px 5px; border-radius: 4px;">
                            ${opLabel}
                        </span>
                        ${statusBadge}
                    </div>
                    
                    <div style="font-weight: 700; color: #1F2937; font-size: 12px; margin-top: 2px;">
                        ${p.address}
                    </div>

                    ${brickText}
                    ${obsText}

                    <div style="margin-top: 8px;">
                        ${confirmBtnHtml}
                        <button onclick="if(typeof window.abrirModalAlterarSequencia === 'function') window.abrirModalAlterarSequencia(${i}, window.rotaOtimizada[${i}])" style="width: 100%; background: #2563EB; color: #FFFFFF; border: none; padding: 6px 8px; border-radius: 6px; font-size: 10px; font-weight: 800; cursor: pointer;">
                            Alterar Ordem Manual
                        </button>
                    </div>
                </div>
            `);
            googleInfoWindow.open(googleMap, m);
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
    if (googleInfoWindow) {
        googleInfoWindow.close();
    }
}

// ==========================================
// ASSINATURA GLOBAL DO AJUSTADOR DE LIMITES
// ==========================================
window.ajustarLimitesMapaGoogle = () => {
    if (!googleMap || !window.partidaLocalizacao || !window.rotaOtimizada || window.rotaOtimizada.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(new google.maps.LatLng(window.partidaLocalizacao.lat, window.partidaLocalizacao.lng));
    window.rotaOtimizada.forEach(p => bounds.extend(new google.maps.LatLng(p.lat, p.lng)));
    googleMap.fitBounds(bounds);
};