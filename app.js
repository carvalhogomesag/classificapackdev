// ==========================================
// ESTADO GLOBAL DA APLICAÇÃO
// ==========================================
let drivers = JSON.parse(localStorage.getItem('cp_drivers')) || [];
let intervals = JSON.parse(localStorage.getItem('cp_intervals')) || [];
let assignments = JSON.parse(localStorage.getItem('cp_assignments')) || []; 

let currentInput = ""; 
let isPrefixLocked = false;
let lockedPrefixValue = "";
let selectedColor = "#2563EB"; 
let lastAnalysisResult = null;

// Estados das Rotas
let partidaLocalizacao = null; // { lat, lng, address }
let moradasEntregas = []; // Lista de { id, lat, lng, address }
let rotaOtimizada = []; 
let leafletMap = null;
let leafletMarkersGroup = null;
let leafletRouteLine = null;

let temporizadorDigitacao = null; // Controla o autocompletar automático

const colorPalette = [
    "#2563EB", "#DC2626", "#059669", "#EA580C", 
    "#7C3AED", "#DB2777", "#0891B2", "#D97706", 
    "#0D9488", "#4F46E5", "#E11D48", "#4B5563"
];

// ==========================================
// REFERÊNCIAS DO DOM (ELEMENTOS HTML)
// ==========================================
const chkFixarPrefixo = document.getElementById('chk-fixar-prefixo');
const inputPrefixo = document.getElementById('input-prefixo');
const visorCodigo = document.getElementById('visor-codigo');
const btnAnalisar = document.getElementById('btn-analisar');

// Abas de navegação
const navTriagem = document.getElementById('nav-triagem');
const navMotoristas = document.getElementById('nav-motoristas');
const navIntervalos = document.getElementById('nav-intervalos');
const navRotas = document.getElementById('nav-rotas');

// Modais e Resultados
const modalResultado = document.getElementById('modal-resultado');
const resultadoCorBg = document.getElementById('resultado-cor-bg');
const resultadoCodigo = document.getElementById('resultado-codigo');
const resultadoMotorista = document.getElementById('resultado-motorista');
const btnConfirmarAtribuir = document.getElementById('btn-confirmar-atribuir');
const chkPrioridade = document.getElementById('chk-prioridade');

// Formulários, Listas e Painel Estatístico
const formMotorista = document.getElementById('form-motorista');
const nomeMotoristaInput = document.getElementById('nome-motorista');
const colorPickerContainer = document.getElementById('color-picker-container');
const listaMotoristas = document.getElementById('lista-motoristas');
const painelResumo = document.getElementById('painel-resumo');
const btnLimparLeituras = document.getElementById('btn-limpar-leituras');

const formIntervalo = document.getElementById('form-intervalo');
const selectMotorista = document.getElementById('select-motorista');
const intInicioInput = document.getElementById('int-inicio');
const intFimInput = document.getElementById('int-fim');
const listaIntervalos = document.getElementById('lista-intervalos');

// Elementos Ecrã de Rotas (Moradas / Otimização)
const btnGpsPartida = document.getElementById('btn-gps-partida');
const btnBuscarPartida = document.getElementById('btn-buscar-partida');
const statusPartida = document.getElementById('status-partida');
const buscaMoradaInput = document.getElementById('busca-morada');
const btnProcurarMorada = document.getElementById('btn-procurar-morada');
const containerSugestoes = document.getElementById('container-sugestoes');
const listaMoradasAdicionadas = document.getElementById('lista-moradas-adicionadas');
const btnLimparEnderecos = document.getElementById('btn-limpar-enderecos');
const btnOtimizarRota = document.getElementById('btn-otimizar-rota');
const containerMapa = document.getElementById('container-mapa');
const containerRotaOrdenada = document.getElementById('container-rota-ordenada');
const listaRotaFinal = document.getElementById('lista-rota-final');

let definindoPartidaPorMorada = false;

