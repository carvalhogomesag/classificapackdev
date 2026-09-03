/**
 * js/rotas-inputs.js
 * Versão v78.7 - Autocomplete Híbrido com Chip CTT Oficial e Google Places Estrito
 * Faz: Exibe chip de preenchimento rápido com a rua oficial dos CTT associada ao CP7 digitado,
 *      trava o Google Places estritamente na zona geográfica de Sintra/Mafra (eliminando Olival Basto/Cascais),
 *      limpa a morada ao trocar de CP e sincroniza o CP real.
 * Depende de: ./ui-menu.js, ./rotas-geografia.js, ./cp7-data.js
 */

import { obterPrefixoPadrao } from './ui-menu.js';
import { obterConcelhoPorCodigoPostal } from './rotas-geografia.js';
import { CP7_DATABASE } from './cp7-data.js';

let autocompleteInstancia = null;
let ultimoCpConcluido = "";

// Mapeamento de centros geográficos precisos por prefixo para travamento estrito
const COORDENADAS_PREFIXOS = {
    "2715": { lat: 38.8550, lng: -9.3100, raio: 4500 }, // Almargem do Bispo / Pêro Pinheiro / Montelavar
    "2710": { lat: 38.7980, lng: -9.3800, raio: 5000 }, // Sintra Centro / São Pedro / Linhó
    "2705": { lat: 38.8100, lng: -9.4300, raio: 5500 }, // Colares / São João das Lampas / Terrugem
    "2725": { lat: 38.7990, lng: -9.3450, raio: 3500 }, // Algueirão / Mem Martins
    "2745": { lat: 38.7600, lng: -9.2600, raio: 3500 }, // Queluz / Monte Abraão
    "2655": { lat: 38.9630, lng: -9.4170, raio: 5000 }, // Ericeira
    "2640": { lat: 38.9370, lng: -9.3280, raio: 5000 }, // Mafra
    "2665": { lat: 38.9300, lng: -9.2500, raio: 5000 }, // Malveira / Venda do Pinheiro
    "2670": { lat: 38.8800, lng: -9.2000, raio: 4500 }  // Lousa / Loures
};

/**
 * Consulta a Base Oficial dos CTT pelo Código Postal (CP7)
 * Retorna os dados oficiais da rua, localidade, concelho e coordenadas (se disponíveis).
 */
export function consultarDadosOficiaisCP7(cp7) {
    if (!cp7 || typeof cp7 !== 'string') return null;
    const cpFormatado = cp7.trim();
    if (CP7_DATABASE && CP7_DATABASE[cpFormatado]) {
        return CP7_DATABASE[cpFormatado];
    }
    return null;
}

/**
 * Exibe ou atualiza o Chip de Sugestão Oficial CTT logo abaixo do campo de morada
 */
function atualizarChipSugestaoOficialCTT(cp7Formatado) {
    const inputMorada = document.getElementById('rota-morada-completa');
    if (!inputMorada) return;

    const containerWrapper = inputMorada.closest('.space-y-1') || inputMorada.parentElement.parentElement || inputMorada.parentElement;

    let chipContainer = document.getElementById('chip-sugestao-oficial-ctt');
    if (!chipContainer) {
        chipContainer = document.createElement('div');
        chipContainer.id = 'chip-sugestao-oficial-ctt';
        chipContainer.className = 'mt-1.5 transition-all hidden';
        containerWrapper.insertBefore(chipContainer, containerWrapper.querySelector('#card-preview-morada-selecionada') || null);
    }

    const dadosCtt = consultarDadosOficiaisCP7(cp7Formatado);
    if (!dadosCtt) {
        chipContainer.classList.add('hidden');
        chipContainer.innerHTML = '';
        return;
    }

    const listaRuas = Array.isArray(dadosCtt.ruas) && dadosCtt.ruas.length > 0 
        ? dadosCtt.ruas 
        : [dadosCtt.rua || dadosCtt.street || dadosCtt.nome || ""];

    const ruasValidas = listaRuas.filter(Boolean);
    if (ruasValidas.length === 0) {
        chipContainer.classList.add('hidden');
        chipContainer.innerHTML = '';
        return;
    }

    chipContainer.innerHTML = `
        <div class="flex flex-wrap items-center gap-1.5 p-1.5 bg-indigo-50/80 border border-indigo-200 rounded-xl">
            <span class="text-[10px] font-extrabold text-indigo-700 flex items-center mr-1">
                <i class="fa-solid fa-map-pin mr-1 text-indigo-500"></i> Oficial CTT:
            </span>
            ${ruasValidas.map(rua => `
                <button type="button" 
                        onclick="window.aplicarRuaOficialNoCampo('${rua.replace(/'/g, "\\'")}')"
                        class="px-2 py-1 bg-white hover:bg-indigo-600 text-indigo-800 hover:text-white text-xs font-bold rounded-lg border border-indigo-200 shadow-2xs transition-all cursor-pointer flex items-center space-x-1">
                    <span>${rua}</span>
                    <i class="fa-solid fa-arrow-turn-down text-[9px] opacity-70"></i>
                </button>
            `).join('')}
        </div>
    `;

    chipContainer.classList.remove('hidden');
}

