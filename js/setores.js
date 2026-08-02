/**
 * setores.js
 * Faz: Controla o ecrã de Atribuição de Bricks, desenhando a árvore geográfica interativa de Mafra e Sintra e associando diretamente cada localidade (Brick) ao motorista selecionado de forma persistente.
 *      Preserva o estado de expansão das Freguesias e permite a seleção em lote de todos os Bricks de uma freguesia de uma só vez.
 *      Implementa avisos visuais de exclusividade táteis com cadeado vermelho e baixa opacidade em Bricks de outros motoristas.
 *      Desenha e atualiza nuvens de calor síncronas e estáveis no mapa geral do gestor com georreferenciação sob procura, cache local e balões explicativos (Hover).
 *      Limita o diâmetro dos círculos translúcidos de arrumação a exatamente 550 metros.
 *      NOVO: Suporta seletor de Concelho de operação (Mafra vs Sintra) com re-centralização do mapa e filtro inteligente de Bricks.
 *      NOVO: Filtra a lista esquerda de motoristas para apresentar apenas os autorizados no concelho selecionado.
 *      NOVO: Envia as atualizações dos Bricks em tempo real diretamente para o Firestore.
 *      MELHORADO: Apresenta o código postal ou o intervalo de códigos postais ao lado do nome de cada localidade (Brick) de forma legível.
 * NÃO faz: Não gere o registo direto de motoristas (motoristas.js) nem as coordenadas geográficas (maps.js).
 * Depende de: ./geografia-data.js, ./storage.js, ./motoristas.js, ./firebase-init.js (para aceder ao db)
 */

import { GEOGRAPHY } from './geografia-data.js';
import { saveData } from './storage.js';

// Importa a instância segura do Firestore
import { db } from './firebase-init.js';

// ID do motorista que está atualmente selecionado na interface para atribuição
let motoristaAtivoId = null;

// Concelho que está atualmente ativo na interface ("MAFRA" ou "SINTRA")
let concelhoAtivo = "MAFRA";

// Guarda o estado de expansão de cada freguesia para evitar que fechem ao clicar nos checkboxes
let freguesiasExpandidas = new Set();

// Instâncias internas seguras do mapa do gestor e balão de informação
let dashboardMap = null;
let dashboardOverlays = [];
let dashboardInfoWindow = null; // Instância única partilhada para balão de hover

// Cache local em memória RAM das coordenadas já geocodificadas para evitar chamadas redundantes ao Google
let brickCoordsCache = {};

// Carrega as coordenadas anteriormente guardadas do armazenamento persistente ao arrancar
try {
    const cached = localStorage.getItem('cp_brick_coords');
    if (cached) {
        brickCoordsCache = JSON.parse(cached);
    }
} catch (e) {
    console.warn("[PWA] Erro ao carregar cache local de coordenadas de Bricks:", e);
}

function salvarCacheCoordenadas() {
    try {
        localStorage.setItem('cp_brick_coords', JSON.stringify(brickCoordsCache));
    } catch (e) {
        console.warn("[PWA] Erro ao persistir cache local de coordenadas de Bricks:", e);
    }
}