// ==========================================
// EVENTOS DE INICIALIZAÇÃO
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // Alerta de segurança sobre carregar ficheiros locais (file://)
    if (window.location.protocol === 'file:') {
        console.warn("Classifica Pack: Está a testar localmente como ficheiro (file://). Recursos de mapas e GPS podem ser bloqueados pelo navegador. Se a busca falhar, publique no Netlify ou use o Live Server no VS Code.");
    }

    setupNavigation();
    setupKeypad();
    setupPrefixLock();
    setupForms();
    renderColorPicker();
    setupResetLeituras();
    setupRotasLogic();
    updateVisor();
});

// ==========================================
// LOGICA DE NAVEGAÇÃO ENTRE ABAS
// ==========================================
function setupNavigation() {
    navTriagem.addEventListener('click', () => showTab('triagem'));
    navMotoristas.addEventListener('click', () => showTab('motoristas'));
    navIntervalos.addEventListener('click', () => showTab('intervalos'));
    navRotas.addEventListener('click', () => showTab('rotas'));
}

function showTab(tabName) {
    document.getElementById('view-triagem').classList.add('hidden');
    document.getElementById('view-motoristas').classList.add('hidden');
    document.getElementById('view-intervalos').classList.add('hidden');
    document.getElementById('view-rotas').classList.add('hidden');

    [navTriagem, navMotoristas, navIntervalos, navRotas].forEach(btn => {
        btn.classList.remove('text-blue-600', 'font-bold');
        btn.classList.add('text-gray-400', 'font-semibold');
    });

    if (tabName === 'triagem') {
        document.getElementById('view-triagem').classList.remove('hidden');
        navTriagem.classList.add('text-blue-600', 'font-bold');
        navTriagem.classList.remove('text-gray-400', 'font-semibold');
    } else if (tabName === 'motoristas') {
        document.getElementById('view-motoristas').classList.remove('hidden');
        navMotoristas.classList.add('text-blue-600', 'font-bold');
        navMotoristas.classList.remove('text-gray-400', 'font-semibold');
        renderDrivers();
        renderSummary(); 
    } else if (tabName === 'intervalos') {
        document.getElementById('view-intervalos').classList.remove('hidden');
        navIntervalos.classList.add('text-blue-600', 'font-bold');
        navIntervalos.classList.remove('text-gray-400', 'font-semibold');
        renderIntervals();
        updateMotoristaSelect();
    } else if (tabName === 'rotas') {
        document.getElementById('view-rotas').classList.remove('hidden');
        navRotas.classList.add('text-blue-600', 'font-bold');
        navRotas.classList.remove('text-gray-400', 'font-semibold');
        
        setTimeout(() => {
            if (leafletMap) {
                leafletMap.invalidateSize();
            }
        }, 200);
    }
}

// ==========================================
// TECLADO VIRTUAL GIGANTE E VISOR
// ==========================================
function setupKeypad() {
    document.querySelectorAll('.btn-key').forEach(button => {
        button.addEventListener('click', () => {
            const val = button.getAttribute('data-val');
            const maxDigits = isPrefixLocked ? 3 : 7;
            
            if (currentInput.length < maxDigits) {
                currentInput += val;
                updateVisor();
            }
        });
    });

    document.getElementById('btn-key-clear').addEventListener('click', () => {
        currentInput = "";
        updateVisor();
    });

    document.getElementById('btn-key-backspace').addEventListener('click', () => {
        currentInput = currentInput.slice(0, -1);
        updateVisor();
    });
}

function updateVisor() {
    let output = "";
    if (isPrefixLocked) {
        const prefix = lockedPrefixValue.padEnd(4, '_');
        const suffix = currentInput.padEnd(3, '_');
        output = `${prefix}-${suffix}`;
    } else {
        const full = currentInput.padEnd(7, '_');
        output = `${full.slice(0, 4)}-${full.slice(4, 7)}`;
    }
    visorCodigo.textContent = output;
}

