/**
 * rotas.js
 * Faz: Gere a lógica de turnos, otimização automática de rotas pelo algoritmo do Vizinho Mais Próximo, Modo Condução e a edição de moradas de entrega.
 * NÃO faz: Não interage diretamente com o hardware do mapa ou autocompletar da Google (delegado para o módulo maps.js).
 * Depende de: ./storage.js, ./voz.js, ./maps.js
 */

import { saveData } from './storage.js';
import { criarReconhecimentoVoz } from './voz.js';
import { 
    obterEnderecoPorGPSGoogle, 
    calcularDistanciaHaversine, 
    desenharMapaGoogle, 
    limparMapaVisual 
} from './maps.js';

let itemSendoEditado = null; 

// ==========================================
// CENTRALIZAÇÃO DA PERSISTÊNCIA DAS ROTAS
// ==========================================
function sincronizarPersistencia() {
    saveData(
        window.drivers, 
        [], // intervals obsoletos
        window.assignments,
        window.partidaLocalizacao,
        window.moradasEntregas,
        window.rotaOtimizada,
        window.dataRotaSelecionada, 
        window.rotaIniciada,
        window.sectors
    );
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
// RECONHECIMENTO DE VOZ (ABA ROTAS - MÉTODO UNIFICADO VIA VOZ.JS)
// ==========================================
export function setupVozLogic() {
    const btnVoz = document.getElementById('btn-voz');
    const buscaMoradaInput = document.getElementById('busca-morada');
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

// ==========================================
// ADICIONAR MORADA NO TURNO
// ==========================================
export function adicionarMorada(morada) {
    const buscaMoradaInput = document.getElementById('busca-morada');
    const statusPartida = document.getElementById('status-partida');

    if (window.definindoPartidaPorMorada) {
        window.partidaLocalizacao = morada;
        if (statusPartida) statusPartida.innerHTML = `<strong>Partida:</strong> ${morada.address}`;
        window.definindoPartidaPorMorada = false;
        if (buscaMoradaInput) buscaMoradaInput.placeholder = "Comece a digitar a morada aqui...";
        sincronizarPersistencia();
    } else {
        morada.status = "Pendente"; 
        morada.observation = ""; 
        window.moradasEntregas.push(morada);
        renderMoradasAdicionadas();
        sincronizarPersistencia();
        abrirModalEdicaoParagem(morada, false);
    }
    if (buscaMoradaInput) buscaMoradaInput.value = "";
}

// ==========================================
// DESENHAR MORADAS ADICIONADAS (FASE DE PLANEAMENTO)
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
        item.className = "flex items-center justify-between p-2 bg-gray-50 rounded border text-xs animate-fade-in space-x-2";
        item.innerHTML = `
            <div class="flex-1 truncate">
                <strong class="text-gray-500">#${index + 1}</strong> <span>${morada.address}</span>
                ${morada.observation ? `<p class="text-[10px] text-blue-500 font-semibold italic mt-0.5 truncate">Nota: ${morada.observation}</p>` : ''}
            </div>
            <div class="flex items-center space-x-1.5 flex-shrink-0">
                <button class="btn-edit-morada text-blue-500 font-bold p-1 hover:bg-blue-50 rounded"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-del-morada text-red-500 font-bold p-1 hover:bg-red-50 rounded">X</button>
            </div>
        `;
        
        item.querySelector('.btn-edit-morada').onclick = () => abrirModalEdicaoParagem(morada, false);
        
        item.querySelector('.btn-del-morada').onclick = () => {
            window.moradasEntregas = window.moradasEntregas.filter(m => m.id !== morada.id);
            window.rotaOtimizada = window.rotaOtimizada.filter(m => m.id !== morada.id); 
            
            renderMoradasAdicionadas();
            
            if (window.rotaOtimizada.length > 0) {
                renderizarItinerarioOtimizado();
                desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
            } else {
                const containerMapa = document.getElementById('container-mapa');
                const containerRotaOrdenada = document.getElementById('container-rota-ordenada');
                const estatisticasRota = document.getElementById('estatisticas-rota');
                if (containerMapa) containerMapa.classList.add('hidden');
                if (containerRotaOrdenada) containerRotaOrdenada.classList.add('hidden');
                if (estatisticasRota) estatisticasRota.classList.add('hidden');
                limparMapaVisual();
            }
            
            sincronizarPersistencia();
        };

        listaMoradasAdicionadas.appendChild(item);
    });
}

