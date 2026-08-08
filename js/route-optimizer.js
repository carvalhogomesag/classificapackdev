/**
 * js/route-optimizer.js
 * Faz: Gere exclusivamente os cálculos de otimização de rotas (Google Cloud Route Optimization API 
 *      e algoritmo de contingência local do vizinho mais próximo), bem como a renderização 
 *      do itinerário otimizado e estatísticas de viagem.
 * Depende de: ./maps.js, ./odometer.js, ./navigation.js
 */

import { calcularDistanciaHaversine, desenharMapaGoogle } from './maps.js';
import { abrirModalOdometroSaida, abrirModalOdometroChegada } from './odometer.js';
import { abrirNavegacao } from './navigation.js';

// ==========================================
// ALGORITMO SÍNCRONO LOCAL DE CONTINGÊNCIA (VIZINHO MAIS PRÓXIMO)
// ==========================================
export function calcularRotaVizinhoMaisProximoLocal() {
    if (!window.partidaLocalizacao || window.moradasEntregas.length === 0) return;

    const unvisited = [...window.moradasEntregas];
    const optimized = [];
    let currentCoords = { lat: window.partidaLocalizacao.lat, lng: window.partidaLocalizacao.lng };

    while (unvisited.length > 0) {
        let nearestIndex = 0;
        let minDistance = Infinity;

        for (let i = 0; i < unvisited.length; i++) {
            const dist = calcularDistanciaHaversine(currentCoords.lat, currentCoords.lng, unvisited[i].lat, unvisited[i].lng);
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

// ==========================================
// DESENHAR LISTA DE ENTREGAS OTIMIZADA
// ==========================================
export function renderizarItinerarioOtimizado(sincronizarPersistenciaCallback, abrirModalEdicaoParagemCallback) {
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

        const primeiraLinhaObs = paragem.observation ? paragem.observation.split('\n')[0] : "";
        const bolinhaHtml = isNewUnconfirmed 
            ? `<span class="btn-index-badge w-5 h-5 rounded-full bg-orange-500 text-white animate-bounce font-bold text-[10px] flex items-center justify-center flex-shrink-0 cursor-pointer">${index + 1}</span>`
            : `<span class="btn-index-badge w-5 h-5 rounded-full ${statusColor} text-white font-bold text-[10px] flex items-center justify-center flex-shrink-0">${index + 1}</span>`;

        item.innerHTML = `
            <div class="flex items-center justify-between space-x-2">
                <div class="flex-1 truncate">
                    <div class="flex items-center space-x-2 flex-wrap gap-1">
                        ${bolinhaHtml}
                        <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">A cerca de ${paragem.distanciaDoAnterior.toFixed(2)} km</span>
                        ${isRecolha ? `<span class="bg-purple-100 text-purple-700 border border-purple-200 text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide flex items-center space-x-1"><i class="fa-solid fa-hand-holding-hand text-purple-500"></i> <span>Recolha</span></span>` : ''}
                        ${isNewUnconfirmed ? `<span class="btn-confirm-seq bg-orange-500 text-white text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide animate-pulse cursor-pointer"><i class="fa-solid fa-circle-exclamation mr-0.5"></i> Novo (Por Confirmar)</span>` : ''}
                        ${isLastNavigated && !isNewUnconfirmed ? `<span class="bg-blue-600 text-white text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide animate-pulse">A navegar</span>` : ''}
                        ${isPriority ? `<span class="bg-orange-500 text-white text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide animate-pulse"><i class="fa-solid fa-circle-exclamation mr-0.5"></i> Prioritária</span>` : ''}
                        ${paragem.brickName ? `<span class="bg-blue-50 text-blue-700 border border-blue-200 text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide flex items-center space-x-1"><i class="fa-solid fa-boxes-stacked text-blue-500"></i> <span>Estante: ${paragem.brickName}</span></span>` : ''}
                    </div>
                    <p class="text-xs font-semibold text-gray-700 mt-1 truncate" title="${paragem.address}">${paragem.address}</p>
                    ${primeiraLinhaObs ? `<div class="bg-yellow-50 border border-yellow-100 p-2 rounded mt-1 text-[11px] text-gray-600 font-medium italic truncate"><i class="fa-solid fa-comment-dots text-yellow-500 mr-1"></i> ${primeiraLinhaObs}</div>` : ''}
                </div>
                <div class="flex flex-col space-y-1">
                    <button class="btn-navegar bg-green-600 hover:bg-green-700 text-white font-bold px-3 py-2 rounded-lg text-xs flex items-center justify-center space-x-1 whitespace-nowrap shadow-sm">
                        <i class="fa-solid fa-location-arrow"></i> <span>Navegar</span>
                    </button>
                    <button class="btn-edit-otimizada bg-gray-50 border hover:bg-gray-100 text-gray-700 font-bold px-3 py-1.5 rounded-lg text-[10px] text-center">Editar Info</button>
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
                renderizarItinerarioOtimizado(sincronizarPersistenciaCallback, abrirModalEdicaoParagemCallback); 
                abrirNavegacao(paragem);
            };

            if (index === 0 && (!window.tripStarted || !window.odometerStart || window.odometerStart === 0)) {
                abrirModalOdometroSaida(acaoNavegar);
            } else {
                acaoNavegar();
            }
        };

        item.querySelector('.btn-edit-otimizada').onclick = () => {
            if (typeof abrirModalEdicaoParagemCallback === 'function') {
                abrirModalEdicaoParagemCallback(paragem, true);
            }
        };

        if (isNewUnconfirmed) {
            item.querySelector('.btn-index-badge')?.addEventListener('click', (e) => { e.stopPropagation(); window.abrirModalAlterarSequencia(index, paragem); });
            item.querySelector('.btn-confirm-seq')?.addEventListener('click', (e) => { e.stopPropagation(); window.abrirModalAlterarSequencia(index, paragem); });
        }

        item.querySelectorAll('.btn-status').forEach(btn => {
            btn.onclick = () => {
                const novoStatus = btn.getAttribute('data-status');
                paragem.status = novoStatus;
                const idx = window.moradasEntregas.findIndex(m => m.id === paragem.id);
                if (idx !== -1) window.moradasEntregas[idx].status = novoStatus;
                
                if (typeof sincronizarPersistenciaCallback === 'function') sincronizarPersistenciaCallback();
                renderizarItinerarioOtimizado(sincronizarPersistenciaCallback, abrirModalEdicaoParagemCallback);
                desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
            };
        });

        listaRotaFinal.appendChild(item);
    });

    renderEstatisticasRota(sincronizarPersistenciaCallback);
}

// ==========================================
// PAINEL DE ESTATÍSTICAS DA ROTA ATIVA
// ==========================================
export function renderEstatisticasRota(sincronizarPersistenciaCallback, sincronizarInterfaceRotaCallback) {
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

    if (statTotal) statTotal.textContent = window.rotaOtimizada.length;
    if (statEntregues) statEntregues.textContent = window.rotaOtimizada.filter(p => p.status === "Entregue").length;
    if (statFalhas) statFalhas.textContent = window.rotaOtimizada.filter(p => p.status === "Failed" || p.status === "Falhou").length;
    if (statPendentes) statPendentes.textContent = window.rotaOtimizada.filter(p => !p.status || p.status === "Pendente").length;

    let totalDist = 0;
    window.rotaOtimizada.forEach(p => totalDist += p.distanciaDoAnterior || 0);

    if (statDistancia) statDistancia.textContent = `${totalDist.toFixed(2)} km`;

    if (statTempo) {
        if (totalDist === 0) {
            statTempo.textContent = "0 min";
        } else {
            const min = Math.round((totalDist / 40) * 60);
            statTempo.textContent = min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}min`;
        }
    }

    if (statSistema) {
        const metodo = window.routingMethodUsed || localStorage.getItem('cp_routing_method') || 'Cloud';
        if (metodo === 'Cloud') {
            statSistema.className = "inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide border bg-emerald-50 text-emerald-700 border-emerald-200";
            statSistema.innerHTML = `<i class="fa-solid fa-cloud"></i> <span>Google Cloud API (Real por Estrada)</span>`;
        } else {
            statSistema.className = "inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide border bg-amber-50 text-amber-700 border-amber-200 animate-pulse";
            statSistema.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>Contingência Local (Linha Reta)</span>`;
        }
    }

    if (btnFinalizarTurno) {
        if (window.tripStarted && !window.tripCompleted) {
            btnFinalizarTurno.classList.remove('hidden');
            btnFinalizarTurno.onclick = () => {
                abrirModalOdometroChegada(() => {
                    if (typeof sincronizarInterfaceRotaCallback === 'function') {
                        sincronizarInterfaceRotaCallback();
                    }
                });
            };
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
                if (totalKmEl) totalKmEl.textContent = `Total percorrido na rota: ${(window.odometerEnd - window.odometerStart).toFixed(1)} km`;
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