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

// Modais e Resultados
const modalResultado = document.getElementById('modal-resultado');
const resultadoCorBg = document.getElementById('resultado-cor-bg');
const resultadoCodigo = document.getElementById('resultado-codigo');
const resultadoMotorista = document.getElementById('resultado-motorista');
const btnConfirmarAtribuir = document.getElementById('btn-confirmar-atribuir');
const chkPrioridade = document.getElementById('chk-prioridade'); // NOVO: Checkbox de prioridade

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

// ==========================================
// EVENTOS DE INICIALIZAÇÃO
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupKeypad();
    setupPrefixLock();
    setupForms();
    renderColorPicker();
    setupResetLeituras();
    updateVisor();
});

// ==========================================
// LOGICA DE NAVEGAÇÃO ENTRE ABAS
// ==========================================
function setupNavigation() {
    navTriagem.addEventListener('click', () => showTab('triagem'));
    navMotoristas.addEventListener('click', () => showTab('motoristas'));
    navIntervalos.addEventListener('click', () => showTab('intervalos'));
}

function showTab(tabName) {
    document.getElementById('view-triagem').classList.add('hidden');
    document.getElementById('view-motoristas').classList.add('hidden');
    document.getElementById('view-intervalos').classList.add('hidden');

    [navTriagem, navMotoristas, navIntervalos].forEach(btn => {
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
    // NOVO: Conta o total de prioritários de toda a ronda
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
        // NOVO: Conta quantos pacotes deste motorista específico são prioridade
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
                <!-- NOVO: Badge laranja se este motorista tiver pacotes prioritários -->
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

    // NOVO: Reseta a caixa de seleção de prioridade para vazia sempre que analisar um novo pacote
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
            priority: chkPrioridade.checked // NOVO: Salva se o utilizador marcou como prioridade
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
// REGISTO DO SERVICE WORKER (PWA)
// ==========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('PWA carregado com sucesso:', reg.scope))
            .catch(err => console.log('Erro ao registar o PWA:', err));
    });
}