/**
 * Aplica a rua oficial dos CTT no campo e coloca o cursor no fim para o número da porta
 */
window.aplicarRuaOficialNoCampo = function(nomeRua) {
    const inputMorada = document.getElementById('rota-morada-completa');
    const inputCP = document.getElementById('rota-codigo-postal');
    if (!inputMorada) return;

    inputMorada.value = `${nomeRua}, `;
    inputMorada.focus();
    const pos = inputMorada.value.length;
    inputMorada.setSelectionRange(pos, pos);

    // Esconde o chip após seleção e renderiza preview
    const chipContainer = document.getElementById('chip-sugestao-oficial-ctt');
    if (chipContainer) chipContainer.classList.add('hidden');

    atualizarPreviewMorada(inputMorada.value, inputCP ? inputCP.value : "");
};

/**
 * Limpa e divide uma morada longa em Artéria/Porta e Localidade/CP sem duplicação de códigos postais
 */
export function formatarMoradaLegivel(moradaCompleta, codigoPostal = "") {
    if (!moradaCompleta) return { linhaPrincipal: "", linhaSecundaria: "" };

    let textoLimpo = moradaCompleta.replace(/,\s*Portugal$/i, '').replace(/,\s*PT$/i, '').trim();

    const matchCP = textoLimpo.match(/\b\d{4}-\d{3}\b/);
    const cpDetectado = matchCP ? matchCP[0] : (codigoPostal || "");
    textoLimpo = textoLimpo.replace(/\b\d{4}-\d{3}\b/g, '').replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').trim();

    const partes = textoLimpo.split(',').map(p => p.trim()).filter(Boolean);

    if (partes.length === 0) {
        return {
            linhaPrincipal: moradaCompleta,
            linhaSecundaria: cpDetectado
        };
    }

    let linhaPrincipal = partes[0];
    let restantePartes = partes.slice(1);

    if (partes[1] && (/^\d+/.test(partes[1]) || /^(nº|lote|bloco|n|lt|andar|r\/c)/i.test(partes[1]))) {
        linhaPrincipal += `, ${partes[1]}`;
        restantePartes = partes.slice(2);
    }

    let localidadeTexto = restantePartes.join(', ').trim();
    let linhaSecundaria = cpDetectado ? `${cpDetectado} ${localidadeTexto}`.trim() : localidadeTexto;

    return {
        linhaPrincipal: linhaPrincipal.trim(),
        linhaSecundaria: linhaSecundaria.trim()
    };
}

/**
 * Cria ou atualiza o Card de Pré-visualização Multi-Linha abaixo da linha inteira de inputs
 */