// Coordenadas centrais aproximadas das Freguesias de Mafra e Sintra (funcionam como Fallback temporário)
const FREGUESIA_COORDS = {
    // ---- CONCELHO DE MAFRA ----
    "AZUEIRA": { lat: 38.9900, lng: -9.2500 },
    "CARVOEIRA MFR": { lat: 38.9300, lng: -9.4100 },
    "CHELEIROS": { lat: 38.8894, lng: -9.3283 },
    "ENCARNAÇÃO": { lat: 39.0200, lng: -9.3800 },
    "ENXARA DO BISPO": { lat: 38.9800, lng: -9.2300 },
    "ERICEIRA": { lat: 38.9628, lng: -9.4156 },
    "GRADIL": { lat: 38.9690, lng: -9.2840 },
    "IGREJA NOVA MFR": { lat: 38.9100, lng: -9.3400 },
    "MAFRA": { lat: 38.9376, lng: -9.3276 },
    "MALVEIRA": { lat: 38.9321, lng: -9.2578 },
    "MILHARADO": { lat: 38.9400, lng: -9.2000 },
    "SANTO ESTEVÃO DAS GALÉS": { lat: 38.8950, lng: -9.2450 },
    "SANTO ISIDORO MFR": { lat: 38.9900, lng: -9.3800 },
    "SOBRAL DA ABELHEIRA": { lat: 39.0100, lng: -9.2900 },
    "SÃO MIGUEL DE ALCAINÇA": { lat: 38.9400, lng: -9.2900 },
    "VENDA DO PINHEIRO": { lat: 38.9236, lng: -9.2318 },
    "VILA FRANCA DO ROSÁRIO": { lat: 38.9700, lng: -9.2500 },

    // ---- CONCELHO DE SINTRA ----
    "ALGUEIRÃO-MEM MARTINS": { lat: 38.7981, lng: -9.3400 },
    "ALMARGEM DO BISPO, PÊRO PINHEIRO E MONTELAVAR": { lat: 38.8500, lng: -9.3100 },
    "COLARES": { lat: 38.7997, lng: -9.4704 },
    "SÃO JOÃO DAS LAMPAS E TERRUGEM": { lat: 38.8600, lng: -9.4100 },
    "SINTRA (U.F.)": { lat: 38.8000, lng: -9.3800 }
};

// ==========================================
// CÁLCULO DE COORDENADAS JITTER DETERMINÍSTICO (NUVENS DE CALOR)
// ==========================================
function obterCoordenadaPrecisaBrick(freguesia, localidade) {
    const brickId = `${freguesia}|${localidade}`;

    // 1. Devolve instantaneamente se já estiver na cache local do dispositivo
    if (brickCoordsCache[brickId]) {
        return brickCoordsCache[brickId];
    }

    // 2. Fallback síncrono ultra-rápido (centroide de freguesia com desvio inteligente) para evitar lag
    const defaultCoords = concelhoAtivo === "SINTRA" ? { lat: 38.8000, lng: -9.3800 } : { lat: 38.9376, lng: -9.3276 };
    const base = FREGUESIA_COORDS[freguesia] || defaultCoords;
    let hash = 0;
    for (let i = 0; i < localidade.length; i++) {
        hash = localidade.charCodeAt(i) + ((hash << 5) - hash);
    }
    const latOffset = ((hash % 100) / 10000) - 0.005;
    const lngOffset = (((hash >> 8) % 100) / 10000) - 0.005;

    return {
        lat: base.lat + latOffset,
        lng: base.lng + lngOffset
    };
}

// ==========================================
// GEOCÓDIGO SOB PROCURA (ACIONADO EXCLUSIVAMENTE SOB PROCURA/INTERAÇÃO TÁTIL)
// ==========================================
function geocodificarBrickSobProcura(freguesia, localidade) {
    const brickId = `${freguesia}|${localidade}`;
    if (brickCoordsCache[brickId]) return; // Evita gastos se já estiver na cache

    if (typeof google !== 'undefined' && google.maps && google.maps.Geocoder) {
        const geocoder = new google.maps.Geocoder();
        const cleanFregName = freguesia.replace(/\s+MFR$/i, "").replace(/\s+\(U\.F\.\)$/i, "");
        const concelhoName = concelhoAtivo === "SINTRA" ? "Sintra" : "Mafra";
        const queryAddress = `${localidade}, ${cleanFregName}, ${concelhoName}, Portugal`;

        geocoder.geocode({ address: queryAddress }, (results, status) => {
            if (status === "OK" && results[0]) {
                const loc = results[0].geometry.location;
                brickCoordsCache[brickId] = { lat: loc.lat(), lng: loc.lng() };
                salvarCacheCoordenadas();

                // Redesenha reativamente o mapa apenas após o sucesso, movendo o circulo para o local real
                desenharBricksNoMapa();
            }
        });
    }
}

