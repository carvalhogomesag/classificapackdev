/**
 * setores.js
 * Versão v74.5 - Com Trava de Segurança e Modo de Calibração Opcional para Bricks
 * Faz: Controla o ecrã de Atribuição de Bricks, pesquisa síncrona por CP7, reatribuição
 *      direta de motoristas pelo balão do mapa, e trava de segurança para pinos (modo seguro por padrão
 *      com opção de desbloqueio para calibração manual de coordenadas).
 * Depende de: ./geografia-data.js, ./storage.js, ./firebase-init.js, ./rotas-relatorios.js
 */

import { GEOGRAPHY, obterEnderecoHigienizado } from './geografia-data.js';
import { saveData } from './storage.js';
import { db } from './firebase-init.js';
import { 
    carregarHistoricoRelatorios, 
    calcularMediasHistoricasPorBrick 
} from './rotas-relatorios.js';

// ID do motorista que está atualmente selecionado na interface para atribuição
let motoristaAtivoId = null;

// Concelho que está atualmente ativo na interface ("MAFRA" ou "SINTRA")
let concelhoAtivo = "MAFRA";

// Guarda o estado de expansão de cada freguesia para evitar que fechem ao clicar nos checkboxes
let freguesiasExpandidas = new Set();

// Flag anti-concorrência para evitar que snapshots do Firestore revertam edições locais imediatas
let isLocalBrickUpdating = false;

// Estado da Trava de Segurança dos Pinos (Falso = Travado/Modo Seguro, Verdadeiro = Destravado para Calibração)
let modoCalibracaoAtivo = false;

// Instâncias internas seguras do mapa do gestor e balão de informação
let dashboardMap = null;
let dashboardInfoWindow = null;

// Mapa de reconciliação inteligente de marcadores (chave: `${driverId}_${brickId}`)
let dashboardMarkersMap = new Map();

// Cache local em memória RAM das coordenadas já geocodificadas
let brickCoordsCache = {};