// ==========================================
// OPÇÃO DE TRAVAR PREFIXO
// ==========================================
function setupPrefixLock() {
    chkFixarPrefixo.addEventListener('change', (e) => {
        isPrefixLocked = e.target.checked;
        if (isPrefixLocked) {
            inputPrefixo.disabled = false;
            inputPrefixo.classList.remove('bg-gray-200', 'text-gray-500');
            inputPrefixo.classList.add('bg-white', 'text-gray-900');
            inputPrefixo.focus();
            
            lockedPrefixValue = sanitizeDigits(inputPrefixo.value).substring(0, 4);
            if (!lockedPrefixValue) {
                lockedPrefixValue = "2700";
                inputPrefixo.value = "2700";
            }
        } else {
            inputPrefixo.disabled = true;
            inputPrefixo.classList.add('bg-gray-200', 'text-gray-500');
            inputPrefixo.classList.remove('bg-white', 'text-gray-900');
        }
        currentInput = ""; 
        updateVisor();
    });

    inputPrefixo.addEventListener('input', (e) => {
        let val = sanitizeDigits(e.target.value).substring(0, 4);
        e.target.value = val;
        lockedPrefixValue = val;
        updateVisor();
    });
}

function sanitizeDigits(str) {
    return str.replace(/\D/g, '');
}

