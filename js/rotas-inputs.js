/**
 * js/rotas-inputs.js
 * Versão v77.5 - Módulo de Formatação de Inputs, Autocomplete, Filtro Inteligente de Artérias CTT
 * Faz: Controla a formatação e máscara de Código Postal (CP7), botão de prefixo rápido,
 *      filtro instantâneo de Ruas/Praças/Avenidas por Código Postal da base oficial CTT (CP7_DATABASE),
 *      lista suspensa inteligente com teclado e clique, e integração com Google Places.
 * Depende de: ./ui-menu.js, ./rotas-geografia.js, ./cp7-data.js
 */

import { obterPrefixoPadrao } from './ui-menu.js';
import { obterConcelhoPorCodigoPostal } from './rotas-geografia.js';
import { CP7_DATABASE } from './cp7-data.js';

let autocompleteInstancia = null;
let itemSugeridoAtivoIndex = -1;

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
 * Filtra e retorna todas as artérias (Ruas, Praças, Largos, etc.) existentes
 * para um dado Código Postal (ou prefixo de 4 dígitos) na base oficial CTT.
 */
export function obterRuasPorCodigoPostal(codigoPostal, termoBusca = "") {
    if (!CP7_DATABASE) return [];
    
    const cleanCP = (codigoPostal || "").trim().toUpperCase();
    const termo = (termoBusca || "").trim().toLowerCase();
    const resultados = [];
    const chavesVistas = new Set();

    const prefixo4 = cleanCP.replace(/\D/g, '').substring(0, 4);
    const cp7Formatado = cleanCP.length >= 8 ? cleanCP : (cleanCP.length === 7 && !cleanCP.includes('-') ? `${cleanCP.substring(0,4)}-${cleanCP.substring(4,7)}` : cleanCP);

    // 1. Procura se há registo direto no CP7
    if (CP7_DATABASE[cp7Formatado]) {
        const item = CP7_DATABASE[cp7Formatado];
        const ruas = Array.isArray(item.ruas) ? item.ruas : [item.rua || item.street || item.nome || ""];
        ruas.filter(Boolean).forEach(r => {
            const key = `${r.toLowerCase()}_${item.localidade || ''}`;
            if (!chavesVistas.has(key)) {
                chavesVistas.add(key);
                resultados.push({
                    rua: r.trim(),
                    localidade: item.localidade || item.cpalf || "",
                    concelho: item.concelho || obterConcelhoPorCodigoPostal(cp7Formatado) || "",
                    cp7: cp7Formatado,
                    lat: item.lat,
                    lng: item.lng
                });
            }
        });
    }

    // 2. Procura em todos os CP7s que partilhem o mesmo Código Postal ou prefixo de 4 dígitos
    for (const [cp, item] of Object.entries(CP7_DATABASE)) {
        if (!item) continue;
        const matchesCP = cleanCP ? (cp === cleanCP || (prefixo4 && cp.startsWith(prefixo4))) : true;
        if (matchesCP) {
            const rua = (item.rua || item.street || item.nome || "").trim();
            if (rua) {
                const key = `${rua.toLowerCase()}_${item.localidade || ''}`;
                if (!chavesVistas.has(key)) {
                    chavesVistas.add(key);
                    resultados.push({
                        rua: rua,
                        localidade: item.localidade || item.cpalf || "",
                        concelho: item.concelho || obterConcelhoPorCodigoPostal(cp) || "",
                        cp7: cp,
                        lat: item.lat,
                        lng: item.lng
                    });
                }
            }
        }
    }

    // 3. Aplica o filtro de texto se o utilizador estiver a digitar a rua
    if (termo) {
        return resultados.filter(item => 
            item.rua.toLowerCase().includes(termo) || 
            item.localidade.toLowerCase().includes(termo) ||
            item.cp7.toLowerCase().includes(termo)
        ).slice(0, 35);
    }

    return resultados.slice(0, 35);
}

/**
 * Cria ou obtém o contentor da lista suspensa de sugestões de moradas oficiais
 */
