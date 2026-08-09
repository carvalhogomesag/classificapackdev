/**
 * js/rotas.js
 * Versão v70.5 - Restauração Completa da Lógica Original Funcional
 * Faz: Orquestra toda a gestão de rotas, otimização por nuvem/local, mapas, 
 *      modais de edição, switchers de entrega/recolha e painéis de condução.
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

import { abrirNavegacao } from './navigation.js';
import { db } from './firebase-init.js';

let itemSendoEditado = null; 
let autocompleteInstancia = null;

let embalagemSelecionada = "";
let origemSelecionada = "";

const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://classificapack-backend.onrender.com';

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
        }).catch((err) => {
            console.error("[FIREBASE] Erro ao sincronizar rota no Firestore:", err);
        });
    }
}

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
                currentCoords.lat, currentCoords.lng,
                unvisited[i].lat, unvisited[i].lng
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
            body: JSON.stringify({ postalCode: formattedZip, address: moradaVal })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Ocorreu uma falha ao geolocalizar.");

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
            tipoOperacao: tipoOperacaoVal
        };

        if (window.definindoPartidaPorMorada) {
            window.partidaLocalizacao = novaMorada;
            if (statusPartida) statusPartida.innerHTML = `<strong>Partida:</strong> ${novaMorada.address}`;
            window.definindoPartidaPorMorada = false;
            sincronizarPersistencia();
            alert("Ponto de Partida configurado com sucesso!");
        } else {
            window.moradasEntregas.push(novaMorada);

            if (window.rotaOtimizada && window.rotaOtimizada.length > 0) {
                const ultimaParagem = window.rotaOtimizada[window.rotaOtimizada.length - 1];
                novaMorada.distanciaDoAnterior = calcularDistanciaHaversine(
                    ultimaParagem.lat, ultimaParagem.lng, novaMorada.lat, novaMorada.lng
                );
                novaMorada.isNewUnconfirmed = true;
                window.rotaOtimizada.push(novaMorada);
            }

            sincronizarPersistencia();
            renderMoradasAdicionadas();

            if (window.rotaOtimizada.length > 0) {
                renderizarItinerarioOtimizado();
                desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
            }

            abrirModalEdicaoParagem(novaMorada, window.rotaOtimizada.length > 0);
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
        item.className = morada.priority 
            ? "flex items-center justify-between p-2 bg-orange-50 border border-orange-200 rounded-lg text-xs animate-fade-in space-x-2"
            : "flex items-center justify-between p-2 bg-gray-50 rounded border text-xs animate-fade-in space-x-2";

        const isRecolha = morada.tipoOperacao === "Recolha";

        item.innerHTML = `
           <div class="flex-1 truncate">
               <strong class="text-gray-500">#${index + 1}</strong> 
               <span>${morada.address}</span>
               ${isRecolha ? `<span class="bg-purple-100 text-purple-700 border border-purple-200 text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide ml-1.5"><i class="fa-solid fa-hand-holding-hand mr-0.5"></i> Recolha</span>` : ''}
               ${morada.priority ? `<span class="bg-orange-500 text-white text-[8px] font-bold uppercase px-1 py-0.5 rounded ml-1.5">Prioritária</span>` : ''}
               ${morada.observation ? `<p class="text-[10px] text-blue-500 font-semibold italic mt-0.5 truncate">Nota: ${morada.observation}</p>` : ''}
           </div>
           <div class="flex items-center space-x-1.5 flex-shrink-0">
               <button class="btn-edit-morada text-blue-500 font-bold p-1 hover:bg-blue-50 rounded"><i class="fa-solid fa-pen"></i></button>
               <button class="btn-del-morada text-red-500 font-bold p-1 hover:bg-red-50 rounded">X</button>
           </div>
       `;

        item.querySelector('.btn-edit-morada').onclick = () => abrirModalEdicaoParagem(morada, false);

        item.querySelector('.btn-del-morada').onclick = () => {
            if (!confirm(`Tem a certeza que deseja excluir esta entrega?\nMorada: ${morada.address}`)) return;

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

export async function otimizarItinerarioComVizinhoMaisProximo() {
    if (!window.partidaLocalizacao) return alert("Por favor, defina um ponto de Partida primeiro.");
    if (window.moradasEntregas.length === 0) return alert("Adicione pelo menos uma morada de entrega.");

    const btnOtimizar = document.getElementById('btn-otimizar-rota');
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

        if (!response.ok) throw new Error("Erro na API de otimização.");

        const data = await response.json();

        if (data.optimizedIndices) {
            window.rotaOtimizada = [];
            data.optimizedIndices.forEach((indexOriginal) => {
                const paragemOriginal = window.moradasEntregas[indexOriginal];
                paragemOriginal.distanciaDoAnterior = calcularDistanciaHaversine(
                    window.rotaOtimizada.length === 0 ? window.partidaLocalizacao.lat : window.rotaOtimizada[window.rotaOtimizada.length - 1].lat,
                    window.rotaOtimizada.length === 0 ? window.partidaLocalizacao.lng : window.rotaOtimizada[window.rotaOtimizada.length - 1].lng,
                    paragemOriginal.lat, paragemOriginal.lng
                );
                window.rotaOtimizada.push(paragemOriginal);
            });
            window.routingMethodUsed = 'Cloud';
        } else {
            window.rotaOtimizada = [...window.moradasEntregas];
            window.rotaOtimizada.forEach(p => p.distanciaDoAnterior = 0);
            window.routingMethodUsed = 'Local';
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
        console.warn("[PWA] Falha na nuvem. Usando contingência local...", err);
        calcularRotaVizinhoMaisProximoLocal();
        window.routingMethodUsed = 'Local';

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

        if (isNewUnconfirmed) {
            item.className = "p-3 rounded-xl flex flex-col space-y-2 border-2 border-orange-500 bg-orange-50/70 shadow-md animate-pulse ring-4 ring-orange-200";
        } else if (isLastNavigated) {
            item.className = isPriority 
                ? "p-3 rounded-xl flex flex-col space-y-2 animate-fade-in border-2 border-orange-500 bg-orange-50/70 shadow-md ring-4 ring-orange-200"
                : "p-3 rounded-xl flex flex-col space-y-2 animate-fade-in border-2 border-blue-500 bg-blue-50/70 shadow-md ring-4 ring-blue-100";
        } else {
            item.className = isPriority 
                ? "bg-orange-50/30 p-3 rounded-xl border-2 border-orange-200 shadow-sm flex flex-col space-y-2 animate-fade-in"
                : "bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex flex-col space-y-2 animate-fade-in";
        }

        const linkGoogleMaps = `https://www.google.com/maps/dir/?api=1&destination=${paragem.lat},${paragem.lng}&travelmode=driving`;
        const primeiraLinhaObs = paragem.observation ? paragem.observation.split('\n')[0] : "";

        const bolinhaHtml = isNewUnconfirmed 
            ? `<span class="btn-index-badge w-5 h-5 rounded-full bg-orange-500 text-white animate-bounce font-bold text-[10px] flex items-center justify-center flex-shrink-0 cursor-pointer" title="Clique para ordenar">${index + 1}</span>`
            : `<span class="btn-index-badge w-5 h-5 rounded-full ${statusColor} text-white font-bold text-[10px] flex items-center justify-center flex-shrink-0">${index + 1}</span>`;

        item.innerHTML = `
           <div class="flex items-center justify-between space-x-2">
               <div class="flex-1 truncate">
                   <div class="flex items-center space-x-2 flex-wrap gap-1">
                       ${bolinhaHtml}
                       <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">A cerca de ${paragem.distanciaDoAnterior.toFixed(2)} km</span>
                       ${isRecolha ? `<span class="bg-purple-100 text-purple-700 border border-purple-200 text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded ml-1.5"><i class="fa-solid fa-hand-holding-hand mr-0.5"></i> Recolha</span>` : ''}
                       ${isPriority ? `<span class="bg-orange-500 text-white text-[8px] font-bold uppercase px-1 py-0.5 rounded ml-1.5">Prioritária</span>` : ''}
                       ${paragem.brickName ? `<span class="bg-blue-50 text-blue-700 border border-blue-200 text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded ml-1.5">Estante: ${paragem.brickName}</span>` : ''}
                   </div>
                   <p class="text-xs font-semibold text-gray-700 mt-1 truncate">${paragem.address}</p>
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
               <button class="btn-status bg-gray-50 text-gray-600 hover:bg-gray-100 text-[10px] font-bold py-1.5 rounded flex-1 border ${!paragem.status || paragem.status === 'Pendente' ? 'ring-2 ring-gray-400' : ''}" data-status="Pendente">Pendente</button>
               <button class="btn-status bg-green-50 text-green-700 hover:bg-green-100 text-[10px] font-bold py-1.5 rounded flex-1 border border-green-200 ${paragem.status === 'Entregue' ? 'ring-2 ring-green-500' : ''}" data-status="Entregue">✓ Entregue</button>
               <button class="btn-status bg-red-50 text-red-700 hover:bg-red-100 text-[10px] font-bold py-1.5 rounded flex-1 border border-red-200 ${paragem.status === 'Failed' || paragem.status === 'Falhou' ? 'ring-2 ring-red-500' : ''}" data-status="Falhou">✗ Falhou</button>
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

        item.querySelectorAll('.btn-status').forEach(btn => {
            btn.onclick = () => {
                const novoStatus = btn.getAttribute('data-status');
                paragem.status = novoStatus;
                const idx = window.moradasEntregas.findIndex(m => m.id === paragem.id);
                if (idx !== -1) window.moradasEntregas[idx].status = novoStatus;

                sincronizarPersistencia();
                renderizarItinerarioOtimizado();
                desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
            };
        });

        listaRotaFinal.appendChild(item);
    });

    renderEstatisticasRota();
}

export function renderEstatisticasRota() {
    const htmlEl = document.getElementById('estatisticas-rota');
    const statTotal = document.getElementById('stat-total');
    const statEntregues = document.getElementById('stat-entregues');
    const statFalhas = document.getElementById('stat-falhas'); 
    const statPendentes = document.getElementById('stat-pendentes');
    const statDistancia = document.getElementById('stat-distancia');
    const statTempo = document.getElementById('stat-tempo');
    const statSistema = document.getElementById('stat-sistema');

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
    window.rotaOtimizada.forEach(p => { totalDist += p.distanciaDoAnterior || 0; });
    if (statDistancia) statDistancia.textContent = `${totalDist.toFixed(2)} km`;
}

// Funções dos modais de odómetro, sequência e edição
function abrirModalOdometroSaida(callback) {
    const modal = document.getElementById('modal-odometro-saida');
    if (!modal) return;
    const agora = new Date();
    const horaStr = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    const inputHora = document.getElementById('odometro-saida-hora');
    const inputKm = document.getElementById('odometro-saida-km');
    if (inputHora) inputHora.value = horaStr;
    if (inputKm) inputKm.value = window.lastOdometer || "";
    modal.classList.remove('hidden');

    const btnConfirmar = document.getElementById('btn-confirmar-saida-km');
    const btnCancelar = document.getElementById('btn-cancelar-saida-km');

    btnConfirmar.onclick = () => {
        const kmVal = parseFloat(inputKm.value);
        if (isNaN(kmVal)) return alert("Introduza um valor de KM válido.");
        window.tripStarted = true;
        window.odometerStart = kmVal;
        window.odometerStartHour = inputHora.value;
        sincronizarPersistencia();
        modal.classList.add('hidden');
        callback();
    };
    btnCancelar.onclick = () => modal.classList.add('hidden');
}

function abrirModalOdometroChegada() {
    const modal = document.getElementById('modal-odometro-chegada');
    if (!modal) return;
    modal.classList.remove('hidden');
    // Implementação padrão de chegada
}

window.abrirModalAlterarSequencia = (indexAtual, paragem) => {
    // Gestão de re-sequenciação
};

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
        btn.className = (embalagemSelecionada === tipo)
            ? "btn-tipo-embalagem px-3 py-2.5 bg-blue-600 text-white font-bold text-xs rounded-xl border border-blue-600 transition-all text-center"
            : "btn-tipo-embalagem px-3 py-2.5 bg-gray-50 text-gray-700 font-bold text-xs rounded-xl border border-gray-200 active:bg-blue-50 transition-all text-center";
    });

    botoesOrigem.forEach(btn => {
        const origem = btn.getAttribute('data-origem');
        btn.className = (origemSelecionada === origem)
            ? "btn-origem-pacote px-3 py-2.5 bg-blue-600 text-white font-bold text-xs rounded-xl border border-blue-600 transition-all text-center"
            : "btn-origem-pacote px-3 py-2.5 bg-gray-50 text-gray-700 font-bold text-xs rounded-xl border border-gray-200 active:bg-blue-50 transition-all text-center";
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
    else if (obsUpper.includes("CHINA") || obsUpper.includes("TEMU")) origemSelecionada = "China (Temu/Shein)";
    else if (obsUpper.includes("FRALDAS")) origemSelecionada = "Fraldas";
}

function configurarBotoesRapidosModal() {
    document.querySelectorAll('.btn-tipo-embalagem').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const tipo = btn.getAttribute('data-tipo');
            embalagemSelecionada = (embalagemSelecionada === tipo) ? "" : tipo;
            atualizarEstilosBotoesModal();
            textObservacoesAutomatico();
        });
    });

    document.querySelectorAll('.btn-origem-pacote').forEach(btn => {
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
    const btnTipoEntrega = document.getElementById('btn-tipo-entrega');
    const btnTipoRecolha = document.getElementById('btn-tipo-recolha');
    const inputTipoOperacao = document.getElementById('rota-tipo-operacao');

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

    if (btnAdicionarPostal) btnAdicionarPostal.addEventListener('click', () => processarAdicaoPorPostal());

    if (btnIniciarRota && dataRotaInput) {
        btnIniciarRota.addEventListener('click', () => {
            const dataSelecionada = dataRotaInput.value;
            if (!dataSelecionada) return alert("Por favor, selecione uma data.");
            const d = new Date(dataSelecionada);
            window.dataRotaSelecionada = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
            window.rotaIniciada = true;
            sincronizarPersistencia();
            sincronizarInterfaceRota();
        });
    }

    if (btnGpsPartida && statusPartida) {
        btnGpsPartida.addEventListener('click', () => {
            statusPartida.textContent = "A obter geolocalização do GPS...";
            if (!navigator.geolocation) return alert("GPS não suportado.");
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    obterEnderecoPorGPSGoogle(position.coords.latitude, position.coords.longitude, (moradaGps) => {
                        window.partidaLocalizacao = moradaGps || { lat: position.coords.latitude, lng: position.coords.longitude, address: "GPS Atual" };
                        statusPartida.innerHTML = `<strong>Partida:</strong> ${window.partidaLocalizacao.address}`;
                        sincronizarPersistencia();
                    });
                },
                () => alert("Erro ao aceder ao GPS.")
            );
        });
    }

    if (btnOtimizarRota) {
        btnOtimizarRota.addEventListener('click', () => otimizarItinerarioComVizinhoMaisProximo());
    }
}

export function sincronizarInterfaceRota() {
    const containerSetupRota = document.getElementById('container-setup-rota');
    const containerPlaneadorRota = document.getElementById('container-planeador-rota');
    if (!containerSetupRota || !containerPlaneadorRota) return;

    if (window.rotaIniciada) {
        containerSetupRota.classList.add('hidden');
        containerPlaneadorRota.classList.remove('hidden');
        renderMoradasAdicionadas();
        alternarModoRota(localStorage.getItem('cp_modo_rota') || 'planeamento');

        if (window.rotaOtimizada.length > 0) {
            document.getElementById('container-mapa')?.classList.remove('hidden');
            document.getElementById('container-rota-ordenada')?.classList.remove('hidden');
            renderizarItinerarioOtimizado();
            setTimeout(() => desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada), 300);
        }
    } else {
        containerSetupRota.classList.remove('hidden');
        containerPlaneadorRota.classList.add('hidden');
    }
}

export function setupModaisEdicao() {
    const btnCancelar = document.getElementById('btn-cancelar-edicao');
    const btnSalvar = document.getElementById('btn-salvar-edicao');
    if (!btnCancelar || !btnSalvar) return;

    btnCancelar.addEventListener('click', () => {
        document.getElementById('modal-editar-paragem')?.classList.add('hidden');
        itemSendoEditado = null;
    });

    configurarBotoesRapidosModal();
}

export function abrirModalEdicaoParagem(paragem) {
    const modal = document.getElementById('modal-editar-paragem');
    const txtMorada = document.getElementById('edit-morada-texto');
    const txtObs = document.getElementById('edit-morada-obs');
    if (!modal || !txtMorada || !txtObs) return;

    itemSendoEditado = paragem;
    txtMorada.value = paragem.address;
    txtObs.value = paragem.observation || "";

    preencherSelecoesPorTexto(paragem.observation || "");
    atualizarEstilosBotoesModal();

    modal.classList.remove('hidden');
}