// ==========================================
// HISTÓRICO DE LEITURAS / RESUMO DE PRODUÇÃO
// ==========================================
function renderSummary() {
    painelResumo.innerHTML = "";

    const totalLeituras = assignments.length;
    const totalPrioritarios = assignments.filter(a => a.priority === true).length; 

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

    if (drivers.length === 0) {
        painelResumo.innerHTML += `<p class="text-xs text-gray-400 italic text-center py-2">Registe motoristas para ver o resumo.</p>`;
        return;
    }

    drivers.forEach(driver => {
        const totalDriver = assignments.filter(a => a.driverId === driver.id).length;
        const totalPrioritariosDriver = assignments.filter(a => a.driverId === driver.id && a.priority === true).length;
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

    const totalSemMotorista = assignments.filter(a => a.driverId === null).length;
    const totalSemMotoristaPrioridade = assignments.filter(a => a.driverId === null && a.priority === true).length;
    
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

function setupResetLeituras() {
    btnLimparLeituras.addEventListener('click', () => {
        if (confirm("Deseja realmente limpar todas as leituras acumuladas? Isto reiniciará os contadores para zero.")) {
            assignments = [];
            saveData();
            renderSummary();
        }
    });
}

// ==========================================
// GERENCIAMENTO DE MOTORISTAS
// ==========================================
function renderColorPicker() {
    colorPickerContainer.innerHTML = "";
    colorPalette.forEach((color, idx) => {
        const btn = document.createElement('button');
        btn.type = "button";
        btn.style.backgroundColor = color;
        btn.className = `h-10 w-full rounded-lg border-2 transition-all duration-150 ${idx === 0 ? 'border-black scale-110' : 'border-transparent'}`;
        
        btn.addEventListener('click', () => {
            selectedColor = color;
            Array.from(colorPickerContainer.children).forEach(child => {
                child.classList.remove('border-black', 'scale-110');
                child.classList.add('border-transparent');
            });
            btn.classList.add('border-black', 'scale-110');
            btn.classList.remove('border-transparent');
        });
        colorPickerContainer.appendChild(btn);
    });
}

function renderDrivers() {
    listaMotoristas.innerHTML = "";
    if (drivers.length === 0) {
        listaMotoristas.innerHTML = `<p class="text-sm text-gray-400 italic text-center py-4">Nenhum motorista registado.</p>`;
        return;
    }

    drivers.forEach(driver => {
        const item = document.createElement('div');
        item.className = "flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200";
        item.innerHTML = `
            <div class="flex items-center space-x-3">
                <span class="w-5 h-5 rounded-full block border" style="background-color: ${driver.color}"></span>
                <span class="font-semibold text-gray-800">${driver.name}</span>
            </div>
            <button onclick="deleteDriver('${driver.id}')" class="text-red-500 active:text-red-700 p-1">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        `;
        listaMotoristas.appendChild(item);
    });
}

window.deleteDriver = function(id) {
    if (confirm("Ao apagar este motorista, os seus intervalos e contagens de pacotes também serão removidos. Confirmar?")) {
        drivers = drivers.filter(d => d.id !== id);
        intervals = intervals.filter(i => i.driverId !== id);
        assignments = assignments.filter(a => a.driverId !== id); 
        saveData();
        renderDrivers();
        renderSummary();
    }
};

// ==========================================
// GERENCIAMENTO DE INTERVALOS
// ==========================================
function updateMotoristaSelect() {
    selectMotorista.innerHTML = `<option value="">Selecione um motorista...</option>`;
    drivers.forEach(driver => {
        const opt = document.createElement('option');
        opt.value = driver.id;
        opt.textContent = driver.name;
        selectMotorista.appendChild(opt);
    });
}

function renderIntervals() {
    listaIntervalos.innerHTML = "";
    if (intervals.length === 0) {
        listaIntervalos.innerHTML = `<p class="text-sm text-gray-400 italic text-center py-4">Nenhum intervalo registado.</p>`;
        return;
    }

    intervals.forEach(interval => {
        const driver = drivers.find(d => d.id === interval.driverId);
        const driverName = driver ? driver.name : "Removido";
        const driverColor = driver ? driver.color : "#9CA3AF";

        const item = document.createElement('div');
        item.className = "flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200";
        item.innerHTML = `
            <div class="flex-1">
                <div class="text-sm font-bold text-gray-800">${interval.start} <i class="fa-solid fa-arrow-right text-xs text-gray-400 px-1"></i> ${interval.end}</div>
                <div class="flex items-center space-x-2 mt-1">
                    <span class="w-3 h-3 rounded-full block" style="background-color: ${driverColor}"></span>
                    <span class="text-xs text-gray-500 font-medium">${driverName}</span>
                </div>
            </div>
            <button onclick="deleteInterval('${interval.id}')" class="text-red-500 active:text-red-700 p-1">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        `;
        listaIntervalos.appendChild(item);
    });
}

window.deleteInterval = function(id) {
    intervals = intervals.filter(i => i.id !== id);
    saveData();
    renderIntervals();
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

// ==========================================
// FORMULÁRIOS DE REGISTO E REGRAS DE SUBMIT
// ==========================================
function setupForms() {
    formMotorista.addEventListener('submit', (e) => {
        e.preventDefault();
        const nome = nomeMotoristaInput.value.trim();
        if (!nome) return;

        const newDriver = {
            id: 'd_' + Date.now(),
            name: nome,
            color: selectedColor
        };

        drivers.push(newDriver);
        saveData();
        
        nomeMotoristaInput.value = "";
        renderDrivers();
        renderSummary(); 
        alert('Motorista registado!');
    });

    setupIntervalInputFormatting(intInicioInput);
    setupIntervalInputFormatting(intFimInput);

    formIntervalo.addEventListener('submit', (e) => {
        e.preventDefault();
        const driverId = selectMotorista.value;
        const startRaw = intInicioInput.value;
        const endRaw = intFimInput.value;

        const startClean = sanitizeDigits(startRaw);
        const endClean = sanitizeDigits(endRaw);

        if (startClean.length !== 7 || endClean.length !== 7) {
            alert('Por favor, digite códigos postais completos com 7 dígitos (ex: 2700-123).');
            return;
        }

        if (parseInt(startClean, 10) > parseInt(endClean, 10)) {
            alert('O código inicial não pode ser maior que o código final.');
            return;
        }

        const newInterval = {
            id: 'i_' + Date.now(),
            driverId: driverId,
            start: `${startClean.substring(0, 4)}-${startClean.substring(4, 7)}`,
            end: `${endClean.substring(0, 4)}-${endClean.substring(4, 7)}`
        };

        intervals.push(newInterval);
        saveData();

        intInicioInput.value = "";
        intFimInput.value = "";
        renderIntervals();
        alert('Intervalo criado!');
    });
}

function saveData() {
    localStorage.setItem('cp_drivers', JSON.stringify(drivers));
    localStorage.setItem('cp_intervals', JSON.stringify(intervals));
    localStorage.setItem('cp_assignments', JSON.stringify(assignments)); 
}

// ==========================================
// PROCESSO DE ANÁLISE / TRIAGEM
// ==========================================
btnAnalisar.addEventListener('click', () => {
    let fullZip = "";
    
    if (isPrefixLocked) {
        if (lockedPrefixValue.length !== 4 || currentInput.length !== 3) {
            alert("Insira os 3 dígitos que faltam para concluir o código.");
            return;
        }
        fullZip = lockedPrefixValue + currentInput;
    } else {
        if (currentInput.length !== 7) {
            alert("O código postal deve ter exatamente 7 dígitos.");
            return;
        }
        fullZip = currentInput;
    }

    const zipNum = parseInt(fullZip, 10);
    let matchedDriver = null;

    for (const interval of intervals) {
        const startNum = parseInt(sanitizeDigits(interval.start), 10);
        const endNum = parseInt(sanitizeDigits(interval.end), 10);

        if (zipNum >= startNum && zipNum <= endNum) {
            matchedDriver = drivers.find(d => d.id === interval.driverId);
            break;
        }
    }

    const formattedZip = `${fullZip.substring(0, 4)}-${fullZip.substring(4, 7)}`;
    resultadoCodigo.textContent = formattedZip;

    if (matchedDriver) {
        resultadoMotorista.textContent = matchedDriver.name;
        resultadoCorBg.style.backgroundColor = matchedDriver.color;
        lastAnalysisResult = {
            zip: formattedZip,
            driverId: matchedDriver.id,
            driverName: matchedDriver.name
        };
    } else {
        resultadoMotorista.textContent = "Sem Motorista Atribuído";
        resultadoCorBg.style.backgroundColor = "#4B5563";
        lastAnalysisResult = {
            zip: formattedZip,
            driverId: null,
            driverName: "Sem Motorista Atribuído"
        };
    }

    chkPrioridade.checked = false; 
    modalResultado.classList.remove('hidden');
});

btnConfirmarAtribuir.addEventListener('click', () => {
    if (lastAnalysisResult) {
        const record = {
            id: 'a_' + Date.now(),
            zip: lastAnalysisResult.zip,
            driverId: lastAnalysisResult.driverId,
            driverName: lastAnalysisResult.driverName,
            timestamp: new Date().toISOString(),
            priority: chkPrioridade.checked 
        };
        
        assignments.push(record);
        saveData();
    }

    modalResultado.classList.add('hidden');
    currentInput = ""; 
    lastAnalysisResult = null;
    updateVisor();     
});

// ==========================================
// LOGICA DE ROTAS, MAPAS E OTIMIZAÇÃO
// ==========================================
function setupRotasLogic() {
    // Obter GPS do Telemóvel como Partida
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
                // NOVO: Faz o reverse geocoding para achar o nome da rua baseado no GPS
                obterEnderecoPorGPS(lat, lng);
            },
            (error) => {
                console.error("Erro no GPS:", error);
                alert("Não foi possível aceder ao GPS. Verifique as permissões de localização do seu telemóvel.");
                statusPartida.textContent = "Partida: Permissão de GPS negada";
            },
            { enableHighAccuracy: true }
        );
    });

    // Abrir procura de Morada para definir ponto de Partida
    btnBuscarPartida.addEventListener('click', () => {
        definindoPartidaPorMorada = true;
        buscaMoradaInput.placeholder = "Procure a morada de PARTIDA...";
        buscaMoradaInput.focus();
    });

    // NOVO: Autocompletar inteligente (pesquisa automaticamente após 500ms de paragem na digitação)
    buscaMoradaInput.addEventListener('input', () => {
        clearTimeout(temporizadorDigitacao);
        const query = buscaMoradaInput.value.trim();

        if (query.length < 3) {
            containerSugestoes.classList.add('hidden');
            return;
        }

        temporizadorDigitacao = setTimeout(() => {
            procurarMoradaNoOSM(query);
        }, 500); // 500ms de atraso (debounce)
    });

    // Botão de Procurar Morada (Manual)
    btnProcurarMorada.addEventListener('click', () => {
        clearTimeout(temporizadorDigitacao);
        const query = buscaMoradaInput.value.trim();
        if (query.length < 3) {
            alert("Digite pelo menos 3 caracteres para procurar.");
            return;
        }
        procurarMoradaNoOSM(query);
    });

    // Tecla Enter no campo de busca de morada
    buscaMoradaInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            btnProcurarMorada.click();
        }
    });

    // Limpar lista de moradas de entrega
    btnLimparEnderecos.addEventListener('click', () => {
        moradasEntregas = [];
        rotaOtimizada = [];
        containerMapa.classList.add('hidden');
        containerRotaOrdenada.classList.add('hidden');
        renderMoradasAdicionadas();
    });

    // Processar a Otimização da Rota (Vizinho Mais Próximo)
    btnOtimizarRota.addEventListener('click', () => {
        if (!partidaLocalizacao) {
            alert("Por favor, defina um ponto de Partida (GPS ou Morada) primeiro.");
            return;
        }
        if (moradasEntregas.length === 0) {
            alert("Adicione pelo menos uma morada de entrega para otimizar.");
            return;
        }

        otimizarItinerarioComVizinhoMaisProximo();
    });
}