function obterContentorSugestoesMorada() {
    const inputMorada = document.getElementById('rota-morada-completa');
    if (!inputMorada) return null;

    let dropdown = document.getElementById('dropdown-sugestoes-ruas-ctt');
    if (!dropdown) {
        // Assegura que o container pai tem posicionamento relativo
        if (inputMorada.parentElement) {
            inputMorada.parentElement.classList.add('relative');
        }

        dropdown = document.createElement('div');
        dropdown.id = 'dropdown-sugestoes-ruas-ctt';
        dropdown.className = 'absolute z-[9999] left-0 right-0 top-full mt-1 bg-white border border-blue-200 rounded-xl shadow-2xl max-h-64 overflow-y-auto divide-y divide-gray-100 hidden transition-all';
        inputMorada.parentElement.appendChild(dropdown);

        // Fecha a lista ao clicar fora
        document.addEventListener('click', (e) => {
            if (!inputMorada.contains(e.target) && !dropdown.contains(e.target)) {
                fecharSugestoesRuas();
            }
        });
    }
    return dropdown;
}

/**
 * Fecha e limpa o menu de sugestões de ruas
 */
export function fecharSugestoesRuas() {
    const dropdown = document.getElementById('dropdown-sugestoes-ruas-ctt');
    if (dropdown) {
        dropdown.classList.add('hidden');
        dropdown.innerHTML = '';
        itemSugeridoAtivoIndex = -1;
    }
}

/**
 * Renderiza as sugestões de ruas filtradas para o Código Postal
 */
export function renderizarSugestoesRuas(termoFiltro = "") {
    const inputCP = document.getElementById('rota-codigo-postal');
    const inputMorada = document.getElementById('rota-morada-completa');
    const dropdown = obterContentorSugestoesMorada();

    if (!inputCP || !inputMorada || !dropdown) return;

    const cpAtual = inputCP.value.trim();
    if (!cpAtual || cpAtual.length < 4) {
        fecharSugestoesRuas();
        return;
    }

    const ruasCorrespondentes = obterRuasPorCodigoPostal(cpAtual, termoFiltro);

    if (ruasCorrespondentes.length === 0) {
        fecharSugestoesRuas();
        return;
    }

    itemSugeridoAtivoIndex = -1;
    dropdown.innerHTML = `
        <div class="px-3 py-1.5 bg-blue-50/80 border-b border-blue-100 flex items-center justify-between text-[11px] font-bold text-blue-700">
            <span><i class="fa-solid fa-map-location-dot mr-1 text-blue-500"></i> Ruas Oficiais dos CTT (${ruasCorrespondentes.length})</span>
            <span class="text-[10px] text-gray-500 font-normal">Clique para preencher</span>
        </div>
    `;

    ruasCorrespondentes.forEach((item, idx) => {
        const itemBtn = document.createElement('button');
        itemBtn.type = 'button';
        itemBtn.className = 'w-full text-left px-3 py-2 text-xs hover:bg-blue-50/70 focus:bg-blue-100 transition-colors flex items-center justify-between group cursor-pointer border-none bg-transparent';
        itemBtn.dataset.index = idx;

        itemBtn.innerHTML = `
            <div class="flex items-center space-x-2 truncate">
                <i class="fa-solid fa-road text-gray-400 group-hover:text-blue-600 transition-colors text-[11px]"></i>
                <div class="truncate">
                    <span class="font-bold text-gray-800 group-hover:text-blue-700">${item.rua}</span>
                    <span class="text-[10px] text-gray-500 ml-1">(${item.localidade || item.concelho})</span>
                </div>
            </div>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 group-hover:bg-blue-600 group-hover:text-white transition-all ml-2 shrink-0">
                ${item.cp7}
            </span>
        `;

        itemBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            selecionarRuaSugerida(item);
        });

        dropdown.appendChild(itemBtn);
    });

    dropdown.classList.remove('hidden');
}

/**
 * Seleciona a rua escolhida, preenche os campos e foca para digitação do número da porta
 */
