/**
 * js/rotas-inputs.js
 * Versão v78.3 - Google Places com Travamento Estrito (strictBounds) em Sintra e Mafra
 * Faz: Ao introduzir o CP7, trava geograficamente o Google Places estritamente ao concelho/zona (strictBounds: true),
 *      mantém o campo da morada limpo para digitação natural da rua/número e formata o preview em 2 linhas.
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
 * Limpa e divide uma morada longa em Artéria/Porta e Localidade/CP para leitura clara
 */
export function formatarMoradaLegivel(moradaCompleta, codigoPostal = "") {
    if (!moradaCompleta) return { linhaPrincipal: "", linhaSecundaria: "" };

    // Remove ", Portugal" ou ", PT" redundantes do fim
    let textoLimpo = moradaCompleta.replace(/,\s*Portugal$/i, '').replace(/,\s*PT$/i, '').trim();

    // Divide por vírgulas para separar artéria/número da localidade
    const partes = textoLimpo.split(',').map(p => p.trim()).filter(Boolean);

    if (partes.length <= 1) {
        return {
            linhaPrincipal: textoLimpo,
            linhaSecundaria: codigoPostal ? `${codigoPostal}` : ""
        };
    }

    const linhaPrincipal = partes[0] + (partes[1] && (/^\d+/.test(partes[1]) || /^(nº|lote|bloco|n|lt|andar|r\/c)/i.test(partes[1])) ? `, ${partes[1]}` : '');
    const restantesPartes = partes.slice(linhaPrincipal.includes(partes[1]) ? 2 : 1);
    
    let linhaSecundaria = restantesPartes.join(', ');
    if (codigoPostal && !linhaSecundaria.includes(codigoPostal)) {
        linhaSecundaria = `${codigoPostal} ${linhaSecundaria}`.trim();
    }

    return {
        linhaPrincipal: linhaPrincipal || textoLimpo,
        linhaSecundaria: linhaSecundaria || (codigoPostal ? `${codigoPostal}` : "")
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

    // Só mostra o preview se já houver uma morada real selecionada ou digitada (mais do que apenas o CP)
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
    if (!inputCP) return;
    inputCP.value = `${prefixo}-`;
    inputCP.focus();
    const comprimentoTexto = inputCP.value.length;
    inputCP.setSelectionRange(comprimentoTexto, comprimentoTexto);

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
 * Aplica a máscara e formatação automática XXXX-XXX no campo de Código Postal
 * e foca o campo da morada para escrita da rua
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

        // Se limpar o código postal, limpa o preview
        if (numerosApenas.length < 4) {
            const preview = document.getElementById('card-preview-morada-selecionada');
            if (preview) preview.classList.add('hidden');
            return;
        }

        // Quando termina de preencher os 7 dígitos do CP, foca a morada para digitar a rua
        if (numerosApenas.length === 7 && inputMorada) {
            inputMorada.focus();
        }
    });

    if (inputMorada) {
        inputMorada.addEventListener('input', () => {
            if (inputMorada.value.trim().length > 6) {
                atualizarPreviewMorada(inputMorada.value, inputCP.value);
            } else {
                const preview = document.getElementById('card-preview-morada-selecionada');
                if (preview) preview.classList.add('hidden');
            }
        });
    }

    configurarTeclasEnterAdicao();
}

/**
 * Trava geograficamente o Google Places (strictBounds: true) ao Concelho / CP inserido
 */
export function configurarEscutaCodigoPostalParaLimites() {
    const inputCP = document.getElementById('rota-codigo-postal');
    if (!inputCP) return;

    inputCP.addEventListener('input', async () => {
        const valor = inputCP.value.trim();
        const numerosApenas = valor.replace(/\D/g, '');

        if (!autocompleteInstancia) return;

        // Se estiver vazio, define área padrão Sintra/Mafra
        if (numerosApenas.length < 4) {
            const centroGeral = { lat: 38.8700, lng: -9.3500 };
            const circuloGeral = new google.maps.Circle({ center: centroGeral, radius: 25000 });
            autocompleteInstancia.setBounds(circuloGeral.getBounds());
            autocompleteInstancia.setOptions({ strictBounds: true });
            return;
        }

        const concelhoDetectado = (obterConcelhoPorCodigoPostal(valor) || "SINTRA").toUpperCase();
        let centroAlvo = concelhoDetectado === "SINTRA" ? { lat: 38.8000, lng: -9.3800 } : { lat: 38.9369, lng: -9.3282 };
        let raioBusca = 12000;

        // Se for um CP7 completo com coordenadas conhecidas, trava num raio fechado de 6km
        if (numerosApenas.length === 7) {
            const formattedZip = `${numerosApenas.substring(0, 4)}-${numerosApenas.substring(4, 7)}`;
            const dadosCtt = consultarDadosOficiaisCP7(formattedZip);
            if (dadosCtt && typeof dadosCtt.lat === 'number' && typeof dadosCtt.lng === 'number' && dadosCtt.lat !== 0) {
                centroAlvo = { lat: dadosCtt.lat, lng: dadosCtt.lng };
                raioBusca = 6000;
            }
        }

        const circuloAlvo = new google.maps.Circle({ center: centroAlvo, radius: raioBusca });
        autocompleteInstancia.setBounds(circuloAlvo.getBounds());
        // TRAVAMENTO ESTRITO OBRIGATÓRIO: impede que o Google sugira Lisboa, Cascais, etc.
        autocompleteInstancia.setOptions({ strictBounds: true });
    });
}

/**
 * Inicializa o Google Places Autocomplete com restrição estrita e preview formatado
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
        const circuloPadrao = new google.maps.Circle({ center: centroPadrao, radius: 25000 });

        autocompleteInstancia = new google.maps.places.Autocomplete(inputMorada, {
            componentRestrictions: { country: 'pt' },
            fields: ['address_components', 'geometry', 'formatted_address', 'name'],
            bounds: circuloPadrao.getBounds(),
            strictBounds: true // Garante que a Google só busca na área definida
        });

        inputMorada.dataset.autocompleteBound = "true";

        autocompleteInstancia.addListener('place_changed', () => {
            const place = autocompleteInstancia.getPlace();
            if (!place || (!place.formatted_address && !place.name)) return;

            const inputCP = document.getElementById('rota-codigo-postal');
            let moradaFormatada = place.formatted_address || place.name || "";

            // Limpa o sufixo redundante ", Portugal"
            moradaFormatada = moradaFormatada.replace(/,\s*Portugal$/i, '').trim();
            inputMorada.value = moradaFormatada;

            // Se o campo do Código Postal estiver vazio, preenche com o CP do Google Places
            if (place.address_components && inputCP && !inputCP.value.trim()) {
                const componenteCP = place.address_components.find(c => c.types.includes('postal_code'));
                if (componenteCP) {
                    const cpLimpo = componenteCP.long_name.replace(/\D/g, '');
                    if (cpLimpo.length === 7) {
                        inputCP.value = `${cpLimpo.substring(0, 4)}-${cpLimpo.substring(4, 7)}`;
                        inputCP.dispatchEvent(new Event('input'));
                    } else if (cpLimpo.length === 4) {
                        inputCP.value = `${cpLimpo}-`;
                    }
                }
            }

            // Renderiza o card de pré-visualização em 2 linhas abaixo da caixa de texto
            atualizarPreviewMorada(moradaFormatada, inputCP ? inputCP.value : "");
        });

    } catch (err) {
        console.warn("[PLACES] Aviso ao inicializar Autocomplete do Google Maps:", err);
    }
}