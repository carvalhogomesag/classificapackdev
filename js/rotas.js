/**
 * js/rotas.js
 * Versão v70.7 - Adição Rápida na Última Posição com Destaque Laranja/Borda Preta e Bounce
 * Faz: Gere a adição de entregas/recolhas diretamente no fim da rota ativa com destaque visual
 *      saltitante (bounce) até confirmação manual de posição, sincronizando em tempo real com o Firestore.
 */

import { saveData } from './storage.js';
import { criarReconhecimentoVoz } from './voz.js';
import { GEOGRAPHY, obterEnderecoHigienizado } from './geografia-data.js';
import { 
    obterEnderecoPorGPSGoogle, 
    calcularDistanciaHaversine, 
    desenharMapaGoogle, 
    limparMapaVisual 
} from './maps.js';

// Importa o módulo de navegação (Google Maps vs Waze)
import { abrirNavegacao } from './navigation.js';

// Importa a instância ativa do Firestore
import { db } from './firebase-init.js';

let itemSendoEditado = null; 
let autocompleteInstancia = null;

let embalagemSelecionada = "";
let origemSelecionada = "";

// =========================================================================
// DETETOR INTELIGENTE DE AMBIENTE (LOCAL VS PRODUÇÃO)
// =========================================================================
const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://classificapack-backend.onrender.com';

// ==========================================
// PERSISTÊNCIA DAS ROTAS (LOCALSTORAGE + FIRESTORE)
// ==========================================
function sincronizarPersistencia() {
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

    localStorage.setItem('cp_routing_method', window.routingMethodUsed || 'Cloud');
    localStorage.setItem('cp_trip_started', JSON.stringify(window.tripStarted));
    localStorage.setItem('cp_trip_completed', JSON.stringify(window.tripCompleted));
    localStorage.setItem('cp_odometer_start', JSON.stringify(window.odometerStart));
    localStorage.setItem('cp_odometer_start_hour', JSON.stringify(window.odometerStartHour));
    localStorage.setItem('cp_odometer_end', JSON.stringify(window.odometerEnd));
    localStorage.setItem('cp_odometer_end_hour', JSON.stringify(window.odometerEndHour));
    localStorage.setItem('cp_last_odometer', JSON.stringify(window.lastOdometer));

    if (window.currentUserUid) {
        db.collection('routes').doc(window.currentUserUid).set({
            partidaLocalizacao: window.partidaLocalizacao || null,
            moradasEntregas: window.moradasEntregas || [],
            rotaOtimizada: window.rotaOtimizada || [],
            dataRotaSelecionada: window.dataRotaSelecionada || "",
            rotaIniciada: window.rotaIniciada || false,
            routingMethodUsed: window.routingMethodUsed || 'Cloud',

            tripStarted: window.tripStarted || false,
            tripCompleted: window.tripCompleted || false,
            odometerStart: window.odometerStart || 0,
            odometerStartHour: window.odometerStartHour || "",
            odometerEnd: window.odometerEnd || 0,
            odometerEndHour: window.odometerEndHour || "",
            lastOdometer: window.lastOdometer || 0,

            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            console.log("[FIREBASE] Rota sincronizada no Firestore com sucesso.");
        }).catch((err) => {
            console.error("[FIREBASE] Erro ao sincronizar rota no Firestore:", err);
        });
    }
}

// ==========================================
// CENTRAL DE MODOS: PLANEAMENTO VS CONDUÇÃO
// ==========================================
export function alternarModoRota(modo) {
    const btnPlaneamento = document.getElementById('btn-modo-planeamento');
    const btnConducao = document.getElementById('btn-modo-conducao');
    const planningControls = document.getElementById('planning-controls');

    if (!btnPlaneamento || !btnConducao || !planningControls) return;

    if (modo === 'conducao') {
        planningControls.classList.add('hidden');
        btnConducao.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-white text-blue-600 shadow transition-all";
        btnPlaneamento.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 transition-all";
        localStorage.setItem('cp_modo_rota', 'conducao');
    } else {
        planningControls.classList.remove('hidden');
        btnPlaneamento.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-white text-blue-600 shadow transition-all";
        btnConducao.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 transition-all";
        localStorage.setItem('cp_modo_rota', 'planeamento');
    }
}

// ==========================================
// RECONHECIMENTO DE VOZ (ABA ROTAS)
// ==========================================
export function setupVozLogic() {
    const btnVoz = document.getElementById('btn-voz');
    const buscaMoradaInput = document.getElementById('rota-morada-completa');
    const micAtivo = document.getElementById('microfone-ativo');
    const micInativo = document.getElementById('microfone-inativo');

    if (!btnVoz || !buscaMoradaInput) return;

    criarReconhecimentoVoz({
        btnElement: btnVoz,
        micAtivoElement: micAtivo,
        micInativoElement: micInativo,
        activeClasses: ['bg-red-500', 'text-white'],
        inactiveClasses: ['bg-blue-50', 'text-blue-700'],
        onResult: (transcript) => {
            buscaMoradaInput.value = transcript;
            buscaMoradaInput.dispatchEvent(new Event('input', { bubbles: true }));
            buscaMoradaInput.focus();
        }
    });
}

function isCatchAllLocality(freguesia, localidade) {
    const cleanFreg = freguesia.replace(/\s+MFR$/i, "").toLowerCase();
    const cleanLoc = localidade.replace(/\s*\(\d{3}-\d{3}\)$/, "").toLowerCase();
    
    if (cleanLoc === cleanFreg) return true;
    if (cleanFreg === "são miguel de alcainça" && cleanLoc === "alcainça") return true;
    return false;
}

function obterConcelhoPorCodigoPostal(zip) {
    if (!zip) return "MAFRA";
    const cleanPrefix = zip.replace(/\D/g, '').substring(0, 4);
    if (cleanPrefix === "2705" || cleanPrefix === "2710" || cleanPrefix === "2715" || cleanPrefix === "2725") {
        return "SINTRA";
    }
    return "MAFRA";
}

function resolveBrickForZip(zip, drivers) {
    if (!zip || !drivers) return { brickId: null, brickName: null };
    const regexZip = /\d{4}-\d{3}/;
    const match = zip.match(regexZip);
    const normalizedZip = match ? match[0] : zip.trim();

    const concelho = obterConcelhoPorCodigoPostal(normalizedZip);

    let matchedFreguesia = null;
    let matchedLocalidade = null;

    if (!GEOGRAPHY[concelho]) return { brickId: null, brickName: null };

    for (const [freguesia, localidades] of Object.entries(GEOGRAPHY[concelho])) {
        for (const [localidade, cpList] of Object.entries(localidades)) {
            if (isCatchAllLocality(freguesia, localidade)) continue;
            if (cpList.includes(normalizedZip)) {
                matchedFreguesia = freguesia;
                matchedLocalidade = localidade;
                break;
            }
        }
        if (matchedFreguesia) break;
    }

    if (!matchedFreguesia) {
        for (const [freguesia, localidades] of Object.entries(GEOGRAPHY[concelho])) {
            for (const [localidade, cpList] of Object.entries(localidades)) {
                if (isCatchAllLocality(freguesia, localidade) && cpList.includes(normalizedZip)) {
                    matchedFreguesia = freguesia;
                    matchedLocalidade = localidade;
                    break;
                }
            }
            if (matchedFreguesia) break;
        }
    }

    if (!matchedFreguesia) return { brickId: null, brickName: null };

    return { 
        brickId: `${matchedFreguesia}|${matchedLocalidade}`, 
        brickName: matchedLocalidade 
    };
}