export function atualizarPreviewMorada(moradaTexto, codigoPostalTexto = "") {
    const inputMorada = document.getElementById('rota-morada-completa');
    if (!inputMorada) return;

    const containerWrapper = inputMorada.closest('.space-y-1') || inputMorada.parentElement.parentElement || inputMorada.parentElement;

    let previewContainer = document.getElementById('card-preview-morada-selecionada');
    if (!previewContainer) {
        previewContainer = document.createElement('div');
        previewContainer.id = 'card-preview-morada-selecionada';
        previewContainer.className = 'mt-2 p-2.5 bg-blue-50/80 border border-blue-200 rounded-xl shadow-xs transition-all hidden w-full';
        containerWrapper.appendChild(previewContainer);
    }

    const textoVal = moradaTexto || inputMorada.value.trim();
    const cpVal = codigoPostalTexto || document.getElementById('rota-codigo-postal')?.value.trim() || "";

    if (!textoVal || textoVal.length < 5 || /^\d{4}-\d{3}$/.test(textoVal)) {
        previewContainer.classList.add('hidden');
        previewContainer.innerHTML = '';
        return;
    }

    const { linhaPrincipal, linhaSecundaria } = formatarMoradaLegivel(textoVal, cpVal);

    previewContainer.innerHTML = `
        <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
                <div class="text-xs font-black text-gray-900 leading-snug break-words">
                    <i class="fa-solid fa-location-dot text-blue-600 mr-1.5"></i>
                    <span>${linhaPrincipal || textoVal}</span>
                </div>
                ${linhaSecundaria ? `
                    <div class="text-[11px] font-bold text-blue-700 leading-tight mt-1 break-words">
                        <i class="fa-solid fa-map-pin text-blue-400 mr-1 text-[10px]"></i>
                        <span>${linhaSecundaria}</span>
                    </div>
                ` : ''}
            </div>
            <button type="button" onclick="document.getElementById('card-preview-morada-selecionada')?.classList.add('hidden')"
                    class="text-gray-400 hover:text-gray-600 p-1 text-xs cursor-pointer border-none bg-transparent" title="Fechar visualização">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
    `;

    previewContainer.classList.remove('hidden');
}

/**
 * Preenche o prefixo no campo de Código Postal e coloca o cursor no fim
 */
export function aplicarPrefixoNoCampo(prefixo) {
    const inputCP = document.getElementById('rota-codigo-postal');
    const inputMorada = document.getElementById('rota-morada-completa');
    if (!inputCP) return;

    inputCP.value = `${prefixo}-`;
    inputCP.focus();
    const comprimentoTexto = inputCP.value.length;
    inputCP.setSelectionRange(comprimentoTexto, comprimentoTexto);

    if (inputMorada) {
        inputMorada.value = "";
    }
    const preview = document.getElementById('card-preview-morada-selecionada');
    if (preview) preview.classList.add('hidden');

    const chipContainer = document.getElementById('chip-sugestao-oficial-ctt');
    if (chipContainer) chipContainer.classList.add('hidden');

    inputCP.dispatchEvent(new Event('input'));
}

/**
 * Configura o evento do botão "Inserir CP-"
 */
export function configurarEventosPrefixoRapido() {
    const btnManual = document.getElementById('btn-inserir-prefixo');
    const inputPrefixoManual = document.getElementById('prefixo-manual');

    if (inputPrefixoManual) {
        inputPrefixoManual.value = obterPrefixoPadrao();
    }

    if (btnManual && inputPrefixoManual) {
        btnManual.addEventListener('click', (e) => {
            e.preventDefault();
            const prefixoVal = inputPrefixoManual.value.replace(/\D/g, '');
            if (prefixoVal.length !== 4) {
                alert("Por favor, introduza um prefixo de Código Postal com exatamente 4 números.");
                inputPrefixoManual.focus();
                return;
            }
            aplicarPrefixoNoCampo(prefixoVal);
        });
    }
}

/**
 * Associa o evento de pressionar a tecla ENTER nos campos de entrada para adicionar o pacote imediatamente
 */
