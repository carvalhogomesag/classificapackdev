/**
 * js/rotas-inputs.js
 * Versão v71.1 - Módulo de Formatação de Inputs e Google Places Autocomplete
 * Faz: Controla a formatação e máscara de Código Postal (CP7), botão de prefixo rápido,
 *      escuta de limites para geocodificação, suporte a Enter e inicialização do Google Places Autocomplete.
 * Depende de: ./ui-menu.js, ./rotas-geografia.js
 */

import { obterPrefixoPadrao } from './ui-menu.js';
import { obterConcelhoPorCodigoPostal } from './rotas-geografia.js';

let autocompleteInstancia = null;

/**
 * Preenche o prefixo no campo de Código Postal e coloca o cursor no fim
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
 * Aplica a máscara e formatação automática XXXX-XXX no campo de Código Postal
 */
export function configurarFormatacaoCodigoPostal() {
    const inputCP = document.getElementById('rota-codigo-postal');
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
    });

    configurarTeclasEnterAdicao();
}

/**
 * Ajusta dinamicamente o centro e limite do Autocomplete ao digitar o CP
 */
export function configurarEscutaCodigoPostalParaLimites() {
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
                const comprimento = inputMorada.value.length;
                inputMorada.setSelectionRange(comprimento, comprimento);
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

/**
 * Inicializa o Autocomplete do Google Places no campo de morada detalhada
 */
export function inicializarAutocompleteMorada() {
    const inputMorada = document.getElementById('rota-morada-completa');
    if (!inputMorada) return;

    configurarTeclasEnterAdicao();

    if (inputMorada.dataset.autocompleteBound === "true") return;

    if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
        setTimeout(inicializarAutocompleteMorada, 500);
        return;
    }

    try {
        const centroMafra = { lat: 38.9369, lng: -9.3282 };
        const circuloMafra = new google.maps.Circle({ center: centroMafra, radius: 15000 });
        const limitesMafra = circuloMafra.getBounds();

        autocompleteInstancia = new google.maps.places.Autocomplete(inputMorada, {
            componentRestrictions: { country: 'pt' },
            fields: ['address_components', 'geometry', 'formatted_address'],
            bounds: limitesMafra,
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
        });
    } catch (err) {
        console.warn("Não foi possível iniciar o Autocomplete do Google Places neste ecrã:", err);
    }
}