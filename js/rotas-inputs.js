/**
 * js/rotas-inputs.js
 * Versão v80.5 - Preservação Automática de Número de Porta, Blindagem de CP7 e Google Places Nativo
 * Faz: Preserva o número de porta/lote digitado pelo utilizador mesmo que o Google Places devolva apenas a rua;
 *      mantém o CP7 da etiqueta protegido contra códigos genéricos (ex: 2710-089) e botão 'X' de limpeza rápida.
 * Depende de: ./ui-menu.js, ./rotas-geografia.js, ./cp7-data.js
 */

import { obterPrefixoPadrao } from './ui-menu.js';
import { obterConcelhoPorCodigoPostal } from './rotas-geografia.js';
import { CP7_DATABASE } from './cp7-data.js';

let autocompleteInstancia = null;
let ultimoCpConcluido = "";
let textoDigitadoAntesDeSelecionar = "";

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
 * Preserva o número da porta digitado pelo utilizador caso o Google Places devolva apenas a rua
 */
function preservarNumeroDaPorta(moradaGoogle, textoDigitado) {
    if (!moradaGoogle || !textoDigitado) return moradaGoogle;

    // Remove o código postal do texto digitado para não confundir com o número da porta
    const textoSemCP = textoDigitado.replace(/\b\d{4}-\d{3}\b/g, '').trim();

    // Procura número da porta ou lote (ex: "78", "nº 12", "Lote 4", "5A", "14-B")
    const matchNumero = textoSemCP.match(/(?:n[ºo°]?\s*|lote\s*|bloco\s*|lt\.?\s*)?(\b\d+[A-Za-z]?\b|\b\d+\s*[-/]\s*\d+\b)/i);

    if (!matchNumero) return moradaGoogle;

    const numeroIdentificado = matchNumero[0].trim();
    const apenasDigitos = matchNumero[1].trim();

    // Verifica se a primeira parte da morada da Google já tem o número
    const partesMorada = moradaGoogle.split(',').map(p => p.trim());
    const primeiraParte = partesMorada[0] || "";

    const jaTemNumero = new RegExp(`\\b${apenasDigitos}\\b`).test(primeiraParte);

    if (!jaTemNumero && partesMorada.length > 0) {
        partesMorada[0] = `${primeiraParte}, ${numeroIdentificado}`;
        return partesMorada.join(', ');
    }

    return moradaGoogle;
}

/**
 * Configura o Botão de Limpar Rápido (X) dentro do campo de morada
 */
function configurarBotaoLimparMorada() {
    const inputMorada = document.getElementById('rota-morada-completa');
    if (!inputMorada) return;

    let btnLimpar = document.getElementById('btn-limpar-campo-morada');
    if (!btnLimpar) {
        if (inputMorada.parentElement) {
            inputMorada.parentElement.classList.add('relative');
        }

        btnLimpar = document.createElement('button');
        btnLimpar.id = 'btn-limpar-campo-morada';
        btnLimpar.type = 'button';
        btnLimpar.className = 'absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-600 hover:text-gray-900 flex items-center justify-center text-xs transition-all cursor-pointer border-none shadow-2xs hidden z-10';
        btnLimpar.title = 'Limpar campo de endereço';
        btnLimpar.innerHTML = '<i class="fa-solid fa-xmark"></i>';

        if (inputMorada.parentElement) {
            inputMorada.parentElement.appendChild(btnLimpar);
        }

        btnLimpar.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            inputMorada.value = '';
            textoDigitadoAntesDeSelecionar = '';
            btnLimpar.classList.add('hidden');
            inputMorada.focus();
        });
    }

    const atualizarVisibilidadeLimpar = () => {
        if (inputMorada.value && inputMorada.value.trim().length > 0) {
            btnLimpar.classList.remove('hidden');
        } else {
            btnLimpar.classList.add('hidden');
        }
    };

    if (inputMorada.dataset.limparBound !== "true") {
        inputMorada.addEventListener('input', () => {
            textoDigitadoAntesDeSelecionar = inputMorada.value;
            atualizarVisibilidadeLimpar();
        });
        inputMorada.addEventListener('change', atualizarVisibilidadeLimpar);
        inputMorada.dataset.limparBound = "true";
    }

    atualizarVisibilidadeLimpar();
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
 * Aplica a máscara XXXX-XXX no Código Postal e limpa/re-preenche dinamicamente ao trocar de CP
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

        // SE O UTILIZADOR ALTERAR OU APAGAR O CÓDIGO POSTAL:
        if (valor !== ultimoCpConcluido) {
            if (numerosApenas.length < 7 && inputMorada) {
                if (/^\d{4}/.test(inputMorada.value.trim())) {
                    inputMorada.value = "";
                    textoDigitadoAntesDeSelecionar = "";
                    const btnLimpar = document.getElementById('btn-limpar-campo-morada');
                    if (btnLimpar) btnLimpar.classList.add('hidden');
                }
            }
        }

        // QUANDO CONCLUI OS 7 DÍGITOS DO NOVO CÓDIGO POSTAL:
        if (numerosApenas.length === 7 && inputMorada) {
            const formattedZip = `${numerosApenas.substring(0, 4)}-${numerosApenas.substring(4, 7)}`;
            ultimoCpConcluido = formattedZip;

            inputMorada.value = `${formattedZip} `;
            textoDigitadoAntesDeSelecionar = inputMorada.value;
            inputMorada.focus();
            const pos = inputMorada.value.length;
            inputMorada.setSelectionRange(pos, pos);

            const btnLimpar = document.getElementById('btn-limpar-campo-morada');
            if (btnLimpar) btnLimpar.classList.remove('hidden');
        }
    });

    configurarTeclasEnterAdicao();
    configurarBotaoLimparMorada();
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
 * Inicializa o Google Places Autocomplete protegendo o CP e preservando o número da porta
 */
export function inicializarAutocompleteMorada() {
    const inputMorada = document.getElementById('rota-morada-completa');
    if (!inputMorada) return;

    configurarTeclasEnterAdicao();
    configurarBotaoLimparMorada();

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
            const cpOriginalDigitado = inputCP ? inputCP.value.trim() : "";
            const temCp7Valido = /^\d{4}-\d{3}$/.test(cpOriginalDigitado);

            let moradaFormatada = place.formatted_address || place.name || "";
            moradaFormatada = moradaFormatada.replace(/,\s*Portugal$/i, '').trim();

            // PRESERVAÇÃO DO NÚMERO DA PORTA: Garante que o número digitado pelo utilizador não se perde
            moradaFormatada = preservarNumeroDaPorta(moradaFormatada, textoDigitadoAntesDeSelecionar || inputMorada.value);

            // REGRA DE OURO: O CP7 da etiqueta (ex: 2710-730) nunca é sobrescrito pelo Google
            if (temCp7Valido) {
                moradaFormatada = moradaFormatada.replace(/\b\d{4}-\d{3}\b/g, cpOriginalDigitado);
                inputMorada.value = moradaFormatada;
            } else {
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
                inputMorada.value = moradaFormatada;
            }

            const btnLimpar = document.getElementById('btn-limpar-campo-morada');
            if (btnLimpar) btnLimpar.classList.remove('hidden');
        });

    } catch (err) {
        console.warn("[PLACES] Erro ao inicializar Google Places Autocomplete:", err);
    }
}