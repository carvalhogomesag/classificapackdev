/**
 * js/rotas-laco.js
 * Versão v83.1 - Sistema Multi-Cluster de Perímetros com Ocultação em Fecho de Turno
 * Faz: Permite desenhar múltiplos blocos/perímetros com cores distintas sobre o mapa,
 *      deteta paragens em cada polígono, suporta agrupamento antes e depois da otimização,
 *      garante que a barra flutuante de blocos NUNCA aparece com o turno fechado/na tela de setup,
 *      e previne a repetição de cores entre múltiplos clusters.
 * Depende de: ./maps.js, ./rotas.js, ./storage.js
 */

import { 
    obterInstanciaMapaGoogle, 
    destacarMarcadoresGrupo, 
    desenharMapaGoogle, 
    desenharMapaPlaneamento 
} from './maps.js';

import { sincronizarPersistencia } from './rotas.js';

let isDrawingMode = false;
let drawingPolyline = null;
let capturedCoordinates = [];
let onGrupoCallbackAtual = null;

// Paleta de cores vibrantes para distinguir múltiplos blocos sem repetição
const PALETA_CLUSTERS = [
    { nome: "Roxo",      cor: "#8B5CF6", borda: "#6D28D9", fundo: "#8B5CF625" },
    { nome: "Ciano",     cor: "#06B6D4", borda: "#0891B2", fundo: "#06B6D425" },
    { nome: "Rosa",      cor: "#EC4899", borda: "#DB2777", fundo: "#EC489925" },
    { nome: "Esmeralda", cor: "#10B981", borda: "#059669", fundo: "#10B98125" },
    { nome: "Âmbar",     cor: "#F59E0B", borda: "#D97706", fundo: "#F59E0B25" },
    { nome: "Índigo",    cor: "#6366F1", borda: "#4F46E5", fundo: "#6366F125" },
    { nome: "Teal",      cor: "#14B8A6", borda: "#0D9488", fundo: "#14B8A625" },
    { nome: "Rubi",      cor: "#E11D48", borda: "#BE123C", fundo: "#E11D4825" },
    { nome: "Azul Real", cor: "#3B82F6", borda: "#1D4ED8", fundo: "#3B82F625" }
];

// Registo em memória de todos os polígonos visuais desenhados no mapa
let activePolygons = new Map(); // clusterId -> google.maps.Polygon

/**
 * Algoritmo Ray-Casting para detetar se uma coordenada GPS está dentro do polígono
 */
function pontoNoPoligono(ponto, vertices) {
    const x = ponto.lat;
    const y = ponto.lng;
    let dentro = false;

    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const xi = vertices[i].lat, yi = vertices[i].lng;
        const xj = vertices[j].lat, yj = vertices[j].lng;

        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) dentro = !dentro;
    }
    return dentro;
}

/**
 * Converte coordenadas de pixel do ecrã para coordenadas geográficas LatLng do Google Maps
 */
function pixelParaLatLng(map, clientX, clientY) {
    const mapDiv = map.getDiv();
    const rect = mapDiv.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const bounds = map.getBounds();
    if (!bounds) return null;

    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();

    const lat = ne.lat() - (y / rect.height) * (ne.lat() - sw.lat());
    const lng = sw.lng() + (x / rect.width) * (ne.lng() - sw.lng());

    return { lat, lng };
}

/**
 * Retorna a próxima cor virgem e não utilizada para um novo cluster
 */
function obterProximaCorCluster() {
    const lista = (window.rotaOtimizada && window.rotaOtimizada.length > 0) ? window.rotaOtimizada : window.moradasEntregas;
    const coresEmUso = new Set();

    if (Array.isArray(lista)) {
        lista.forEach(p => {
            if (p.isClusterGroup && p.clusterColor) {
                coresEmUso.add(p.clusterColor.toUpperCase());
            }
        });
    }

    const corDisponivel = PALETA_CLUSTERS.find(c => !coresEmUso.has(c.cor.toUpperCase()));
    if (corDisponivel) {
        return corDisponivel;
    }

    const indexCor = coresEmUso.size % PALETA_CLUSTERS.length;
    return PALETA_CLUSTERS[indexCor];
}

/**
 * Ativa o modo de desenho livre de perímetro sobre o mapa
 */