// Cache local de dados de relatórios calculados
let ultimasMediasCalculadas = [];

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
// AUXILIAR DE COMPATIBILIDADE E ROBUSTEZ: NORMALIZADOR DE IDS
// =========================================================================
function normalizarBrickId(id) {
    if (!id || typeof id !== 'string') return "";
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

// Coordenadas centrais aproximadas das Freguesias de Mafra e Sintra
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
// CÁLCULO DE COORDENADAS JITTER DETERMINÍSTICO
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
// GEOCÓDIGO SOB PROCURA
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
// REATRIBUIÇÃO DIRETA DE MOTORISTA A PARTIR DO BALÃO DO MAPA
// =========================================================================
window.trocarMotoristaDoBrick = function(brickId, novoMotoristaId) {
    if (!brickId || !novoMotoristaId) return;

    const driversArr = Array.isArray(window.drivers) ? window.drivers : [];
    const novoMotorista = driversArr.find(d => d.id === novoMotoristaId);
    if (!novoMotorista) return;

    const normalizedBid = normalizarBrickId(brickId);
    let motoristaAnterior = null;

    // 1. Remover o Brick do dono anterior
    driversArr.forEach(d => {
        if (Array.isArray(d.brickIds)) {
            const hasBrick = d.brickIds.some(id => normalizarBrickId(id) === normalizedBid);
            if (hasBrick && d.id !== novoMotoristaId) {
                motoristaAnterior = d;
                d.brickIds = d.brickIds.filter(id => normalizarBrickId(id) !== normalizedBid);
            }
        }
    });

    // 2. Adicionar ao novo motorista
    if (!Array.isArray(novoMotorista.brickIds)) {
        novoMotorista.brickIds = [];
    }
    const jaPossui = novoMotorista.brickIds.some(id => normalizarBrickId(id) === normalizedBid);
    if (!jaPossui) {
        novoMotorista.brickIds.push(brickId);
    }

    // 3. Atualização otimista imediata na memória local
    isLocalBrickUpdating = true;
    saveData(
        window.drivers, 
        [], 
        window.assignments, 
        window.partidaLocalizacao, 
        window.moradasEntregas, 
        window.rotaOtimizada, 
        window.dataRotaSelecionada, 
        window.rotaIniciada
    );

    // 4. Re-renderizar interface visual e marcadores no mapa
    renderDriversForAttribution();
    renderGeographicTree();
    atualizarAuditoriaBricks();
    desenharBricksNoMapa();

    // 5. Persistir as alterações no Firestore
    const promises = [];
    if (motoristaAnterior) {
        promises.push(db.collection('drivers').doc(motoristaAnterior.id).update({
            brickIds: motoristaAnterior.brickIds
        }));
    }
    promises.push(db.collection('drivers').doc(novoMotorista.id).update({
        brickIds: novoMotorista.brickIds
    }));

    Promise.all(promises).then(() => {
        console.log(`✅ [ATRIBUIÇÃO MAPA] Brick "${brickId}" atribuído com sucesso a "${novoMotorista.name}".`);
    }).catch(err => {
        console.error("❌ Erro ao sincronizar reatribuição no Firestore:", err);
    }).finally(() => {
        isLocalBrickUpdating = false;
    });
};

// =========================================================================
// CONTROLO DO BOTÃO DE TRAVA / MODO DE CALIBRAÇÃO DE PINOS
// =========================================================================
function configurarControloModoCalibracao() {
    const btnToggle = document.getElementById('btn-toggle-modo-calibracao');
    const icone = document.getElementById('icone-trava-calibracao');
    const texto = document.getElementById('texto-trava-calibracao');
    const aviso = document.getElementById('aviso-calibracao-ativa');

    if (!btnToggle || btnToggle.dataset.bound === "true") return;

    btnToggle.addEventListener('click', () => {
        modoCalibracaoAtivo = !modoCalibracaoAtivo;

        if (modoCalibracaoAtivo) {
            // MODO CALIBRAÇÃO ATIVO (Destravado para mover)
            btnToggle.className = "bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-extrabold px-3 py-1.5 rounded-xl border border-amber-600 flex items-center justify-center space-x-1.5 transition-all cursor-pointer shadow-md animate-none";
            if (icone) icone.className = "fa-solid fa-unlock text-white";
            if (texto) texto.textContent = "Calibração Ativa (Pinos Móveis)";
            if (aviso) aviso.classList.remove('hidden');
        } else {
            // MODO SEGURO (Travado para não mover por acidente)
            btnToggle.className = "bg-gray-100 hover:bg-gray-200 text-gray-700 text-[11px] font-extrabold px-3 py-1.5 rounded-xl border border-gray-300 flex items-center justify-center space-x-1.5 transition-all cursor-pointer shadow-xs";
            if (icone) icone.className = "fa-solid fa-lock text-green-600";
            if (texto) texto.textContent = "Pinos Bloqueados (Modo Seguro)";
            if (aviso) aviso.classList.add('hidden');
        }

        // Atualiza a propriedade draggable de todos os marcadores no mapa
        for (const marker of dashboardMarkersMap.values()) {
            marker.setDraggable(modoCalibracaoAtivo);
        }
    });

    btnToggle.dataset.bound = "true";
}

// =========================================================================
// INICIALIZAÇÃO DO MAPA GERAL DO GESTOR
// =========================================================================
function inicializarMapaBricksDashboard() {
    const mapEl = document.getElementById('map-dashboard-bricks');
    if (!mapEl || typeof google === 'undefined') return;

    configurarControloModoCalibracao();

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

// =========================================================================
// DESENHO, CALIBRAÇÃO E REATRIBUIÇÃO DE BRICKS NO MAPA DO GESTOR
// =========================================================================
function desenharBricksNoMapa() {
    if (!dashboardMap) return;

    const driversArr = Array.isArray(window.drivers) ? window.drivers : [];
    const keysDesejadas = new Set();
    const bounds = new google.maps.LatLngBounds();
    let totalPontosDesenhados = 0;

    const pinSvgPath = "M12 2C8.14 2 5 5.14 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.86-3.14-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z";

    // Filtra apenas os motoristas deste concelho para o seletor do balão
    const driversDoConcelho = driversArr.filter(driver => {
        const concelhos = Array.isArray(driver.concelhos) ? driver.concelhos : ["MAFRA"];
        return concelhos.includes(concelhoAtivo);
    });

    driversArr.forEach(drv => {
        const bIds = Array.isArray(drv.brickIds) ? drv.brickIds : [];
        bIds.forEach(id => {
            if (id && typeof id === 'string' && id.includes('|')) {
                const [freg, loc] = id.split('|');

                if (!GEOGRAPHY[concelhoAtivo] || !GEOGRAPHY[concelhoAtivo][freg] || !GEOGRAPHY[concelhoAtivo][freg][loc]) {
                    return; 
                }

                const markerKey = `${drv.id}_${id}`;
                keysDesejadas.add(markerKey);

                const coords = obterCoordenadaPrecisaBrick(freg, loc);
                bounds.extend(coords);
                totalPontosDesenhados++;

                if (!dashboardMarkersMap.has(markerKey)) {
                    // Cria o marcador com a trava respeitando o estado atual do modo de calibração
                    const marker = new google.maps.Marker({
                        position: coords,
                        map: dashboardMap,
                        draggable: modoCalibracaoAtivo,
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

                    // Evento de arrastar o pino para calibrar (só acionado se modoCalibracaoAtivo estiver true)
                    marker.addListener('dragend', (event) => {
                        const novaLat = event.latLng.lat();
                        const novaLng = event.latLng.lng();
                        const novasCoords = { lat: novaLat, lng: novaLng };

                        brickCoordsCache[id] = novasCoords;
                        salvarCacheCoordenadas();

                        db.collection('brickCoordinates').doc(id).set(novasCoords).then(() => {
                            console.log(`✅ [CALIBRAÇÃO] Posição do Brick "${id}" atualizada no Firestore.`);
                        }).catch((err) => {
                            console.error(`❌ [CALIBRAÇÃO] Erro ao gravar coordenada do Brick "${id}":`, err);
                        });

                        if (dashboardInfoWindow) {
                            dashboardInfoWindow.setContent(`
                                <div style="font-family: system-ui, sans-serif; font-size: 11px; padding: 4px;">
                                    <div style="font-weight: 800; color: #10B981;">📍 Posição Calibrada!</div>
                                    <div style="color: #374151; font-weight: 600; font-size: 10px; margin-top: 2px;">${freg} - ${loc}</div>
                                    <div style="color: #6B7280; font-size: 9px; font-mono;">(${novaLat.toFixed(5)}, ${novaLng.toFixed(5)})</div>
                                </div>
                            `);
                            dashboardInfoWindow.setPosition(novasCoords);
                            dashboardInfoWindow.open(dashboardMap, marker);
                        }
                    });

                    // Balão informativo rico com Seletor Interativo de Motorista
                    const exibirInfoBrick = () => {
                        if (dashboardInfoWindow) {
                            const cpList = (GEOGRAPHY[concelhoAtivo] && GEOGRAPHY[concelhoAtivo][freg]) 
                                ? GEOGRAPHY[concelhoAtivo][freg][loc] || [] 
                                : [];
                            
                            const cpFormatado = cpList.length > 0 
                                ? (cpList.length === 1 ? cpList[0] : `${cpList[0]} a ${cpList[cpList.length - 1]}`)
                                : "";

                            const opcoesDriversHtml = driversDoConcelho.map(d => `
                                <option value="${d.id}" ${d.id === drv.id ? 'selected' : ''} style="color: ${d.color}; font-weight: bold;">
                                    ${d.name}
                                </option>
                            `).join('');

                            dashboardInfoWindow.setContent(`
                                <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 12px; padding: 6px; line-height: 1.4; max-width: 250px;">
                                    <div style="font-weight: 800; color: #1F2937; font-size: 13px; margin-bottom: 2px;">
                                        📍 ${freg}
                                    </div>
                                    <div style="font-weight: 700; color: #2563EB; font-size: 12px;">
                                        Brick: ${loc}
                                    </div>
                                    ${cpFormatado ? `<div style="font-size: 10px; font-family: monospace; color: #6B7280; margin-top: 2px;">CPs: ${cpFormatado}</div>` : ''}

                                    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #E5E7EB;">
                                        <label style="display: block; font-size: 9px; font-weight: 900; text-transform: uppercase; color: #6B7280; margin-bottom: 3px;">
                                            Estante de (Alterar Motorista):
                                        </label>
                                        <div style="display: flex; align-items: center; gap: 6px;">
                                            <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background-color: ${drv.color}; flex-shrink: 0;"></span>
                                            <select onchange="if(typeof window.trocarMotoristaDoBrick === 'function') window.trocarMotoristaDoBrick('${id}', this.value)"
                                                    style="flex: 1; padding: 4px 6px; border-radius: 6px; border: 1px solid #D1D5DB; font-size: 11px; font-weight: 800; color: #1F2937; background: #F9FAFB; outline: none; cursor: pointer;">
                                                ${opcoesDriversHtml}
                                            </select>
                                        </div>
                                    </div>

                                    <div style="margin-top: 6px; font-size: 9px; color: #9CA3AF; font-style: italic;">
                                        ${modoCalibracaoAtivo 
                                            ? '🔓 Modo Calibração: Pode arrastar este pino para o local exato.' 
                                            : '🔒 Modo Seguro: Pinos travados contra arrasto acidental.'}
                                    </div>
                                </div>
                            `);
                            dashboardInfoWindow.setPosition(marker.getPosition());
                            dashboardInfoWindow.open(dashboardMap, marker);
                        }
                    };

                    marker.addListener('mouseover', exibirInfoBrick);
                    marker.addListener('click', exibirInfoBrick);

                    dashboardMarkersMap.set(markerKey, marker);
                }
            }
        });
    });

    for (const [key, marker] of dashboardMarkersMap.entries()) {
        if (!keysDesejadas.has(key)) {
            marker.setMap(null);
            dashboardMarkersMap.delete(key);
        }
    }

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
            renderGeographicTree();
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
// COMPUTAÇÃO EM TEMPO REAL: AUDITORIA DE BRICKS NÃO ALOCADOS
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
// EXIBIÇÃO DE DETALHES DO RELATÓRIO DO GESTOR (MODAL)
// =========================================================================
function exibirModalDetalheRelatorio(relatorio) {
    const modal = document.getElementById('modal-detalhe-relatorio');
    const conteudo = document.getElementById('conteudo-modal-relatorio');
    if (!modal || !conteudo) return;

    const detalhamentoBricks = relatorio.detalhamentoPorBrick || {};
    let bricksHtml = Object.values(detalhamentoBricks).map(b => `
        <div class="p-2.5 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between text-[11px]">
            <div>
                <span class="font-bold text-gray-800 block">${b.nomeBrick}</span>
                <span class="text-[9px] text-gray-400 font-mono">${b.brickId} (${b.concelho})</span>
            </div>
            <div class="flex items-center space-x-2 text-[10px] font-bold">
                <span class="text-gray-700 font-black">Total: ${b.totalAlocados}</span>
                <span class="text-green-600">✓ ${b.entregasConcluidas}</span>
                <span class="text-purple-600">📦 ${b.recolhasConcluidas}</span>
                <span class="text-red-500">✗ ${b.falhas}</span>
            </div>
        </div>
    `).join('');

    if (!bricksHtml) bricksHtml = '<p class="text-gray-400 italic">Sem informação de bricks.</p>';

    conteudo.innerHTML = `
        <div class="bg-purple-50 p-3 rounded-xl border border-purple-100 space-y-1">
            <div class="flex justify-between items-center">
                <span class="font-black text-purple-900 text-sm">${relatorio.driverName}</span>
                <span class="text-[10px] bg-purple-200 text-purple-800 font-bold px-2 py-0.5 rounded">${relatorio.concelho}</span>
            </div>
            <span class="text-[10px] text-purple-600 block">Data do Turno: ${relatorio.dataRelatorio} (${relatorio.dataHoraCriacao})</span>
        </div>

        <div class="grid grid-cols-2 gap-2 text-center text-[10px]">
            <div class="bg-gray-50 p-2 rounded-lg border">
                <span class="text-gray-400 block font-bold uppercase">Telemetria</span>
                <span class="font-bold text-gray-800 block">${relatorio.telemetriaTurno?.duracaoHoras || 0}h (${relatorio.telemetriaTurno?.kmPercorridos || 0} KM)</span>
            </div>
            <div class="bg-gray-50 p-2 rounded-lg border">
                <span class="text-gray-400 block font-bold uppercase">Eficiência</span>
                <span class="font-bold text-purple-700 block">${relatorio.metricasEficiencia?.eventosPorHora || 0} evt/h | ${relatorio.metricasEficiencia?.eventosPorKm || 0} evt/KM</span>
            </div>
        </div>

        <div class="space-y-1.5">
            <span class="font-bold text-gray-600 uppercase text-[10px] block">Detalhamento por Brick (Estante)</span>
            <div class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                ${bricksHtml}
            </div>
        </div>
    `;

    modal.classList.remove('hidden');

    const btnFecharX = document.getElementById('btn-fechar-modal-relatorio');
    const btnFecharOk = document.getElementById('btn-fechar-modal-relatorio-ok');

    const fecharModal = () => modal.classList.add('hidden');
    if (btnFecharX) btnFecharX.onclick = fecharModal;
    if (btnFecharOk) btnFecharOk.onclick = fecharModal;
}

// =========================================================================
// RENDERIZADOR DA TABELA FILTRADA DE MÉDIAS E TOTAIS POR CP7 / BRICK
// =========================================================================
function renderizarTabelaMediasFiltrada(termoPesquisa = "") {
    const tbodyMedias = document.getElementById('tbody-medias-bricks');
    if (!tbodyMedias) return;

    tbodyMedias.innerHTML = "";

    const termo = termoPesquisa.toLowerCase().trim();

    const filtrados = ultimasMediasCalculadas.filter(item => {
        if (!termo) return true;
        const bId = String(item.brickId || '').toLowerCase();
        const nBrick = String(item.nomeBrick || '').toLowerCase();
        return bId.includes(termo) || nBrick.includes(termo);
    });

    if (filtrados.length === 0) {
        tbodyMedias.innerHTML = `
            <tr>
                <td colspan="6" class="p-4 text-center text-gray-400 italic font-semibold">
                    ${termo ? `Nenhum Brick ou Código Postal encontrado para "${termoPesquisa}".` : 'Sem dados de Bricks nos relatórios.'}
                </td>
            </tr>`;
        return;
    }

    filtrados.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-purple-50/40 transition-colors";
        tr.innerHTML = `
            <td class="p-2.5 font-bold text-gray-800">
                ${item.nomeBrick} 
                <span class="text-[9px] text-purple-600 font-mono font-bold block">${item.brickId}</span>
            </td>
            <td class="p-2.5 text-center text-[10px] font-bold uppercase text-gray-500">${item.concelho}</td>
            <td class="p-2.5 text-center text-sm font-black text-green-700 bg-green-50/50">${item.somaTotalObjetos - (item.mediaFalhasPorTurno * item.totalTurnosAtendido || 0)}</td>
            <td class="p-2.5 text-center font-extrabold text-purple-700 bg-purple-50/50">${item.somaTotalObjetos}</td>
            <td class="p-2.5 text-center font-bold text-red-500">${Math.round(item.mediaFalhasPorTurno * item.totalTurnosAtendido)}</td>
            <td class="p-2.5 text-center text-sm font-black text-blue-700 bg-blue-50/50">${item.mediaObjetosPorTurno}</td>
        `;
        tbodyMedias.appendChild(tr);
    });
}

// =========================================================================
// RENDERIZAÇÃO DO PAINEL DO GESTOR: RELATÓRIOS E MÉDIAS DE CARGA POR BRICK
// =========================================================================
async function renderizarPainelRelatoriosGestor() {
    const tbodyMedias = document.getElementById('tbody-medias-bricks');
    const containerHistorico = document.getElementById('lista-relatorios-historico');
    const inputPesquisa = document.getElementById('filtro-pesquisa-brick');

    if (!tbodyMedias || !containerHistorico) return;

    try {
        const relatorios = await carregarHistoricoRelatorios({ concelho: concelhoAtivo });

        const elTurnos = document.getElementById('gestor-stat-turnos');
        const elDuracao = document.getElementById('gestor-stat-duracao');
        const elEvtHora = document.getElementById('gestor-stat-evt-hora');
        const elEvtKm = document.getElementById('gestor-stat-evt-km');

        if (relatorios.length === 0) {
            if (elTurnos) elTurnos.textContent = "0";
            if (elDuracao) elDuracao.textContent = "0h";
            if (elEvtHora) elEvtHora.textContent = "0.0";
            if (elEvtKm) elEvtKm.textContent = "0.0";

            tbodyMedias.innerHTML = `
                <tr>
                    <td colspan="6" class="p-4 text-center text-gray-400 italic">Nenhum relatório registado para ${concelhoAtivo}.</td>
                </tr>`;
            containerHistorico.innerHTML = `
                <p class="text-xs text-gray-400 italic text-center py-4">Nenhum turno finalizado registado na nuvem.</p>`;
            return;
        }

        let somaDuracao = 0;
        let somaEvtHora = 0;
        let somaEvtKm = 0;

        relatorios.forEach(r => {
            somaDuracao += (r.telemetriaTurno?.duracaoHoras || 0);
            somaEvtHora += (r.metricasEficiencia?.eventosPorHora || 0);
            somaEvtKm += (r.metricasEficiencia?.eventosPorKm || 0);
        });

        const totalTurnos = relatorios.length;
        if (elTurnos) elTurnos.textContent = totalTurnos;
        if (elDuracao) elDuracao.textContent = `${(somaDuracao / totalTurnos).toFixed(1)}h`;
        if (elEvtHora) elEvtHora.textContent = (somaEvtHora / totalTurnos).toFixed(1);
        if (elEvtKm) elEvtKm.textContent = (somaEvtKm / totalTurnos).toFixed(1);

        // Calcular e Guardar Médias
        ultimasMediasCalculadas = calcularMediasHistoricasPorBrick(relatorios);

        // Ativar Escuta do Campo de Pesquisa por CP7
        if (inputPesquisa && !inputPesquisa.dataset.listenerAtivo) {
            inputPesquisa.addEventListener('input', (e) => {
                renderizarTabelaMediasFiltrada(e.target.value);
            });
            inputPesquisa.dataset.listenerAtivo = "true";
        }

        renderizarTabelaMediasFiltrada(inputPesquisa ? inputPesquisa.value : "");

        // Histórico Recente de Relatórios
        containerHistorico.innerHTML = "";
        relatorios.slice(0, 10).forEach(r => {
            const dateObj = new Date(r.dataHoraCriacao || r.dataRelatorio);
            const dataStr = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()}`;
            const horaStr = `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;

            const card = document.createElement('div');
            card.className = "p-3 bg-gray-50 hover:bg-purple-50/50 border border-gray-200 hover:border-purple-200 rounded-xl flex items-center justify-between transition cursor-pointer";
            card.innerHTML = `
                <div class="space-y-0.5">
                    <div class="flex items-center space-x-2">
                        <span class="font-bold text-gray-800 text-xs">${r.driverName || 'Motorista'}</span>
                        <span class="text-[10px] bg-gray-200 text-gray-700 px-1.5 py-0.2 rounded font-mono">${dataStr} ${horaStr}</span>
                    </div>
                    <div class="text-[10px] text-gray-500 flex items-center space-x-2">
                        <span>⏱️ ${r.telemetriaTurno?.duracaoHoras || 0}h</span>
                        <span>🛣️ ${r.telemetriaTurno?.kmPercorridos || 0} KM</span>
                        <span>📦 ${r.resumoEventos?.totalObjetosAlocados || 0} pacotes</span>
                    </div>
                </div>
                <button type="button" class="btn-ver-relatorio bg-purple-600 hover:bg-purple-700 text-white font-bold text-[10px] px-2.5 py-1.5 rounded-lg transition cursor-pointer">
                    Ver Detalhes
                </button>
            `;

            card.querySelector('.btn-ver-relatorio').addEventListener('click', (e) => {
                e.stopPropagation();
                exibirModalDetalheRelatorio(r);
            });

            containerHistorico.appendChild(card);
        });

    } catch (err) {
        console.error("Erro ao renderizar painel de relatórios do gestor:", err);
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

    const localidadeParaMotorista = new Map();
    driversArr.forEach(drv => {
        const bIds = Array.isArray(drv.brickIds) ? drv.brickIds : [];
        bIds.forEach(id => {
            if (id && typeof id === 'string') {
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
                <button type="button" class="btn-expand-tree text-gray-500 hover:text-blue-600 font-mono text-[10px] px-2 py-0.5 rounded border bg-white focus:outline-none shadow-sm transition flex items-center space-x-1 cursor-pointer">
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
            
            const motoristaDono = localidadeParaMotorista.get(normalizedBid);

            const isAssignedToActive = Array.isArray(activeDriver.brickIds) && 
                activeDriver.brickIds.map(id => normalizarBrickId(id)).includes(normalizedBid);

            const cpList = localidadesMap[locName] || [];
            const cpTexto = formatarIntervaloCPs(cpList);

            const label = document.createElement('label');

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
                    
                    const confirmar = confirm(`Tem a certeza que deseja ${acao} o Brick "${locName}" do motorista "${activeDriver.name}"?`);
                    if (!confirmar) {
                        e.target.checked = !checkedState;
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
                        updatedBrickIds = updatedBrickIds.filter(id => normalizarBrickId(id) !== normalizedBid);
                    }

                    isLocalBrickUpdating = true;

                    activeDriver.brickIds = updatedBrickIds;
                    saveData(window.drivers, [], window.assignments, window.partidaLocalizacao, window.moradasEntregas, window.rotaOtimizada, window.dataRotaSelecionada, window.rotaIniciada);

                    renderDriversForAttribution();
                    renderGeographicTree();
                    atualizarAuditoriaBricks();
                    desenharBricksNoMapa();

                    db.collection('drivers').doc(activeDriver.id).update({
                        brickIds: updatedBrickIds
                    }).then(() => {
                        console.log("[FIREBASE] Bricks do motorista sincronizados no Firestore.");
                    }).catch((err) => {
                        console.error("[FIREBASE] Erro ao sincronizar Bricks:", err);
                        alert("Erro de ligação: Não foi possível guardar as alterações.");
                    }).finally(() => {
                        isLocalBrickUpdating = false;
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

                isLocalBrickUpdating = true;

                activeDriver.brickIds = updatedBrickIds;
                saveData(window.drivers, [], window.assignments, window.partidaLocalizacao, window.moradasEntregas, window.rotaOtimizada, window.dataRotaSelecionada, window.rotaIniciada);

                renderDriversForAttribution();
                renderGeographicTree();
                atualizarAuditoriaBricks();
                desenharBricksNoMapa();

                db.collection('drivers').doc(activeDriver.id).update({
                    brickIds: updatedBrickIds
                }).then(() => {
                    console.log("[FIREBASE] Alterações de Bricks em lote sincronizadas no Firestore.");
                }).catch((err) => {
                    console.error("[FIREBASE] Erro ao sincronizar Bricks em lote:", err);
                    alert("Erro de ligação: Não foi possível guardar as alterações.");
                }).finally(() => {
                    isLocalBrickUpdating = false;
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
    if (isLocalBrickUpdating) return;

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

    configurarControloModoCalibracao();

    const btnAtualizarRelatorios = document.getElementById('btn-atualizar-relatorios');
    if (btnAtualizarRelatorios && !btnAtualizarRelatorios.dataset.listenerAtivo) {
        btnAtualizarRelatorios.addEventListener('click', () => renderizarPainelRelatoriosGestor());
        btnAtualizarRelatorios.dataset.listenerAtivo = "true";
    }

    renderDriversForAttribution();
    renderGeographicTree();
    atualizarAuditoriaBricks();
    renderizarPainelRelatoriosGestor();

    setTimeout(inicializarMapaBricksDashboard, 150);
};