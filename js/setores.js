/**
 * setores.js
 * Faz: Controla o ecrã de Atribuição de Bricks, desenhando a árvore geográfica interativa de Mafra e Sintra e associando diretamente cada localidade (Brick) ao motorista selecionado de forma persistente.
 *      Preserva o estado de expansão das Freguesias e permite a seleção em lote de todos os Bricks de uma freguesia de uma só vez.
 *      Implementa avisos visuais de exclusividade táteis com cadeado vermelho e baixa opacidade em Bricks de outros motoristas.
 *      Desenha e atualiza pins coloridos e leves no mapa geral do gestor com georreferenciação sob procura, cache local e balões explicativos (Hover).
 *      NOVO: Mapeamento de IDs normalizado (Case-Insensitive) para corrigir falhas de leitura de Bricks já atribuídos.
 *      NOVO: Mensagem de confirmação tátil antes de atribuir ou retirar qualquer Brick (individual ou em lote).
 * NÃO faz: Não gere o registo direto de motoristas (motoristas.js) nem as coordenadas geográficas (maps.js).
 * Depende de: ./geografia-data.js, ./storage.js, ./motoristas.js, ./firebase-init.js (para aceder ao db)
 */

import { GEOGRAPHY, obterEnderecoHigienizado } from './geografia-data.js';
import { saveData } from './storage.js';

// Importa a instância ativa do Firestore
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

// =========================================================================
// AUXILIAR DE COMPATIBILIDADE E ROBUSTEZ: NORMALIZADOR DE IDS (CASE-INSENSITIVE)
// =========================================================================
function normalizarBrickId(id) {
    if (!id || typeof id !== 'string') return "";
    // Limpa espaços extras e força maiúsculas para que "Sintra" e "SINTRA" coincidam 100%
    return id.toUpperCase().trim();
}

// ==========================================
// SINCRONIZAÇÃO DA CACHE PARTILHADA DE COORDENADAS (FIRESTORE)
// ==========================================
let cacheFirestoreSincronizada = false;