// =========================================================================
// INICIALIZAÇÃO DO MAPA GERAL DO GESTOR
// =========================================================================
function inicializarMapaBricksDashboard() {
    const mapEl = document.getElementById('map-dashboard-bricks');
    if (!mapEl || typeof google === 'undefined') return;

    const centerCoords = concelhoAtivo === "SINTRA" ? { lat: 38.8000, lng: -9.3800 } : { lat: 38.9500, lng: -9.3000 };

    if (!dashboardMap) {
        dashboardMap = new google.maps.Map(mapEl, {
            zoom: 11,
            center: centerCoords,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false
        });

        // Inicializa o balão partilhado de Hover
        dashboardInfoWindow = new google.maps.InfoWindow({
            disableAutoPan: true // Evita oscilação do mapa ao passar o rato rapidamente
        });
    } else {
        dashboardMap.setCenter(centerCoords);
        google.maps.event.trigger(dashboardMap, 'resize');
    }

    desenharBricksNoMapa();
}

// ==========================================
// DESENHAR NUVENS DE COR DE CADA MOTORISTA NO MAPA GERAL
// ==========================================
function desenharBricksNoMapa() {
    if (!dashboardMap) return;

    // Fecha o balão se estiver aberto para evitar órfãos em re-desenhos
    if (dashboardInfoWindow) {
        dashboardInfoWindow.close();
    }

    // Limpa desenhos e marcas antigas do mapa de forma síncrona
    dashboardOverlays.forEach(overlay => overlay.setMap(null));
    dashboardOverlays = [];

    // Mapeamento síncrono e de acordo com o concelho selecionado
    window.drivers.forEach(drv => {
        const bIds = Array.isArray(drv.brickIds) ? drv.brickIds : [];
        bIds.forEach(id => {
            if (id.includes('|')) {
                const [freg, loc] = id.split('|');

                // Filtro dinâmico: Verifica se a freguesia do brick pertence ao concelho selecionado
                // Isto evita que as nuvens de Mafra surjam misturadas com as de Sintra no mapa
                if (!GEOGRAPHY[concelhoAtivo] || !GEOGRAPHY[concelhoAtivo][freg]) {
                    return; // Ignora o brick se for de outro concelho
                }

                const coords = obterCoordenadaPrecisaBrick(freg, loc);

                // Círculo Translúcido de Atribuição (Raio limitado a exatamente 550 metros)
                const circle = new google.maps.Circle({
                    strokeColor: drv.color,
                    strokeOpacity: 0.6,
                    strokeWeight: 1,
                    fillColor: drv.color,
                    fillOpacity: 0.2, // Visual nebuloso ultra-agradável
                    map: dashboardMap,
                    center: coords,
                    radius: 550
                });
                dashboardOverlays.push(circle);

                // Ouvinte de passagem de rato (Hover) sobre o círculo para mostrar balão explicativo instantâneo
                circle.addListener('mouseover', () => {
                    if (dashboardInfoWindow) {
                        dashboardInfoWindow.setContent(`
                            <div style="font-family: system-ui, sans-serif; font-size: 11px; padding: 2px 4px; line-height: 1.4;">
                                <div style="font-weight: bold; color: #1F2937; margin-bottom: 2px;">${freg} - ${loc}</div>
                                <div style="display: flex; align-items: center; gap: 4px;">
                                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${drv.color};"></span>
                                    <span style="color: ${drv.color}; font-weight: bold; font-size: 10px; text-transform: uppercase;">Estante de: ${drv.name}</span>
                                </div>
                            </div>
                        `);
                        dashboardInfoWindow.setPosition(coords);
                        dashboardInfoWindow.open(dashboardMap);
                    }
                });

                circle.addListener('mouseout', () => {
                    if (dashboardInfoWindow) {
                        dashboardInfoWindow.close();
                    }
                });

                // Pequeno ponto de ancoragem no centro da nuvem
                const marker = new google.maps.Marker({
                    position: coords,
                    map: dashboardMap,
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 4,
                        fillColor: drv.color,
                        fillOpacity: 0.9,
                        strokeWeight: 1,
                        strokeColor: "#FFFFFF"
                    },
                    title: `${freg} - ${loc} (${drv.name})`
                });
                dashboardOverlays.push(marker);
            }
        });
    });
}

