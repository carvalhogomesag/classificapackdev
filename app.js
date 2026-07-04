// app.js
import { setupNavigation, showTab, updateVisor, setupKeypad, setupPrefixLock } from './ui.js';
import { saveData, safeJSONParse } from './storage.js';
import { 
    renderDrivers, 
    handleDriverSubmit, 
    updateZoneSelect, 
    renderIntervals, 
    renderSummary,
    renderZones,
    renderIntervalCheckboxes,
    findDriverForZip
} from './gestao.js';
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
// ESTADO GLOBAL DA APLICAÇÃO (RECUPERAÇÃO SEGURA)
// ==========================================
window.drivers = safeJSONParse('cp_drivers', []);
window.intervals = safeJSONParse('cp_intervals', []);
window.assignments = safeJSONParse('cp_assignments', []);
window.zones = safeJSONParse('cp_zones', []); // Nova lista de agrupamentos

window.currentInput = "";
window.isPrefixLocked = false;
window.lockedPrefixValue = "";
window.selectedColor = "#2563EB";
window.lastAnalysisResult = null;

// Estados das Rotas com Recuperação de Memória Ativa e Segura
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
    setupTriagemLogic(); // Novo monitor de cliques da triagem
    
    const visorCodigo = document.getElementById('visor-codigo');
    if (visorCodigo) {
        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
    }
    
    // Renderizações Iniciais Seguras
    const listaMotoristas = document.getElementById('lista-motoristas');
    if (listaMotoristas) {
        renderDrivers(window.drivers, window.zones, listaMotoristas, window.deleteDriver);
    }
    
    renderizarZonasEIntervalosUI();
    atualizarSummaryUI();
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
// CENTRALIZAÇÃO E ATUALIZAÇÃO DA INTERFACE DE DADOS
// ==========================================
function renderizarZonasEIntervalosUI() {
    const listaIntervalos = document.getElementById('lista-intervalos');
    if (listaIntervalos) {
        renderIntervals(window.intervals, window.zones, listaIntervalos, window.deleteInterval);
    }
    
    const listaZonas = document.getElementById('lista-zonas');
    if (listaZonas) {
        renderZones(window.zones, window.intervals, listaZonas, window.deleteZone);
    }

    const checkboxesIntervalos = document.getElementById('checkboxes-intervalos');
    if (checkboxesIntervalos) {
        renderIntervalCheckboxes(window.intervals, checkboxesIntervalos);
    }

    const selectZonaMotorista = document.getElementById('select-zona-motorista');
    if (selectZonaMotorista) {
        updateZoneSelect(window.zones, selectZonaMotorista);
    }
}

function atualizarSummaryUI() {
    renderSummary(window.assignments, window.drivers, document.getElementById('painel-resumo'));
}