async function carregarCacheCoordenadasFirestore() {
    if (cacheFirestoreSincronizada) return;
    try {
        const snapshot = await db.collection('brickCoordinates').get();
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data && typeof data.lat === 'number' && typeof data.lng === 'number') {
                brickCoordsCache[doc.id] = { lat: data.lat, lng: data.lng };
            }
        });
        salvarCacheCoordenadas();
        cacheFirestoreSincronizada = true;
    } catch (e) {
        console.warn("[PWA] Não foi possível sincronizar a cache partilhada de coordenadas de Bricks:", e);
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
// CÁLCULO DE COORDENADAS JITTER DETERMINÍSTICO (DISPERSÃO DE RECURSO)
// ==========================================
function obterCoordenadaPrecisaBrick(freguesia, localidade) {
    const brickId = `${freguesia}|${localidade}`;

    if (brickCoordsCache[brickId]) {
        return brickCoordsCache[brickId];
    }

    const defaultCoords = concelhoAtivo === "SINTRA" ? { lat: 38.8000, lng: -9.3800 } : { lat: 38.9376, lng: -9.3276 };
    const base = FREGUESIA_COORDS[normalizarBrickId(freguesia)] || FREGUESIA_COORDS[freguesia] || defaultCoords;
    let hash = 0;
    for (let i = 0; i < localidade.length; i++) {
        hash = localidade.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const latOffset = (((hash % 100) - 50) / 4000);
    const lngOffset = ((((hash >> 8) % 100) - 50) / 4000);

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
    if (brickCoordsCache[brickId]) return;

    if (typeof google !== 'undefined' && google.maps && google.maps.Geocoder) {
        const geocoder = new google.maps.Geocoder();
        
        const cpList = (GEOGRAPHY[concelhoAtivo] && GEOGRAPHY[concelhoAtivo][freguesia]) 
            ? GEOGRAPHY[concelhoAtivo][freguesia][localidade] || [] 
            : [];
            
        const queryAddress = obterEnderecoHigienizado(localidade, cpList, freguesia, concelhoAtivo);

        geocoder.geocode({ address: queryAddress }, (results, status) => {
            if (status === "OK" && results[0]) {
                const loc = results[0].geometry.location;
                const coordsResolvidas = { lat: loc.lat(), lng: loc.lng() };
                brickCoordsCache[brickId] = coordsResolvidas;
                salvarCacheCoordenadas();

                db.collection('brickCoordinates').doc(brickId).set(coordsResolvidas).catch((err) => {
                    console.warn("[PWA] Falha ao partilhar coordenada de Brick via Firestore:", err);
                });

                desenharBricksNoMapa();
            } else {
                console.warn(`[PWA] Não foi possível geocodificar "${queryAddress}". Caching fallback.`);
                const fallbackCoords = obterCoordenadaPrecisaBrick(freguesia, localidade);
                brickCoordsCache[brickId] = fallbackCoords;
                salvarCacheCoordenadas();
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

        dashboardInfoWindow = new google.maps.InfoWindow({
            disableAutoPan: true
        });

        carregarCacheCoordenadasFirestore().then(() => desenharBricksNoMapa());
    } else {
        dashboardMap.setCenter(centerCoords);
        google.maps.event.trigger(dashboardMap, 'resize');
    }

    desenharBricksNoMapa();
}

// ==========================================
// DESENHAR OS PINS GEOGRÁFICOS DE CADA MOTORISTA NO MAPA GERAL
// ==========================================
function desenharBricksNoMapa() {
    if (!dashboardMap) return;

    if (dashboardInfoWindow) {
        dashboardInfoWindow.close();
    }

    dashboardOverlays.forEach(overlay => overlay.setMap(null));
    dashboardOverlays = [];

    const driversArr = Array.isArray(window.drivers) ? window.drivers : [];

    const bounds = new google.maps.LatLngBounds();
    let totalPontosDesenhados = 0;

    driversArr.forEach(drv => {
        const bIds = Array.isArray(drv.brickIds) ? drv.brickIds : [];
        bIds.forEach(id => {
            if (id && typeof id === 'string' && id.includes('|')) {
                const [freg, loc] = id.split('|');

                if (!GEOGRAPHY[concelhoAtivo] || !GEOGRAPHY[concelhoAtivo][freg] || !GEOGRAPHY[concelhoAtivo][freg][loc]) {
                    return; 
                }

                const coords = obterCoordenadaPrecisaBrick(freg, loc);
                bounds.extend(coords);
                totalPontosDesenhados++;

                const pinSvgPath = "M12 2C8.14 2 5 5.14 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.86-3.14-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z";

                const marker = new google.maps.Marker({
                    position: coords,
                    map: dashboardMap,
                    icon: {
                        path: pinSvgPath,
                        fillColor: drv.color,
                        fillOpacity: 1.0,
                        strokeWeight: 1,
                        strokeColor: "#FFFFFF",
                        scale: 1.2,
                        anchor: new google.maps.Point(12, 22)
                    },
                    title: `${freg} - ${loc} (${drv.name})`
                });
                dashboardOverlays.push(marker);

                marker.addListener('mouseover', () => {
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
                        dashboardInfoWindow.open(dashboardMap, marker);
                    }
                });

                marker.addListener('mouseout', () => {
                    if (dashboardInfoWindow) {
                        dashboardInfoWindow.close();
                    }
                });
            }
        });
    });

    if (totalPontosDesenhados > 0) {
        dashboardMap.fitBounds(bounds);

        google.maps.event.addListenerOnce(dashboardMap, 'bounds_changed', function () {
            if (dashboardMap.getZoom() > 15) {
                dashboardMap.setZoom(15);
            }
        });
    }
}

// =========================================================================
// RENDERIZAÇÃO DA LISTA DE MOTORISTAS NO PAINEL DE ATRIBUIÇÃO
// =========================================================================
export function renderDriversForAttribution() {
    const listContainer = document.getElementById('lista-atribuicao-motoristas');
    if (!listContainer) return;

    listContainer.innerHTML = "";

    const driversArr = Array.isArray(window.drivers) ? window.drivers : [];

    const filteredDrivers = driversArr.filter(driver => {
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
            renderDriversForAttribution();
            window.renderizarSetoresUI();
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

    const ordenados = [...cpList].sort((a, b) => a.localeCompare(b));
    const min = ordenados[0];
    const max = ordenados[ordenados.length - 1];

    return `(${min} a ${max})`;
}

// =========================================================================
// COMPUTAÇÃO EM TEMPO REAL: AUDITORIA DE BRICKS NÃO ALOCADOS (SALDO ZERO)
// =========================================================================
function atualizarAuditoriaBricks() {
    const concelho = concelhoAtivo;
    const elTotal = document.getElementById('stat-total-bricks');
    const elAlocados = document.getElementById('stat-alocados-bricks');
    const elSaldo = document.getElementById('stat-saldo-bricks');
    const elLabelSaldo = document.getElementById('label-saldo-bricks');
    const elCardSaldo = document.getElementById('card-saldo-bricks');
    const elBadgeStatus = document.getElementById('badge-saldo-status');
    const elContainerPendentes = document.getElementById('container-bricks-pendentes');
    const elListaPendentes = document.getElementById('lista-bricks-pendentes');

    if (!elTotal || !elAlocados || !elSaldo) return;

    const todosBricksDoConcelho = [];
    if (GEOGRAPHY[concelho]) {
        for (const [freguesia, localidades] of Object.entries(GEOGRAPHY[concelho])) {
            for (const localidade of Object.keys(localidades)) {
                todosBricksDoConcelho.push(`${freguesia}|${localidade}`);
            }
        }
    }

    const bricksAlocadosSet = new Set();
    const driversArr = Array.isArray(window.drivers) ? window.drivers : [];

    driversArr.forEach(drv => {
        const bIds = Array.isArray(drv.brickIds) ? drv.brickIds : [];
        bIds.forEach(id => {
            if (id && typeof id === 'string' && id.includes('|')) {
                const [freg, loc] = id.split('|');
                
                // Normaliza a validação contra o concelho ativo para máxima robustez
                if (GEOGRAPHY[concelho] && GEOGRAPHY[concelho][freg] && GEOGRAPHY[concelho][freg][loc]) {
                    bricksAlocadosSet.add(normalizarBrickId(id));
                }
            }
        });
    });

    const bricksOrfaos = todosBricksDoConcelho.filter(id => !bricksAlocadosSet.has(normalizarBrickId(id)));

    const totalCount = todosBricksDoConcelho.length;
    const alocadosCount = bricksAlocadosSet.size;
    const saldoCount = bricksOrfaos.length;

    elTotal.textContent = totalCount;
    elAlocados.textContent = alocadosCount;
    elSaldo.textContent = saldoCount;

    if (saldoCount === 0) {
        if (elBadgeStatus) {
            elBadgeStatus.className = "text-[9px] font-black uppercase px-2 py-0.5 rounded border bg-green-50 text-green-700 border-green-200 animate-none";
            elBadgeStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>Saldo Zero (100% Coberto)</span>`;
        }
        if (elCardSaldo) {
            elCardSaldo.className = "bg-green-50 p-2.5 rounded-xl border border-green-200";
        }
        elSaldo.className = "block text-base font-black text-green-600";
        if (elLabelSaldo) {
            elLabelSaldo.textContent = "Sem Alocar";
            elLabelSaldo.className = "text-[9px] font-bold text-green-500 uppercase";
        }
        if (elContainerPendentes) elContainerPendentes.classList.add('hidden');
        if (elListaPendentes) elListaPendentes.innerHTML = "";
    } else {
        if (elBadgeStatus) {
            elBadgeStatus.className = "text-[9px] font-black uppercase px-2 py-0.5 rounded border bg-red-50 text-red-700 border-red-200 animate-pulse";
            elBadgeStatus.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>Cobertura Incompleta</span>`;
        }
        if (elCardSaldo) {
            elCardSaldo.className = "bg-red-50 p-2.5 rounded-xl border border-red-200";
        }
        elSaldo.className = "block text-base font-black text-red-600";
        if (elLabelSaldo) {
            elLabelSaldo.textContent = "Sem Alocar";
            elLabelSaldo.className = "text-[9px] font-bold text-red-500 uppercase";
        }

        if (elContainerPendentes) elContainerPendentes.classList.remove('hidden');
        if (elListaPendentes) {
            elListaPendentes.innerHTML = "";
            bricksOrfaos.forEach(id => {
                const [freg, loc] = id.split('|');
                const itemDiv = document.createElement('div');
                itemDiv.className = "flex items-center space-x-1.5 p-1.5 bg-red-50/50 border border-red-100 rounded text-red-700 truncate";
                itemDiv.innerHTML = `
                    <i class="fa-solid fa-circle-xmark text-[9px] text-red-400 shrink-0"></i>
                    <span class="truncate" title="${freg} - ${loc}">${freg} - ${loc}</span>
                `;
                elListaPendentes.appendChild(itemDiv);
            });
        }
    }
}

// =========================================================================
// DESENHO DA ÁRVORE HIERÁRQUICA E CONTROLO REATIVO DE ATRIBUIÇÃO DE BRICKS
// =========================================================================
export function renderGeographicTree() {
    const treeContainer = document.getElementById('arvore-bricks-localidades');
    const labelSelected = document.getElementById('label-motorista-selecionado');
    if (!treeContainer) return;

    treeContainer.innerHTML = "";

    const driversArr = Array.isArray(window.drivers) ? window.drivers : [];
    const activeDriver = driversArr.find(d => d.id === motoristaAtivoId);

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

    labelSelected.className = "text-[10px] font-black uppercase bg-blue-100 text-blue-800 px-2 py-0.5 rounded border border-blue-200";
    labelSelected.textContent = activeDriver.name;

    const concelho = concelhoAtivo;
    
    if (!GEOGRAPHY[concelho]) {
        treeContainer.innerHTML = '<p class="text-xs text-red-500 italic text-center py-4">Erro: Concelho não configurado.</p>';
        return;
    }

    const freguesiasList = Object.keys(GEOGRAPHY[concelho]).sort();

    // Map estruturado e normalizado (Case-Insensitive) para ler instantaneamente o motorista dono de cada localidade
    const localidadeParaMotorista = new Map();
    driversArr.forEach(drv => {
        const bIds = Array.isArray(drv.brickIds) ? drv.brickIds : [];
        bIds.forEach(id => {
            if (id && typeof id === 'string') {
                // Guarda a chave sempre normalizada (Maiúsculas) para eliminar o bug visual do ecrã
                localidadeParaMotorista.set(normalizarBrickId(id), drv);
            }
        });
    });

    freguesiasList.forEach(freguesiaName => {
        const localidadesMap = GEOGRAPHY[concelho][freguesiaName];
        const localidadesKeys = Object.keys(localidadesMap).sort();

        const allLocs = Object.keys(localidadesMap);
        const ownedLocs = allLocs.filter(locName => {
            const brickId = `${freguesiaName}|${locName}`;
            const normalizedBid = normalizarBrickId(brickId);
            return Array.isArray(activeDriver.brickIds) && 
                activeDriver.brickIds.map(id => normalizarBrickId(id)).includes(normalizedBid);
        });
        const isAllOwned = allLocs.length > 0 && ownedLocs.length === allLocs.length;

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
                    <input type="checkbox" ${isAllOwned ? 'checked' : ''} class="freg-checkbox rounded text-blue-600 focus:ring-blue-500 border-gray-300 w-4 h-4 cursor-pointer">
                    <span class="font-bold text-gray-700 text-xs">${freguesiaName}</span>
                </div>
            </div>
            <span class="text-[9px] text-gray-400 font-semibold">${localidadesKeys.length} Bricks</span>
        `;

        const subContainer = document.createElement('div');
        subContainer.className = `${isExpanded ? '' : 'hidden'} p-2 bg-gray-50/50 border-t border-dashed space-y-2.5 pl-6 animate-fade-in`;

        localidadesKeys.forEach(locName => {
            const brickId = `${freguesiaName}|${locName}`;
            const normalizedBid = normalizarBrickId(brickId);
            
            // Leitura segura baseada na chave normalizada (Case-Insensitive)
            const motoristaDono = localidadeParaMotorista.get(normalizedBid);

            const isAssignedToActive = Array.isArray(activeDriver.brickIds) && 
                activeDriver.brickIds.map(id => normalizarBrickId(id)).includes(normalizedBid);

            const cpList = localidadesMap[locName] || [];
            const cpTexto = formatarIntervaloCPs(cpList);

            const label = document.createElement('label');

            // CORREÇÃO USABILIDADE: Se pertencer a outro motorista, fica trancado de forma visível
            if (motoristaDono && motoristaDono.id !== activeDriver.id) {
                label.className = "flex items-center justify-between p-2 rounded bg-gray-100/50 text-gray-400 cursor-not-allowed select-none text-[11px] border border-gray-200 opacity-60";
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

                const cb = label.querySelector('.brick-checkbox');
                cb.addEventListener('change', (e) => {
                    const checkedState = e.target.checked;
                    const acao = checkedState ? "atribuir" : "retirar";
                    
                    // NOVO: Mensagem de confirmação tátil antes de gravar no banco de dados
                    const confirmar = confirm(`Tem a certeza que deseja ${acao} o Brick "${locName}" do motorista "${activeDriver.name}"?`);
                    if (!confirmar) {
                        e.target.checked = !checkedState; // Reverte a checkbox na UI
                        return;
                    }

                    if (!Array.isArray(activeDriver.brickIds)) {
                        activeDriver.brickIds = [];
                    }

                    let updatedBrickIds = [...activeDriver.brickIds];
                    if (checkedState) {
                        updatedBrickIds.push(brickId);
                        geocodificarBrickSobProcura(freguesiaName, locName);
                    } else {
                        // Faz a filtragem normalizada para garantir a exclusão correta
                        updatedBrickIds = updatedBrickIds.filter(id => normalizarBrickId(id) !== normalizedBid);
                    }

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

        const fregCb = header.querySelector('.freg-checkbox');
        if (fregCb) {
            fregCb.addEventListener('change', (e) => {
                const checkedState = e.target.checked;
                const acao = checkedState ? "atribuir em lote" : "retirar em lote";
                
                // NOVO: Mensagem de confirmação em lote de segurança
                const confirmar = confirm(`Tem a certeza que deseja ${acao} todos os Bricks livres da freguesia "${freguesiaName}" para o motorista "${activeDriver.name}"?`);
                if (!confirmar) {
                    e.target.checked = !checkedState;
                    return;
                }

                if (!Array.isArray(activeDriver.brickIds)) {
                    activeDriver.brickIds = [];
                }

                let updatedBrickIds = [...activeDriver.brickIds];
                let delayPacing = 0;

                allLocs.forEach(locName => {
                    const brickId = `${freguesiaName}|${locName}`;
                    const normalizedBid = normalizarBrickId(brickId);
                    const motoristaDono = localidadeParaMotorista.get(normalizedBid);
                    const isOwnedByOther = motoristaDono && motoristaDono.id !== activeDriver.id;

                    if (checkedState) {
                        const isAlreadyOwned = updatedBrickIds.map(id => normalizarBrickId(id)).includes(normalizedBid);
                        if (!isOwnedByOther && !isAlreadyOwned) {
                            updatedBrickIds.push(brickId);

                            setTimeout(() => {
                                geocodificarBrickSobProcura(freguesiaName, locName);
                            }, delayPacing);
                            delayPacing += 300;
                        }
                    } else {
                        updatedBrickIds = updatedBrickIds.filter(id => normalizarBrickId(id) !== normalizedBid);
                    }
                });

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
    const seletorConcelho = document.getElementById('select-concelho-setores');
    if (seletorConcelho) {
        seletorConcelho.value = concelhoAtivo;
        if (!seletorConcelho.dataset.listenerAtivo) {
            seletorConcelho.addEventListener('change', (e) => {
                concelhoAtivo = e.target.value;
                freguesiasExpandidas.clear();
                motoristaAtivoId = null;

                if (dashboardMap) {
                    const centerCoords = concelhoAtivo === "SINTRA" ? { lat: 38.8000, lng: -9.3800 } : { lat: 38.9500, lng: -9.3000 };
                    dashboardMap.setCenter(centerCoords);
                }

                window.renderizarSetoresUI();
            });
            seletorConcelho.dataset.listenerAtivo = "true";
        }
    }

    renderDriversForAttribution();
    renderGeographicTree();
    atualizarAuditoriaBricks();

    setTimeout(inicializarMapaBricksDashboard, 150);
};