function calcularRotaVizinhoMaisProximoLocal() {
    if (!window.partidaLocalizacao || window.moradasEntregas.length === 0) return;

    const unvisited = [...window.moradasEntregas];
    const optimized = [];
    let currentCoords = { lat: window.partidaLocalizacao.lat, lng: window.partidaLocalizacao.lng };

    while (unvisited.length > 0) {
        let nearestIndex = 0;
        let minDistance = Infinity;

        for (let i = 0; i < unvisited.length; i++) {
            const dist = calcularDistanciaHaversine(
                currentCoords.lat,
                currentCoords.lng,
                unvisited[i].lat,
                unvisited[i].lng
            );
            if (dist < minDistance) {
                minDistance = dist;
                nearestIndex = i;
            }
        }

        const nextStop = unvisited.splice(nearestIndex, 1)[0];
        nextStop.distanciaDoAnterior = minDistance;
        optimized.push(nextStop);
        currentCoords = { lat: nextStop.lat, lng: nextStop.lng };
    }

    window.rotaOtimizada = optimized;
}

// =========================================================================
// ADICIONAR NOVA AÇÃO (ENTREGA OU RECOLHA) DIRETAMENTE NO FIM DA ROTA
// =========================================================================
export async function processarAdicaoPorPostal() {
    const inputPostal = document.getElementById('rota-codigo-postal');
    const inputMorada = document.getElementById('rota-morada-completa');
    const btnAdicionar = document.getElementById('btn-adicionar-postal-rota');
    const statusPartida = document.getElementById('status-partida');

    if (!inputPostal || !btnAdicionar) return;

    const postalCodeVal = inputPostal.value.trim();
    const moradaVal = inputMorada ? inputMorada.value.trim() : "";

    const cleanZip = postalCodeVal.replace(/\D/g, '');
    if (cleanZip.length !== 7) {
        alert("Por favor, introduza um Código Postal válido com 7 dígitos (ex: 2655-319).");
        inputPostal.focus();
        return;
    }

    const formattedZip = `${cleanZip.substring(0, 4)}-${cleanZip.substring(4, 7)}`;

    btnAdicionar.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> <span>A geolocalizar...</span>';
    btnAdicionar.disabled = true;

    try {
        const response = await fetch(`${API_BASE_URL}/api/geocode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                postalCode: formattedZip,
                address: moradaVal
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Ocorreu uma falha ao geolocalizar.");
        }

        const { brickId, brickName } = resolveBrickForZip(formattedZip, window.drivers);
        const tipoOperacaoVal = document.getElementById('rota-tipo-operacao')?.value || "Entrega";

        const novaMorada = {
            id: 'm_' + Date.now() + Math.random().toString(36).substr(2, 5),
            lat: data.lat,
            lng: data.lng,
            address: data.address,
            status: "Pendente",
            observation: "",
            priority: false,
            brickId: brickId,
            brickName: brickName,
            tipoOperacao: tipoOperacaoVal,
            isNewUnconfirmed: true // MARCA COMO NOVA AÇÃO NÃO CONFIRMADA (LARANJA + BORDA PRETA + BOUNCE)
        };

        if (window.definindoPartidaPorMorada) {
            novaMorada.isNewUnconfirmed = false;
            window.partidaLocalizacao = novaMorada;
            if (statusPartida) statusPartida.innerHTML = `<strong>Partida:</strong> ${novaMorada.address}`;
            window.definindoPartidaPorMorada = false;
            sincronizarPersistencia();
            alert("Ponto de Partida configurado com sucesso!");
        } else {
            window.moradasEntregas.push(novaMorada);

            // SE A ROTA JÁ TIVER AÇÕES, ADICIONA DIRETAMENTE NO FIM (ÚLTIMA POSIÇÃO)
            if (!window.rotaOtimizada) window.rotaOtimizada = [];

            let pontoAnterior = window.partidaLocalizacao;
            if (window.rotaOtimizada.length > 0) {
                pontoAnterior = window.rotaOtimizada[window.rotaOtimizada.length - 1];
            }

            novaMorada.distanciaDoAnterior = pontoAnterior ? calcularDistanciaHaversine(
                pontoAnterior.lat,
                pontoAnterior.lng,
                novaMorada.lat,
                novaMorada.lng
            ) : 0;

            // INSERE DIRETAMENTE NO FIM DA ROTA OTIMIZADA
            window.rotaOtimizada.push(novaMorada);

            sincronizarPersistencia();
            renderMoradasAdicionadas();

            // EXIBE OS CONTENTORES DO MAPA E DA ROTA
            document.getElementById('container-mapa')?.classList.remove('hidden');
            document.getElementById('container-rota-ordenada')?.classList.remove('hidden');

            renderizarItinerarioOtimizado();
            desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);

            // MIDA AUTOMATICAMENTE PARA O MODO CONDUÇÃO PARA O MOTORISTA VER A NOVA PARAGEM NO FIM
            alternarModoRota('conducao');
        }

        inputPostal.value = "";
        if (inputMorada) inputMorada.value = "";
        
        const btnTipoEntrega = document.getElementById('btn-tipo-entrega');
        const btnTipoRecolha = document.getElementById('btn-tipo-recolha');
        const inputTipoOperacao = document.getElementById('rota-tipo-operacao');
        if (btnTipoEntrega && btnTipoRecolha && inputTipoOperacao) {
            inputTipoOperacao.value = "Entrega";
            btnTipoEntrega.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-blue-600 text-white shadow transition-all cursor-pointer flex items-center justify-center space-x-1.5 focus:outline-none";
            btnTipoRecolha.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 hover:text-gray-700 transition-all cursor-pointer flex items-center justify-center space-x-1.5 focus:outline-none";
        }

    } catch (err) {
        console.error("Erro na geocodificação:", err);
        alert(`Erro: ${err.message}`);
    } finally {
        btnAdicionar.innerHTML = '<i class="fa-solid fa-plus"></i> <span>Adicionar Pacote</span>';
        btnAdicionar.disabled = false;
    }
}

// ==========================================
// DESENHAR MORADAS ADICIONADAS (PLANEAMENTO)
// ==========================================
export function renderMoradasAdicionadas() {
    const listaMoradasAdicionadas = document.getElementById('lista-moradas-adicionadas');
    if (!listaMoradasAdicionadas) return;

    listaMoradasAdicionadas.innerHTML = "";
    if (window.moradasEntregas.length === 0) {
        listaMoradasAdicionadas.innerHTML = `<p class="text-xs text-gray-400 italic text-center py-2">Nenhuma morada adicionada.</p>`;
        return;
    }
    window.moradasEntregas.forEach((morada, index) => {
        const item = document.createElement('div');
        
        if (morada.priority) {
            item.className = "flex items-center justify-between p-2 bg-orange-50 border border-orange-200 rounded-lg text-xs animate-fade-in space-x-2";
        } else {
            item.className = "flex items-center justify-between p-2 bg-gray-50 rounded border text-xs animate-fade-in space-x-2";
        }

        const isRecolha = morada.tipoOperacao === "Recolha";

        item.innerHTML = `
            <div class="flex-1 truncate">
                <strong class="text-gray-500">#${index + 1}</strong> 
                <span>${morada.address}</span>
                ${isRecolha ? `<span class="bg-purple-100 text-purple-700 text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded border border-purple-200 ml-1.5"><i class="fa-solid fa-hand-holding-hand mr-0.5"></i> Recolha</span>` : ''}
                ${morada.priority ? `<span class="bg-orange-500 text-white text-[8px] font-bold uppercase px-1 py-0.5 rounded ml-1.5"><i class="fa-solid fa-circle-exclamation mr-0.5"></i> Prioritária</span>` : ''}
                ${morada.observation ? `<p class="text-[10px] text-blue-500 font-semibold italic mt-0.5 truncate">Nota: ${morada.observation}</p>` : ''}
            </div>
            <div class="flex items-center space-x-1.5 flex-shrink-0">
                <button class="btn-edit-morada text-blue-500 font-bold p-1 hover:bg-blue-50 rounded"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-del-morada text-red-500 font-bold p-1 hover:bg-red-50 rounded">X</button>
            </div>
        `;
        
        item.querySelector('.btn-edit-morada').onclick = () => abrirModalEdicaoParagem(morada, false);
        
        item.querySelector('.btn-del-morada').onclick = () => {
            const confirmar = confirm(`Tem a certeza que deseja excluir esta entrega no planeamento?\nMorada: ${morada.address}`);
            if (!confirmar) return;

            window.moradasEntregas = window.moradasEntregas.filter(m => m.id !== morada.id);
            window.rotaOtimizada = window.rotaOtimizada.filter(m => m.id !== morada.id); 
            
            renderMoradasAdicionadas();
            
            if (window.rotaOtimizada.length > 0) {
                renderizarItinerarioOtimizado();
                desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
            } else {
                document.getElementById('container-mapa')?.classList.add('hidden');
                document.getElementById('container-rota-ordenada')?.classList.add('hidden');
                document.getElementById('estatisticas-rota')?.classList.add('hidden');
                limparMapaVisual();
            }
            
            sincronizarPersistencia();
        };

        listaMoradasAdicionadas.appendChild(item);
    });
}

// =========================================================================
// OTIMIZAÇÃO GLOBAL DA ROTA VIA GOOGLE ROUTE OPTIMIZATION API
// =========================================================================
export async function otimizarItinerarioComVizinhoMaisProximo() {
    if (!window.partidaLocalizacao) return alert("Por favor, defina um ponto de Partida primeiro.");
    if (window.moradasEntregas.length === 0) return alert("Adicione pelo menos uma morada de entrega.");

    const btnOtimizar = document.getElementById('btn-otimizar-rota');

    if (window.rotaOtimizada && window.rotaOtimizada.length > 0) {
        const confirmarRecalculo = confirm("Atenção: Já possui uma rota ativa. Se otimizar de novo, o sistema recalculará todo o percurso e confirmará todas as posições. Deseja continuar?");
        if (!confirmarRecalculo) return;
    }

    if (btnOtimizar) {
        btnOtimizar.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> <span>A calcular rota ótima...</span>';
        btnOtimizar.disabled = true;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/optimize-route`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pontoPartida: window.partidaLocalizacao,
                paragens: window.moradasEntregas
            })
        });

        if (!response.ok) {
            let errorDetails = `Erro ${response.status} (${response.statusText})`;
            try {
                const errJson = await response.json();
                if (errJson.error) errorDetails += ` - ${errJson.error}`;
            } catch(e) {}
            throw new Error(errorDetails);
        }

        const data = await response.json();
        
        if (data.optimizedIndices) {
            const indices = data.optimizedIndices;
            window.rotaOtimizada = [];

            indices.forEach((indexOriginal) => {
                const paragemOriginal = window.moradasEntregas[indexOriginal];
                paragemOriginal.isNewUnconfirmed = false; // CONFIRMA TODAS AS POSIÇÕES AO OTIMIZAR
                paragemOriginal.distanciaDoAnterior = calcularDistanciaHaversine(
                    window.rotaOtimizada.length === 0 ? window.partidaLocalizacao.lat : window.rotaOtimizada[window.rotaOtimizada.length - 1].lat,
                    window.rotaOtimizada.length === 0 ? window.partidaLocalizacao.lng : window.rotaOtimizada[window.rotaOtimizada.length - 1].lng,
                    paragemOriginal.lat,
                    paragemOriginal.lng
                );
                window.rotaOtimizada.push(paragemOriginal);
            });

            window.routingMethodUsed = 'Cloud';
            localStorage.setItem('cp_routing_method', 'Cloud');
        } else {
            window.rotaOtimizada = [...window.moradasEntregas];
            window.rotaOtimizada.forEach(p => {
                p.isNewUnconfirmed = false;
                p.distanciaDoAnterior = 0;
            });
            window.routingMethodUsed = 'Local';
            localStorage.setItem('cp_routing_method', 'Local');
        }

        document.getElementById('container-mapa')?.classList.remove('hidden');
        document.getElementById('container-rota-ordenada')?.classList.remove('hidden');

        renderizarItinerarioOtimizado();
        sincronizarPersistencia();
        
        setTimeout(() => {
            desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
        }, 300);

        alternarModoRota('conducao');

    } catch (err) {
        console.warn("[PWA] Falha ao otimizar via nuvem Google Cloud. Ativando resolvedor síncrono local...", err);
        
        calcularRotaVizinhoMaisProximoLocal();
        window.rotaOtimizada.forEach(p => p.isNewUnconfirmed = false);
        window.routingMethodUsed = 'Local';
        localStorage.setItem('cp_routing_method', 'Local');
        
        alert(`O servidor em nuvem falhou ou está temporariamente a dormir (${err.message}).\n\nContingência Ativada: Calculámos com sucesso uma rota aproximada localmente no próprio dispositivo!`);
        
        document.getElementById('container-mapa')?.classList.remove('hidden');
        document.getElementById('container-rota-ordenada')?.classList.remove('hidden');

        renderizarItinerarioOtimizado();
        sincronizarPersistencia();
        
        setTimeout(() => {
            desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
        }, 300);

        alternarModoRota('conducao');
    } finally {
        if (btnOtimizar) {
            btnOtimizar.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> <span>Otimizar Sequência de Rota</span>';
            btnOtimizar.disabled = false;
        }
    }
}