// NOVO: Traduz coordenadas de latitude/longitude obtidas do GPS num endereço de rua real (Reverse Geocoding)
async function obterEnderecoPorGPS(lat, lng) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
        const response = await fetch(url);
        
        if (!response.ok) throw new Error("Erro na rede ao tentar traduzir o GPS.");
        
        const data = await response.json();
        
        if (data && data.display_name) {
            partidaLocalizacao = {
                lat: lat,
                lng: lng,
                address: data.display_name
            };
            statusPartida.innerHTML = `<strong>Partida:</strong> ${data.display_name}`;
        } else {
            usarFallbackGPS(lat, lng);
        }
    } catch (error) {
        console.error("Erro no Reverse Geocoding do GPS:", error);
        usarFallbackGPS(lat, lng);
    }
}

// Fallback caso o servidor não consiga traduzir as coordenadas em morada
function usarFallbackGPS(lat, lng) {
    partidaLocalizacao = {
        lat: lat,
        lng: lng,
        address: `Localização GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`
    };
    statusPartida.innerHTML = `<strong>Partida:</strong> Localização GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
}

// Conexão gratuita com o OpenStreetMap (Nominatim)
async function procurarMoradaNoOSM(query) {
    containerSugestoes.innerHTML = `<div class="p-3 text-xs text-gray-500 italic flex items-center"><i class="fa-solid fa-spinner animate-spin mr-2"></i>A pesquisar morada no mapa...</div>`;
    containerSugestoes.classList.remove('hidden');

    try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&countrycodes=pt,es&limit=5`;
        const response = await fetch(url);
        
        if (!response.ok) throw new Error(`HTTP erro! Status: ${response.status}`);
        
        const data = await response.json();
        renderizarSugestoesProcura(data);
    } catch (error) {
        // Agora o erro é impresso detalhadamente no console F12 para ajudar no diagnóstico
        console.error("Erro detalhado na consulta OSM Nominatim:", error);
        containerSugestoes.innerHTML = `
            <div class="p-3 text-xs text-red-500 font-semibold">
                Erro ao procurar. Se estiver a testar localmente, publique no Netlify ou use o Live Server do VS Code para evitar bloqueios de CORS.
            </div>`;
    }
}