// =========================================================================
// ALGORITMO INTELIGENTE DE OTIMIZAÇÃO: VIZINHO MAIS PRÓXIMO (GREEDY TSP)
// =========================================================================
export function otimizarItinerarioComVizinhoMaisProximo() {
    let atual = { lat: window.partidaLocalizacao.lat, lng: window.partidaLocalizacao.lng };
    let restantes = [...window.moradasEntregas];
    window.rotaOtimizada = [];

    while (restantes.length > 0) {
        let indiceMaisProximo = -1;
        let menorDistancia = Infinity;

        for (let i = 0; i < restantes.length; i++) {
            const dist = calcularDistanciaHaversine(atual.lat, atual.lng, restantes[i].lat, restantes[i].lng);
            if (dist < menorDistancia) {
                menorDistancia = dist;
                indiceMaisProximo = i;
            }
        }

        if (indiceMaisProximo !== -1) {
            const paragem = restantes[indiceMaisProximo];
            paragem.distanciaDoAnterior = menorDistancia;
            window.rotaOtimizada.push(paragem);
            atual = { lat: paragem.lat, lng: paragem.lng };
            restantes.splice(indiceMaisProximo, 1);
        }
    }

    const containerMapa = document.getElementById('container-mapa');
    const containerRotaOrdenada = document.getElementById('container-rota-ordenada');
    if (containerMapa) containerMapa.classList.remove('hidden');
    if (containerRotaOrdenada) containerRotaOrdenada.classList.remove('hidden');

    renderizarItinerarioOtimizado();
    sincronizarPersistencia();
    
    setTimeout(() => {
        desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
    }, 300);

    // Entra logo em Modo Condução focado após otimizar a rota
    alternarModoRota('conducao');
}