// =========================================================================
// FUNÇÃO DE CONFIRMAÇÃO DIRETA DA POSIÇÃO DA NOVA AÇÃO
// =========================================================================
window.confirmarPosicaoParagem = (paragemId) => {
    const paragem = window.rotaOtimizada.find(p => p.id === paragemId);
    if (paragem) {
        paragem.isNewUnconfirmed = false;
        const originalPre = window.moradasEntregas.find(m => m.id === paragemId);
        if (originalPre) originalPre.isNewUnconfirmed = false;

        sincronizarPersistencia();
        renderizarItinerarioOtimizado();
        desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
    }
};

// =========================================================================
// DESENHAR LISTA DE ENTREGAS OTIMIZADA
// =========================================================================
export function renderizarItinerarioOtimizado() {
    const listaRotaFinal = document.getElementById('lista-rota-final');
    if (!listaRotaFinal) return;

    listaRotaFinal.innerHTML = "";
    const lastNavigatedId = localStorage.getItem('cp_last_navigated_id');

    window.rotaOtimizada.forEach((paragem, index) => {
        const item = document.createElement('div');
        item.id = `paragem-${paragem.id}`; 
        
        const isRecolha = paragem.tipoOperacao === "Recolha";

        let statusColor = "bg-blue-600";
        if (paragem.status === "Entregue") statusColor = "bg-green-500";
        if (paragem.status === "Falhou") statusColor = "bg-red-500";
        if (isRecolha && paragem.status === "Pendente") statusColor = "bg-purple-600";

        const isLastNavigated = paragem.id === lastNavigatedId;
        const isPriority = !!paragem.priority;
        const isNewUnconfirmed = !!paragem.isNewUnconfirmed;

        // ESTILIZAÇÃO DO CARTÃO COM BASE NO ESTADO
        if (isNewUnconfirmed) {
            // CARTÃO LARANJA COM BORDA PRETA ESPESSA E Destaque
            item.className = "p-3 rounded-xl flex flex-col space-y-2.5 border-2 border-black bg-orange-50 shadow-lg ring-4 ring-orange-200 animate-pulse";
        } else if (isLastNavigated) {
            item.className = isPriority 
                ? "p-3 rounded-xl flex flex-col space-y-2 animate-fade-in border-2 border-orange-500 bg-orange-50/70 shadow-md ring-4 ring-orange-200"
                : "p-3 rounded-xl flex flex-col space-y-2 animate-fade-in border-2 border-blue-500 bg-blue-50/70 shadow-md ring-4 ring-blue-100";
        } else {
            item.className = isPriority 
                ? "bg-orange-50/30 p-3 rounded-xl border-2 border-orange-200 shadow-sm flex flex-col space-y-2 animate-fade-in"
                : "bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex flex-col space-y-2 animate-fade-in";
        }

        const primeiraLinhaObs = paragem.observation ? paragem.observation.split('\n')[0] : "";

        // BOLINHA LARANJA COM BORDA PRETA E EFEITO SALTITANTE (BOUNCE)
        const bolinhaHtml = isNewUnconfirmed 
            ? `<span class="btn-index-badge w-6 h-6 rounded-full bg-orange-500 text-white border-2 border-black font-black text-xs flex items-center justify-center flex-shrink-0 animate-bounce cursor-pointer shadow-md" title="Clique para alterar ou confirmar posição">
                ${index + 1}
               </span>`
            : `<span class="btn-index-badge w-5 h-5 rounded-full ${statusColor} text-white font-bold text-[10px] flex items-center justify-center flex-shrink-0 transition-colors">
                ${index + 1}
               </span>`;

        item.innerHTML = `
            <div class="flex items-center justify-between space-x-2">
                <div class="flex-1 truncate">
                    <div class="flex items-center space-x-2 flex-wrap gap-1">
                        ${bolinhaHtml}
                        <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                            A cerca de ${paragem.distanciaDoAnterior.toFixed(2)} km
                        </span>
                        
                        ${isRecolha ? `<span class="bg-purple-100 text-purple-700 border border-purple-200 text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide flex items-center space-x-1" title="Operação de Recolha"><i class="fa-solid fa-hand-holding-hand text-purple-500"></i> <span>Recolha</span></span>` : ''}
                        
                        ${isNewUnconfirmed ? `
                            <button onclick="window.confirmarPosicaoParagem('${paragem.id}')" class="bg-orange-500 hover:bg-orange-600 text-white font-black text-[9px] uppercase px-2 py-0.5 rounded-lg border-2 border-black shadow flex items-center space-x-1 transition-all">
                                <i class="fa-solid fa-check"></i>
                                <span>Confirmar Posição #${index + 1}</span>
                            </button>
                        ` : ''}

                        ${isLastNavigated && !isNewUnconfirmed ? `<span class="bg-blue-600 text-white text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide animate-pulse">A navegar</span>` : ''}
                        ${isPriority ? `<span class="bg-orange-500 text-white text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide animate-pulse"><i class="fa-solid fa-circle-exclamation mr-0.5"></i> Prioritária</span>` : ''}
                        ${paragem.brickName ? `<span class="bg-blue-50 text-blue-700 border border-blue-200 text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide flex items-center space-x-1"><i class="fa-solid fa-boxes-stacked text-blue-500"></i> <span>Estante: ${paragem.brickName}</span></span>` : ''}
                    </div>
                    <p class="text-xs font-semibold text-gray-700 mt-1 truncate" title="${paragem.address}">
                        ${paragem.address}
                    </p>
                    ${primeiraLinhaObs ? `<div class="bg-yellow-50 border border-yellow-100 p-2 rounded mt-1 text-[11px] text-gray-600 font-medium italic truncate"><i class="fa-solid fa-comment-dots text-yellow-500 mr-1"></i> ${primeiraLinhaObs}</div>` : ''}
                </div>
                <div class="flex flex-col space-y-1">
                    <button class="btn-navegar bg-green-600 hover:bg-green-700 text-white font-bold px-3 py-2 rounded-lg text-xs flex items-center justify-center space-x-1 whitespace-nowrap shadow-sm">
                        <i class="fa-solid fa-location-arrow"></i> <span>Navegar</span>
                    </button>
                    <button class="btn-edit-otimizada bg-gray-50 border hover:bg-gray-100 text-gray-700 font-bold px-3 py-1.5 rounded-lg text-[10px] text-center">
                        Editar Info
                    </button>
                </div>
            </div>
            
            <div class="flex space-x-1.5 pt-1.5 border-t border-dashed">
                <button class="btn-status bg-gray-50 text-gray-600 hover:bg-gray-100 text-[10px] font-bold py-1.5 rounded flex-1 border ${!paragem.status || paragem.status === 'Pendente' ? 'ring-2 ring-gray-400' : ''}" data-status="Pendente">
                    Pendente
                </button>
                <button class="btn-status bg-green-50 text-green-700 hover:bg-green-100 text-[10px] font-bold py-1.5 rounded flex-1 border border-green-200 ${paragem.status === 'Entregue' ? 'ring-2 ring-green-500' : ''}" data-status="Entregue">
                    ✓ Entregue
                </button>
                <button class="btn-status bg-red-50 text-red-700 hover:bg-red-100 text-[10px] font-bold py-1.5 rounded flex-1 border border-red-200 ${paragem.status === 'Failed' || paragem.status === 'Falhou' ? 'ring-2 ring-red-500' : ''}" data-status="Falhou">
                    ✗ Falhou
                </button>
            </div>
        `;

        item.querySelector('.btn-navegar').onclick = () => {
            const acaoNavegar = () => {
                localStorage.setItem('cp_last_navigated_id', paragem.id);
                renderizarItinerarioOtimizado(); 
                abrirNavegacao(paragem);
            };

            if (index === 0 && (!window.tripStarted || !window.odometerStart || window.odometerStart === 0)) {
                abrirModalOdometroSaida(acaoNavegar);
            } else {
                acaoNavegar();
            }
        };

        item.querySelector('.btn-edit-otimizada').onclick = () => abrirModalEdicaoParagem(paragem, true);

        if (isNewUnconfirmed) {
            const btnIndex = item.querySelector('.btn-index-badge');
            if (btnIndex) {
                btnIndex.onclick = (e) => {
                    e.stopPropagation();
                    window.abrirModalAlterarSequencia(index, paragem);
                };
            }
        }

        item.querySelectorAll('.btn-status').forEach(btn => {
            btn.onclick = () => {
                const novoStatus = btn.getAttribute('data-status');
                paragem.status = novoStatus;
                
                const idx = window.moradasEntregas.findIndex(m => m.id === paragem.id);
                if (idx !== -1) {
                    window.moradasEntregas[idx].status = novoStatus;
                }
                
                sincronizarPersistencia();
                renderizarItinerarioOtimizado();
                desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
            };
        });

        listaRotaFinal.appendChild(item);
    });

    renderEstatisticasRota();
}