// =========================================================================
// RENDERIZAÇÃO DA LISTA DE MOTORISTAS NO PAINEL DE ATRIBUIÇÃO
// =========================================================================
export function renderDriversForAttribution() {
    const listContainer = document.getElementById('lista-atribuicao-motoristas');
    if (!listContainer) return;

    listContainer.innerHTML = "";

    // NOVO & MELHORADO (Filtro de Usabilidade): 
    // Mostra apenas os motoristas habilitados a atuar no concelho de operação selecionado no topo.
    const filteredDrivers = window.drivers.filter(driver => {
        const concelhos = Array.isArray(driver.concelhos) ? driver.concelhos : ["MAFRA"];
        return concelhos.includes(concelhoAtivo);
    });

    if (filteredDrivers.length === 0) {
        listContainer.innerHTML = `
            <p class="text-xs text-gray-400 italic text-center py-6 px-4 bg-gray-50 border border-dashed rounded-lg">
                Nenhum motorista registado em ${concelhoAtivo.charAt(0) + concelhoAtivo.slice(1).toLowerCase()}.
            </p>`;
        return;
    }

    filteredDrivers.forEach(driver => {
        const brickCount = Array.isArray(driver.brickIds) ? driver.brickIds.length : 0;
        const btn = document.createElement('button');
        btn.type = "button";
        
        // Estilo visual destacado se for o motorista atualmente ativo
        if (motoristaAtivoId === driver.id) {
            btn.className = "w-full flex items-center justify-between p-3 rounded-lg border-2 text-left bg-blue-50 border-blue-500 shadow-xs transition duration-150";
        } else {
            btn.className = "w-full flex items-center justify-between p-3 rounded-lg border border-gray-200 text-left bg-gray-50/50 hover:bg-gray-50 active:bg-gray-100 transition duration-150";
        }

        btn.innerHTML = `
            <div class="flex items-center space-x-2 truncate">
                <span class="w-3 h-3 rounded-full border shadow-sm flex-shrink-0" style="background-color: ${driver.color}"></span>
                <span class="font-bold text-gray-700 text-xs truncate">${driver.name}</span>
            </div>
            <span class="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-blue-100/50 text-blue-700 border border-blue-200 flex-shrink-0">
                ${brickCount} Bricks
            </span>
        `;

        btn.addEventListener('click', () => {
            motoristaAtivoId = driver.id;
            renderDriversForAttribution(); // Atualiza destaque
            window.renderizarSetoresUI(); // Atualiza a árvore para as caixas deste motorista
        });

        listContainer.appendChild(btn);
    });
}

// ==========================================
// AUXILIAR: FORMATAR INTERVALO OU CÓDIGO POSTAL ÚNICO
// ==========================================
function formatarIntervaloCPs(cpList) {
    if (!Array.isArray(cpList) || cpList.length === 0) return "";
    if (cpList.length === 1) return `(${cpList[0]})`;

    // Ordena os códigos postais para obtermos o menor e o maior limite de forma síncrona
    const ordenados = [...cpList].sort((a, b) => a.localeCompare(b));
    const min = ordenados[0];
    const max = ordenados[ordenados.length - 1];

    return `(${min} a ${max})`;
}