// Renderiza as sugestões encontradas pelo OpenStreetMap
function renderizarSugestoesProcura(resultados) {
    containerSugestoes.innerHTML = "";
    
    if (!resultados || resultados.length === 0) {
        containerSugestoes.innerHTML = `<div class="p-3 text-xs text-gray-500 italic">Nenhum endereço encontrado. Tente escrever de forma diferente.</div>`;
        return;
    }

    resultados.forEach(item => {
        const option = document.createElement('div');
        option.className = "p-3 hover:bg-blue-50 cursor-pointer transition-colors border-b last:border-0";
        option.textContent = item.display_name;
        
        option.addEventListener('click', () => {
            const latitude = parseFloat(item.lat);
            const longitude = parseFloat(item.lon);

            if (definindoPartidaPorMorada) {
                partidaLocalizacao = {
                    lat: latitude,
                    lng: longitude,
                    address: item.display_name
                };
                statusPartida.innerHTML = `<strong>Partida:</strong> ${item.display_name}`;
                definindoPartidaPorMorada = false;
                buscaMoradaInput.placeholder = "Rua, número, cidade...";
            } else {
                moradasEntregas.push({
                    id: 'm_' + Date.now() + Math.random().toString(36).substr(2, 5),
                    lat: latitude,
                    lng: longitude,
                    address: item.display_name
                });
                renderMoradasAdicionadas();
            }

            buscaMoradaInput.value = "";
            containerSugestoes.classList.add('hidden');
        });

        containerSugestoes.appendChild(option);
    });
}