export function configurarTeclasEnterAdicao() {
    const inputCP = document.getElementById('rota-codigo-postal');
    const inputMorada = document.getElementById('rota-morada-completa');

    const dispararAdicao = (e) => {
        if (e.key === 'Enter') {
            const pacContainer = document.querySelector('.pac-container');
            const pacItemSelecionado = pacContainer && pacContainer.querySelector('.pac-item-selected');
            if (pacItemSelecionado) {
                return;
            }

            e.preventDefault();
            const btnAdicionar = document.getElementById('btn-adicionar-postal-rota');
            if (btnAdicionar) {
                btnAdicionar.click();
            }
        }
    };

    if (inputCP && inputCP.dataset.enterBound !== "true") {
        inputCP.addEventListener('keydown', dispararAdicao);
        inputCP.dataset.enterBound = "true";
    }

    if (inputMorada && inputMorada.dataset.enterBound !== "true") {
        inputMorada.addEventListener('keydown', dispararAdicao);
        inputMorada.dataset.enterBound = "true";
    }
}

/**
 * Aplica a máscara XXXX-XXX no Código Postal e limpa automaticamente a morada ao trocar de CP
 */
export function configurarFormatacaoCodigoPostal() {
    const inputCP = document.getElementById('rota-codigo-postal');
    const inputMorada = document.getElementById('rota-morada-completa');
    if (!inputCP) return;

    inputCP.addEventListener('input', () => {
        let valor = inputCP.value.replace(/[^0-9-]/g, '');
        const numerosApenas = valor.replace(/\D/g, '');

        if (numerosApenas.length <= 4) {
            valor = numerosApenas;
        } else {
            valor = `${numerosApenas.substring(0, 4)}-${numerosApenas.substring(4, 7)}`;
        }
        inputCP.value = valor.toUpperCase();

        // SE O UTILIZADOR ALTERAR O CÓDIGO POSTAL:
        if (valor !== ultimoCpConcluido) {
            if (inputMorada) {
                inputMorada.value = "";
            }
            const preview = document.getElementById('card-preview-morada-selecionada');
            if (preview) {
                preview.classList.add('hidden');
                preview.innerHTML = '';
            }
            const chipContainer = document.getElementById('chip-sugestao-oficial-ctt');
            if (chipContainer) chipContainer.classList.add('hidden');
        }

        // QUANDO DIGITA OS 7 DÍGITOS COMPLETOS:
        if (numerosApenas.length === 7) {
            ultimoCpConcluido = valor;
            
            // Exibe de imediato o Chip com a Rua Oficial dos CTT para preenchimento em 1 clique
            atualizarChipSugestaoOficialCTT(valor);

            if (inputMorada) {
                inputMorada.value = "";
                inputMorada.focus();
            }
        }
    });

    configurarTeclasEnterAdicao();
}

/**
 * Trava geograficamente o Google Places (strictBounds: true) ao Concelho / Prefixo correto
 */
export function configurarEscutaCodigoPostalParaLimites() {
    const inputCP = document.getElementById('rota-codigo-postal');
    if (!inputCP) return;

    inputCP.addEventListener('input', async () => {
        const valor = inputCP.value.trim();
        const numerosApenas = valor.replace(/\D/g, '');

        if (!autocompleteInstancia) return;

        if (numerosApenas.length < 4) {
            const centroGeral = { lat: 38.8700, lng: -9.3500 };
            const circuloGeral = new google.maps.Circle({ center: centroGeral, radius: 20000 });
            autocompleteInstancia.setBounds(circuloGeral.getBounds());
            autocompleteInstancia.setOptions({ strictBounds: true });
            return;
        }

        const prefixo4 = numerosApenas.substring(0, 4);
        let centroAlvo = { lat: 38.8000, lng: -9.3800 };
        let raioBusca = 5000;

        if (COORDENADAS_PREFIXOS[prefixo4]) {
            centroAlvo = { lat: COORDENADAS_PREFIXOS[prefixo4].lat, lng: COORDENADAS_PREFIXOS[prefixo4].lng };
            raioBusca = COORDENADAS_PREFIXOS[prefixo4].raio;
        } else {
            const concelhoDetectado = (obterConcelhoPorCodigoPostal(valor) || "SINTRA").toUpperCase();
            centroAlvo = concelhoDetectado === "SINTRA" ? { lat: 38.8200, lng: -9.3600 } : { lat: 38.9369, lng: -9.3282 };
            raioBusca = 5000;
        }

        if (numerosApenas.length === 7) {
            const formattedZip = `${numerosApenas.substring(0, 4)}-${numerosApenas.substring(4, 7)}`;
            const dadosCtt = consultarDadosOficiaisCP7(formattedZip);
            if (dadosCtt && typeof dadosCtt.lat === 'number' && typeof dadosCtt.lng === 'number' && dadosCtt.lat !== 0) {
                centroAlvo = { lat: dadosCtt.lat, lng: dadosCtt.lng };
                raioBusca = 3500;
            }
        }

        const circuloAlvo = new google.maps.Circle({ center: centroAlvo, radius: raioBusca });
        autocompleteInstancia.setBounds(circuloAlvo.getBounds());
        // strictBounds: true elimina Olival Basto, Cascais, Lisboa e outras cidades fora do concelho
        autocompleteInstancia.setOptions({ strictBounds: true });
    });
}