// =========================================================================
// DESENHAR LISTA DE ENTREGAS OTIMIZADA COM SISTEMA DE SCROLL INTELIGENTE
// =========================================================================
export function renderizarItinerarioOtimizado() {
    const listaRotaFinal = document.getElementById('lista-rota-final');
    if (!listaRotaFinal) return;

    listaRotaFinal.innerHTML = "";
    
    const lastNavigatedId = localStorage.getItem('cp_last_navigated_id');

    window.rotaOtimizada.forEach((paragem, index) => {
        const item = document.createElement('div');
        item.id = `paragem-${paragem.id}`; // Para scroll automático
        
        let statusColor = "bg-blue-600";
        if (paragem.status === "Entregue") statusColor = "bg-green-500";
        if (paragem.status === "Falhou") statusColor = "bg-red-500";

        const isLastNavigated = paragem.id === lastNavigatedId;

        // Visual estético destacado para o item ativo que está em navegação
        if (isLastNavigated) {
            item.className = "p-3 rounded-xl flex flex-col space-y-2 animate-fade-in border-2 border-blue-500 bg-blue-50/70 shadow-md ring-4 ring-blue-100";
        } else {
            item.className = "bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex flex-col space-y-2 animate-fade-in";
        }

        const linkGoogleMaps = `https://www.google.com/maps/dir/?api=1&destination=${paragem.lat},${paragem.lng}&travelmode=driving`;
        const primeiraLinhaObs = paragem.observation ? paragem.observation.split('\n')[0] : "";

        item.innerHTML = `
            <div class="flex items-center justify-between space-x-2">
                <div class="flex-1 truncate">
                    <div class="flex items-center space-x-2">
                        <span class="w-5 h-5 rounded-full ${statusColor} text-white font-bold text-[10px] flex items-center justify-center flex-shrink-0 transition-colors">
                            ${index + 1}
                        </span>
                        <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                            A cerca de ${paragem.distanciaDoAnterior.toFixed(2)} km
                        </span>
                        ${isLastNavigated ? `<span class="bg-blue-600 text-white text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide animate-pulse">A navegar</span>` : ''}
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

        item.querySelector('.btn-edit-otimizada').onclick = () => abrirModalEdicaoParagem(paragem, true);

        // Ao carregar em navegar, regista o ID para destacar o item de forma persistente
        item.querySelector('.btn-navegar').onclick = () => {
            localStorage.setItem('cp_last_navigated_id', paragem.id);
            renderizarItinerarioOtimizado(); 
            window.open(linkGoogleMaps, '_blank');
        };

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

    // SCROLL AUTOMÁTICO SUAVE: Desloca o telemóvel para focar a entrega ativa
    if (lastNavigatedId) {
        setTimeout(() => {
            const elementoAlvo = document.getElementById(`paragem-${lastNavigatedId}`);
            if (elementoAlvo) {
                elementoAlvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 150);
    }
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
}

// ==========================================
// CONFIGURAÇÃO DO MENU E CONTROLOS DE TURNOS
// ==========================================
export function setupRotasLogic() {
    const btnIniciarRota = document.getElementById('btn-iniciar-rota');
    const dataRotaInput = document.getElementById('data-rota');
    const btnEncerrarRota = document.getElementById('btn-encerrar-rota');
    const btnGpsPartida = document.getElementById('btn-gps-partida');
    const btnBuscarPartida = document.getElementById('btn-buscar-partida');
    const btnLimparEnderecos = document.getElementById('btn-limpar-enderecos');
    const btnOtimizarRota = document.getElementById('btn-otimizar-rota');
    const statusPartida = document.getElementById('status-partida');
    const buscaMoradaInput = document.getElementById('busca-morada');

    const btnPlaneamento = document.getElementById('btn-modo-planeamento');
    const btnConducao = document.getElementById('btn-modo-conducao');

    if (btnPlaneamento && btnConducao) {
        btnPlaneamento.addEventListener('click', () => alternarModoRota('planeamento'));
        btnConducao.addEventListener('click', () => alternarModoRota('conducao'));
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
            window.dataRotaSelecionada = dataFormatada;
            window.rotaIniciada = true;
            sincronizarPersistencia();
            sincronizarInterfaceRota();
        });
    }

    if (btnEncerrarRota) {
        btnEncerrarRota.addEventListener('click', () => {
            if (confirm("Tem a certeza de que deseja encerrar a rota atual? Isto limpará o itinerário planeado.")) {
                window.partidaLocalizacao = null;
                window.moradasEntregas = [];
                window.rotaOtimizada = [];
                window.dataRotaSelecionada = "";
                window.rotaIniciada = false;
                localStorage.removeItem('cp_last_navigated_id');
                limparMapaVisual();
                sincronizarPersistencia();
                sincronizarInterfaceRota();
            }
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

    if (btnBuscarPartida && buscaMoradaInput) {
        btnBuscarPartida.addEventListener('click', () => {
            window.definindoPartidaPorMorada = true;
            buscaMoradaInput.placeholder = "Procure a morada de PARTIDA...";
            buscaMoradaInput.focus();
        });
    }

    if (btnLimparEnderecos) {
        btnLimparEnderecos.addEventListener('click', () => {
            window.moradasEntregas = [];
            window.rotaOtimizada = [];
            localStorage.removeItem('cp_last_navigated_id');
            document.getElementById('container-mapa').classList.add('hidden');
            document.getElementById('container-rota-ordenada').classList.add('hidden');
            document.getElementById('estatisticas-rota').classList.add('hidden');
            limparMapaVisual();
            renderMoradasAdicionadas();
            sincronizarPersistencia();
        });
    }

    if (btnOtimizarRota) {
        btnOtimizarRota.addEventListener('click', () => {
            if (!window.partidaLocalizacao) return alert("Por favor, defina um ponto de Partida primeiro.");
            if (window.moradasEntregas.length === 0) return alert("Adicione pelo menos uma morada de entrega.");
            otimizarItinerarioComVizinhoMaisProximo();
        });
    }
}

// ==========================================
// SINCRONIZAÇÃO DA INTERFACE DE CONFIGURAÇÃO DE TURNO
// ==========================================
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

        const modoSalvo = localStorage.getItem('cp_modo_rota') || 'planeamento';
        alternarModoRota(modoSalvo);

        if (window.rotaOtimizada.length > 0) {
            const containerMapa = document.getElementById('container-mapa');
            const containerRotaOrdenada = document.getElementById('container-rota-ordenada');
            if (containerMapa) containerMapa.classList.remove('hidden');
            if (containerRotaOrdenada) containerRotaOrdenada.classList.remove('hidden');
            
            renderizarItinerarioOtimizado();
            
            setTimeout(() => {
                desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
            }, 300);
        } else {
            const containerMapa = document.getElementById('container-mapa');
            const containerRotaOrdenada = document.getElementById('container-rota-ordenada');
            const estatisticasRota = document.getElementById('estatisticas-rota');
            if (containerMapa) containerMapa.classList.add('hidden');
            if (containerRotaOrdenada) containerRotaOrdenada.classList.add('hidden');
            if (estatisticasRota) estatisticasRota.classList.add('hidden');
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

// ==========================================
// CONFIGURAÇÃO DO POP-UP (MODAL) DE EDIÇÃO DE PARAGENS
// ==========================================
export function setupModaisEdicao() {
    const btnCancelarEdicao = document.getElementById('btn-cancelar-edicao');
    const btnSalvarEdicao = document.getElementById('btn-salvar-edicao');

    if (!btnCancelarEdicao || !btnSalvarEdicao) return;

    btnCancelarEdicao.addEventListener('click', () => {
        const modalEditarParagem = document.getElementById('modal-editar-paragem');
        if (modalEditarParagem) modalEditarParagem.classList.add('hidden');
        itemSendoEditado = null;
    });

    btnSalvarEdicao.addEventListener('click', () => {
        if (!itemSendoEditado) return;

        const editMoradaTexto = document.getElementById('edit-morada-texto');
        const editMoradaObs = document.getElementById('edit-morada-obs');
        if (!editMoradaTexto || !editMoradaObs) return;

        const novaMorada = editMoradaTexto.value.trim();
        const novaObs = editMoradaObs.value.trim();

        if (!novaMorada) {
            alert("A morada de entrega não pode ficar em branco.");
            return;
        }

        let itemIndexPre = window.moradasEntregas.findIndex(m => m.id === itemSendoEditado.id);
        let itemIndexPos = window.rotaOtimizada.findIndex(m => m.id === itemSendoEditado.id);

        if (itemIndexPre !== -1) {
            window.moradasEntregas[itemIndexPre].address = novaMorada;
            window.moradasEntregas[itemIndexPre].observation = novaObs;
        }

        if (itemIndexPos !== -1) {
            window.rotaOtimizada[itemIndexPos].address = novaMorada;
            window.rotaOtimizada[itemIndexPos].observation = novaObs;
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
    });
}

export function abrirModalEdicaoParagem(paragem, estaNaRotaOtimizada) {
    const modalEditarParagem = document.getElementById('modal-editar-paragem');
    const editMoradaTexto = document.getElementById('edit-morada-texto');
    const editMoradaObs = document.getElementById('edit-morada-obs');

    if (!modalEditarParagem || !editMoradaTexto || !editMoradaObs) return;

    itemSendoEditado = paragem;
    editMoradaTexto.value = paragem.address;
    editMoradaObs.value = paragem.observation || "";
    modalEditarParagem.classList.remove('hidden');

    setTimeout(() => {
        editMoradaObs.focus();
        editMoradaObs.select();
    }, 150);
}