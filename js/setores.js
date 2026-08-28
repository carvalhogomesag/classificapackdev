/**
 * setores.js
 * Versão v76.8 - Módulo de Atribuição de Bricks, Mapa do Gestor e Controlo de Camadas (Bricks + CP7)
 * Faz: Gere a atribuição de Bricks a motoristas, calibração manual de coordenadas,
 *      sistema de Mapeamento de Precisão por Código Postal (CP7) com Mini-Pinos discretos,
 *      controlos independentes de visibilidade para Pinos de Bricks e Mini-Pinos,
 *      trava de calibração e Auditoria de Saldo Zero.
 * Depende de: ./geografia-data.js, ./storage.js, ./firebase-init.js
 */

import { GEOGRAPHY, obterEnderecoHigienizado } from './geografia-data.js';
import { saveData } from './storage.js';
import { db } from './firebase-init.js';

// ID do motorista que está atualmente selecionado na interface para atribuição
let motoristaAtivoId = null;

// Concelho que está atualmente ativo na interface ("MAFRA" ou "SINTRA")
let concelhoAtivo = "MAFRA";

// Guarda o estado de expansão de cada freguesia para evitar que fechem ao clicar nos checkboxes
let freguesiasExpandidas = new Set();

// Flag anti-concorrência para evitar que snapshots do Firestore revertam edições locais imediatas
let isLocalBrickUpdating = false;

// Estado da Trava de Segurança dos Pinos de Bricks (Falso = Travado/Modo Seguro, Verdadeiro = Destravado para Calibração)
let modoCalibracaoAtivo = false;

// Estados de visibilidade das camadas no mapa
let brickPinosVisiveis = true;
let miniPinosVisiveis = true;

// Instâncias internas seguras do mapa do gestor e balão de informação
let dashboardMap = null;
let dashboardInfoWindow = null;

// Mapas de reconciliação inteligente de marcadores
let dashboardMarkersMap = new Map(); // Pinos de Bricks
let miniPinosMarkersMap = new Map(); // Mini-Pinos de CP7 individuais

// Cache local em memória RAM das coordenadas calibradas/auditadas de Bricks
let brickCoordsCache = {};

// Cache local em memória RAM das coordenadas de CP7s individuais mapeados
let cp7CoordsCache = {};

try {
    const cachedBricks = localStorage.getItem('cp_brick_coords');
    if (cachedBricks) {
        brickCoordsCache = JSON.parse(cachedBricks);
    }
    const cachedCp7 = localStorage.getItem('cp_cp7_coords');
    if (cachedCp7) {
        cp7CoordsCache = JSON.parse(cachedCp7);
    }
} catch (e) {
    console.warn("[PWA] Erro ao carregar caches locais de coordenadas:", e);
}

function salvarCacheCoordenadas() {
    try {
        localStorage.setItem('cp_brick_coords', JSON.stringify(brickCoordsCache));
    } catch (e) {
        console.warn("[PWA] Erro ao persistir cache local de coordenadas de Bricks:", e);
    }
}

function salvarCacheCp7() {
    try {
        localStorage.setItem('cp_cp7_coords', JSON.stringify(cp7CoordsCache));
    } catch (e) {
        console.warn("[PWA] Erro ao persistir cache local de CP7s:", e);
    }
}

// =========================================================================
// AUXILIAR DE COMPATIBILIDADE E ROBUSTEZ: NORMALIZADOR DE IDS
// =========================================================================
function normalizarBrickId(id) {
    if (!id || typeof id !== 'string') return "";
    return id.toUpperCase().trim();
}

function normalizarCP7(cp) {
    if (!cp) return "";
    const clean = cp.replace(/\D/g, '');
    if (clean.length === 7) {
        return `${clean.substring(0, 4)}-${clean.substring(4, 7)}`;
    }
    return cp.trim();
}

// ==========================================
// SINCRONIZAÇÃO DAS CACHES COM O FIRESTORE
// ==========================================
let cacheFirestoreSincronizada = false;