// ==========================================
// PAINEL DE ESTATÍSTICAS DA ROTA ATIVA
// ==========================================
export function renderEstatisticasRota() {
    const htmlEl = document.getElementById('estatisticas-rota');
    const statTotal = document.getElementById('stat-total');
    const statEntregues = document.getElementById('stat-entregues');
    const statFalhas = document.getElementById('stat-falhas'); 
    const statPendentes = document.getElementById('stat-pendentes');

    const statDistancia = document.getElementById('stat-distancia');
    const statTempo = document.getElementById('stat-tempo');
    const statSistema = document.getElementById('stat-sistema');

    const btnFinalizarTurno = document.getElementById('btn-finalizar-turno');
    const painelOdometroResumo = document.getElementById('painel-odometro-resumo');

    if (!htmlEl) return;

    htmlEl.classList.remove('hidden');

    const total = window.rotaOtimizada.length;
    const entregues = window.rotaOtimizada.filter(p => p.status === "Entregue").length;
    const falhadas = window.rotaOtimizada.filter(p => p.status === "Failed" || p.status === "Falhou").length;
    const pendentes = window.rotaOtimizada.filter(p => !p.status || p.status === "Pendente").length;

    if (statTotal) statTotal.textContent = total;
    if (statEntregues) statEntregues.textContent = entregues;
    if (statFalhas) statFalhas.textContent = falhadas;
    if (statPendentes) statPendentes.textContent = pendentes;

    let totalDist = 0;
    window.rotaOtimizada.forEach(p => {
        totalDist += p.distanciaDoAnterior || 0;
    });

    if (statDistancia) statDistancia.textContent = `${totalDist.toFixed(2)} km`;

    if (statTempo) {
        if (totalDist === 0) {
            statTempo.textContent = "0 min";
        } else {
            const tempoTotalMinutos = Math.round((totalDist / 40) * 60);
            if (tempoTotalMinutos < 60) {
                statTempo.textContent = `${tempoTotalMinutos} min`;
            } else {
                const horas = Math.floor(tempoTotalMinutos / 60);
                const mins = tempoTotalMinutos % 60;
                statTempo.textContent = `${horas}h ${mins}min`;
            }
        }
    }

    if (statSistema) {
        const metodo = window.routingMethodUsed || localStorage.getItem('cp_routing_method') || 'Cloud';
        if (metodo === 'Cloud') {
            statSistema.className = "inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide border bg-emerald-50 text-emerald-700 border-emerald-200 animate-none";
            statSistema.innerHTML = `<i class="fa-solid fa-cloud"></i> <span>Google Cloud API (Real por Estrada)</span>`;
        } else {
            statSistema.className = "inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide border bg-amber-50 text-amber-700 border-amber-200 animate-pulse";
            statSistema.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>Contingência Local (Linha Reta)</span>`;
        }
    }

    if (btnFinalizarTurno) {
        if (window.tripStarted && !window.tripCompleted) {
            btnFinalizarTurno.classList.remove('hidden');
        } else {
            btnFinalizarTurno.classList.add('hidden');
        }
    }

    if (painelOdometroResumo) {
        if (window.tripStarted) {
            painelOdometroResumo.classList.remove('hidden');
            
            const startKmEl = document.getElementById('odometro-resumo-saida-km');
            const startHourEl = document.getElementById('odometro-resumo-saida-hora');
            const endKmEl = document.getElementById('odometro-resumo-chegada-km');
            const endHourEl = document.getElementById('odometro-resumo-chegada-hora');
            const totalKmEl = document.getElementById('odometro-resumo-total-viagem');

            if (startKmEl) startKmEl.textContent = `${window.odometerStart} KM`;
            if (startHourEl) startHourEl.textContent = `Hora: ${window.odometerStartHour}`;

            if (window.tripCompleted) {
                if (endKmEl) endKmEl.textContent = `${window.odometerEnd} KM`;
                if (endHourEl) endHourEl.textContent = `Hora: ${window.odometerEndHour}`;
                if (totalKmEl) {
                    const diff = window.odometerEnd - window.odometerStart;
                    totalKmEl.textContent = `Total percorrido na rota: ${diff.toFixed(1)} km`;
                }
            } else {
                if (endKmEl) endKmEl.textContent = `-- KM`;
                if (endHourEl) endHourEl.textContent = `Hora: Em trânsito`;
                if (totalKmEl) totalKmEl.textContent = `Total percorrido na rota: Em trânsito...`;
            }
        } else {
            painelOdometroResumo.classList.add('hidden');
        }
    }
}

// ==========================================
// MODAIS DO ODÓMETRO (SAÍDA E CHEGADA)
// ==========================================
function abrirModalOdometroSaida(callback) {
    const modal = document.getElementById('modal-odometro-saida');
    if (!modal) return;

    const agora = new Date();
    const horaStr = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    
    const inputHora = document.getElementById('odometro-saida-hora');
    const inputKm = document.getElementById('odometro-saida-km');
    const txtMinimo = document.getElementById('odometro-saida-minimo');

    if (inputHora) inputHora.value = horaStr;
    if (inputKm) inputKm.value = window.lastOdometer || "";
    if (txtMinimo) txtMinimo.textContent = `Mínimo exigido: ${window.lastOdometer || 0} KM`;

    modal.classList.remove('hidden');

    const btnConfirmar = document.getElementById('btn-confirmar-saida-km');
    const btnCancelar = document.getElementById('btn-cancelar-saida-km');

    btnConfirmar.onclick = () => {
        const kmVal = parseFloat(inputKm.value);
        const horaVal = inputHora.value.trim();

        if (isNaN(kmVal) || kmVal < (window.lastOdometer || 0)) {
            alert(`Erro de validação: O valor de quilometragem de partida não pode ser menor do que o último registo final (${window.lastOdometer || 0} KM).`);
            return;
        }
        if (!horaVal) {
            alert("Por favor, introduza um horário de partida válido.");
            return;
        }

        window.tripStarted = true;
        window.tripCompleted = false;
        window.odometerStart = kmVal;
        window.odometerStartHour = horaVal;
        window.lastOdometer = kmVal;

        sincronizarPersistencia();
        modal.classList.add('hidden');
        if (typeof callback === 'function') callback();
    };

    btnCancelar.onclick = () => modal.classList.add('hidden');
}

function abrirModalOdometroChegada() {
    const modal = document.getElementById('modal-odometro-chegada');
    if (!modal) return;

    const agora = new Date();
    const horaStr = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    
    const inputHora = document.getElementById('odometer-chegada-hora') || document.getElementById('odometro-chegada-hora');
    const inputKm = document.getElementById('odometro-chegada-km');
    const txtMinimo = document.getElementById('odometro-chegada-minimo');

    if (inputHora) inputHora.value = horaStr;
    if (inputKm) inputKm.value = "";
    if (txtMinimo) txtMinimo.textContent = `Mínimo de partida: ${window.odometerStart || 0} KM`;

    modal.classList.remove('hidden');

    const btnConfirmar = document.getElementById('btn-confirmar-chegada-km');
    const btnCancelar = document.getElementById('btn-cancelar-chegada-km');

    btnConfirmar.onclick = () => {
        const kmVal = parseFloat(inputKm.value);
        const horaVal = inputHora ? inputHora.value.trim() : "";

        if (isNaN(kmVal) || kmVal < window.odometerStart) {
            alert(`Erro de validação: O valor de quilometragem final não pode ser inferior ao valor de saída (${window.odometerStart} KM).`);
            return;
        }
        if (!horaVal) {
            alert("Por favor, introduza um horário de regresso válido.");
            return;
        }

        alert(`Turno Encerrado com Sucesso!\n\nPartida: ${window.odometerStart} KM às ${window.odometerStartHour}\nChegada: ${kmVal} KM às ${horaVal}\nTotal Percorrido: ${(kmVal - window.odometerStart).toFixed(1)} km`);

        window.tripCompleted = true;
        window.odometerEnd = kmVal;
        window.odometerEndHour = horaVal;
        window.lastOdometer = kmVal;

        window.partidaLocalizacao = null;
        window.moradasEntregas = [];
        window.rotaOtimizada = [];
        window.dataRotaSelecionada = "";
        window.rotaIniciada = false;
        window.tripStarted = false;
        window.tripCompleted = false;
        window.odometerStart = 0;
        window.odometerStartHour = "";
        window.odometerEnd = 0;
        window.odometerEndHour = "";

        localStorage.removeItem('cp_last_navigated_id');
        limparMapaVisual();

        sincronizarPersistencia();
        modal.classList.add('hidden');
        sincronizarInterfaceRota();
    };

    btnCancelar.onclick = () => modal.classList.add('hidden');
}

// ==========================================
// RE-SEQUENCIAÇÃO DE ENTREGA (POSIÇÃO)
// ==========================================
window.abrirModalAlterarSequencia = (indexAtual, paragem) => {
    const modal = document.getElementById('modal-alterar-sequencia');
    if (!modal) return;

    const txtMorada = document.getElementById('txt-seq-morada');
    const txtPosAtual = document.getElementById('txt-seq-pos-atual');
    const inputNovaPos = document.getElementById('input-seq-nova-pos');

    if (txtMorada) txtMorada.textContent = paragem.address;
    if (txtPosAtual) txtPosAtual.textContent = indexAtual + 1;
    if (inputNovaPos) {
        inputNovaPos.value = indexAtual + 1;
        inputNovaPos.max = window.rotaOtimizada.length;
    }

    modal.classList.remove('hidden');

    const btnConfirmar = document.getElementById('btn-confirmar-sequencia');
    const btnCancelar = document.getElementById('btn-cancelar-sequencia');

    btnConfirmar.onclick = () => {
        const novaPos = parseInt(inputNovaPos.value);
        if (isNaN(novaPos) || novaPos < 1 || novaPos > window.rotaOtimizada.length) {
            alert(`Erro: Introduza uma posição válida entre 1 e ${window.rotaOtimizada.length}.`);
            return;
        }

        const novoIndex = novaPos - 1;

        // CONFIRMA A POSIÇÃO E REMOVE A ANIMAÇÃO SALTITANTE E COR LARANJA
        paragem.isNewUnconfirmed = false;
        const originalPre = window.moradasEntregas.find(m => m.id === paragem.id);
        if (originalPre) originalPre.isNewUnconfirmed = false;

        if (indexAtual !== novoIndex) {
            const item = window.rotaOtimizada.splice(indexAtual, 1)[0];
            window.rotaOtimizada.splice(novoIndex, 0, item);

            window.rotaOtimizada.forEach((p, idx) => {
                p.distanciaDoAnterior = calcularDistanciaHaversine(
                    idx === 0 ? window.partidaLocalizacao.lat : window.rotaOtimizada[idx - 1].lat,
                    idx === 0 ? window.partidaLocalizacao.lng : window.rotaOtimizada[idx - 1].lng,
                    p.lat,
                    p.lng
                );
            });

            window.moradasEntregas = [...window.rotaOtimizada];
        }

        sincronizarPersistencia();
        renderizarItinerarioOtimizado();
        desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);

        modal.classList.add('hidden');
    };

    btnCancelar.onclick = () => modal.classList.add('hidden');
};

function aplicarPrefixoNoCampo(prefixo) {
    const inputCP = document.getElementById('rota-codigo-postal');
    if (!inputCP) return;
    inputCP.value = `${prefixo}-`;
    inputCP.focus();
    const comprimentoTexto = inputCP.value.length;
    inputCP.setSelectionRange(comprimentoTexto, comprimentoTexto);
}

function configurarEventosPrefixoRapido() {
    const btnManual = document.getElementById('btn-inserir-prefixo');
    const inputPrefixoManual = document.getElementById('prefixo-manual');

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

function configurarFormatacaoCodigoPostal() {
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
}

function configurarEscutaCodigoPostalParaLimites() {
    const inputCP = document.getElementById('rota-codigo-postal');
    const inputMorada = document.getElementById('rota-morada-completa');
    if (!inputCP) return;

    inputCP.addEventListener('input', async () => {
        const valor = inputCP.value.trim();
        const padraoCP = /^\d{4}-\d{3}$/;

        if (valor.length === 0 && autocompleteInstancia) {
            const centroMafra = { lat: 38.9369, lng: -9.3282 };
            const circuloMafra = new google.maps.Circle({ center: centroMafra, radius: 15000 });
            autocompleteInstancia.setBounds(circuloMafra.getBounds());
            autocompleteInstancia.setOptions({ strictBounds: false });
            return;
        }

        if (padraoCP.test(valor)) {
            if (inputMorada) {
                inputMorada.value = valor;
                inputMorada.focus();
                const comprimento = inputMorada.value.length;
                inputMorada.setSelectionRange(comprimento, comprimento);
            }

            if (autocompleteInstancia) {
                const concelhoDetectado = obterConcelhoPorCodigoPostal(valor);
                const centroConcelho = concelhoDetectado === "SINTRA" ? { lat: 38.8000, lng: -9.3800 } : { lat: 38.9369, lng: -9.3282 };
                const circuloConcelho = new google.maps.Circle({ center: centroConcelho, radius: 15000 });
                autocompleteInstancia.setBounds(circuloConcelho.getBounds());
                autocompleteInstancia.setOptions({ strictBounds: false });
            }
        }
    });
}

function inicializarAutocompleteMorada() {
    const inputMorada = document.getElementById('rota-morada-completa');
    if (!inputMorada) return;

    if (inputMorada.dataset.autocompleteBound === "true") return;

    if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
        setTimeout(inicializarAutocompleteMorada, 500);
        return;
    }

    try {
        const centroMafra = { lat: 38.9369, lng: -9.3282 };
        const circuloMafra = new google.maps.Circle({ center: centroMafra, radius: 15000 });
        const limitesMafra = circuloMafra.getBounds();

        autocompleteInstancia = new google.maps.places.Autocomplete(inputMorada, {
            componentRestrictions: { country: 'pt' },
            fields: ['address_components', 'geometry', 'formatted_address'],
            bounds: limitesMafra,
            strictBounds: false
        });

        inputMorada.dataset.autocompleteBound = "true";

        autocompleteInstancia.addListener('place_changed', () => {
            const localSelecionado = autocompleteInstancia.getPlace();
            if (!localSelecionado || !localSelecionado.address_components) return;

            const componenteCP = localSelecionado.address_components.find(c => c.types.includes('postal_code'));
            if (componenteCP) {
                const inputCP = document.getElementById('rota-codigo-postal');
                if (inputCP) {
                    const cpLimpo = componenteCP.long_name.replace(/\D/g, '');
                    if (cpLimpo.length === 7) {
                        inputCP.value = `${cpLimpo.substring(0, 4)}-${cpLimpo.substring(4, 7)}`;
                    } else if (cpLimpo.length === 4) {
                        inputCP.value = `${cpLimpo}-`;
                        inputCP.focus();
                    }
                }
            }
        });
    } catch (err) {
        console.warn("Não foi possível iniciar o Autocomplete do Google Places neste ecrã:", err);
    }
}

function textObservacoesAutomatico() {
    const textareaObs = document.getElementById('edit-morada-obs');
    if (!textareaObs) return;

    const partes = [];
    if (embalagemSelecionada) partes.push(embalagemSelecionada);
    if (origemSelecionada) partes.push(origemSelecionada);

    textareaObs.value = partes.join(" ");
}

function atualizarEstilosBotoesModal() {
    const botoesEmbalagem = document.querySelectorAll('.btn-tipo-embalagem');
    const botoesOrigem = document.querySelectorAll('.btn-origem-pacote');

    botoesEmbalagem.forEach(btn => {
        const tipo = btn.getAttribute('data-tipo');
        if (embalagemSelecionada === tipo) {
            btn.className = "btn-tipo-embalagem px-3 py-2.5 bg-blue-600 text-white font-bold text-xs rounded-xl border border-blue-600 transition-all text-center";
        } else {
            btn.className = "btn-tipo-embalagem px-3 py-2.5 bg-gray-50 text-gray-700 font-bold text-xs rounded-xl border border-gray-200 active:bg-blue-50 transition-all text-center";
        }
    });

    botoesOrigem.forEach(btn => {
        const origem = btn.getAttribute('data-origem');
        if (origemSelecionada === origem) {
            btn.className = "btn-origem-pacote px-3 py-2.5 bg-blue-600 text-white font-bold text-xs rounded-xl border border-blue-600 transition-all text-center";
        } else {
            if (origem === 'Fraldas') {
                btn.className = "btn-origem-pacote px-3 py-2.5 bg-blue-50 text-blue-700 font-extrabold text-xs rounded-xl border border-blue-200 active:bg-blue-100 transition-all text-center flex items-center justify-center space-x-1";
            } else {
                btn.className = "btn-origem-pacote px-3 py-2.5 bg-gray-50 text-gray-700 font-bold text-xs rounded-xl border border-gray-200 active:bg-blue-50 transition-all text-center";
            }
        }
    });
}

function preencherSelecoesPorTexto(observacao) {
    embalagemSelecionada = "";
    origemSelecionada = "";

    if (!observacao) return;
    const obsUpper = observacao.toUpperCase();

    if (obsUpper.includes("ENVELOPE")) embalagemSelecionada = "Envelope";
    else if (obsUpper.includes("CAIXA PEQUENA")) embalagemSelecionada = "Caixa Pequena";
    else if (obsUpper.includes("CAIXA GRANDE")) embalagemSelecionada = "Caixa Grande";
    else if (obsUpper.includes("PACOTE")) embalagemSelecionada = "Pacote";

    if (obsUpper.includes("AMAZON")) origemSelecionada = "Amazon";
    else if (obsUpper.includes("ZARA")) origemSelecionada = "Zara";
    else if (obsUpper.includes("CHINA") || obsUpper.includes("TEMU") || obsUpper.includes("SHEIN")) origemSelecionada = "China (Temu/Shein)";
    else if (obsUpper.includes("FRALDAS")) origemSelecionada = "Fraldas";
}

function configurarBotoesRapidosModal() {
    const botoesEmbalagem = document.querySelectorAll('.btn-tipo-embalagem');
    const botoesOrigem = document.querySelectorAll('.btn-origem-pacote');

    botoesEmbalagem.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const tipo = btn.getAttribute('data-tipo');
            embalagemSelecionada = (embalagemSelecionada === tipo) ? "" : tipo;
            atualizarEstilosBotoesModal();
            textObservacoesAutomatico();
        });
    });

    botoesOrigem.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const origem = btn.getAttribute('data-origem');
            origemSelecionada = (origemSelecionada === origem) ? "" : origem;
            atualizarEstilosBotoesModal();
            textObservacoesAutomatico();
        });
    });
}

export function setupRotasLogic() {
    const btnIniciarRota = document.getElementById('btn-iniciar-rota');
    const dataRotaInput = document.getElementById('data-rota');
    const btnGpsPartida = document.getElementById('btn-gps-partida');
    const btnBuscarPartida = document.getElementById('btn-buscar-partida');
    const btnLimparEnderecos = document.getElementById('btn-limpar-enderecos');
    const btnOtimizarRota = document.getElementById('btn-otimizar-rota');
    const statusPartida = document.getElementById('status-partida');

    const btnAdicionarPostal = document.getElementById('btn-adicionar-postal-rota');
    const btnPlaneamento = document.getElementById('btn-modo-planeamento');
    const btnConducao = document.getElementById('btn-modo-conducao');
    const btnFinalizarTurno = document.getElementById('btn-finalizar-turno');

    const btnTipoEntrega = document.getElementById('btn-tipo-entrega');
    const btnTipoRecolha = document.getElementById('btn-tipo-recolha');
    const inputTipoOperacao = document.getElementById('rota-tipo-operacao');

    configurarEventosPrefixoRapido();
    configurarFormatacaoCodigoPostal();
    inicializarAutocompleteMorada();
    configurarEscutaCodigoPostalParaLimites();

    if (btnPlaneamento && btnConducao) {
        btnPlaneamento.addEventListener('click', () => alternarModoRota('planeamento'));
        btnConducao.addEventListener('click', () => alternarModoRota('conducao'));
    }

    if (btnTipoEntrega && btnTipoRecolha && inputTipoOperacao) {
        btnTipoEntrega.addEventListener('click', () => {
            inputTipoOperacao.value = "Entrega";
            btnTipoEntrega.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-blue-600 text-white shadow transition-all cursor-pointer flex items-center justify-center space-x-1.5 focus:outline-none";
            btnTipoRecolha.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 hover:text-gray-700 transition-all cursor-pointer flex items-center justify-center space-x-1.5 focus:outline-none";
        });

        btnTipoRecolha.addEventListener('click', () => {
            inputTipoOperacao.value = "Recolha";
            btnTipoRecolha.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-purple-600 text-white shadow transition-all cursor-pointer flex items-center justify-center space-x-1.5 focus:outline-none";
            btnTipoEntrega.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 hover:text-gray-700 transition-all cursor-pointer flex items-center justify-center space-x-1.5 focus:outline-none";
        });
    }

    if (btnAdicionarPostal) {
        btnAdicionarPostal.addEventListener('click', () => processarAdicaoPorPostal());
    }

    if (btnIniciarRota && dataRotaInput) {
        btnIniciarRota.addEventListener('click', () => {
            const dataSelecionada = dataRotaInput.value;
            if (!dataSelecionada) {
                alert("Por favor, selecione uma data para continuar.");
                return;
            }
            const d = new Date(dataSelecionada);
            const dataFormatada = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
            
            window.tripStarted = false;
            window.tripCompleted = false;
            window.odometerStart = 0;
            window.odometerStartHour = "";
            window.odometerEnd = 0;
            window.odometerEndHour = "";

            window.dataRotaSelecionada = dataFormatada;
            window.rotaIniciada = true;
            sincronizarPersistencia();
            sincronizarInterfaceRota();
        });
    }

    if (btnGpsPartida && statusPartida) {
        btnGpsPartida.addEventListener('click', () => {
            statusPartida.textContent = "A obter geolocalização do GPS...";
            if (!navigator.geolocation) {
                alert("O seu telemóvel não suporta Geolocalização.");
                statusPartida.textContent = "Partida: Erro no GPS";
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    obterEnderecoPorGPSGoogle(lat, lng, (moradaGps) => {
                        if (moradaGps) {
                            window.partidaLocalizacao = moradaGps;
                            statusPartida.innerHTML = `<strong>Partida:</strong> ${moradaGps.address}`;
                        } else {
                            window.partidaLocalizacao = { lat, lng, address: `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})` };
                            statusPartida.innerHTML = `<strong>Partida:</strong> GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
                        }
                        sincronizarPersistencia();
                    });
                },
                () => {
                    alert("Não foi possível aceder ao GPS. Verifique as permissões.");
                    statusPartida.textContent = "Partida: Permissão negada";
                },
                { enableHighAccuracy: true }
            );
        });
    }

    if (btnBuscarPartida) {
        btnBuscarPartida.addEventListener('click', () => {
            window.definindoPartidaPorMorada = true;
            alert("Introduza o Código Postal e a rua de PARTIDA pretendida nos campos abaixo e clique em 'Adicionar Pacote' para marcar o início!");
            const inputPostal = document.getElementById('rota-codigo-postal');
            if (inputPostal) inputPostal.focus();
        });
    }

    if (btnLimparEnderecos) {
        btnLimparEnderecos.addEventListener('click', () => {
            if (confirm("Tem a certeza de que deseja eliminar todas as moradas e recomeçar a rota do zero?")) {
                window.moradasEntregas = [];
                window.rotaOtimizada = [];
                localStorage.removeItem('cp_last_navigated_id');
                document.getElementById('container-mapa')?.classList.add('hidden');
                document.getElementById('container-rota-ordenada')?.classList.add('hidden');
                document.getElementById('estatisticas-rota')?.classList.add('hidden');
                limparMapaVisual();
                renderMoradasAdicionadas();
                sincronizarPersistencia();
            }
        });
    }

    if (btnOtimizarRota) {
        btnOtimizarRota.addEventListener('click', () => {
            if (!window.partidaLocalizacao) return alert("Por favor, defina um ponto de Partida primeiro.");
            if (window.moradasEntregas.length === 0) return alert("Adicione pelo menos uma morada de entrega.");
            otimizarItinerarioComVizinhoMaisProximo();
        });
    }

    if (btnFinalizarTurno) {
        btnFinalizarTurno.addEventListener('click', () => abrirModalOdometroChegada());
    }
}