// ==========================================
// LÓGICA DE TRIAGEM (MÉTODO NOVO OPERACIONAL)
// ==========================================
function setupTriagemLogic() {
    const btnAnalisar = document.getElementById('btn-analisar');
    const btnConfirmarAtribuir = document.getElementById('btn-confirmar-atribuir');
    const modalResultado = document.getElementById('modal-resultado');

    if (btnAnalisar) {
        btnAnalisar.addEventListener('click', () => {
            let zipToAnalyze = "";
            if (window.isPrefixLocked) {
                zipToAnalyze = window.lockedPrefixValue + window.currentInput;
            } else {
                zipToAnalyze = window.currentInput;
            }

            const cleanDigits = sanitizeDigits(zipToAnalyze);
            if (cleanDigits.length !== 7) {
                alert("Por favor, introduza um Código Postal válido com 7 dígitos.");
                return;
            }

            const formattedZip = `${cleanDigits.substring(0, 4)}-${cleanDigits.substring(4, 7)}`;
            const driver = findDriverForZip(formattedZip, window.intervals, window.zones, window.drivers);
            
            const resultadoCodigo = document.getElementById('resultado-codigo');
            const resultadoMotorista = document.getElementById('resultado-motorista');
            const resultadoCorBg = document.getElementById('resultado-cor-bg');
            const chkPrioridade = document.getElementById('chk-prioridade');

            if (resultadoCodigo) resultadoCodigo.textContent = formattedZip;
            
            if (driver) {
                if (resultadoMotorista) resultadoMotorista.textContent = driver.name;
                if (resultadoCorBg) resultadoCorBg.style.backgroundColor = driver.color;
                window.lastAnalysisResult = { zip: formattedZip, driverId: driver.id };
            } else {
                if (resultadoMotorista) resultadoMotorista.textContent = "Sem Motorista";
                if (resultadoCorBg) resultadoCorBg.style.backgroundColor = "#9CA3AF"; 
                window.lastAnalysisResult = { zip: formattedZip, driverId: null };
            }

            if (chkPrioridade) chkPrioridade.checked = false;
            if (modalResultado) modalResultado.classList.remove('hidden');
        });
    }

    if (btnConfirmarAtribuir && modalResultado) {
        btnConfirmarAtribuir.addEventListener('click', () => {
            if (!window.lastAnalysisResult) return;

            const chkPrioridade = document.getElementById('chk-prioridade');
            const isPriority = chkPrioridade ? chkPrioridade.checked : false;

            window.assignments.push({
                id: 'a_' + Date.now(),
                zip: window.lastAnalysisResult.zip,
                driverId: window.lastAnalysisResult.driverId,
                priority: isPriority,
                date: new Date().toISOString().split('T')[0]
            });

            sincronizarPersistencia();
            atualizarSummaryUI();

            modalResultado.classList.add('hidden');
            window.currentInput = "";
            const visorCodigo = document.getElementById('visor-codigo');
            if (visorCodigo) {
                updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
            }
            window.lastAnalysisResult = null;
        });
    }

    if (modalResultado) {
        modalResultado.addEventListener('click', (e) => {
            if (e.target === modalResultado) {
                modalResultado.classList.add('hidden');
            }
        });
    }
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
    const listaRotaFinal = document.getElementById('lista-rota-final');
    if (!listaRotaFinal) return;

    listaRotaFinal.innerHTML = "";
    window.rotaOtimizada.forEach((paragem, index) => {
        const item = document.createElement('div');
        
        let statusColor = "bg-blue-600";
        if (paragem.status === "Entregue") statusColor = "bg-green-500";
        if (paragem.status === "Falhou") statusColor = "bg-red-500";

        item.className = "bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex flex-col space-y-2 animate-fade-in";
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
                    </div>
                    <p class="text-xs font-semibold text-gray-700 mt-1 truncate" title="${paragem.address}">
                        ${paragem.address}
                    </p>
                    ${primeiraLinhaObs ? `<div class="bg-yellow-50 border border-yellow-100 p-2 rounded mt-1 text-[11px] text-gray-600 font-medium italic truncate"><i class="fa-solid fa-comment-dots text-yellow-500 mr-1"></i> ${primeiraLinhaObs}</div>` : ''}
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
    const statFalhas = document.getElementById('stat-falhas'); 
    const statPendentes = document.getElementById('stat-pendentes');

    if (!estatisticasRota) return;

    estatisticasRota.classList.remove('hidden');

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

    setTimeout(() => {
        editMoradaObs.focus();
        editMoradaObs.select();
    }, 150);
}

function sincronizarPersistencia() {
    saveData(
        window.drivers, 
        window.intervals, 
        window.assignments,
        window.partidaLocalizacao,
        window.moradasEntregas,
        window.rotaOtimizada,
        window.dataRotaSelecionada, 
        window.rotaIniciada,
        window.zones // Novo 9.º argumento persistido com sucesso
    );
}

window.ajustarLimitesMapaGoogle = () => {
    if (window.rotaOtimizada && window.rotaOtimizada.length > 0) {
        ajustarLimitesMapaGoogleInterno();
    }
};

function ajustarLimitesMapaGoogleInterno() {
    if (typeof google === 'undefined' || !window.googleMapInstance || !window.partidaLocalizacao) return;
    const limits = new google.maps.LatLngBounds();
    limits.extend(new google.maps.LatLng(window.partidaLocalizacao.lat, window.partidaLocalizacao.lng));
    window.rotaOtimizada.forEach(p => limits.extend(new google.maps.LatLng(p.lat, p.lng)));
    window.googleMapInstance.fitBounds(limits);
}

// ==========================================
// GESTÃO DE FORMULÁRIOS E DADOS
// ==========================================
function setupForms() {
    const formMotorista = document.getElementById('form-motorista');
    const formIntervalo = document.getElementById('form-intervalo');
    const formZona = document.getElementById('form-zona');

    const listaMotoristas = document.getElementById('lista-motoristas');
    const selectZonaMotorista = document.getElementById('select-zona-motorista');

    const intInicioInput = document.getElementById('int-inicio');
    const intFimInput = document.getElementById('int-fim');

    if (formMotorista && listaMotoristas && selectZonaMotorista) {
        formMotorista.addEventListener('submit', (e) => {
            handleDriverSubmit(e, window.drivers, window.selectedColor, () => {
                renderDrivers(window.drivers, window.zones, listaMotoristas, window.deleteDriver);
                atualizarSummaryUI();
                updateZoneSelect(window.zones, selectZonaMotorista);
            });
        });
    }

    if (intInicioInput) setupIntervalInputFormatting(intInicioInput);
    if (intFimInput) setupIntervalInputFormatting(intFimInput);

    if (formIntervalo && intInicioInput && intFimInput) {
        formIntervalo.addEventListener('submit', (e) => {
            e.preventDefault();
            const nomeInput = document.getElementById('int-nome');
            const name = nomeInput ? nomeInput.value.trim() : "";
            const startRaw = intInicioInput.value;
            const endRaw = intFimInput.value;
            const startClean = sanitizeDigits(startRaw);
            const endClean = sanitizeDigits(endRaw);

            if (!name) return alert('Insira um nome descritivo para o intervalo.');
            if (startClean.length !== 7 || endClean.length !== 7) return alert('Insira códigos postais completos (ex: 2700-123).');
            if (parseInt(startClean, 10) > parseInt(endClean, 10)) return alert('Código inicial não pode ser maior.');

            const newInterval = { 
                id: 'i_' + Date.now(), 
                name: name,
                start: `${startClean.substring(0, 4)}-${startClean.substring(4, 7)}`, 
                end: `${endClean.substring(0, 4)}-${endClean.substring(4, 7)}` 
            };
            window.intervals.push(newInterval);
            sincronizarPersistencia();

            if (nomeInput) nomeInput.value = "";
            intInicioInput.value = ""; 
            intFimInput.value = "";
            
            renderizarZonasEIntervalosUI();
            alert('Intervalo de códigos postais criado com sucesso!');
        });
    }

    if (formZona) {
        formZona.addEventListener('submit', (e) => {
            e.preventDefault();
            const nomeInput = document.getElementById('zona-nome');
            const checkboxesContainer = document.getElementById('checkboxes-intervalos');
            
            const name = nomeInput ? nomeInput.value.trim() : "";
            if (!name) return alert('Insira um nome para a Zona.');

            const checkedBoxes = checkboxesContainer.querySelectorAll('input[type="checkbox"]:checked');
            const selectedIntervalIds = Array.from(checkedBoxes).map(cb => cb.value);

            if (selectedIntervalIds.length === 0) {
                return alert('Por favor, selecione pelo menos um intervalo para compor a Zona.');
            }

            const newZone = {
                id: 'z_' + Date.now(),
                name: name,
                intervalIds: selectedIntervalIds
            };
            window.zones.push(newZone);
            sincronizarPersistencia();

            if (nomeInput) nomeInput.value = "";
            
            renderizarZonasEIntervalosUI();
            alert('Zona criada com sucesso!');
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
                atualizarSummaryUI();
            }
        });
    }
}

// Métodos Globais de Exclusão Adaptados
window.deleteDriver = (id) => {
    if (confirm("Ao apagar este motorista, as suas contagens de pacotes também serão removidas. Confirmar?")) {
        window.drivers = window.drivers.filter(d => d.id !== id);
        window.assignments = window.assignments.filter(a => a.driverId !== id); 
        sincronizarPersistencia();
        
        const listaMotoristas = document.getElementById('lista-motoristas');
        if (listaMotoristas) {
            renderDrivers(window.drivers, window.zones, listaMotoristas, window.deleteDriver);
        }
        
        atualizarSummaryUI();
    }
};

window.deleteInterval = (id) => {
    if (confirm("Deseja apagar este intervalo?")) {
        window.intervals = window.intervals.filter(i => i.id !== id);
        
        // Remove o intervalo removido de quaisquer zonas ativas
        window.zones.forEach(zone => {
            if (zone.intervalIds) {
                zone.intervalIds = zone.intervalIds.filter(iid => iid !== id);
            }
        });

        sincronizarPersistencia();
        renderizarZonasEIntervalosUI();
    }
};

window.deleteZone = (id) => {
    if (confirm("Deseja apagar esta Zona? Os motoristas associados a ela ficarão sem atribuição.")) {
        window.zones = window.zones.filter(z => z.id !== id);
        
        // Dissocia os motoristas afetados por esta remoção
        window.drivers.forEach(drv => {
            if (drv.zoneId === id) drv.zoneId = "";
        });

        sincronizarPersistencia();
        renderizarZonasEIntervalosUI();
        
        const listaMotoristas = document.getElementById('lista-motoristas');
        if (listaMotoristas) {
            renderDrivers(window.drivers, window.zones, listaMotoristas, window.deleteDriver);
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