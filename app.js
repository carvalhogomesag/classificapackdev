// app.js
import { setupNavigation, showTab, updateVisor } from './ui.js';
import { saveData } from './storage.js';
import { renderDrivers, handleDriverSubmit, updateMotoristaSelect, renderIntervals } from './gestao.js';
import { inicializarGoogleAutocomplete, obterEnderecoPorGPSGoogle, calcularDistanciaHaversine, desenharMapaGoogle, limparMapaVisual } from './rotas.js';

// ==========================================
// PALETE DE CORES GLOBAL
// ==========================================
const colorPalette = [
    "#2563EB", "#DC2626", "#059669", "#EA580C", 
    "#7C3AED", "#DB2777", "#0891B2", "#D97706", 
    "#0D9488", "#4F46E5", "#E11D48", "#4B5563"
];

// ==========================================
// FUNÇÃO DE UTILIDADE: SAFE JSON PARSE (BLINDAGEM DE MEMÓRIA)
// ==========================================
function safeJSONParse(key, fallback) {
    try {
        const item = localStorage.getItem(key);
        // Filtra nulos, vazios ou o texto literal corrompido "undefined"
        if (item === null || item === "undefined" || item === "") {
            return fallback;
        }
        return JSON.parse(item);
    } catch (error) {
        console.warn(`Classifica Pack (LocalStorage): Chave corrompida '${key}'. Limpando registo.`, error);
        localStorage.removeItem(key);
        return fallback;
    }
}

// ==========================================
// ESTADO GLOBAL DA APLICAÇÃO (RECUPERAÇÃO SEGURA)
// ==========================================
window.drivers = safeJSONParse('cp_drivers', []);
window.intervals = safeJSONParse('cp_intervals', []);
window.assignments = safeJSONParse('cp_assignments', []);

window.currentInput = "";
window.isPrefixLocked = false;
window.lockedPrefixValue = "";
window.selectedColor = "#2563EB";
window.lastAnalysisResult = null;

// Estados das Rotas com Recuperação de Memória Ativa e Segura contra erros de sintaxe
window.partidaLocalizacao = safeJSONParse('cp_partida', null);
window.moradasEntregas = safeJSONParse('cp_entregas', []);
window.rotaOtimizada = safeJSONParse('cp_rota_otimizada', []);
window.dataRotaSelecionada = safeJSONParse('cp_data_rota', "");
window.rotaIniciada = safeJSONParse('cp_rota_iniciada', false);
window.definindoPartidaPorMorada = false;

// Estado para controle de edição
let itemSendoEditado = null; 

// ==========================================
// INICIALIZAÇÃO DA APLICAÇÃO
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    carregarGoogleMapsScript();
    setupNavigation(showTab);
    setupKeypad();
    setupPrefixLock();
    setupForms();
    renderColorPicker();
    setupResetLeituras();
    setupRotasLogic();
    setupModaisEdicao();
    
    const visorCodigo = document.getElementById('visor-codigo');
    if (visorCodigo) {
        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
    }
    
    // Renderizações Iniciais Seguras
    const listaMotoristas = document.getElementById('lista-motoristas');
    if (listaMotoristas) {
        renderDrivers(window.drivers, listaMotoristas, window.deleteDriver);
    }
    
    const listaIntervalos = document.getElementById('lista-intervalos');
    if (listaIntervalos) {
        renderIntervals(window.intervals, window.drivers, listaIntervalos, window.deleteInterval);
    }
    
    const selectMotorista = document.getElementById('select-motorista');
    if (selectMotorista) {
        updateMotoristaSelect(window.drivers, selectMotorista);
    }
    
    renderSummary();
    sincronizarInterfaceRota();
});

function carregarGoogleMapsScript() {
    if (typeof google !== 'undefined') return;
    if (typeof GOOGLE_MAPS_API_KEY === 'undefined' || !GOOGLE_MAPS_API_KEY) {
        console.error("Chave de API do Google Maps não foi definida no config.js.");
        return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
        console.log("Google Maps SDK carregado.");
        const buscaMoradaInput = document.getElementById('busca-morada');
        if (buscaMoradaInput) {
            inicializarGoogleAutocomplete(buscaMoradaInput, adicionarMorada);
        }
    };
    script.onerror = () => console.error("Falha ao carregar o SDK do Google Maps.");
    document.head.appendChild(script);
}