export function sincronizarInterfaceRota() {
    const containerSetupRota = document.getElementById('container-setup-rota');
    const containerPlaneadorRota = document.getElementById('container-planeador-rota');
    const displayDataRota = document.getElementById('display-data-rota');
    const statusPartida = document.getElementById('status-partida');
    const dataRotaInput = document.getElementById('data-rota');

    if (!containerSetupRota || !containerPlaneadorRota) return;

    if (window.rotaIniciada) {
        containerSetupRota.classList.add('hidden');
        containerPlaneadorRota.classList.remove('hidden');
        if (displayDataRota) displayDataRota.textContent = window.dataRotaSelecionada;

        if (statusPartida) {
            if (window.partidaLocalizacao) {
                statusPartida.innerHTML = `<strong>Partida:</strong> ${window.partidaLocalizacao.address}`;
            } else {
                statusPartida.textContent = "Partida: Localização não definida";
            }
        }

        renderMoradasAdicionadas();
        setTimeout(inicializarAutocompleteMorada, 100);

        const modoSalvo = localStorage.getItem('cp_modo_rota') || 'planeamento';
        alternarModoRota(modoSalvo);

        if (window.rotaOtimizada.length > 0) {
            document.getElementById('container-mapa')?.classList.remove('hidden');
            document.getElementById('container-rota-ordenada')?.classList.remove('hidden');
            
            renderizarItinerarioOtimizado();
            
            setTimeout(() => {
                desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
            }, 300);
        } else {
            document.getElementById('container-mapa')?.classList.add('hidden');
            document.getElementById('container-rota-ordenada')?.classList.add('hidden');
            document.getElementById('estatisticas-rota')?.classList.add('hidden');
        }

    } else {
        containerSetupRota.classList.remove('hidden');
        containerPlaneadorRota.classList.add('hidden');
        if (dataRotaInput) {
            const hoje = new Date();
            dataRotaInput.value = hoje.toISOString().split('T')[0];
        }
    }
}

