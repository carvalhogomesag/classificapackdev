/**
 * js/maps.js
 * Versão v82.1 - Suporte Total a Múltiplos Blocos (Multi-Cluster) com Cores Únicas e Bouncing
 * Faz: Gere a integração total com a Google Maps Platform:
 *      - Renderização de pinos com cores distintas para cada Bloco (Roxo, Ciano, Âmbar, Rosa, etc.).
 *      - Suporte a novos pacotes por confirmar dentro de blocos (mantém a cor do bloco com salto bounce e borda preta).
 *      - Desenho de rota otimizada com polilinha e balões com distintivo do Bloco.
 *      - Dispersão em espiral para moradas no mesmo local.
 * Depende de: Nenhuns módulos externos (comunicação direta com o SDK do Google Maps e window.CP7_DATABASE).
 */

let googleMap = null;
let googleMarkers = [];
let googleRoutePolyline = null;
let autocompleteWidget = null;
let autocompleteWidgetTriagem = null;
let googleInfoWindow = null;

/**
 * Retorna a instância ativa do Google Maps
 */
export function obterInstanciaMapaGoogle() {
    return googleMap;
}

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

        const cp7 = extrairCodigoPostalGoogle(place.address_components);
        if (cp7 && window.CP7_DATABASE && window.CP7_DATABASE[cp7]) {
            const officialData = window.CP7_DATABASE[cp7];
            const ruaOficial = officialData.rua || officialData.street || officialData.nome || "";
            const locOficial = officialData.localidade || officialData.locality || "";
            const concelhoOficial = officialData.concelho || officialData.municipality || "";

            if (ruaOficial && !address.toLowerCase().includes(ruaOficial.toLowerCase())) {
                address = `${ruaOficial}, ${cp7} ${locOficial || concelhoOficial}`.trim();
            }

            if (typeof officialData.lat === 'number' && typeof officialData.lng === 'number' && officialData.lat !== 0 && officialData.lng !== 0) {
                lat = officialData.lat;
                lng = officialData.lng;
            }
        }

        callback({ id: 'm_' + Date.now() + Math.random().toString(36).substr(2, 5), lat, lng, address });
    });
}

/**
 * Inicializa o widget do Google Places Autocomplete para procurar Códigos Postais por moradas (Triagem)
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
 * Algoritmo de dispersão em espiral para evitar sobreposição de pinos na mesma coordenada
 */
function criarDispersorEspiral() {
    const posicoesOcupadas = [];
    return function evitarSobreposicao(lat, lng) {
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
    };
}

/**
 * DESENHA O MAPA EM TEMPO REAL NO MODO PLANEAMENTO COM SUPORTE A MÚLTIPLOS BLOCOS
 */
