/**
 * js/rotas-inputs.js
 * Versão v80.2 - Google Places Tradicional com CP7 e Cursor no Fim
 * Faz: Ao completar os 7 dígitos do CP7, transporta apenas o código postal formatado ("XXXX-XXX ")
 *      para o campo da morada e coloca o cursor no FINAL para digitação imediata da rua/porta.
 * Depende de: ./ui-menu.js, ./rotas-geografia.js, ./cp7-data.js
 */

import { obterPrefixoPadrao } from './ui-menu.js';
import { obterConcelhoPorCodigoPostal } from './rotas-geografia.js';
import { CP7_DATABASE } from './cp7-data.js';

let autocompleteInstancia = null;

/**
 * Consulta a Base Oficial dos CTT pelo Código Postal (CP7)
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
 * Preenche o prefixo no campo de Código Postal e foca o campo
 */
export function aplicarPrefixoNoCampo(prefixo) {
    const inputCP = document.getElementById('rota-codigo-postal');
    if (!inputCP) return;
    inputCP.value = `${prefixo}-`;
    inputCP.focus();
    const comprimentoTexto = inputCP.value.length;
    inputCP.setSelectionRange(comprimentoTexto, comprimentoTexto);
}

/**
 * Configura o botão de inserção rápida de prefixo (ex: "2710-")
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
 * Aplica a máscara XXXX-XXX no campo de Código Postal e envia "XXXX-XXX "
 * para o campo da Google com o cursor posicionado no FIM para digitação imediata
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

        // SE O UTILIZADOR LIMPAR OU ALTERAR O CÓDIGO POSTAL:
        if (numerosApenas.length < 4 && inputMorada && /^\d{4}/.test(inputMorada.value.trim())) {
            inputMorada.value = "";
        }

        // QUANDO COMPLETA OS 7 DÍGITOS DO CP7:
        if (numerosApenas.length === 7 && inputMorada) {
            const formattedZip = `${numerosApenas.substring(0, 4)}-${numerosApenas.substring(4, 7)}`;
            const valorAtualMorada = inputMorada.value.trim();

            // Se o campo estiver vazio ou contiver apenas um código postal anterior
            if (!valorAtualMorada || /^\d{4}-\d{3}/.test(valorAtualMorada) || /^\d{4}/.test(valorAtualMorada)) {
                inputMorada.value = `${formattedZip} `;
                inputMorada.focus();
                
                // Cursor colocado no FIM para continuar a digitar a rua logo a seguir ao espaço
                const pos = inputMorada.value.length;
                inputMorada.setSelectionRange(pos, pos);
            }
        }
    });

    configurarTeclasEnterAdicao();
}

/**
 * Mantém o centro de busca padrão do Google Places na região de Sintra / Mafra
 */
export function configurarEscutaCodigoPostalParaLimites() {
    if (!autocompleteInstancia) return;

    try {
        const centroSintraMafra = { lat: 38.8600, lng: -9.3500 };
        const circuloRegiao = new google.maps.Circle({ center: centroSintraMafra, radius: 30000 });
        autocompleteInstancia.setBounds(circuloRegiao.getBounds());
        autocompleteInstancia.setOptions({ strictBounds: false });
    } catch (e) {
        console.warn("[PLACES] Aviso ao definir limites gerais:", e);
    }
}

/**
 * Inicializa o Google Places Autocomplete Tradicional (Moradas, POIs e Ruas)
 */
export function inicializarAutocompleteMorada() {
    const inputMorada = document.getElementById('rota-morada-completa');
    if (!inputMorada) return;

    configurarTeclasEnterAdicao();

    if (inputMorada.dataset.autocompleteBound === "true") return;

    if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
        setTimeout(inicializarAutocompleteMorada, 300);
        return;
    }

    try {
        const centroPadrao = { lat: 38.8600, lng: -9.3500 };
        const circuloPadrao = new google.maps.Circle({ center: centroPadrao, radius: 30000 });

        autocompleteInstancia = new google.maps.places.Autocomplete(inputMorada, {
            componentRestrictions: { country: 'pt' },
            fields: ['address_components', 'geometry', 'formatted_address', 'name'],
            bounds: circuloPadrao.getBounds(),
            strictBounds: false
        });

        inputMorada.dataset.autocompleteBound = "true";

        autocompleteInstancia.addListener('place_changed', () => {
            const place = autocompleteInstancia.getPlace();
            if (!place || (!place.formatted_address && !place.name)) return;

            const inputCP = document.getElementById('rota-codigo-postal');
            let moradaFormatada = place.formatted_address || place.name || "";

            // Limpa o sufixo redundante ", Portugal" para manter o campo limpo
            moradaFormatada = moradaFormatada.replace(/,\s*Portugal$/i, '').trim();
            inputMorada.value = moradaFormatada;

            // Extrai o Código Postal retornado pelo Google Places se o campo do CP estiver vazio
            if (place.address_components && inputCP) {
                const componenteCP = place.address_components.find(c => c.types.includes('postal_code'));
                if (componenteCP) {
                    const cpLimpo = componenteCP.long_name.replace(/\D/g, '');
                    if (cpLimpo.length === 7) {
                        inputCP.value = `${cpLimpo.substring(0, 4)}-${cpLimpo.substring(4, 7)}`;
                    } else if (cpLimpo.length === 4) {
                        inputCP.value = `${cpLimpo}-`;
                    }
                }
            }
        });

    } catch (err) {
        console.warn("[PLACES] Erro ao inicializar Google Places Autocomplete:", err);
    }
}