// ==========================================
// LÓGICA DAS ROTAS DO TURNO
// ==========================================
function setupRotasLogic() {
    const btnIniciarRota = document.getElementById('btn-iniciar-rota');
    const dataRotaInput = document.getElementById('data-rota');
    const btnEncerrarRota = document.getElementById('btn-encerrar-rota');
    const btnGpsPartida = document.getElementById('btn-gps-partida');
    const btnBuscarPartida = document.getElementById('btn-buscar-partida');
    const btnLimparEnderecos = document.getElementById('btn-limpar-enderecos');
    const btnOtimizarRota = document.getElementById('btn-otimizar-rota');
    const statusPartida = document.getElementById('status-partida');
    const buscaMoradaInput = document.getElementById('busca-morada');

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
            
            const containerMapa = document.getElementById('container-mapa');
            const containerRotaOrdenada = document.getElementById('container-rota-ordenada');
            const estatisticasRota = document.getElementById('estatisticas-rota');
            
            if (containerMapa) containerMapa.classList.add('hidden');
            if (containerRotaOrdenada) containerRotaOrdenada.classList.add('hidden');
            if (estatisticasRota) estatisticasRota.classList.add('hidden');
            
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

function sincronizarInterfaceRota() {
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

function adicionarMorada(morada) {
    const buscaMoradaInput = document.getElementById('busca-morada');
    const statusPartida = document.getElementById('status-partida');

    if (window.definindoPartidaPorMorada) {
        window.partidaLocalizacao = morada;
        if (statusPartida) statusPartida.innerHTML = `<strong>Partida:</strong> ${morada.address}`;
        window.definindoPartidaPorMorada = false;
        if (buscaMoradaInput) buscaMoradaInput.placeholder = "Comece a digitar a morada aqui...";
    } else {
        morada.status = "Pendente"; 
        morada.observation = ""; 
        window.moradasEntregas.push(morada);
        renderMoradasAdicionadas();
    }
    sincronizarPersistencia();
    if (buscaMoradaInput) buscaMoradaInput.value = "";
}

function renderMoradasAdicionadas() {
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
            renderMoradasAdicionadas();
            sincronizarPersistencia();
        };

        listaMoradasAdicionadas.appendChild(item);
    });
}

function otimizarItinerarioComVizinhoMaisProximo() {
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
}

