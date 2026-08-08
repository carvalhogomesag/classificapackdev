/**
 * js/geocoding.js
 * Versão v70.1 - Correção da variável localidade e melhoria na injeção de prefixo rápido
 * Faz: Gere exclusivamente as operações de geocodificação de códigos postais e moradas,
 *      a integração com o Autocomplete do Google Places e a resolução de Bricks associados.
 * Depende de: ./geografia-data.js, ./maps.js
 */

import { GEOGRAPHY } from './geografia-data.js';
import { calcularDistanciaHaversine, desenharMapaGoogle, limparMapaVisual } from './maps.js';

function isCatchAllLocality(freguesia, localidade) {
    const cleanFreg = freguesia.replace(/\s+MFR$/i, "").toLowerCase();
    const cleanLoc = localidade.replace(/\s*\(\d{3}-\d{3}\)$/, "").toLowerCase();
    
    if (cleanLoc === cleanFreg) return true;
    if (cleanFreg === "são miguel de alcainça" && cleanLoc === "alcainça") return true;
    return false;
}

function obterConcelhoPorCodigoPostal(zip) {
    if (!zip) return "MAFRA";
    const cleanPrefix = zip.replace(/\D/g, '').substring(0, 4);
    if (cleanPrefix === "2705" || cleanPrefix === "2710" || cleanPrefix === "2715" || cleanPrefix === "2725") {
        return "SINTRA";
    }
    return "MAFRA";
}

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

export function configurarEscutaCodigoPostalParaLimites(autocompleteInstancia) {
    const inputCP = document.getElementById('rota-codigo-postal');
    const inputMorada = document.getElementById('rota-morada-completa');
    if (!inputCP) return;

    // CORRIGIDO: evita ligar os mesmos listeners várias vezes se esta função for
    // chamada de novo (ex: sempre que se volta à aba Rotas), o que duplicava as
    // pesquisas disparadas no Google Maps a cada visita repetida ao ecrã.
    if (inputCP.dataset.limitesBound === "true") return;
    inputCP.dataset.limitesBound = "true";

    // Restringe apenas a área de busca do Autocomplete ao concelho detetado pelo
    // prefixo — pode correr logo que se tenha só o prefixo (4 dígitos), sem
    // precisar do código completo. Não mexe no texto do campo de pesquisa.
    const restringirBoundsAoConcelho = (valor) => {
        if (!autocompleteInstancia) return;
        const concelhoDetectado = obterConcelhoPorCodigoPostal(valor);
        const centroConcelho = concelhoDetectado === "SINTRA" ? { lat: 38.8000, lng: -9.3800 } : { lat: 38.9369, lng: -9.3282 };
        const circuloConcelho = new google.maps.Circle({ center: centroConcelho, radius: 15000 });
        autocompleteInstancia.setBounds(circuloConcelho.getBounds());
        autocompleteInstancia.setOptions({ strictBounds: false });
    };

    // CORRIGIDO: só empurra o texto para o campo de pesquisa do Google Maps quando
    // o Código Postal estiver COMPLETO (7 dígitos) — nunca com o prefixo sozinho,
    // que é exatamente o fluxo pedido: prefixo preenche "Nova Paragem", e só ao
    // completar os 3 dígitos finais é que o sistema joga no campo de pesquisa.
    const injetarCodigoCompletoNaMorada = (valor) => {
        if (!inputMorada) return;
        inputMorada.value = valor;
        inputMorada.focus();
        inputMorada.setSelectionRange(inputMorada.value.length, inputMorada.value.length);

        inputMorada.dispatchEvent(new Event('input', { bubbles: true }));
        inputMorada.dispatchEvent(new Event('change', { bubbles: true }));

        const keyboardEvent = new KeyboardEvent('keyup', { bubbles: true, key: 'a' });
        inputMorada.dispatchEvent(keyboardEvent);
    };

    const padraoCPCompleto = /^\d{4}-\d{3}$/;
    const padraoPrefix = /^\d{4}$/;

    // Escuta tanto inputs completos quanto prefixos rápidos (ex: 4 ou 7 dígitos)
    inputCP.addEventListener('input', () => {
        const valor = inputCP.value.trim();

        if (valor.length === 0) {
            restringirBoundsAoConcelho(''); // volta ao raio alargado por defeito
            return;
        }

        if (padraoCPCompleto.test(valor)) {
            // Código completo: restringe a área E empurra o texto para a pesquisa
            restringirBoundsAoConcelho(valor);
            injetarCodigoCompletoNaMorada(valor);
        } else if (padraoPrefix.test(valor)) {
            // Só o prefixo (sem hífen): já restringe a área, mas ainda não pesquisa
            restringirBoundsAoConcelho(valor);
        }
    });

    inputCP.addEventListener('prefixo-aplicado', () => {
        // Disparado assim que um prefixo de 4 dígitos é inserido (ex: "2640-").
        // Só restringe a área de busca aqui — a pesquisa em si só acontece quando
        // o Código Postal ficar completo, tratado no listener de 'input' acima.
        const valor = inputCP.value.trim();
        if (valor.length > 0) {
            restringirBoundsAoConcelho(valor);
        }
    });
}

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