export function ativarModoDesenhoPerimetro(onGrupoSelecionadoCallback) {
    const map = obterInstanciaMapaGoogle();
    if (!map) {
        alert("O mapa ainda não está carregado. Adicione pelo menos uma morada primeiro.");
        return;
    }

    onGrupoCallbackAtual = onGrupoSelecionadoCallback;
    isDrawingMode = true;

    map.setOptions({
        draggable: false,
        gestureHandling: 'none'
    });

    const mapDiv = map.getDiv();
    mapDiv.style.cursor = 'crosshair';

    capturedCoordinates = [];
    const configCor = obterProximaCorCluster();

    drawingPolyline = new google.maps.Polyline({
        map: map,
        path: [],
        strokeColor: configCor.cor,
        strokeOpacity: 0.9,
        strokeWeight: 3.5,
        zIndex: 9999
    });

    const iniciarDesenho = (e) => {
        if (!isDrawingMode) return;
        capturedCoordinates = [];
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const coords = pixelParaLatLng(map, clientX, clientY);
        if (coords) {
            capturedCoordinates.push(coords);
            drawingPolyline.setPath(capturedCoordinates);
        }
    };

    const desenhar = (e) => {
        if (!isDrawingMode || capturedCoordinates.length === 0) return;
        e.preventDefault();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const coords = pixelParaLatLng(map, clientX, clientY);
        if (coords) {
            capturedCoordinates.push(coords);
            drawingPolyline.setPath(capturedCoordinates);
        }
    };

    const finalizarDesenho = () => {
        if (!isDrawingMode || capturedCoordinates.length < 3) {
            desativarModoDesenho();
            return;
        }

        if (drawingPolyline) {
            drawingPolyline.setMap(null);
            drawingPolyline = null;
        }

        const clusterId = `cluster_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        const corCluster = obterProximaCorCluster();

        const novoPoligono = new google.maps.Polygon({
            map: map,
            paths: capturedCoordinates,
            strokeColor: corCluster.borda,
            strokeOpacity: 0.9,
            strokeWeight: 2.5,
            fillColor: corCluster.cor,
            fillOpacity: 0.18,
            zIndex: 9990
        });

        activePolygons.set(clusterId, novoPoligono);

        desativarModoDesenho();
        processarNovoCluster(clusterId, corCluster, capturedCoordinates);
    };

    mapDiv.onmousedown = iniciarDesenho;
    mapDiv.onmousemove = desenhar;
    mapDiv.onmouseup = finalizarDesenho;

    mapDiv.ontouchstart = iniciarDesenho;
    mapDiv.ontouchmove = desenhar;
    mapDiv.ontouchend = finalizarDesenho;

    exibirBarraAvisoDesenho();
}

/**
 * Desativa a captura de desenho e restaura o controlo do mapa
 */
export function desativarModoDesenho() {
    isDrawingMode = false;
    const map = obterInstanciaMapaGoogle();
    if (map) {
        map.setOptions({
            draggable: true,
            gestureHandling: 'auto'
        });
        const mapDiv = map.getDiv();
        mapDiv.style.cursor = '';
        mapDiv.onmousedown = null;
        mapDiv.onmousemove = null;
        mapDiv.onmouseup = null;
        mapDiv.ontouchstart = null;
        mapDiv.ontouchmove = null;
        mapDiv.ontouchend = null;
    }
    ocultarBarraAvisoDesenho();
}

/**
 * Processa a criação de um novo cluster a partir das coordenadas desenhadas
 */
function processarNovoCluster(clusterId, configCor, vertices) {
    const listaAlvo = (window.rotaOtimizada && window.rotaOtimizada.length > 0) ? window.rotaOtimizada : window.moradasEntregas;
    if (!Array.isArray(listaAlvo) || listaAlvo.length === 0) return;

    const clustersExistentes = new Set();
    listaAlvo.forEach(p => {
        if (p.clusterGroupId) clustersExistentes.add(p.clusterGroupId);
    });
    const numeroBloco = clustersExistentes.size + 1;
    const nomeBloco = `Bloco ${numeroBloco}`;

    const paragensNoGrupo = [];

    listaAlvo.forEach(p => {
        if (typeof p.lat === 'number' && typeof p.lng === 'number') {
            const estaDentro = pontoNoPoligono({ lat: p.lat, lng: p.lng }, vertices);
            if (estaDentro) {
                p.isClusterGroup = true;
                p.clusterGroupId = clusterId;
                p.clusterGroupName = nomeBloco;
                p.clusterColor = configCor.cor;
                p.clusterBorder = configCor.borda;
                paragensNoGrupo.push(p);
            }
        }
    });

    if (paragensNoGrupo.length === 0) {
        alert("⚠️ Nenhuma paragem foi encontrada dentro do perímetro desenhado. Tente desenhar mais próximo dos pinos.");
        removerPoligonoCluster(clusterId);
        return;
    }

    if (window.rotaOtimizada && window.rotaOtimizada.length > 0 && Array.isArray(window.moradasEntregas)) {
        const idSet = new Set(paragensNoGrupo.map(p => p.id));
        window.moradasEntregas.forEach(p => {
            if (idSet.has(p.id)) {
                p.isClusterGroup = true;
                p.clusterGroupId = clusterId;
                p.clusterGroupName = nomeBloco;
                p.clusterColor = configCor.cor;
                p.clusterBorder = configCor.borda;
            }
        });
    }

    destacarMarcadoresGrupo(paragensNoGrupo.map(p => p.id));
    renderizarPainelMultiClusters();

    sincronizarPersistencia();

    if (typeof onGrupoCallbackAtual === 'function') {
        onGrupoCallbackAtual(paragensNoGrupo);
    }
}

/**
 * Remove um cluster específico e grava a remoção imediatamente
 */
export function removerClusterEspecifico(clusterId) {
    removerPoligonoCluster(clusterId);

    const limparLista = (lista) => {
        if (!Array.isArray(lista)) return;
        lista.forEach(p => {
            if (p.clusterGroupId === clusterId) {
                p.isClusterGroup = false;
                p.clusterGroupId = null;
                p.clusterGroupName = null;
                p.clusterColor = null;
                p.clusterBorder = null;
            }
        });
    };

    limparLista(window.moradasEntregas);
    limparLista(window.rotaOtimizada);

    sincronizarPersistencia();

    const mapElement = document.getElementById('map');
    if (mapElement) {
        if (window.isRouteOptimized && window.rotaOtimizada && window.rotaOtimizada.length > 0) {
            desenharMapaGoogle(mapElement, window.partidaLocalizacao, window.rotaOtimizada);
        } else if (window.moradasEntregas && window.moradasEntregas.length > 0) {
            desenharMapaPlaneamento(mapElement, window.partidaLocalizacao, window.moradasEntregas);
        }
    }

    renderizarPainelMultiClusters();
}

/**
 * Remove o polígono do Google Maps
 */
function removerPoligonoCluster(clusterId) {
    const poly = activePolygons.get(clusterId);
    if (poly) {
        poly.setMap(null);
        activePolygons.delete(clusterId);
    }
}

/**
 * Limpa todos os clusters e polígonos e persiste a limpeza
 */
export function limparTodosClusters() {
    activePolygons.forEach(poly => {
        if (poly) poly.setMap(null);
    });
    activePolygons.clear();

    const limparLista = (lista) => {
        if (!Array.isArray(lista)) return;
        lista.forEach(p => {
            p.isClusterGroup = false;
            p.clusterGroupId = null;
            p.clusterGroupName = null;
            p.clusterColor = null;
            p.clusterBorder = null;
        });
    };

    limparLista(window.moradasEntregas);
    limparLista(window.rotaOtimizada);

    sincronizarPersistencia();

    const mapElement = document.getElementById('map');
    if (mapElement) {
        if (window.isRouteOptimized && window.rotaOtimizada && window.rotaOtimizada.length > 0) {
            desenharMapaGoogle(mapElement, window.partidaLocalizacao, window.rotaOtimizada);
        } else if (window.moradasEntregas && window.moradasEntregas.length > 0) {
            desenharMapaPlaneamento(mapElement, window.partidaLocalizacao, window.moradasEntregas);
        }
    }

    renderizarPainelMultiClusters();
}

/**
 * Renderiza o painel flutuante de múltiplos clusters (Com proteção de Turno Fechado)
 */
export function renderizarPainelMultiClusters() {
    let container = document.getElementById('container-acoes-laco-grupo');
    if (!container) {
        container = document.createElement('div');
        container.id = 'container-acoes-laco-grupo';
        container.className = 'fixed bottom-20 left-1/2 -translate-x-1/2 z-[1000] bg-white/95 backdrop-blur-md border-2 border-purple-400 p-3 rounded-2xl shadow-2xl transition-all max-w-[92vw] overflow-x-auto';
        document.body.appendChild(container);
    }

    // REGRA DE OURO: Se o turno não está iniciado (tela de setup ativa), ESCONDE O PAINEL 100%!
    if (!window.rotaIniciada) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }

    const lista = (window.rotaOtimizada && window.rotaOtimizada.length > 0) ? window.rotaOtimizada : window.moradasEntregas;
    const clustersMap = new Map();

    if (Array.isArray(lista)) {
        lista.forEach(p => {
            if (p.isClusterGroup && p.clusterGroupId) {
                if (!clustersMap.has(p.clusterGroupId)) {
                    clustersMap.set(p.clusterGroupId, {
                        id: p.clusterGroupId,
                        name: p.clusterGroupName || "Bloco",
                        color: p.clusterColor || "#8B5CF6",
                        count: 0
                    });
                }
                clustersMap.get(p.clusterGroupId).count++;
            }
        });
    }

    if (clustersMap.size === 0) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }

    const clustersList = Array.from(clustersMap.values());

    container.innerHTML = `
        <div class="flex items-center space-x-2">
            <div class="flex items-center space-x-1.5 flex-nowrap pr-2 border-r border-gray-200">
                <span class="w-2.5 h-2.5 rounded-full bg-purple-600 animate-ping"></span>
                <span class="text-[11px] font-black text-gray-800 uppercase tracking-tight whitespace-nowrap">
                    ${clustersList.length} ${clustersList.length === 1 ? 'Bloco' : 'Blocos'}:
                </span>
            </div>

            <div class="flex items-center space-x-1.5 flex-nowrap">
                ${clustersList.map(c => `
                    <div class="flex items-center space-x-1 px-2.5 py-1 rounded-xl text-[11px] font-bold text-white shadow-2xs whitespace-nowrap" style="background-color: ${c.color};">
                        <span>${c.name} (${c.count})</span>
                        <button type="button" onclick="window.removerClusterEspecifico('${c.id}')"
                                class="hover:opacity-80 p-0.5 ml-1 text-[10px] cursor-pointer border-none bg-transparent text-white" title="Desfazer este bloco">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                `).join('')}
            </div>

            <button type="button" onclick="window.limparTodosClusters()"
                    class="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-[10px] font-extrabold rounded-lg border border-gray-300 cursor-pointer whitespace-nowrap ml-1" title="Limpar todos os blocos">
                Limpar Todos
            </button>
        </div>
    `;

    container.classList.remove('hidden');
}

/**
 * Exibe barra de aviso quando o modo de desenho está ativo
 */
function exibirBarraAvisoDesenho() {
    let barra = document.getElementById('barra-aviso-desenho-laco');
    if (!barra) {
        barra = document.createElement('div');
        barra.id = 'barra-aviso-desenho-laco';
        barra.className = 'fixed top-20 left-1/2 -translate-x-1/2 z-[1000] bg-purple-900/95 text-white px-4 py-2 rounded-2xl shadow-xl border border-purple-400 text-xs font-black flex items-center space-x-2 animate-bounce';
        document.body.appendChild(barra);
    }
    barra.innerHTML = `
        <i class="fa-solid fa-pen-nib text-purple-300"></i>
        <span>Desenhe no mapa em volta dos pinos para formar um novo bloco</span>
    `;
    barra.classList.remove('hidden');
}

function ocultarBarraAvisoDesenho() {
    const barra = document.getElementById('barra-aviso-desenho-laco');
    if (barra) barra.classList.add('hidden');
}

// Assinaturas públicas no objeto global Window
window.ativarModoDesenhoPerimetro = ativarModoDesenhoPerimetro;
window.removerClusterEspecifico = removerClusterEspecifico;
window.limparTodosClusters = limparTodosClusters;
window.renderizarPainelMultiClusters = renderizarPainelMultiClusters;