export function setupModaisEdicao() {
    const btnCancelarEdicao = document.getElementById('btn-cancelar-edicao');
    const btnSalvarEdicao = document.getElementById('btn-salvar-edicao');

    if (!btnCancelarEdicao || !btnSalvarEdicao) return;

    btnCancelarEdicao.addEventListener('click', () => {
        const modalEditarParagem = document.getElementById('modal-editar-paragem');
        if (modalEditarParagem) modalEditarParagem.classList.add('hidden');
        itemSendoEditado = null;
    });

    btnSalvarEdicao.addEventListener('click', async () => {
        if (!itemSendoEditado) return;

        const editMoradaTexto = document.getElementById('edit-morada-texto');
        const editMoradaObs = document.getElementById('edit-morada-obs');
        const editMoradaPrioridade = document.getElementById('edit-morada-prioridade');
        const editTipoOperacaoInput = document.getElementById('edit-tipo-operacao');

        if (!editMoradaTexto || !editMoradaObs) return;

        const novaMorada = editMoradaTexto.value.trim();
        const novaObs = editMoradaObs.value.trim();
        const novaPrioridade = editMoradaPrioridade ? editMoradaPrioridade.checked : false;
        const novoTipoOperacao = editTipoOperacaoInput ? editTipoOperacaoInput.value : "Entrega";

        if (!novaMorada) {
            alert("A morada de entrega não pode ficar em branco.");
            return;
        }

        const textoOriginalBotao = btnSalvarEdicao.innerHTML;
        btnSalvarEdicao.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> A geolocalizar...';
        btnSalvarEdicao.disabled = true;

        try {
            if (novaMorada !== itemSendoEditado._originalAddress) {
                const response = await fetch(`${API_BASE_URL}/api/geocode`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ postalCode: "", address: novaMorada })
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || "Falha ao validar a nova morada geográfica.");
                }

                itemSendoEditado.lat = data.lat;
                itemSendoEditado.lng = data.lng;
                itemSendoEditado.address = data.address;

                const postalCodeMatch = data.address.match(/\d{4}-\d{3}/);
                if (postalCodeMatch) {
                    const { brickId, brickName } = resolveBrickForZip(postalCodeMatch[0], window.drivers);
                    itemSendoEditado.brickId = brickId;
                    itemSendoEditado.brickName = brickName;
                } else {
                    const { brickId, brickName } = resolveBrickForZip(novaMorada, window.drivers);
                    if (brickId) {
                        itemSendoEditado.brickId = brickId;
                        itemSendoEditado.brickName = brickName;
                    }
                }
            }

            // GUARDAR ALTERAÇÕES TAMBÉM CONFIRMA A POSIÇÃO E REMOVE A ANIMAÇÃO SALTITANTE
            itemSendoEditado.isNewUnconfirmed = false;
            itemSendoEditado.observation = novaObs;
            itemSendoEditado.priority = novaPrioridade;
            itemSendoEditado.tipoOperacao = novoTipoOperacao;

            let itemIndexPre = window.moradasEntregas.findIndex(m => m.id === itemSendoEditado.id);
            let itemIndexPos = window.rotaOtimizada.findIndex(m => m.id === itemSendoEditado.id);

            if (itemIndexPre !== -1) {
                window.moradasEntregas[itemIndexPre] = { ...itemSendoEditado };
            }

            if (itemIndexPos !== -1) {
                window.rotaOtimizada[itemIndexPos] = { ...itemSendoEditado };

                window.rotaOtimizada.forEach((p, idx) => {
                    p.distanciaDoAnterior = calcularDistanciaHaversine(
                        idx === 0 ? window.partidaLocalizacao.lat : window.rotaOtimizada[idx - 1].lat,
                        idx === 0 ? window.partidaLocalizacao.lng : window.rotaOtimizada[idx - 1].lng,
                        p.lat,
                        p.lng
                    );
                });
            }

            sincronizarPersistencia();
            renderMoradasAdicionadas();
            if (window.rotaOtimizada.length > 0) {
                renderizarItinerarioOtimizado();
                desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
            }

            const modalEditarParagem = document.getElementById('modal-editar-paragem');
            if (modalEditarParagem) modalEditarParagem.classList.add('hidden');
            itemSendoEditado = null;

        } catch (err) {
            console.error("[PWA] Erro ao gravar edição de paragem:", err);
            alert(`Erro ao atualizar a paragem: ${err.message}`);
        } finally {
            btnSalvarEdicao.innerHTML = textoOriginalBotao;
            btnSalvarEdicao.disabled = false;
        }
    });

    const editTipoEntrega = document.getElementById('edit-tipo-entrega');
    const editTipoRecolha = document.getElementById('edit-tipo-recolha');
    const editTipoOperacaoInput = document.getElementById('edit-tipo-operacao');

    if (editTipoEntrega && editTipoRecolha && editTipoOperacaoInput) {
        editTipoEntrega.addEventListener('click', () => {
            editTipoOperacaoInput.value = "Entrega";
            editTipoEntrega.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-blue-600 text-white shadow transition-all focus:outline-none cursor-pointer";
            editTipoRecolha.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 transition-all focus:outline-none cursor-pointer";
        });

        editTipoRecolha.addEventListener('click', () => {
            editTipoOperacaoInput.value = "Recolha";
            editTipoRecolha.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-purple-600 text-white shadow transition-all focus:outline-none cursor-pointer";
            editTipoEntrega.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 transition-all focus:outline-none cursor-pointer";
        });
    }

    configurarBotoesRapidosModal();
}