// Renderiza a lista de moradas que o motorista adicionou antes de otimizar
function renderMoradasAdicionadas() {
    listaMoradasAdicionadas.innerHTML = "";
    
    if (moradasEntregas.length === 0) {
        listaMoradasAdicionadas.innerHTML = `<p class="text-xs text-gray-400 italic text-center py-2">Nenhuma morada adicionada.</p>`;
        return;
    }

    moradasEntregas.forEach((morada, index) => {
        const item = document.createElement('div');
        item.className = "flex items-center justify-between p-2 bg-gray-50 rounded border text-xs";
        item.innerHTML = `
            <div class="flex-1 truncate pr-2">
                <strong class="text-gray-500 flex-shrink-0">#${index + 1}</strong> <span class="text-gray-700">${morada.address}</span>
            </div>
            <button onclick="removerMoradaEntrega('${morada.id}')" class="text-red-500 font-bold px-1.5 py-0.5 hover:bg-red-50 rounded">
                <i class="fa-solid fa-times"></i>
            </button>
        `;
        listaMoradasAdicionadas.appendChild(item);
    });
}

window.removerMoradaEntrega = function(id) {
    moradasEntregas = moradasEntregas.filter(m => m.id !== id);
    rotaOtimizada = [];
    containerMapa.classList.add('hidden');
    containerRotaOrdenada.classList.add('hidden');
    renderMoradasAdicionadas();
};

// ==========================================
// CÁLCULO ALGORÍTMICO TSP HAVERSINE (OTIMIZADOR)
// ==========================================
function calcularDistanciaHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
}

function otimizarItinerarioComVizinhoMaisProximo() {
    let atual = { lat: partidaLocalizacao.lat, lng: partidaLocalizacao.lng };
    let restantes = [...moradasEntregas];
    rotaOtimizada = [];

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
            rotaOtimizada.push(paragem);
            
            atual = { lat: paragem.lat, lng: paragem.lng };
            restantes.splice(indiceMaisProximo, 1);
        }
    }

    containerMapa.classList.remove('hidden');
    containerRotaOrdenada.classList.remove('hidden');

    renderizarItinerarioOtimizado();
    desenharMapaComLeaflet();
}

