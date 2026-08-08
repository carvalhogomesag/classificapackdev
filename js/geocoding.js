/**
 * js/geocoding.js
 * Faz: Gere exclusivamente as operações de geocodificação de códigos postais e moradas,
 *      a integração com o Autocomplete do Google Places e a resolução de Bricks associados.
 * Depende de: ./geografia-data.js, ./maps.js
 */

import { GEOGRAPHY } from './geografia-data.js';
import { calcularDistanciaHaversine, desenharMapaGoogle, limparMapaVisual } from './maps.js';

// Auxiliar para detetar se uma localidade é a capital genérica (catch-all) de uma freguesia
function isCatchAllLocality(freguesia, localidade) {
    const cleanFreg = freguesia.replace(/\s+MFR$/i, "").toLowerCase();
    const cleanLoc = localidade.replace(/\s*\(\d{3}-\d{3}\)$/, "").toLowerCase();
    
    if (cleanLoc === cleanFreg) return true;
    if (cleanFreg === "são miguel de alcainça" && cleanLoc === "alcainça") return true;
    return false;
}

// Auxiliar para detetar o concelho correspondente ao código postal fornecido
function obterConcelhoPorCodigoPostal(zip) {
    if (!zip) return "MAFRA";
    const cleanPrefix = zip.replace(/\D/g, '').substring(0, 4);
    if (cleanPrefix === "2705" || cleanPrefix === "2710" || cleanPrefix === "2715" || cleanPrefix === "2725") {
        return "SINTRA";
    }
    return "MAFRA";
}

// Resolvedor de Brick compatível interno
export function resolveBrickForZip(zip, drivers) {
    if (!zip || !drivers) return { brickId: null, brickName: null };
    const regexZip = /\d{4}-\d{3}/;
    const match = zip.match(regexZip);
    const normalizedZip = match ? match[0] : zip.trim();

    const concelho = obterConcelhoPorCodigoPostal(normalizedZip);

    let matchedFreguesia = null;
    let matchedLocalidade = null;

    if (!GEOGRAPHY[concelho]) return { brickId: null, brickName: null };

    for (const [freguesia, localidades] of Object.entries(GEOGRAPHY[concelho])) {
        for (const [localidade, cpList] of Object.entries(localidades)) {
            if (isCatchAllLocality(freguesia, localidade)) continue;
            if (cpList.includes(normalizedZip)) {
                matchedFreguesia = freguesia;
                matchedLocalidade = localidade;
                break;
            }
        }
        if (matchedFreguesia) break;
    }

    if (!matchedFreguesia) {
        for (const [freguesia, localidades] of Object.entries(GEOGRAPHY[concelho])) {
            for (const [localidade, cpList] of Object.entries(localidades)) {
                if (isCatchAllLocality(freguesia, localidade) && cpList.includes(normalizedZip)) {
                    matchedFreguesia = freguesia;
                    matchedLocalidade = localidade;
                    break;
                }
            }
            if (matchedFreguesia) break;
        }
    }

    if (!matchedFreguesia) return { brickId: null, brickName: null };

    return { 
        brickId: `${matchedFreguesia}|${matchedLocalidade}`, 
        brickName: matchedLocalidade 
    };
}

// Configuração da escuta de código postal para limites e inputs
export function configurarEscutaCodigoPostalParaLimites(autocompleteInstancia) {
    const inputCP = document.getElementById('rota-codigo-postal');
    const inputMorada = document.getElementById('rota-morada-completa');
    if (!inputCP) return;

    inputCP.addEventListener('input', async () => {
        const valor = inputCP.value.trim();
        const padraoCP = /^\d{4}-\d{3}$/;

        if (valor.length === 0 && autocompleteInstancia) {
            const centroMafra = { lat: 38.9369, lng: -9.3282 };
            const circuloMafra = new google.maps.Circle({ center: centroMafra, radius: 15000 });
            autocompleteInstancia.setBounds(circuloMafra.getBounds());
            autocompleteInstancia.setOptions({ strictBounds: false });
            return;
        }

        if (padraoCP.test(valor)) {
            if (inputMorada) {
                inputMorada.value = valor;
                inputMorada.focus();
                inputMorada.setSelectionRange(inputMorada.value.length, inputMorada.value.length);
            }

            if (autocompleteInstancia) {
                const concelhoDetectado = obterConcelhoPorCodigoPostal(valor);
                const centroConcelho = concelhoDetectado === "SINTRA" ? { lat: 38.8000, lng: -9.3800 } : { lat: 38.9369, lng: -9.3282 };
                const circuloConcelho = new google.maps.Circle({ center: centroConcelho, radius: 15000 });
                autocompleteInstancia.setBounds(circuloConcelho.getBounds());
                autocompleteInstancia.setOptions({ strictBounds: false });
            }
        }
    });
}

// Inicializador do Autocomplete de moradas do Google Places
export function inicializarAutocompleteMorada(inputMoradaId, apiBaseUrl, onPlaceSelected) {
    const inputMorada = document.getElementById(inputMoradaId);
    if (!inputMorada) return null;

    if (inputMorada.dataset.autocompleteBound === "true") return null;

    if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
        setTimeout(() => inicializarAutocompleteMorada(inputMoradaId, apiBaseUrl, onPlaceSelected), 500);
        return null;
    }

    try {
        const centroMafra = { lat: 38.9369, lng: -9.3282 };
        const circuloMafra = new google.maps.Circle({ center: centroMafra, radius: 15000 });

        const autocompleteInstancia = new google.maps.places.Autocomplete(inputMorada, {
            componentRestrictions: { country: 'pt' },
            fields: ['address_components', 'geometry', 'formatted_address'],
            bounds: circuloMafra.getBounds(),
            strictBounds: false
        });

        inputMorada.dataset.autocompleteBound = "true";

        autocompleteInstancia.addListener('place_changed', () => {
            const localSelecionado = autocompleteInstancia.getPlace();
            if (!localSelecionado || !localSelecionado.address_components) return;

            const componenteCP = localSelecionado.address_components.find(c => c.types.includes('postal_code'));
            if (componenteCP) {
                const inputCP = document.getElementById('rota-codigo-postal');
                if (inputCP) {
                    const cpLimpo = componenteCP.long_name.replace(/\D/g, '');
                    if (cpLimpo.length === 7) {
                        inputCP.value = `${cpLimpo.substring(0, 4)}-${cpLimpo.substring(4, 7)}`;
                    } else if (cpLimpo.length === 4) {
                        inputCP.value = `${cpLimpo}-`;
                        inputCP.focus();
                    }
                }
            }

            if (typeof onPlaceSelected === 'function') {
                onPlaceSelected(localSelecionado);
            }
        });

        return autocompleteInstancia;
    } catch (err) {
        console.warn("Erro ao iniciar o Autocomplete do Google Places:", err);
        return null;
    }
}