export function desenharMapaPlaneamento(mapElement, partida, moradas) {
    if (typeof google === 'undefined' || !mapElement) return;
    if (!partida && (!moradas || moradas.length === 0)) return;

    const centroInicial = partida ? { lat: partida.lat, lng: partida.lng } : { lat: moradas[0].lat, lng: moradas[0].lng };

    if (!googleMap) {
        googleMap = new google.maps.Map(mapElement, {
            zoom: 13,
            center: centroInicial,
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

    const bounds = new google.maps.LatLngBounds();
    const evitarSobreposicao = criarDispersorEspiral();

    // 1. Ponto de Partida
    if (partida && typeof partida.lat === 'number') {
        const startPos = evitarSobreposicao(partida.lat, partida.lng);
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
                <div style="font-family: system-ui, sans-serif; font-size: 12px; padding: 4px; line-height: 1.4; max-width: 220px;">
                    <div style="font-weight: 800; color: #DC2626; font-size: 13px; text-transform: uppercase; margin-bottom: 2px;">
                        🚩 Ponto de Partida
                    </div>
                    <div style="color: #374151; font-weight: 600;">${partida.address}</div>
                </div>
            `);
            googleInfoWindow.open(googleMap, partidaMarker);
        });

        googleMarkers.push(partidaMarker);
    }

    // 2. Marcadores das Paragens com Cores do respetivo Bloco
    if (Array.isArray(moradas)) {
        moradas.forEach((p, i) => {
            if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;

            const pos = evitarSobreposicao(p.lat, p.lng);
            bounds.extend(pos);

            let pinoColor = p.isClusterGroup && p.clusterColor 
                ? p.clusterColor 
                : (p.tipoOperacao === "Recolha" ? "#9333EA" : "#2563EB");

            let strokeColor = p.isClusterGroup && p.clusterBorder 
                ? p.clusterBorder 
                : "#FFFFFF";

            let strokeWeight = p.isClusterGroup ? 3.5 : 2;

            const m = new google.maps.Marker({
                position: pos,
                map: googleMap,
                label: { 
                    text: (i + 1).toString(), 
                    color: "#FFFFFF", 
                    fontWeight: "bold",
                    fontSize: "11px"
                },
                title: p.address,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 14,
                    fillColor: pinoColor,
                    fillOpacity: 0.95,
                    strokeWeight: strokeWeight,
                    strokeColor: strokeColor
                }
            });

            m.paragemId = p.id;
            m.paragemIndex = i;

            m.addListener('click', () => {
                const isRecolha = p.tipoOperacao === "Recolha";
                const opLabel = isRecolha ? "Recolha" : "Entrega";
                const opColor = isRecolha ? "#7C3AED" : "#2563EB";
                const brickText = p.brickName ? `<div style="font-size: 11px; color: #2563EB; font-weight: 700; margin-top: 3px;">📦 Estante: ${p.brickName}</div>` : '';
                
                const clusterBadge = p.isClusterGroup ? `
                    <div style="font-size: 10px; background: ${p.clusterColor || '#8B5CF6'}20; color: ${p.clusterBorder || '#6D28D9'}; font-weight: 800; padding: 2px 6px; border-radius: 4px; margin-top: 3px; border: 1px solid ${p.clusterColor || '#8B5CF6'}50;">
                        🔗 ${p.clusterGroupName || 'Bloco'} (Roteirizado Junto)
                    </div>
                ` : '';

                googleInfoWindow.setContent(`
                    <div style="font-family: system-ui, sans-serif; font-size: 12px; padding: 4px; line-height: 1.4; max-width: 230px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px;">
                            <span style="background: ${pinoColor}; color: #FFFFFF; font-weight: 900; font-size: 11px; padding: 2px 6px; border-radius: 9999px;">
                                #${i + 1}
                            </span>
                            <span style="background: ${opColor}15; color: ${opColor}; font-weight: 800; font-size: 10px; border: 1px solid ${opColor}40; padding: 1px 5px; border-radius: 4px;">
                                ${opLabel}
                            </span>
                        </div>
                        <div style="font-weight: 700; color: #1F2937; font-size: 12px; margin-top: 2px;">
                            ${p.address}
                        </div>
                        ${brickText}
                        ${clusterBadge}
                    </div>
                `);
                googleInfoWindow.open(googleMap, m);
            });

            googleMarkers.push(m);
        });
    }

    if (!bounds.isEmpty()) {
        googleMap.fitBounds(bounds);
        if (moradas && moradas.length === 1 && !partida) {
            googleMap.setZoom(15);
        }
    }
}

/**
 * Desenha a rota otimizada com polilinha e respeito total às cores de cada Bloco
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
    const evitarSobreposicao = criarDispersorEspiral();

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
            <div style="font-family: system-ui, sans-serif; font-size: 12px; padding: 4px; line-height: 1.4; max-width: 220px;">
                <div style="font-weight: 800; color: #DC2626; font-size: 13px; text-transform: uppercase; margin-bottom: 2px;">
                    🚩 Ponto de Partida
                </div>
                <div style="color: #374151; font-weight: 600;">${partida.address}</div>
            </div>
        `);
        googleInfoWindow.open(googleMap, partidaMarker);
    });

    googleMarkers.push(partidaMarker);

    // Paragens Otimizadas com Cores por Bloco
    rotas.forEach((p, i) => {
        const pos = evitarSobreposicao(p.lat, p.lng);
        path.push(pos);
        bounds.extend(pos);

        // Define a cor base: se tem bloco, usa a cor do bloco!
        let pinoColor = (p.isClusterGroup && p.clusterColor) ? p.clusterColor : "#2563EB"; 
        let bounceAnimation = null;
        let strokeColor = (p.isClusterGroup && p.clusterBorder) ? p.clusterBorder : "#FFFFFF";
        let strokeWeight = p.isClusterGroup ? 3.5 : 2;

        if (p.isNewUnconfirmed) {
            // Se for novo pacote não confirmado dentro de um bloco: mantém a cor do bloco, com bounce e borda preta
            if (!p.isClusterGroup) {
                pinoColor = "#F97316"; // Laranja clássico apenas para os que NÃO pertencem a nenhum bloco
            }
            bounceAnimation = google.maps.Animation.BOUNCE;
            strokeColor = "#000000"; 
            strokeWeight = 3.5;
        } else if (p.status === "Entregue") {
            pinoColor = "#10B981"; 
            strokeColor = "#059669";
        } else if (p.status === "Falhou" || p.status === "Failed") {
            pinoColor = "#EF4444"; 
            strokeColor = "#B91C1C";
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

        m.paragemId = p.id;
        m.paragemIndex = i;

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
            
            const clusterText = p.isClusterGroup ? `
                <div style="font-size: 10px; background: ${p.clusterColor || '#8B5CF6'}20; color: ${p.clusterBorder || '#6D28D9'}; font-weight: 800; padding: 2px 6px; border-radius: 4px; margin-top: 3px; border: 1px solid ${p.clusterColor || '#8B5CF6'}50;">
                    🔗 ${p.clusterGroupName || 'Bloco'} (Roteirizado Junto)
                </div>
            ` : '';

            const obsText = p.observation ? `<div style="font-size: 10px; color: #4B5563; font-style: italic; background: #FEF3C7; padding: 4px; border-radius: 4px; margin-top: 4px;">💬 ${p.observation}</div>` : '';

            const confirmBtnHtml = p.isNewUnconfirmed ? `
                <button onclick="if(typeof window.confirmarPosicaoParagem === 'function') { window.confirmarPosicaoParagem('${p.id}'); }" style="background: #10B981; color: #FFFFFF; border: none; padding: 6px 8px; border-radius: 6px; font-size: 10px; font-weight: 800; cursor: pointer; width: 100%; margin-bottom: 4px;">
                    ✓ Confirmar Posição Atual
                </button>
            ` : '';

            googleInfoWindow.setContent(`
                <div style="font-family: system-ui, sans-serif; font-size: 12px; padding: 4px; line-height: 1.4; max-width: 240px;">
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
                    ${clusterText}
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
 * Destaca visualmente no mapa os marcadores de paragens de acordo com o seu bloco
 */
export function destacarMarcadoresGrupo(idsParagensSelecionadas) {
    const lista = (window.rotaOtimizada && window.rotaOtimizada.length > 0) ? window.rotaOtimizada : window.moradasEntregas;
    if (!Array.isArray(lista)) return;

    const idToParagemMap = new Map();
    lista.forEach(p => idToParagemMap.set(p.id, p));

    googleMarkers.forEach(m => {
        if (!m.paragemId) return;
        const paragem = idToParagemMap.get(m.paragemId);
        if (paragem && paragem.isClusterGroup) {
            m.setIcon({
                path: google.maps.SymbolPath.CIRCLE,
                scale: 16,
                fillColor: paragem.clusterColor || "#8B5CF6",
                fillOpacity: 1,
                strokeWeight: 3.5,
                strokeColor: paragem.clusterBorder || "#6D28D9"
            });
        }
    });
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
    if (!googleMap) return;
    const lista = (window.rotaOtimizada && window.rotaOtimizada.length > 0) ? window.rotaOtimizada : window.moradasEntregas;
    if (!lista || lista.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    if (window.partidaLocalizacao) {
        bounds.extend(new google.maps.LatLng(window.partidaLocalizacao.lat, window.partidaLocalizacao.lng));
    }
    lista.forEach(p => bounds.extend(new google.maps.LatLng(p.lat, p.lng)));
    googleMap.fitBounds(bounds);
};