function selecionarRuaSugerida(item) {
    const inputCP = document.getElementById('rota-codigo-postal');
    const inputMorada = document.getElementById('rota-morada-completa');

    if (inputCP && item.cp7) {
        inputCP.value = item.cp7;
    }

    if (inputMorada) {
        // Preenche com o nome da rua seguido de vírgula para inserção imediata do número
        inputMorada.value = `${item.rua}, `;
        inputMorada.focus();
        const pos = inputMorada.value.length;
        inputMorada.setSelectionRange(pos, pos);
    }

    fecharSugestoesRuas();
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

    // Abre de imediato as ruas disponíveis para aquele prefixo
    setTimeout(() => {
        renderizarSugestoesRuas("");
    }, 50);
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
            const dropdown = document.getElementById('dropdown-sugestoes-ruas-ctt');
            const dropdownAberto = dropdown && !dropdown.classList.contains('hidden');

            // Se o dropdown de sugestões estiver aberto e o utilizador pressionou Enter
            if (dropdownAberto) {
                const items = dropdown.querySelectorAll('button[data-index]');
                if (items.length > 0) {
                    e.preventDefault();
                    const alvo = itemSugeridoAtivoIndex >= 0 && itemSugeridoAtivoIndex < items.length 
                        ? items[itemSugeridoAtivoIndex] 
                        : items[0];
                    alvo.click();
                    return;
                }
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
        inputMorada.addEventListener('keydown', (e) => {
            const dropdown = document.getElementById('dropdown-sugestoes-ruas-ctt');
            const dropdownAberto = dropdown && !dropdown.classList.contains('hidden');

            if (dropdownAberto) {
                const items = dropdown.querySelectorAll('button[data-index]');
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    itemSugeridoAtivoIndex = Math.min(itemSugeridoAtivoIndex + 1, items.length - 1);
                    items.forEach((btn, idx) => {
                        btn.className = idx === itemSugeridoAtivoIndex 
                            ? 'w-full text-left px-3 py-2 text-xs bg-blue-100 transition-colors flex items-center justify-between font-bold text-blue-800 cursor-pointer border-none' 
                            : 'w-full text-left px-3 py-2 text-xs hover:bg-blue-50/70 transition-colors flex items-center justify-between cursor-pointer border-none bg-transparent';
                    });
                    return;
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    itemSugeridoAtivoIndex = Math.max(itemSugeridoAtivoIndex - 1, 0);
                    items.forEach((btn, idx) => {
                        btn.className = idx === itemSugeridoAtivoIndex 
                            ? 'w-full text-left px-3 py-2 text-xs bg-blue-100 transition-colors flex items-center justify-between font-bold text-blue-800 cursor-pointer border-none' 
                            : 'w-full text-left px-3 py-2 text-xs hover:bg-blue-50/70 transition-colors flex items-center justify-between cursor-pointer border-none bg-transparent';
                    });
                    return;
                } else if (e.key === 'Escape') {
                    fecharSugestoesRuas();
                    return;
                }
            }

            dispararAdicao(e);
        });
        inputMorada.dataset.enterBound = "true";
    }
}

/**
 * Aplica a máscara e formatação automática XXXX-XXX no campo de Código Postal
 * e dispara a abertura das sugestões oficiais de ruas CTT
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

        // Se já digitou os 4 primeiros dígitos, exibe ou atualiza as sugestões de ruas daquele CP
        if (valor.length >= 4) {
            const termoMorada = inputMorada ? inputMorada.value : "";
            renderizarSugestoesRuas(termoMorada);
        } else {
            fecharSugestoesRuas();
        }
    });

    if (inputMorada) {
        // Ao digitar no campo da morada, filtra as ruas correspondentes àquele CP
        inputMorada.addEventListener('input', () => {
            renderizarSugestoesRuas(inputMorada.value);
        });

        // Ao focar no campo da morada, abre a lista de ruas se houver CP digitado
        inputMorada.addEventListener('focus', () => {
            if (inputCP.value.length >= 4) {
                renderizarSugestoesRuas(inputMorada.value);
            }
        });
    }

    configurarTeclasEnterAdicao();
}

/**
 * Ajusta dinamicamente o centro e limite do Autocomplete do Google
 */
export function configurarEscutaCodigoPostalParaLimites() {
    const inputCP = document.getElementById('rota-codigo-postal');
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
            const dadosCtt = consultarDadosOficiaisCP7(valor);

            if (dadosCtt && autocompleteInstancia) {
                let centroAlvo = null;
                let raioBusca = 15000;

                if (typeof dadosCtt.lat === 'number' && typeof dadosCtt.lng === 'number' && dadosCtt.lat !== null) {
                    centroAlvo = { lat: dadosCtt.lat, lng: dadosCtt.lng };
                    raioBusca = 4000;
                } else {
                    const concelhoDetectado = (dadosCtt.concelho || obterConcelhoPorCodigoPostal(valor) || "SINTRA").toUpperCase();
                    centroAlvo = concelhoDetectado === "SINTRA" ? { lat: 38.8000, lng: -9.3800 } : { lat: 38.9369, lng: -9.3282 };
                }

                const circuloAlvo = new google.maps.Circle({ center: centroAlvo, radius: raioBusca });
                autocompleteInstancia.setBounds(circuloAlvo.getBounds());
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