function renderizarItinerarioOtimizado() {
    listaRotaFinal.innerHTML = "";
    window.rotaOtimizada.forEach((paragem, index) => {
        const item = document.createElement('div');
        
        let statusColor = "bg-blue-600";
        if (paragem.status === "Entregue") statusColor = "bg-green-500";
        if (paragem.status === "Falhou") statusColor = "bg-red-500";

        item.className = "bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex flex-col space-y-2 animate-fade-in";
        const linkGoogleMaps = `https://www.google.com/maps/dir/?api=1&destination=${paragem.lat},${paragem.lng}&travelmode=driving`;

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
                    </div>
                    <p class="text-xs font-semibold text-gray-700 mt-1 truncate" title="${paragem.address}">
                        ${paragem.address}
                    </p>
                    ${paragem.observation ? `<div class="bg-yellow-50 border border-yellow-100 p-2 rounded mt-1 text-[11px] text-gray-600 font-medium italic"><i class="fa-solid fa-comment-dots text-yellow-500 mr-1"></i> ${paragem.observation}</div>` : ''}
                </div>
                <div class="flex flex-col space-y-1">
                    <a href="${linkGoogleMaps}" target="_blank" class="bg-green-600 hover:bg-green-700 text-white font-bold px-3 py-2 rounded-lg text-xs flex items-center justify-center space-x-1 whitespace-nowrap shadow-sm">
                        <i class="fa-solid fa-location-arrow"></i> <span>Navegar</span>
                    </a>
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

        item.querySelectorAll('.btn-status').forEach(btn => {
            btn.onclick = () => {
                const novoStatus = btn.getAttribute('data-status');
                paragem.status = novoStatus;
                
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
// PAINEL DE ESTATÍSTICAS DO TURNO (À PROVA DE FALHAS)
// ==========================================
function renderEstatisticasRota() {
    const estatisticasRota = document.getElementById('estatisticas-rota');
    const statTotal = document.getElementById('stat-total');
    const statEntregues = document.getElementById('stat-entregues');
    const statFalhadas = document.getElementById('stat-falhadas');
    const statPendentes = document.getElementById('stat-pendentes');

    if (!estatisticasRota || !statTotal) return;

    estatisticasRota.classList.remove('hidden');

    const total = window.rotaOtimizada.length;
    const entregues = window.rotaOtimizada.filter(p => p.status === "Entregue").length;
    const falhadas = window.rotaOtimizada.filter(p => p.status === "Failed" || p.status === "Falhou").length;
    const pendentes = window.rotaOtimizada.filter(p => !p.status || p.status === "Pendente").length;

    statTotal.textContent = total;
    statEntregues.textContent = entregues;
    statFalhadas.textContent = falhadas;
    statPendentes.textContent = pendentes;
}

// ==========================================
// MODAL DE EDIÇÃO DE MORADA / OBSERVAÇÃO
// ==========================================
function setupModaisEdicao() {
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

function abrirModalEdicaoParagem(paragem, estaNaRotaOtimizada) {
    const modalEditarParagem = document.getElementById('modal-editar-paragem');
    const editMoradaTexto = document.getElementById('edit-morada-texto');
    const editMoradaObs = document.getElementById('edit-morada-obs');

    if (!modalEditarParagem || !editMoradaTexto || !editMoradaObs) return;

    itemSendoEditado = paragem;
    editMoradaTexto.value = paragem.address;
    editMoradaObs.value = paragem.observation || "";
    modalEditarParagem.classList.remove('hidden');
}

// CORREÇÃO: Gravação correta de parâmetros para o storage.js
function sincronizarPersistencia() {
    saveData(
        window.drivers, 
        window.intervals, 
        window.assignments,
        window.partidaLocalizacao,
        window.moradasEntregas,
        window.rotaOtimizada,
        window.dataRotaSelecionada, // Passagem correta do parâmetro de data
        window.rotaIniciada // Passagem correta do parâmetro de status da rota
    );
}

// ==========================================
// TECLADO NUMÉRICO E VISOR
// ==========================================
function setupKeypad() {
    document.querySelectorAll('.btn-key').forEach(button => {
        button.addEventListener('click', () => {
            const val = button.getAttribute('data-val');
            const maxDigits = window.isPrefixLocked ? 3 : 7;
            if (window.currentInput.length < maxDigits) {
                window.currentInput += val;
                const visorCodigo = document.getElementById('visor-codigo');
                if (visorCodigo) updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
            }
        });
    });

    const btnClear = document.getElementById('btn-key-clear');
    if (btnClear) {
        btnClear.addEventListener('click', () => {
            window.currentInput = "";
            const visorCodigo = document.getElementById('visor-codigo');
            if (visorCodigo) updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
        });
    }

    const btnBackspace = document.getElementById('btn-key-backspace');
    if (btnBackspace) {
        btnBackspace.addEventListener('click', () => {
            window.currentInput = window.currentInput.slice(0, -1);
            const visorCodigo = document.getElementById('visor-codigo');
            if (visorCodigo) updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
        });
    }
}

function setupPrefixLock() {
    const chkFixarPrefixo = document.getElementById('chk-fixar-prefixo');
    const inputPrefixo = document.getElementById('input-prefixo');
    const visorCodigo = document.getElementById('visor-codigo');

    if (!chkFixarPrefixo || !inputPrefixo || !visorCodigo) return;

    chkFixarPrefixo.addEventListener('change', (e) => {
        window.isPrefixLocked = e.target.checked;
        if (window.isPrefixLocked) {
            inputPrefixo.disabled = false;
            inputPrefixo.classList.remove('bg-gray-200', 'text-gray-500');
            inputPrefixo.classList.add('bg-white', 'text-gray-900');
            inputPrefixo.focus();
            
            window.lockedPrefixValue = sanitizeDigits(inputPrefixo.value).substring(0, 4);
            if (!window.lockedPrefixValue) {
                window.lockedPrefixValue = "2700";
                inputPrefixo.value = "2700";
            }
        } else {
            inputPrefixo.disabled = true;
            inputPrefixo.classList.add('bg-gray-200', 'text-gray-500');
            inputPrefixo.classList.remove('bg-white', 'text-gray-900');
        }
        window.currentInput = ""; 
        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
    });

    inputPrefixo.addEventListener('input', (e) => {
        let val = sanitizeDigits(e.target.value).substring(0, 4);
        e.target.value = val;
        window.lockedPrefixValue = val;
        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
    });
}

// ==========================================
// GESTÃO DE FORMULÁRIOS E DADOS
// ==========================================
function setupForms() {
    const formMotorista = document.getElementById('form-motorista');
    const formIntervalo = document.getElementById('form-intervalo');
    const listaMotoristas = document.getElementById('lista-motoristas');
    const selectMotorista = document.getElementById('select-motorista');
    const intInicioInput = document.getElementById('int-inicio');
    const intFimInput = document.getElementById('int-fim');
    const listaIntervalos = document.getElementById('lista-intervalos');

    if (formMotorista && listaMotoristas && selectMotorista) {
        formMotorista.addEventListener('submit', (e) => {
            handleDriverSubmit(e, window.drivers, window.selectedColor, () => {
                renderDrivers(window.drivers, listaMotoristas, window.deleteDriver);
                renderSummary();
                updateMotoristaSelect(window.drivers, selectMotorista);
            });
        });
    }

    if (intInicioInput) setupIntervalInputFormatting(intInicioInput);
    if (intFimInput) setupIntervalInputFormatting(intFimInput);

    if (formIntervalo && selectMotorista && intInicioInput && intFimInput && listaIntervalos) {
        formIntervalo.addEventListener('submit', (e) => {
            e.preventDefault();
            const driverId = selectMotorista.value;
            const startRaw = intInicioInput.value;
            const endRaw = intFimInput.value;
            const startClean = sanitizeDigits(startRaw);
            const endClean = sanitizeDigits(endRaw);

            if (startClean.length !== 7 || endClean.length !== 7) return alert('Insira códigos postais completos (ex: 2700-123).');
            if (parseInt(startClean, 10) > parseInt(endClean, 10)) return alert('Código inicial não pode ser maior.');

            const newInterval = { id: 'i_' + Date.now(), driverId, start: `${startClean.substring(0, 4)}-${startClean.substring(4, 7)}`, end: `${endClean.substring(0, 4)}-${endClean.substring(4, 7)}` };
            window.intervals.push(newInterval);
            sincronizarPersistencia();

            intInicioInput.value = ""; intFimInput.value = "";
            renderIntervals(window.intervals, window.drivers, listaIntervalos, window.deleteInterval);
            alert('Intervalo criado!');
        });
    }
}

function renderColorPicker() {
    const colorPickerContainer = document.getElementById('color-picker-container');
    if (!colorPickerContainer) return;

    colorPickerContainer.innerHTML = "";
    colorPalette.forEach((color, idx) => {
        const btn = document.createElement('button');
        btn.type = "button";
        btn.style.backgroundColor = color;
        btn.className = `h-10 w-full rounded-lg border-2 transition-all duration-150 ${idx === 0 ? 'border-black scale-110' : 'border-transparent'}`;
        btn.addEventListener('click', () => {
            window.selectedColor = color;
            Array.from(colorPickerContainer.children).forEach(child => {
                child.classList.remove('border-black', 'scale-110');
                child.classList.add('border-transparent');
            });
            btn.classList.add('border-black', 'scale-110');
        });
        colorPickerContainer.appendChild(btn);
    });
}

function setupResetLeituras() {
    const btnLimparLeituras = document.getElementById('btn-limpar-leituras');
    if (btnLimparLeituras) {
        btnLimparLeituras.addEventListener('click', () => {
            if (confirm("Deseja realmente limpar todas as leituras?")) {
                window.assignments = [];
                sincronizarPersistencia();
                renderSummary();
            }
        });
    }
}

// ==========================================
// HISTÓRICO DE LEITURAS / RESUMO DE PRODUÇÃO
// ==========================================
// NOVO: RenderSummary declarada de forma segura e visível em qualquer nível
function renderSummary() {
    const painelResumo = document.getElementById('painel-resumo');
    if (!painelResumo) return;

    painelResumo.innerHTML = "";

    const totalLeituras = window.assignments.length;
    const totalPrioritarios = window.assignments.filter(a => a.priority === true).length; 

    const headerDiv = document.createElement('div');
    headerDiv.className = "flex justify-between items-center pb-2 border-b text-sm font-semibold text-gray-700";
    headerDiv.innerHTML = `
        <span>Total Processado:</span>
        <div class="flex items-center space-x-1.5">
            <span class="bg-blue-600 text-white px-2.5 py-0.5 rounded-full text-xs font-bold" title="Total de encomendas">${totalLeituras} un</span>
            ${totalPrioritarios > 0 ? `<span class="bg-orange-500 text-white px-2.5 py-0.5 rounded-full text-xs font-bold flex items-center space-x-1" title="Prioritárias"><i class="fa-solid fa-circle-exclamation"></i> <span>${totalPrioritarios}</span></span>` : ''}
        </div>
    `;
    painelResumo.appendChild(headerDiv);

    if (window.drivers.length === 0) {
        painelResumo.innerHTML += `<p class="text-xs text-gray-400 italic text-center py-2">Registe motoristas para ver o resumo.</p>`;
        return;
    }

    window.drivers.forEach(driver => {
        const totalDriver = window.assignments.filter(a => a.driverId === driver.id).length;
        const totalPrioritariosDriver = window.assignments.filter(a => a.driverId === driver.id && a.priority === true).length;
        const percent = totalLeituras > 0 ? Math.round((totalDriver / totalLeituras) * 100) : 0;

        const row = document.createElement('div');
        row.className = "flex items-center justify-between text-xs py-1";
        row.innerHTML = `
            <div class="flex items-center space-x-2">
                <span class="w-3.5 h-3.5 rounded-full" style="background-color: ${driver.color}"></span>
                <span class="font-medium text-gray-700">${driver.name}</span>
            </div>
            <div class="flex items-center space-x-2 font-bold text-gray-900">
                <span>${totalDriver} un</span>
                ${totalPrioritariosDriver > 0 ? `<span class="bg-orange-100 text-orange-700 text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center space-x-0.5" title="Prioritários"><i class="fa-solid fa-circle-exclamation text-[8px]"></i> <span>${totalPrioritariosDriver}</span></span>` : ''}
                <span class="text-gray-400 text-[10px] font-normal">(${percent}%)</span>
            </div>
        `;
        painelResumo.appendChild(row);
    });

    const totalSemMotorista = window.assignments.filter(a => a.driverId === null).length;
    const totalSemMotoristaPrioridade = window.assignments.filter(a => a.driverId === null && a.priority === true).length;
    
    if (totalSemMotorista > 0) {
        const percentSem = Math.round((totalSemMotorista / totalLeituras) * 100);
        const rowSem = document.createElement('div');
        rowSem.className = "flex items-center justify-between text-xs py-1 border-t border-dashed mt-1 pt-1";
        rowSem.innerHTML = `
            <div class="flex items-center space-x-2 text-gray-500">
                <span class="w-3.5 h-3.5 rounded-full bg-gray-400"></span>
                <span class="font-medium italic">Sem Motorista</span>
            </div>
            <div class="flex items-center space-x-2 font-bold text-red-600">
                <span>${totalSemMotorista} un</span>
                ${totalSemMotoristaPrioridade > 0 ? `<span class="bg-orange-100 text-orange-700 text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center space-x-0.5"><i class="fa-solid fa-circle-exclamation text-[8px]"></i> <span>${totalSemMotoristaPrioridade}</span></span>` : ''}
                <span class="text-gray-400 text-[10px] font-normal">(${percentSem}%)</span>
            </div>
        `;
        painelResumo.appendChild(rowSem);
    }
}

// Métodos Globais de Exclusão
window.deleteDriver = (id) => {
    if (confirm("Ao apagar este motorista, os seus intervalos e contagens de pacotes também serão removidos. Confirmar?")) {
        window.drivers = window.drivers.filter(d => d.id !== id);
        window.intervals = window.intervals.filter(i => i.driverId !== id);
        window.assignments = window.assignments.filter(a => a.driverId !== id); 
        sincronizarPersistencia();
        
        const listaMotoristas = document.getElementById('lista-motoristas');
        if (listaMotoristas) {
            renderDrivers(window.drivers, listaMotoristas, window.deleteDriver);
        }
        
        renderSummary();
        
        const selectMotorista = document.getElementById('select-motorista');
        if (selectMotorista) {
            updateMotoristaSelect(window.drivers, selectMotorista);
        }
    }
};

window.deleteInterval = (id) => {
    if (confirm("Deseja apagar este intervalo?")) {
        window.intervals = window.intervals.filter(i => i.id !== id);
        sincronizarPersistencia();
        
        const listaIntervalos = document.getElementById('lista-intervalos');
        if (listaIntervalos) {
            renderIntervals(window.intervals, window.drivers, listaIntervalos, window.deleteInterval);
        }
    }
};

function setupIntervalInputFormatting(inputElement) {
    inputElement.addEventListener('input', (e) => {
        let val = sanitizeDigits(e.target.value);
        if (val.length > 4) {
            val = val.substring(0, 4) + '-' + val.substring(4, 7);
        }
        e.target.value = val;
    });
}

function sanitizeDigits(str) { return str.replace(/\D/g, ''); }