// =========================================================================
// DESENHO DA ÁRVORE HIERÁRQUICA E CONTROLO REATIVO DE ATRIBUIÇÃO DE BRICKS
// =========================================================================
export function renderGeographicTree() {
    const treeContainer = document.getElementById('arvore-bricks-localidades');
    const labelSelected = document.getElementById('label-motorista-selecionado');
    if (!treeContainer) return;

    treeContainer.innerHTML = "";

    const activeDriver = window.drivers.find(d => d.id === motoristaAtivoId);

    // Se nenhum motorista estiver selecionado na lista esquerda, bloqueia a árvore com aviso amigável
    if (!activeDriver) {
        labelSelected.className = "text-[10px] font-black uppercase bg-red-100 text-red-700 px-2 py-0.5 rounded border border-red-200";
        labelSelected.textContent = "Nenhum Selecionado";
        treeContainer.innerHTML = `
            <div class="text-center py-10 space-y-2">
                <i class="fa-solid fa-hand-pointer text-gray-300 text-3xl"></i>
                <p class="text-xs text-gray-400 font-bold italic">Selecione um motorista à esquerda para começar a associar Bricks.</p>
            </div>
        `;
        return;
    }

    // Identifica o motorista ativo e mostra-o no topo do painel
    labelSelected.className = "text-[10px] font-black uppercase bg-blue-100 text-blue-800 px-2 py-0.5 rounded border border-blue-200";
    labelSelected.textContent = activeDriver.name;

    const concelho = concelhoAtivo;
    
    // Verificação de segurança caso o concelho selecionado não exista na base de dados
    if (!GEOGRAPHY[concelho]) {
        treeContainer.innerHTML = '<p class="text-xs text-red-500 italic text-center py-4">Erro: Concelho não configurado.</p>';
        return;
    }

    const freguesiasList = Object.keys(GEOGRAPHY[concelho]).sort();

    // Mapeia onde está cada localidade para mostrar avisos de exclusividade tátil
    const localidadeParaMotorista = new Map();
    window.drivers.forEach(drv => {
        const bIds = Array.isArray(drv.brickIds) ? drv.brickIds : [];
        bIds.forEach(id => {
            localidadeParaMotorista.set(id, drv);
        });
    });

    freguesiasList.forEach(freguesiaName => {
        const localidadesMap = GEOGRAPHY[concelho][freguesiaName];
        const localidadesKeys = Object.keys(localidadesMap).sort();

        // Verifica se todas as localidades desta freguesia pertencem a este motorista
        const allLocs = Object.keys(localidadesMap);
        const ownedLocs = allLocs.filter(locName => {
            const brickId = `${freguesiaName}|${locName}`;
            return Array.isArray(activeDriver.brickIds) && activeDriver.brickIds.includes(brickId);
        });
        const isAllOwned = allLocs.length > 0 && ownedLocs.length === allLocs.length;

        // Recupera o estado de expansão desta freguesia
        const isExpanded = freguesiasExpandidas.has(freguesiaName);

        const fregDiv = document.createElement('div');
        fregDiv.className = "border rounded-lg bg-white overflow-hidden shadow-xs border-gray-200";

        const header = document.createElement('div');
        header.className = "flex items-center justify-between p-2.5 bg-gray-50 border-b select-none";

        header.innerHTML = `
            <div class="flex items-center space-x-2">
                <button type="button" class="btn-expand-tree text-gray-500 hover:text-blue-600 font-mono text-[10px] px-2 py-0.5 rounded border bg-white focus:outline-none shadow-sm transition flex items-center space-x-1">
                    ${isExpanded 
                        ? "<span><i class='fa-solid fa-minus mr-0.5'></i> Recolher</span>" 
                        : "<span><i class='fa-solid fa-plus mr-0.5'></i> Expandir</span>"
                    }
                </button>
                <div class="flex items-center space-x-1.5">
                    <!-- Checkbox de seleção rápida de Freguesia inteira -->
                    <input type="checkbox" ${isAllOwned ? 'checked' : ''} class="freg-checkbox rounded text-blue-600 focus:ring-blue-500 border-gray-300 w-4 h-4 cursor-pointer">
                    <span class="font-bold text-gray-700 text-xs">${freguesiaName}</span>
                </div>
            </div>
            <span class="text-[9px] text-gray-400 font-semibold">${localidadesKeys.length} Bricks</span>
        `;

        const subContainer = document.createElement('div');
        // Mantém a visibilidade da pasta de acordo com a memória de expansão
        subContainer.className = `${isExpanded ? '' : 'hidden'} p-2 bg-gray-50/50 border-t border-dashed space-y-2.5 pl-6 animate-fade-in`;

        localidadesKeys.forEach(locName => {
            const brickId = `${freguesiaName}|${locName}`;
            const motoristaDono = localidadeParaMotorista.get(brickId);

            const isAssignedToActive = Array.isArray(activeDriver.brickIds) && activeDriver.brickIds.includes(brickId);

            // Determina a lista de códigos postais para esta localidade e formata o seu intervalo
            const cpList = localidadesMap[locName] || [];
            const cpTexto = formatarIntervaloCPs(cpList);

            const label = document.createElement('label');

            if (motoristaDono && motoristaDono.id !== activeDriver.id) {
                // Se a localidade já estiver sob a responsabilidade de outro motorista
                label.className = "flex items-center justify-between p-2 rounded bg-red-50/20 text-gray-400 cursor-not-allowed select-none text-[11px] border border-red-100/10 opacity-70";
                label.innerHTML = `
                    <div class="flex items-center space-x-2 truncate pr-2">
                        <i class="fa-solid fa-lock text-red-400 text-[10px] animate-none"></i>
                        <input type="checkbox" disabled class="rounded text-gray-300 border-gray-200 w-3.5 h-3.5 cursor-not-allowed">
                        <span class="font-bold text-gray-400 line-through truncate">${locName}</span>
                        <span class="text-[9px] text-gray-400 font-mono font-normal ml-1 shrink-0">${cpTexto}</span>
                    </div>
                    <span class="text-[8px] font-black uppercase px-2 py-0.5 rounded border flex items-center space-x-1 shrink-0" style="background-color: ${motoristaDono.color}15; color: ${motoristaDono.color}; border-color: ${motoristaDono.color}30">
                        <i class="fa-solid fa-user text-[7px]"></i> <span>Com: ${motoristaDono.name}</span>
                    </span>
                `;
            } else {
                // Se estiver livre ou já for deste motorista selecionado
                label.className = "flex items-center justify-between p-2 rounded hover:bg-white border border-transparent hover:border-gray-200 cursor-pointer text-[11px] text-gray-700 transition duration-100";
                label.innerHTML = `
                    <div class="flex items-center space-x-2 truncate pr-2">
                        <input type="checkbox" value="${brickId}" ${isAssignedToActive ? 'checked' : ''} class="brick-checkbox rounded text-blue-600 focus:ring-blue-500 border-gray-300 w-3.5 h-3.5 cursor-pointer">
                        <span class="font-bold text-gray-600 truncate">${locName}</span>
                        <span class="text-[9px] text-gray-400 font-mono font-normal ml-1 shrink-0">${cpTexto}</span>
                    </div>
                    ${isAssignedToActive 
                        ? `<span class="text-[8px] bg-blue-50 text-blue-700 font-extrabold px-1.5 py-0.5 rounded border border-blue-200 shrink-0">Associado</span>`
                        : `<span class="text-[8px] bg-green-50 text-green-700 font-extrabold px-1.5 py-0.5 rounded border border-green-200 shrink-0">Livre</span>`
                    }
                `;

                // Guarda reativamente a alteração com um simples clique (GRAVAÇÃO DIRETA NO FIRESTORE!)
                const cb = label.querySelector('.brick-checkbox');
                cb.addEventListener('change', (e) => {
                    if (!Array.isArray(activeDriver.brickIds)) {
                        activeDriver.brickIds = [];
                    }

                    let updatedBrickIds = [...activeDriver.brickIds];
                    if (e.target.checked) {
                        updatedBrickIds.push(brickId);
                        
                        // Geocodifica sob procura apenas a localidade interada, evitando sobrecarga
                        geocodificarBrickSobProcura(freguesiaName, locName);
                    } else {
                        updatedBrickIds = updatedBrickIds.filter(id => id !== brickId);
                    }

                    // Grava diretamente no Firestore no documento do motorista correspondente
                    db.collection('drivers').doc(activeDriver.id).update({
                        brickIds: updatedBrickIds
                    }).then(() => {
                        console.log("[FIREBASE] Bricks do motorista sincronizados no Firestore.");
                    }).catch((err) => {
                        console.error("[FIREBASE] Erro ao sincronizar Bricks:", err);
                        alert("Erro de ligação: Não foi possível guardar as alterações.");
                    });
                });
            }

            subContainer.appendChild(label);
        });

        // Evento de alteração em lote de toda a Freguesia (GRAVAÇÃO DIRETA NO FIRESTORE!)
        const fregCb = header.querySelector('.freg-checkbox');
        if (fregCb) {
            fregCb.addEventListener('change', (e) => {
                if (!Array.isArray(activeDriver.brickIds)) {
                    activeDriver.brickIds = [];
                }

                let updatedBrickIds = [...activeDriver.brickIds];
                let delayPacing = 0; // Atraso progressivo para evitar over limit

                allLocs.forEach(locName => {
                    const brickId = `${freguesiaName}|${locName}`;
                    const motoristaDono = localidadeParaMotorista.get(brickId);
                    const isOwnedByOther = motoristaDono && motoristaDono.id !== activeDriver.id;

                    if (e.target.checked) {
                        // Associa em lote apenas as localidades que estão realmente livres
                        if (!isOwnedByOther && !updatedBrickIds.includes(brickId)) {
                            updatedBrickIds.push(brickId);

                            // Geocodifica com compassamento de 300ms entre localidades para respeitar o Google
                            setTimeout(() => {
                                geocodificarBrickSobProcura(freguesiaName, locName);
                            }, delayPacing);
                            delayPacing += 300;
                        }
                    } else {
                        // Remove todas as localidades desta freguesia que pertenciam a este motorista
                        updatedBrickIds = updatedBrickIds.filter(id => id !== brickId);
                    }
                });

                // Envia a lista atualizada de uma só vez para o Firestore
                db.collection('drivers').doc(activeDriver.id).update({
                    brickIds: updatedBrickIds
                }).then(() => {
                    console.log("[FIREBASE] Alterações de Bricks em lote sincronizadas no Firestore.");
                }).catch((err) => {
                    console.error("[FIREBASE] Erro ao sincronizar Bricks em lote:", err);
                    alert("Erro de ligação: Não foi possível guardar as alterações.");
                });
            });
        }

        fregDiv.appendChild(header);
        fregDiv.appendChild(subContainer);
        treeContainer.appendChild(fregDiv);

        const btnExpand = header.querySelector('.btn-expand-tree');
        btnExpand.addEventListener('click', (e) => {
            e.stopPropagation();
            if (subContainer.classList.contains('hidden')) {
                subContainer.classList.remove('hidden');
                freguesiasExpandidas.add(freguesiaName);
                btnExpand.innerHTML = "<span><i class='fa-solid fa-minus mr-0.5'></i> Recolher</span>";
            } else {
                subContainer.classList.add('hidden');
                freguesiasExpandidas.delete(freguesiaName);
                btnExpand.innerHTML = "<span><i class='fa-solid fa-plus mr-0.5'></i> Expandir</span>";
            }
        });
    });
}