/**
 * Inicializa o Google Places Autocomplete com travamento estrito e captura de moradas
 */
export function inicializarAutocompleteMorada() {
    const inputMorada = document.getElementById('rota-morada-completa');
    if (!inputMorada) return;

    configurarTeclasEnterAdicao();

    if (inputMorada.dataset.autocompleteBound === "true") return;

    if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
        setTimeout(inicializarAutocompleteMorada, 400);
        return;
    }

    try {
        const centroPadrao = { lat: 38.8700, lng: -9.3500 };
        const circuloPadrao = new google.maps.Circle({ center: centroPadrao, radius: 20000 });

        autocompleteInstancia = new google.maps.places.Autocomplete(inputMorada, {
            componentRestrictions: { country: 'pt' },
            fields: ['address_components', 'geometry', 'formatted_address', 'name'],
            bounds: circuloPadrao.getBounds(),
            strictBounds: true
        });

        inputMorada.dataset.autocompleteBound = "true";

        autocompleteInstancia.addListener('place_changed', () => {
            const place = autocompleteInstancia.getPlace();
            if (!place || (!place.formatted_address && !place.name)) return;

            const inputCP = document.getElementById('rota-codigo-postal');
            let moradaFormatada = place.formatted_address || place.name || "";

            moradaFormatada = moradaFormatada.replace(/,\s*Portugal$/i, '').trim();

            let cpGoogleReal = "";
            if (place.address_components) {
                const componenteCP = place.address_components.find(c => c.types.includes('postal_code'));
                if (componenteCP) {
                    const cpLimpo = componenteCP.long_name.replace(/\D/g, '');
                    if (cpLimpo.length === 7) {
                        cpGoogleReal = `${cpLimpo.substring(0, 4)}-${cpLimpo.substring(4, 7)}`;
                    } else if (cpLimpo.length === 4) {
                        cpGoogleReal = `${cpLimpo}-`;
                    }
                }
            }

            if (cpGoogleReal && inputCP) {
                inputCP.value = cpGoogleReal;
                ultimoCpConcluido = cpGoogleReal;
            }

            const cpFinal = cpGoogleReal || (inputCP ? inputCP.value.trim() : "");

            let moradaSemCP = moradaFormatada.replace(/\b\d{4}-\d{3}\b/g, '').replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').trim();
            inputMorada.value = moradaSemCP;

            // Oculta o chip da CTT quando seleciona morada e exibe o preview estruturado
            const chipContainer = document.getElementById('chip-sugestao-oficial-ctt');
            if (chipContainer) chipContainer.classList.add('hidden');

            atualizarPreviewMorada(moradaSemCP, cpFinal);
        });

    } catch (err) {
        console.warn("[PLACES] Aviso ao inicializar Autocomplete do Google Maps:", err);
    }
}