async function carregarCachesFirestore() {
    if (cacheFirestoreSincronizada) return;
    try {
        // 1. Sincroniza coordenadas de Bricks
        const snapshotBricks = await db.collection('brickCoordinates').get();
        snapshotBricks.forEach(doc => {
            const data = doc.data();
            if (data && typeof data.lat === 'number' && typeof data.lng === 'number') {
                brickCoordsCache[doc.id] = { 
                    lat: data.lat, 
                    lng: data.lng,
                    auditado: data.auditado === true,
                    auditadoEm: data.auditadoEm || ""
                };
            }
        });
        salvarCacheCoordenadas();

        // 2. Sincroniza coordenadas de CP7s Individuais
        const snapshotCp7 = await db.collection('postalCodeCoordinates').get();
        snapshotCp7.forEach(doc => {
            const data = doc.data();
            if (data && typeof data.lat === 'number' && typeof data.lng === 'number') {
                cp7CoordsCache[doc.id] = {
                    lat: data.lat,
                    lng: data.lng,
                    concelho: data.concelho || "",
                    criadoEm: data.criadoEm || ""
                };
            }
        });
        salvarCacheCp7();

        cacheFirestoreSincronizada = true;
        atualizarContadorCp7Mapeados();
        desenharBricksNoMapa();
        desenharMiniPinosNoMapa();
        renderGeographicTree();
    } catch (e) {
        console.warn("[PWA] Não foi possível sincronizar as caches partilhadas do Firestore:", e);
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
// CÁLCULO DE COORDENADAS DE BRICKS
// ==========================================
function obterCoordenadaPrecisaBrick(freguesia, localidade) {
    const brickId = `${freguesia}|${localidade}`;

    if (brickCoordsCache[brickId] && typeof brickCoordsCache[brickId].lat === 'number') {
        return {
            lat: brickCoordsCache[brickId].lat,
            lng: brickCoordsCache[brickId].lng,
            auditado: brickCoordsCache[brickId].auditado === true,
            auditadoEm: brickCoordsCache[brickId].auditadoEm || ""
        };
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
        lng: base.lng + lngOffset,
        auditado: false,
        auditadoEm: ""
    };
}

// =========================================================================
// GESTÃO DO MAPEADOR DE PRECISÃO CP7 (MINI-PINOS)
// =========================================================================
function configurarMapeadorCP7() {
    const inputCp7 = document.getElementById('input-novo-cp7');
    const inputCoords = document.getElementById('input-coords-novo-cp7');
    const btnSalvar = document.getElementById('btn-salvar-cp7-coordenada');
    const btnToggleMiniPinos = document.getElementById('btn-toggle-mini-pinos');
    const btnToggleBrickPinos = document.getElementById('btn-toggle-brick-pinos');

    // Máscara automática de CP7 (XXXX-XXX)
    if (inputCp7 && !inputCp7.dataset.bound) {
        inputCp7.addEventListener('input', (e) => {
            let val = e.target.value.replace(/\D/g, '').slice(0, 7);
            if (val.length > 4) {
                val = `${val.slice(0, 4)}-${val.slice(4)}`;
            }
            e.target.value = val;
        });
        inputCp7.dataset.bound = "true";
    }

    // Botão de Adicionar Mini-Pino CP7
    if (btnSalvar && !btnSalvar.dataset.bound) {
        btnSalvar.addEventListener('click', async () => {
            const cpRaw = inputCp7 ? inputCp7.value.trim() : "";
            const coordsRaw = inputCoords ? inputCoords.value.trim() : "";

            const cleanCp = cpRaw.replace(/\D/g, '');
            if (cleanCp.length !== 7) {
                alert("Por favor, introduza um Código Postal completo com 7 dígitos (ex: 2715-311).");
                if (inputCp7) inputCp7.focus();
                return;
            }
            const cpFormatado = `${cleanCp.slice(0, 4)}-${cleanCp.slice(4)}`;

            if (!coordsRaw) {
                alert("Por favor, cole as coordenadas do Google Maps (ex: 38.757405, -9.363379).");
                if (inputCoords) inputCoords.focus();
                return;
            }

            const cleanCoords = coordsRaw.replace(/[()]/g, '').trim();
            const parts = cleanCoords.split(/[\s,;]+/).filter(Boolean);

            if (parts.length < 2) {
                alert("Formato de coordenadas inválido. Cole no formato: latitude, longitude (ex: 38.757405, -9.363379)");
                return;
            }

            const lat = parseFloat(parts[0]);
            const lng = parseFloat(parts[1]);

            if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                alert("Valores numéricos de coordenadas inválidos. Verifique o texto copiado.");
                return;
            }

            const agora = new Date();
            const hoje = `${String(agora.getDate()).padStart(2, '0')}/${String(agora.getMonth() + 1).padStart(2, '0')}/${agora.getFullYear()}`;

            btnSalvar.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> <span>A guardar...</span>';
            btnSalvar.disabled = true;

            try {
                cp7CoordsCache[cpFormatado] = {
                    lat: lat,
                    lng: lng,
                    concelho: concelhoAtivo,
                    criadoEm: hoje
                };
                salvarCacheCp7();

                await db.collection('postalCodeCoordinates').doc(cpFormatado).set({
                    lat: lat,
                    lng: lng,
                    concelho: concelhoAtivo,
                    criadoEm: hoje,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                atualizarContadorCp7Mapeados();
                desenharMiniPinosNoMapa();

                if (dashboardMap) {
                    dashboardMap.panTo({ lat, lng });
                    dashboardMap.setZoom(15);
                }

                if (inputCp7) inputCp7.value = "";
                if (inputCoords) inputCoords.value = "";

                alert(`📍 SUCESSO!\n\nMini-Pino para o Código Postal ${cpFormatado} mapeado com precisão!\n(${lat.toFixed(6)}, ${lng.toFixed(6)})`);
            } catch (err) {
                console.error("Erro ao guardar CP7:", err);
                alert("Ocorreu um aviso ao gravar na nuvem, mas o ponto foi registado localmente.");
                desenharMiniPinosNoMapa();
            } finally {
                btnSalvar.innerHTML = '<i class="fa-solid fa-plus"></i> <span>Mapear CP7</span>';
                btnSalvar.disabled = false;
            }
        });
        btnSalvar.dataset.bound = "true";
    }

    // 1. Botão de ligar/desligar visualização de Pinos de Bricks
    if (btnToggleBrickPinos && !btnToggleBrickPinos.dataset.bound) {
        btnToggleBrickPinos.addEventListener('click', () => {
            brickPinosVisiveis = !brickPinosVisiveis;
            const icone = document.getElementById('icone-toggle-brick-pinos');
            const texto = document.getElementById('texto-toggle-brick-pinos');

            if (brickPinosVisiveis) {
                btnToggleBrickPinos.className = "bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-extrabold px-3 py-1.5 rounded-xl border border-blue-200 flex items-center justify-center space-x-1.5 transition-all cursor-pointer shadow-xs";
                if (icone) icone.className = "fa-solid fa-eye text-blue-600";
                if (texto) texto.textContent = "Ver Pinos Bricks";
            } else {
                btnToggleBrickPinos.className = "bg-gray-100 hover:bg-gray-200 text-gray-500 text-[11px] font-extrabold px-3 py-1.5 rounded-xl border border-gray-300 flex items-center justify-center space-x-1.5 transition-all cursor-pointer shadow-xs opacity-80";
                if (icone) icone.className = "fa-solid fa-eye-slash text-gray-500";
                if (texto) texto.textContent = "Pinos Bricks Ocultos";
            }

            for (const marker of dashboardMarkersMap.values()) {
                marker.setVisible(brickPinosVisiveis);
            }
        });
        btnToggleBrickPinos.dataset.bound = "true";
    }

    // 2. Botão de ligar/desligar visualização de Mini-Pinos CP7
    if (btnToggleMiniPinos && !btnToggleMiniPinos.dataset.bound) {
        btnToggleMiniPinos.addEventListener('click', () => {
            miniPinosVisiveis = !miniPinosVisiveis;
            const icone = document.getElementById('icone-toggle-mini-pinos');
            const texto = document.getElementById('texto-toggle-mini-pinos');

            if (miniPinosVisiveis) {
                btnToggleMiniPinos.className = "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-extrabold px-3 py-1.5 rounded-xl border border-indigo-200 flex items-center justify-center space-x-1.5 transition-all cursor-pointer shadow-xs";
                if (icone) icone.className = "fa-solid fa-eye text-indigo-600";
                if (texto) texto.textContent = "Ver Mini-Pinos CP7";
            } else {
                btnToggleMiniPinos.className = "bg-gray-100 hover:bg-gray-200 text-gray-500 text-[11px] font-extrabold px-3 py-1.5 rounded-xl border border-gray-300 flex items-center justify-center space-x-1.5 transition-all cursor-pointer shadow-xs opacity-80";
                if (icone) icone.className = "fa-solid fa-eye-slash text-gray-500";
                if (texto) texto.textContent = "Mini-Pinos Ocultos";
            }

            for (const marker of miniPinosMarkersMap.values()) {
                marker.setVisible(miniPinosVisiveis);
            }
        });
        btnToggleMiniPinos.dataset.bound = "true";
    }

    atualizarContadorCp7Mapeados();
}

function atualizarContadorCp7Mapeados() {
    const badge = document.getElementById('stat-total-cp7-mapeados');
    if (!badge) return;

    const total = Object.keys(cp7CoordsCache).length;
    badge.textContent = `${total} CP7s Mapeados`;
}

// =========================================================================
// DESENHO DOS MINI-PINOS DE CP7 NO MAPA
// =========================================================================
function desenharMiniPinosNoMapa() {
    if (!dashboardMap) return;

    const keysDesejadas = new Set();
    const miniPinSvgPath = "M12 2C8.14 2 5 5.14 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.86-3.14-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z";

    for (const [cpFormatado, data] of Object.entries(cp7CoordsCache)) {
        if (!data || typeof data.lat !== 'number' || typeof data.lng !== 'number') continue;

        const markerKey = `cp7_${cpFormatado}`;
        keysDesejadas.add(markerKey);

        let marker = miniPinosMarkersMap.get(markerKey);

        if (!marker) {
            marker = new google.maps.Marker({
                position: { lat: data.lat, lng: data.lng },
                map: dashboardMap,
                visible: miniPinosVisiveis,
                zIndex: 50,
                icon: {
                    path: miniPinSvgPath,
                    fillColor: "#4F46E5",
                    fillOpacity: 0.95,
                    strokeWeight: 1,
                    strokeColor: "#FFFFFF",
                    scale: 0.8,
                    anchor: new google.maps.Point(12, 22)
                },
                title: `CP7: ${cpFormatado}`
            });

            marker.addListener('click', () => {
                if (dashboardInfoWindow) {
                    dashboardInfoWindow.setContent(`
                        <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 11px; padding: 6px; line-height: 1.4; width: 220px;">
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                                <span style="font-weight: 900; font-size: 13px; color: #312E81; font-family: monospace;">
                                    📮 ${cpFormatado}
                                </span>
                                <span style="font-size: 8px; font-weight: 800; background: #EEF2FF; color: #4338CA; padding: 2px 5px; border-radius: 4px; border: 1px solid #C7D2FE;">
                                    MINI-PINO CP7
                                </span>
                            </div>
                            <div style="font-size: 10px; color: #4B5563; font-family: monospace; margin-bottom: 6px;">
                                Lat: ${data.lat.toFixed(6)}<br>Lng: ${data.lng.toFixed(6)}
                            </div>
                            <div style="font-size: 9px; color: #9CA3AF; margin-bottom: 6px;">
                                Mapeado em: ${data.criadoEm || 'Registo Manual'}
                            </div>
                            <button type="button" 
                                    onclick="window.removerMiniPinoCP7('${cpFormatado}')"
                                    style="width: 100%; background: #FEE2E2; color: #DC2626; border: 1px solid #FCA5A5; border-radius: 6px; padding: 4px; font-size: 10px; font-weight: bold; cursor: pointer;">
                                <i class="fa-solid fa-trash-can mr-1"></i> Remover Ponto
                            </button>
                        </div>
                    `);
                    dashboardInfoWindow.setPosition(marker.getPosition());
                    dashboardInfoWindow.open(dashboardMap, marker);
                }
            });

            miniPinosMarkersMap.set(markerKey, marker);
        } else {
            marker.setPosition({ lat: data.lat, lng: data.lng });
            marker.setVisible(miniPinosVisiveis);
        }
    }

    for (const [key, marker] of miniPinosMarkersMap.entries()) {
        if (!keysDesejadas.has(key)) {
            marker.setMap(null);
            miniPinosMarkersMap.delete(key);
        }
    }
}

// =========================================================================
// REMOÇÃO DE MINI-PINO CP7
// =========================================================================
window.removerMiniPinoCP7 = async function(cpFormatado) {
    if (!cpFormatado) return;

    const confirmar = confirm(`Tem a certeza que deseja eliminar o Mini-Pino do Código Postal "${cpFormatado}"?`);
    if (!confirmar) return;

    delete cp7CoordsCache[cpFormatado];
    salvarCacheCp7();

    try {
        await db.collection('postalCodeCoordinates').doc(cpFormatado).delete();
        console.log(`[CP7] Ponto ${cpFormatado} eliminado do Firestore.`);
    } catch (err) {
        console.warn("[CP7] Aviso ao eliminar na nuvem:", err);
    }

    if (dashboardInfoWindow) {
        dashboardInfoWindow.close();
    }

    atualizarContadorCp7Mapeados();
    desenharMiniPinosNoMapa();
};

// =========================================================================
// CALIBRAÇÃO DIRETA DE BRICKS MANUALMENTE (COPIADAS DO GOOGLE MAPS)
// =========================================================================
window.atualizarCoordenadaManualBrick = async function(brickId, rawCoordString) {
    if (!brickId || !rawCoordString) {
        alert("Por favor, introduza ou cole as coordenadas (ex: 38.757405, -9.363379).");
        return;
    }

    const cleanStr = rawCoordString.replace(/[()]/g, '').trim();
    const parts = cleanStr.split(/[\s,;]+/).filter(Boolean);

    if (parts.length < 2) {
        alert("Formato inválido. Por favor cole as coordenadas no formato:\nlatitude, longitude (ex: 38.757405, -9.363379)");
        return;
    }

    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        alert("Valores de coordenadas inválidos. Verifique se copiou corretamente os números do Google Maps.");
        return;
    }

    const agora = new Date();
    const hoje = `${String(agora.getDate()).padStart(2, '0')}/${String(agora.getMonth() + 1).padStart(2, '0')}/${agora.getFullYear()}`;
    
    const novasCoords = { 
        lat, 
        lng,
        auditado: true,
        auditadoEm: hoje
    };

    brickCoordsCache[brickId] = novasCoords;
    salvarCacheCoordenadas();

    try {
        await db.collection('brickCoordinates').doc(brickId).set({
            lat: lat,
            lng: lng,
            auditado: true,
            auditadoEm: hoje,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log(`✅ [CALIBRAÇÃO MANUAL] Posição do Brick "${brickId}" gravada no Firestore como AUDITADA.`);
    } catch (err) {
        console.warn(`[CALIBRAÇÃO MANUAL] Aviso ao gravar na nuvem:`, err);
    }

    if (dashboardInfoWindow) {
        dashboardInfoWindow.close();
    }

    desenharBricksNoMapa();
    renderGeographicTree();
    alert(`🎯 SUCESSO!\n\nPosição do Brick "${brickId.replace('|', ' - ')}" fixada e marcada como AUDITADA!\n\nLatitude: ${lat.toFixed(6)}\nLongitude: ${lng.toFixed(6)}`);
};

// =========================================================================
// REATRIBUIÇÃO DIRETA DE MOTORISTA A PARTIR DO BALÃO DO MAPA
// =========================================================================
window.trocarMotoristaDoBrick = function(brickId, novoMotoristaId) {
    if (!brickId) return;

    const driversArr = Array.isArray(window.drivers) ? window.drivers : [];
    const normalizedBid = normalizarBrickId(brickId);
    let motoristaAnterior = null;

    driversArr.forEach(d => {
        if (Array.isArray(d.brickIds)) {
            const hasBrick = d.brickIds.some(id => normalizarBrickId(id) === normalizedBid);
            if (hasBrick && d.id !== novoMotoristaId) {
                motoristaAnterior = d;
                d.brickIds = d.brickIds.filter(id => normalizarBrickId(id) !== normalizedBid);
            }
        }
    });

    let novoMotorista = null;
    if (novoMotoristaId) {
        novoMotorista = driversArr.find(d => d.id === novoMotoristaId);
        if (novoMotorista) {
            if (!Array.isArray(novoMotorista.brickIds)) {
                novoMotorista.brickIds = [];
            }
            const jaPossui = novoMotorista.brickIds.some(id => normalizarBrickId(id) === normalizedBid);
            if (!jaPossui) {
                novoMotorista.brickIds.push(brickId);
            }
        }
    }

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

    renderDriversForAttribution();
    renderGeographicTree();
    atualizarAuditoriaBricks();
    desenharBricksNoMapa();

    const promises = [];
    if (motoristaAnterior) {
        promises.push(db.collection('drivers').doc(motoristaAnterior.id).update({
            brickIds: motoristaAnterior.brickIds
        }));
    }
    if (novoMotorista) {
        promises.push(db.collection('drivers').doc(novoMotorista.id).update({
            brickIds: novoMotorista.brickIds
        }));
    }

    Promise.all(promises).then(() => {
        console.log(`✅ [ATRIBUIÇÃO MAPA] Brick "${brickId}" sincronizado.`);
    }).catch(err => {
        console.error("❌ Erro ao sincronizar reatribuição no Firestore:", err);
    }).finally(() => {
        isLocalBrickUpdating = false;
    });
};

// =========================================================================
// CONTROLO DO BOTÃO DE TRAVA / MODO DE CALIBRAÇÃO DE PINOS DE BRICKS
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
            btnToggle.className = "bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-extrabold px-3 py-1.5 rounded-xl border border-amber-600 flex items-center justify-center space-x-1.5 transition-all cursor-pointer shadow-md animate-none";
            if (icone) icone.className = "fa-solid fa-unlock text-white";
            if (texto) texto.textContent = "Calibração Ativa (Pinos Móveis)";
            if (aviso) aviso.classList.remove('hidden');
        } else {
            btnToggle.className = "bg-gray-100 hover:bg-gray-200 text-gray-700 text-[11px] font-extrabold px-3 py-1.5 rounded-xl border border-gray-300 flex items-center justify-center space-x-1.5 transition-all cursor-pointer shadow-xs";
            if (icone) icone.className = "fa-solid fa-lock text-green-600";
            if (texto) texto.textContent = "Pinos Bloqueados (Modo Seguro)";
            if (aviso) aviso.classList.add('hidden');
        }

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
    configurarMapeadorCP7();

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
            disableAutoPan: false
        });

        carregarCachesFirestore().then(() => {
            desenharBricksNoMapa();
            desenharMiniPinosNoMapa();
        });
    } else {
        dashboardMap.setCenter(centerCoords);
        google.maps.event.trigger(dashboardMap, 'resize');
    }

    desenharBricksNoMapa();
    desenharMiniPinosNoMapa();
}