// =========================================================================
// CENTRALIZAÇÃO E ATUALIZAÇÃO DA INTERFACE DE SETORES E BRICKS (WINDOW)
// =========================================================================
window.renderizarSetoresUI = () => {
    // Configura o seletor de concelho (Mafra vs Sintra)
    const seletorConcelho = document.getElementById('select-concelho-setores');
    if (seletorConcelho) {
        seletorConcelho.value = concelhoAtivo;
        if (!seletorConcelho.dataset.listenerAtivo) {
            seletorConcelho.addEventListener('change', (e) => {
                concelhoAtivo = e.target.value;
                
                // Limpa o estado de expansão ao mudar de concelho para evitar árvores inconsistentes
                freguesiasExpandidas.clear();

                // NOVO & MELHORADO: Limpa o motorista ativo para garantir que não tentamos gerir 
                // bricks com um motorista não habilitado no novo concelho
                motoristaAtivoId = null;

                // Recenterabilidade síncrona do mapa
                if (dashboardMap) {
                    const centerCoords = concelhoAtivo === "SINTRA" ? { lat: 38.8000, lng: -9.3800 } : { lat: 38.9500, lng: -9.3000 };
                    dashboardMap.setCenter(centerCoords);
                }

                // Renderização reativa de toda a UI
                window.renderizarSetoresUI();
            });
            seletorConcelho.dataset.listenerAtivo = "true";
        }
    }

    // Sincroniza a listagem de motoristas no painel de atribuição (filtrada dinamicamente)
    renderDriversForAttribution();

    // Renderiza a árvore do concelho ativo reativa (Mafra ou Sintra)
    renderGeographicTree();

    // Inicializa e redesenha o mapa de forma síncrona estável
    setTimeout(inicializarMapaBricksDashboard, 150);
};