function renderizarItinerarioOtimizado() {
    listaRotaFinal.innerHTML = "";

    rotaOtimizada.forEach((paragem, index) => {
        const item = document.createElement('div');
        item.className = "bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between space-x-3 animate-fade-in";
        const linkGoogleMaps = `https://www.google.com/maps/dir/?api=1&destination=${paragem.lat},${paragem.lng}&travelmode=driving`;

        item.innerHTML = `
            <div class="flex-1 truncate">
                <div class="flex items-center space-x-2">
                    <span class="w-5 h-5 rounded-full bg-blue-600 text-white font-bold text-[10px] flex items-center justify-center flex-shrink-0">
                        ${index + 1}
                    </span>
                    <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        A cerca de ${paragem.distanciaDoAnterior.toFixed(2)} km
                    </span>
                </div>
                <p class="text-xs font-semibold text-gray-700 mt-1 truncate" title="${paragem.address}">
                    ${paragem.address}
                </p>
            </div>
            <a href="${linkGoogleMaps}" target="_blank" class="bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-bold px-3 py-2 rounded-lg text-xs flex items-center space-x-1 whitespace-nowrap shadow-sm">
                <i class="fa-solid fa-location-arrow"></i> <span>Navegar</span>
            </a>
        `;
        listaRotaFinal.appendChild(item);
    });
}

function desenharMapaComLeaflet() {
    if (!leafletMap) {
        leafletMap = L.map('map', { zoomControl: false }).setView([partidaLocalizacao.lat, partidaLocalizacao.lng], 13);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(leafletMap);

        leafletMarkersGroup = L.layerGroup().addTo(leafletMap);
    } else {
        leafletMarkersGroup.clearLayers();
        if (leafletRouteLine) {
            leafletMap.removeLayer(leafletRouteLine);
        }
    }

    const coordenadasPolilinha = [];

    const marcadorPartidaIcon = L.divIcon({
        className: 'bg-red-600 text-white font-bold rounded-full w-6 h-6 flex items-center justify-center border-2 border-white shadow-lg',
        html: 'P'
    });
    L.marker([partidaLocalizacao.lat, partidaLocalizacao.lng], { icon: marcadorPartidaIcon })
        .addTo(leafletMarkersGroup)
        .bindPopup(`<strong>Partida:</strong> ${partidaLocalizacao.address}`);
    
    coordenadasPolilinha.push([partidaLocalizacao.lat, partidaLocalizacao.lng]);

    rotaOtimizada.forEach((paragem, index) => {
        const marcadorIcon = L.divIcon({
            className: 'bg-blue-600 text-white font-bold rounded-full w-6 h-6 flex items-center justify-center border-2 border-white shadow-lg',
            html: (index + 1).toString()
        });
        
        L.marker([paragem.lat, paragem.lng], { icon: marcadorIcon })
            .addTo(leafletMarkersGroup)
            .bindPopup(`<strong>Paragem ${index + 1}:</strong> ${paragem.address}`);
        
        coordenadasPolilinha.push([paragem.lat, paragem.lng]);
    });

    leafletRouteLine = L.polyline(coordenadasPolilinha, {
        color: '#2563EB', 
        weight: 4,
        opacity: 0.85
    }).addTo(leafletMap);

    leafletMap.fitBounds(leafletRouteLine.getBounds(), { padding: [30, 30] });
    
    setTimeout(() => {
        leafletMap.invalidateSize();
    }, 150);
}

// Fechar sugestões ao clicar fora do ecrã de busca
document.addEventListener('click', (e) => {
    if (e.target !== buscaMoradaInput && e.target !== containerSugestoes) {
        containerSugestoes.classList.add('hidden');
    }
});

// ==========================================
// REGISTO DO SERVICE WORKER (PWA)
// ==========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('PWA carregado com sucesso:', reg.scope))
            .catch(err => console.log('Erro ao registar o PWA:', err));
    });
}