// =========================================================================
// DESENHO DOS BRICKS NO MAPA DO GESTOR
// =========================================================================
function desenharBricksNoMapa() {
    if (!dashboardMap) return;

    const driversArr = Array.isArray(window.drivers) ? window.drivers : [];
    const keysDesejadas = new Set();
    const bounds = new google.maps.LatLngBounds();
    let totalPontosDesenhados = 0;

    const pinSvgPath = "M12 2C8.14 2 5 5.14 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.86-3.14-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z";

    const driversDoConcelho = driversArr.filter(driver => {
        const concelhos = Array.isArray(driver.concelhos) ? driver.concelhos : ["MAFRA"];
        return concelhos.includes(concelhoAtivo);
    });

    const localidadeParaMotorista = new Map();
    driversArr.forEach(drv => {
        const bIds = Array.isArray(drv.brickIds) ? drv.brickIds : [];
        bIds.forEach(id => {
            if (id && typeof id === 'string') {
                localidadeParaMotorista.set(normalizarBrickId(id), drv);
            }
        });
    });

    if (GEOGRAPHY[concelhoAtivo]) {
        for (const [freguesia, localidades] of Object.entries(GEOGRAPHY[concelhoAtivo])) {
            for (const [localidade, cpList] of Object.entries(localidades)) {
                const brickId = `${freguesia}|${localidade}`;
                const normalizedBid = normalizarBrickId(brickId);
                const motoristaDono = localidadeParaMotorista.get(normalizedBid);

                const markerKey = brickId;
                keysDesejadas.add(markerKey);

                const coords = obterCoordenadaPrecisaBrick(freguesia, localidade);
                const isAuditado = coords.auditado === true;
                
                bounds.extend(coords);
                totalPontosDesenhados++;

                const pinColor = motoristaDono ? motoristaDono.color : "#9CA3AF";
                const pinStrokeColor = isAuditado ? "#10B981" : (motoristaDono ? "#FFFFFF" : "#4B5563");
                const pinStrokeWeight = isAuditado ? 2.5 : 1.5;

                let marker = dashboardMarkersMap.get(markerKey);

                if (!marker) {
                    marker = new google.maps.Marker({
                        position: coords,
                        map: dashboardMap,
                        visible: brickPinosVisiveis,
                        draggable: modoCalibracaoAtivo,
                        zIndex: 100,
                        icon: {
                            path: pinSvgPath,
                            fillColor: pinColor,
                            fillOpacity: 1.0,
                            strokeWeight: pinStrokeWeight,
                            strokeColor: pinStrokeColor,
                            scale: 1.2,
                            anchor: new google.maps.Point(12, 22)
                        },
                        title: `${freguesia} - ${localidade} ${isAuditado ? '✅ [Auditado]' : '⏳ [Estimado]'}`
                    });

                    marker.addListener('dragend', (event) => {
                        const novaLat = event.latLng.lat();
                        const novaLng = event.latLng.lng();
                        const agora = new Date();
                        const hoje = `${String(agora.getDate()).padStart(2, '0')}/${String(agora.getMonth() + 1).padStart(2, '0')}/${agora.getFullYear()}`;
                        
                        const novasCoords = { 
                            lat: novaLat, 
                            lng: novaLng,
                            auditado: true,
                            auditadoEm: hoje
                        };

                        brickCoordsCache[brickId] = novasCoords;
                        salvarCacheCoordenadas();

                        db.collection('brickCoordinates').doc(brickId).set({
                            lat: novaLat,
                            lng: novaLng,
                            auditado: true,
                            auditadoEm: hoje,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        }).then(() => {
                            console.log(`✅ [CALIBRAÇÃO] Posição do Brick "${brickId}" atualizada no Firestore.`);
                        }).catch((err) => {
                            console.error(`❌ [CALIBRAÇÃO] Erro ao gravar coordenada:`, err);
                        });

                        renderGeographicTree();

                        if (dashboardInfoWindow) {
                            dashboardInfoWindow.setContent(`
                                <div style="font-family: system-ui, sans-serif; font-size: 11px; padding: 4px;">
                                    <div style="font-weight: 800; color: #10B981;">🎯 Posição Calibrada & Auditada!</div>
                                    <div style="color: #374151; font-weight: 600; font-size: 10px; margin-top: 2px;">${freguesia} - ${localidade}</div>
                                    <div style="color: #6B7280; font-size: 9px; font-mono;">(${novaLat.toFixed(6)}, ${novaLng.toFixed(6)})</div>
                                </div>
                            `);
                            dashboardInfoWindow.setPosition(novasCoords);
                            dashboardInfoWindow.open(dashboardMap, marker);
                        }
                    });

                    dashboardMarkersMap.set(markerKey, marker);
                } else {
                    marker.setPosition(coords);
                    marker.setVisible(brickPinosVisiveis);
                    marker.setDraggable(modoCalibracaoAtivo);
                    marker.setIcon({
                        path: pinSvgPath,
                        fillColor: pinColor,
                        fillOpacity: 1.0,
                        strokeWeight: pinStrokeWeight,
                        strokeColor: pinStrokeColor,
                        scale: 1.2,
                        anchor: new google.maps.Point(12, 22)
                    });
                }

                const safeDomId = normalizedBid.replace(/[^a-zA-Z0-9]/g, '_');
                
                const exibirInfoBrick = () => {
                    if (dashboardInfoWindow) {
                        const cpFormatado = Array.isArray(cpList) && cpList.length > 0 
                            ? (cpList.length === 1 ? cpList[0] : `${cpList[0]} a ${cpList[cpList.length - 1]}`)
                            : "";

                        const opcoesDriversHtml = `
                            <option value="" ${!motoristaDono ? 'selected' : ''}>-- Sem Motorista (Livre) --</option>
                            ${driversDoConcelho.map(d => `
                                <option value="${d.id}" ${motoristaDono && d.id === motoristaDono.id ? 'selected' : ''} style="color: ${d.color}; font-weight: bold;">
                                    ${d.name}
                                </option>
                            `).join('')}
                        `;

                        const posAtual = marker.getPosition();
                        const latAtual = posAtual ? posAtual.lat().toFixed(6) : coords.lat.toFixed(6);
                        const lngAtual = posAtual ? posAtual.lng().toFixed(6) : coords.lng.toFixed(6);

                        const seloAuditoriaHtml = isAuditado 
                            ? `<div style="display: inline-flex; align-items: center; gap: 4px; background-color: #ECFDF5; color: #059669; border: 1px solid #A7F3D0; padding: 2px 7px; border-radius: 6px; font-size: 9px; font-weight: 800; margin-top: 4px;">
                                   <i class="fa-solid fa-circle-check"></i> Posição Auditada & Fixada ${coords.auditadoEm ? `(${coords.auditadoEm})` : ''}
                               </div>`
                            : `<div style="display: inline-flex; align-items: center; gap: 4px; background-color: #FFFBEB; color: #D97706; border: 1px solid #FDE68A; padding: 2px 7px; border-radius: 6px; font-size: 9px; font-weight: 800; margin-top: 4px;">
                                   <i class="fa-solid fa-clock"></i> Posição Estimada (Não Auditado)
                               </div>`;

                        dashboardInfoWindow.setContent(`
                            <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 12px; padding: 6px; line-height: 1.4; width: 260px;">
                                <div style="font-weight: 800; color: #1F2937; font-size: 13px; margin-bottom: 2px;">
                                    📍 ${freguesia}
                                </div>
                                <div style="font-weight: 700; color: #2563EB; font-size: 12px;">
                                    Brick: ${localidade}
                                </div>
                                ${cpFormatado ? `<div style="font-size: 10px; font-family: monospace; color: #6B7280; margin-top: 2px;">CPs: ${cpFormatado}</div>` : ''}

                                ${seloAuditoriaHtml}

                                <!-- 1. SELETOR DE MOTORISTA -->
                                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #E5E7EB;">
                                    <label style="display: block; font-size: 9px; font-weight: 900; text-transform: uppercase; color: #6B7280; margin-bottom: 3px;">
                                        Estante de (Alterar Motorista):
                                    </label>
                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background-color: ${pinColor}; flex-shrink: 0;"></span>
                                        <select onchange="if(typeof window.trocarMotoristaDoBrick === 'function') window.trocarMotoristaDoBrick('${brickId}', this.value)"
                                                style="flex: 1; padding: 4px 6px; border-radius: 6px; border: 1px solid #D1D5DB; font-size: 11px; font-weight: 800; color: #1F2937; background: #F9FAFB; outline: none; cursor: pointer;">
                                            ${opcoesDriversHtml}
                                        </select>
                                    </div>
                                </div>

                                <!-- 2. CALIBRAÇÃO DIRETA: COLAR COORDENADAS DO GOOGLE MAPS -->
                                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #E5E7EB;">
                                    <label style="display: block; font-size: 9px; font-weight: 900; text-transform: uppercase; color: #6B7280; margin-bottom: 3px;">
                                        🎯 Fixar Coordenada Google Maps:
                                    </label>
                                    <div style="display: flex; gap: 4px; align-items: center;">
                                        <input type="text" id="input-coords-${safeDomId}" 
                                               placeholder="Cole: 38.7574, -9.3633" 
                                               value="${latAtual}, ${lngAtual}"
                                               style="flex: 1; padding: 5px 6px; border-radius: 6px; border: 1px solid #D1D5DB; font-size: 10px; font-family: monospace; color: #1F2937; background: #FFFFFF; outline: none;" />
                                        <button type="button" 
                                                onclick="window.atualizarCoordenadaManualBrick('${brickId}', document.getElementById('input-coords-${safeDomId}').value)"
                                                style="background: #2563EB; color: white; border: none; border-radius: 6px; padding: 5px 9px; font-size: 10px; font-weight: 900; cursor: pointer; transition: all;">
                                            Fixar
                                        </button>
                                    </div>
                                    <div style="font-size: 8px; color: #9CA3AF; margin-top: 3px; font-style: italic;">
                                        Copie as coordenadas no Google Maps e cole aqui para auditar e fixar o pino.
                                    </div>
                                </div>
                            </div>
                        `);
                        dashboardInfoWindow.setPosition(marker.getPosition());
                        dashboardInfoWindow.open(dashboardMap, marker);
                    }
                };

                google.maps.event.clearInstanceListeners(marker);
                marker.addListener('click', exibirInfoBrick);
            }
        }
    }

    for (const [key, marker] of dashboardMarkersMap.entries()) {
        if (!keysDesejadas.has(key)) {
            marker.setMap(null);
            dashboardMarkersMap.delete(key);
        }
    }

    if (totalPontosDesenhados > 0 && dashboardMap) {
        dashboardMap.fitBounds(bounds);

        google.maps.event.addListenerOnce(dashboardMap, 'bounds_changed', function () {
            if (dashboardMap.getZoom() > 14) {
                dashboardMap.setZoom(14);
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
        const brickCount = (Array.isArray(driver.brickIds) ? driver.brickIds : []).filter(id => {
            if (!id || typeof id !== 'string' || !id.includes('|')) return false;
            const [freg, loc] = id.split('|');
            return GEOGRAPHY[concelhoAtivo] && GEOGRAPHY[concelhoAtivo][freg] && GEOGRAPHY[concelhoAtivo][freg][loc];
        }).length;

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
            <span class="text-[9px] font-black uppercase px-2 py-0.5 rounded ${
                brickCount > 0 ? 'bg-blue-100/50 text-blue-700 border border-blue-200' : 'bg-gray-100 text-gray-500 border border-gray-200'
            } flex-shrink-0">
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

            const isAuditado = Boolean(brickCoordsCache[brickId] && brickCoordsCache[brickId].auditado === true);

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
                        ${isAuditado 
                            ? `<span class="text-[8px] bg-emerald-50 text-emerald-600 font-bold px-1.5 py-0.2 rounded border border-emerald-200">🎯 GPS OK</span>` 
                            : `<span class="text-[8px] bg-gray-100 text-gray-400 font-medium px-1 py-0.2 rounded">📍 Pendente</span>`}
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
                        ${isAuditado 
                            ? `<span class="text-[8px] bg-emerald-50 text-emerald-700 font-bold px-1.5 py-0.5 rounded border border-emerald-200 shrink-0">🎯 GPS OK</span>` 
                            : `<span class="text-[8px] bg-gray-100 text-gray-400 font-medium px-1 py-0.5 rounded shrink-0">📍 Pendente</span>`}
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

                allLocs.forEach(locName => {
                    const brickId = `${freguesiaName}|${locName}`;
                    const normalizedBid = normalizarBrickId(brickId);
                    const motoristaDono = localidadeParaMotorista.get(normalizedBid);
                    const isOwnedByOther = motoristaDono && motoristaDono.id !== activeDriver.id;

                    if (checkedState) {
                        const isAlreadyOwned = updatedBrickIds.map(id => normalizarBrickId(id)).includes(normalizedBid);
                        if (!isOwnedByOther && !isAlreadyOwned) {
                            updatedBrickIds.push(brickId);
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
    configurarMapeadorCP7();

    renderDriversForAttribution();
    renderGeographicTree();
    atualizarAuditoriaBricks();

    setTimeout(inicializarMapaBricksDashboard, 150);
};