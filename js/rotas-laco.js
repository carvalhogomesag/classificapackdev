/**
 * js/rotas-laco.js
 * Versão v81.0 - Módulo de Desenho Livre de Perímetro (Lasso) e Agrupamento em Bloco
 * Faz: Permite ao utilizador desenhar livremente com o dedo/rato sobre o mapa da rota,
 *      deteta todas as paragens contidas no perímetro desenhado e agrupa-as para roteirização conjunta.
 * Depende de: ./maps.js, ./storage.js
 */

import { obterInstanciaMapaGoogle, destacarMarcadoresGrupo } from './maps.js';

let isDrawingMode = false;
let currentPolygon = null;
let drawingPolyline = null;
let capturedCoordinates = [];
let mouseMoveListener = null;
let touchMoveListener = null;

/**
 * Algoritmo matemático Ray-Casting para detetar se um ponto GPS está dentro do polígono
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
 * Converte coordenadas de pixel do ecrã (clientX, clientY) para coordenadas geográficas LatLng
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
 * Ativa o modo de desenho livre de perímetro sobre o mapa
 */
export function ativarModoDesenhoPerimetro(onGrupoSelecionadoCallback) {
    const map = obterInstanciaMapaGoogle();
    if (!map) {
        alert("O mapa ainda não está carregado.");
        return;
    }

    limparPerimetroDesenho();
    isDrawingMode = true;

    // Desativa o arrasto do mapa para permitir o desenho com o dedo/rato
    map.setOptions({
        draggable: false,
        gestureHandling: 'none'
    });

    const mapDiv = map.getDiv();
    mapDiv.style.cursor = 'crosshair';

    capturedCoordinates = [];

    // Cria a linha guia do desenho em tempo real
    drawingPolyline = new google.maps.Polyline({
        map: map,
        path: [],
        strokeColor: "#8B5CF6",
        strokeOpacity: 0.9,
        strokeWeight: 3,
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

        // Fecha o polígono
        if (drawingPolyline) {
            drawingPolyline.setMap(null);
            drawingPolyline = null;
        }

        currentPolygon = new google.maps.Polygon({
            map: map,
            paths: capturedCoordinates,
            strokeColor: "#7C3AED",
            strokeOpacity: 0.9,
            strokeWeight: 2.5,
            fillColor: "#8B5CF6",
            fillOpacity: 0.2,
            zIndex: 9998
        });

        desativarModoDesenho();
        processarParagensNoPerimetro(capturedCoordinates, onGrupoSelecionadoCallback);
    };

    // Eventos do Rato
    mapDiv.onmousedown = iniciarDesenho;
    mapDiv.onmousemove = desenhar;
    mapDiv.onmouseup = finalizarDesenho;

    // Eventos Touch (Mobile)
    mapDiv.ontouchstart = iniciarDesenho;
    mapDiv.ontouchmove = desenhar;
    mapDiv.ontouchend = finalizarDesenho;

    exibirBarraAvisoDesenho();
}

/**
 * Desativa o modo de captura de desenho e restaura o controlo do mapa
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
 * Identifica quais paragens estão dentro do perímetro desenhado e aplica o agrupamento
 */
function processarParagensNoPerimetro(vertices, onGrupoSelecionadoCallback) {
    const listaAtual = (window.rotaOtimizada && window.rotaOtimizada.length > 0) ? window.rotaOtimizada : window.moradasEntregas;
    if (!Array.isArray(listaAtual) || listaAtual.length === 0) return;

    const paragensNoGrupo = [];

    listaAtual.forEach((p, idx) => {
        if (typeof p.lat === 'number' && typeof p.lng === 'number') {
            const estaDentro = pontoNoPoligono({ lat: p.lat, lng: p.lng }, vertices);
            if (estaDentro) {
                p.isClusterGroup = true;
                p.clusterGroupId = p.clusterGroupId || `cluster_${Date.now()}`;
                paragensNoGrupo.push(p);
            }
        }
    });

    if (paragensNoGrupo.length === 0) {
        alert("⚠️ Nenhuma paragem foi encontrada dentro do perímetro desenhado. Tente desenhar em volta dos pinos pretendidos.");
        limparPerimetroDesenho();
        return;
    }

    // Destaca visualmente os marcadores no mapa
    destacarMarcadoresGrupo(paragensNoGrupo.map(p => p.id));

    // Exibe a barra de ações do grupo selecionado
    exibirBarraAcoesGrupo(paragensNoGrupo.length);

    if (typeof onGrupoSelecionadoCallback === 'function') {
        onGrupoSelecionadoCallback(paragensNoGrupo);
    }
}

/**
 * Remove o polígono visual e desmarca o agrupamento de cluster
 */
export function limparPerimetroDesenho() {
    if (currentPolygon) {
        currentPolygon.setMap(null);
        currentPolygon = null;
    }
    if (drawingPolyline) {
        drawingPolyline.setMap(null);
        drawingPolyline = null;
    }
    capturedCoordinates = [];

    // Remove a flag de cluster das paragens
    const lista = (window.rotaOtimizada && window.rotaOtimizada.length > 0) ? window.rotaOtimizada : window.moradasEntregas;
    if (Array.isArray(lista)) {
        lista.forEach(p => {
            p.isClusterGroup = false;
            p.clusterGroupId = null;
        });
    }

    ocultarBarraAcoesGrupo();
}

/**
 * Exibe barra de aviso "Desenhe o perímetro no ecrã"
 */
function exibirBarraAvisoDesenho() {
    let barra = document.getElementById('barra-aviso-desenho-laco');
    if (!barra) {
        barra = document.createElement('div');
        barra.id = 'barra-aviso-desenho-laco';
        barra.className = 'fixed top-20 left-1/2 -translate-x-1/2 z-[1000] bg-purple-900/90 text-white px-4 py-2 rounded-2xl shadow-xl border border-purple-400 text-xs font-black flex items-center space-x-2 animate-bounce';
        document.body.appendChild(barra);
    }
    barra.innerHTML = `
        <i class="fa-solid fa-pen-nib text-purple-300"></i>
        <span>Desenhe com o dedo/rato em volta dos pinos que quer agrupar</span>
    `;
    barra.classList.remove('hidden');
}

function ocultarBarraAvisoDesenho() {
    const barra = document.getElementById('barra-aviso-desenho-laco');
    if (barra) barra.classList.add('hidden');
}

/**
 * Exibe a barra flutuante de confirmação com a contagem de paragens agrupadas
 */
function exibirBarraAcoesGrupo(quantidade) {
    let container = document.getElementById('container-acoes-laco-grupo');
    if (!container) {
        container = document.createElement('div');
        container.id = 'container-acoes-laco-grupo';
        container.className = 'fixed bottom-20 left-1/2 -translate-x-1/2 z-[1000] bg-white/95 backdrop-blur border-2 border-purple-500 p-3 rounded-2xl shadow-2xl flex items-center space-x-3 transition-all';
        document.body.appendChild(container);
    }

    container.innerHTML = `
        <div class="flex items-center space-x-2">
            <span class="w-3 h-3 rounded-full bg-purple-600 animate-ping"></span>
            <span class="text-xs font-black text-gray-800">
                🔗 <strong>${quantidade}</strong> paragens agrupadas em bloco!
            </span>
        </div>
        <button type="button" onclick="window.limparPerimetroLaco()"
                class="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl border border-gray-300 cursor-pointer">
            Limpar
        </button>
    `;
    container.classList.remove('hidden');
}

function ocultarBarraAcoesGrupo() {
    const container = document.getElementById('container-acoes-laco-grupo');
    if (container) container.classList.add('hidden');
}

// Assinaturas públicas no objeto global Window
window.ativarModoDesenhoPerimetro = ativarModoDesenhoPerimetro;
window.limparPerimetroLaco = limparPerimetroDesenho;