export function abrirModalEdicaoParagem(paragem, estaNaRotaOtimizada) {
    const modalEditarParagem = document.getElementById('modal-editar-paragem');
    const editMoradaTexto = document.getElementById('edit-morada-texto');
    const editMoradaObs = document.getElementById('edit-morada-obs');
    const editMoradaPrioridade = document.getElementById('edit-morada-prioridade');

    if (!modalEditarParagem || !editMoradaTexto || !editMoradaObs) return;

    itemSendoEditado = paragem;
    itemSendoEditado._originalAddress = paragem.address;

    editMoradaTexto.value = paragem.address;
    editMoradaObs.value = paragem.observation || "";
    if (editMoradaPrioridade) {
        editMoradaPrioridade.checked = !!paragem.priority;
    }

    const tipoOperacao = paragem.tipoOperacao || "Entrega";
    const editTipoEntrega = document.getElementById('edit-tipo-entrega');
    const editTipoRecolha = document.getElementById('edit-tipo-recolha');
    const editTipoOperacaoInput = document.getElementById('edit-tipo-operacao');

    if (editTipoEntrega && editTipoRecolha && editTipoOperacaoInput) {
        editTipoOperacaoInput.value = tipoOperacao;
        if (tipoOperacao === "Recolha") {
            editTipoRecolha.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-purple-600 text-white shadow transition-all focus:outline-none cursor-pointer";
            editTipoEntrega.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 transition-all focus:outline-none cursor-pointer";
        } else {
            editTipoEntrega.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-blue-600 text-white shadow transition-all focus:outline-none cursor-pointer";
            editTipoRecolha.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 transition-all focus:outline-none cursor-pointer";
        }
    }

    preencherSelecoesPorTexto(paragem.observation || "");
    atualizarEstilosBotoesModal();

    modalEditarParagem.classList.remove('hidden');

    setTimeout(() => {
        editMoradaObs.focus();
        editMoradaObs.select();
    }, 150);
}