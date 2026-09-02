/**
 * js/rotas-inputs.js
 * Versão v77.4 - Módulo de Formatação de Inputs, Autocomplete e Validação Oficial CTT
 * Faz: Controla a formatação e máscara de Código Postal (CP7), botão de prefixo rápido,
 *      escuta de limites para geocodificação, suporte a Enter, inicialização do Google Places Autocomplete
 *      e integração direta com a Base Oficial dos CTT (CP7 como Verdade Absoluta).
 * Depende de: ./ui-menu.js, ./rotas-geografia.js, ./cp7-data.js
 */

import { obterPrefixoPadrao } from './ui-menu.js';
import { obterConcelhoPorCodigoPostal } from './rotas-geografia.js';
import { CP7_DATABASE } from './cp7-data.js';

let autocompleteInstancia = null;

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
 * Ajusta dinamicamente o centro e limite do Autocomplete e auto-preenche a morada oficial dos CTT ao digitar o CP7
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
            const circuloMafra = new google.maps.Circle({ center: centroMafra, radius: 20000 });
            autocompleteInstancia.setBounds(circuloMafra.getBounds());
            autocompleteInstancia.setOptions({ strictBounds: false });
            return;
        }

        if (padraoCP.test(valor)) {
            // 1. Consulta a verdade absoluta dos CTT no CP7_DATABASE
            const dadosCtt = consultarDadosOficiaisCP7(valor);

            if (dadosCtt) {
                const ruaOficial = dadosCtt.rua ? dadosCtt.rua.trim() : "";
                const localidadeOficial = dadosCtt.localidade || dadosCtt.cpalf || "";
                const concelhoOficial = dadosCtt.concelho || obterConcelhoPorCodigoPostal(valor);

                // Se o campo da morada estiver vazio ou apenas com o código postal antigo, auto-preenche com a rua oficial dos CTT
                if (inputMorada) {
                    const moradaSugerida = ruaOficial 
                        ? `${ruaOficial}, ${localidadeOficial} (${concelhoOficial})`
                        : `${valor} ${localidadeOficial}, ${concelhoOficial}`;

                    inputMorada.value = moradaSugerida;
                    inputMorada.focus();

                    // Se temos rua oficial, posiciona o cursor no início para facilitar a digitação do número da porta (ex: "Nº 12, ")
                    inputMorada.setSelectionRange(0, 0);
                }

                // 2. Se temos coordenadas GPS exatas para este CP7, foca o Google Places diretamente nesse raio
                if (autocompleteInstancia) {
                    let centroAlvo = null;
                    let raioBusca = 15000;

                    if (typeof dadosCtt.lat === 'number' && typeof dadosCtt.lng === 'number' && dadosCtt.lat !== null) {
                        centroAlvo = { lat: dadosCtt.lat, lng: dadosCtt.lng };
                        raioBusca = 4000; // Raio de precisão máxima de 4km
                    } else {
                        const concelhoDetectado = (dadosCtt.concelho || obterConcelhoPorCodigoPostal(valor) || "SINTRA").toUpperCase();
                        centroAlvo = concelhoDetectado === "SINTRA" ? { lat: 38.8000, lng: -9.3800 } : { lat: 38.9369, lng: -9.3282 };
                    }

                    const circuloAlvo = new google.maps.Circle({ center: centroAlvo, radius: raioBusca });
                    autocompleteInstancia.setBounds(circuloAlvo.getBounds());
                    autocompleteInstancia.setOptions({ strictBounds: false });
                }
            } else {
                // Fallback caso o CP7 não esteja na lista
                if (inputMorada && (!inputMorada.value || /^\d{4}-\d{3}$/.test(inputMorada.value.trim()))) {
                    inputMorada.value = valor;
                    inputMorada.focus();
                }

                if (autocompleteInstancia) {
                    const concelhoDetectado = obterConcelhoPorCodigoPostal(valor);
                    const centroConcelho = concelhoDetectado === "SINTRA" ? { lat: 38.8000, lng: -9.3800 } : { lat: 38.9369, lng: -9.3282 };
                    const circuloConcelho = new google.maps.Circle({ center: centroConcelho, radius: 15000 });
                    autocompleteInstancia.setBounds(circuloConcelho.getBounds());
                    autocompleteInstancia.setOptions({ strictBounds: false });
                }
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
        const circuloMafra = new google.maps.Circle({ center: centroMafra, radius: 20000 });
        const limitesMafra = circuloMafra.getBounds();

        autocompleteInstancia = new google.maps.places.Autocomplete(inputMorada, {
            componentRestrictions: { country: 'pt' },
            fields: ['address_components', 'geometry', 'formatted_address', 'name'],
            bounds: limitesMafra,
            strictBounds: false
        });

        inputMorada.dataset.autocompleteBound = "true";

        autocompleteInstancia.addListener('place_changed', () => {
            const localSelecionado = autocompleteInstancia.getPlace();
            if (!localSelecionado || !localSelecionado.address_components) return;

            const inputCP = document.getElementById('rota-codigo-postal');
            const cpDigitado = inputCP ? inputCP.value.trim() : "";
            const padraoCP7 = /^\d{4}-\d{3}$/;

            // Se o estafeta já digitou um CP7 completo válido, respeitamos como Verdade Absoluta
            if (padraoCP7.test(cpDigitado)) {
                return;
            }

            const componenteCP = localSelecionado.address_components.find(c => c.types.includes('postal_code'));
            if (componenteCP && inputCP) {
                const cpLimpo = componenteCP.long_name.replace(/\D/g, '');
                if (cpLimpo.length === 7) {
                    inputCP.value = `${cpLimpo.substring(0, 4)}-${cpLimpo.substring(4, 7)}`;
                    // Dispara a validação oficial do CTT para o novo código
                    inputCP.dispatchEvent(new Event('input'));
                } else if (cpLimpo.length === 4) {
                    inputCP.value = `${cpLimpo}-`;
                    inputCP.focus();
                }
            }
        });
    } catch (err) {
        console.warn("Não foi possível iniciar o Autocomplete do Google Places neste ecrã:", err);
    }
}