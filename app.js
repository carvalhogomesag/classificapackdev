// app.js
import { setupNavigation, showTab, updateVisor } from './ui.js';
import { saveData } from './storage.js';
import { renderDrivers, handleDriverSubmit, updateMotoristaSelect, renderIntervals } from './gestao.js';
import { inicializarGoogleAutocomplete, obterEnderecoPorGPSGoogle, calcularDistanciaHaversine, desenharMapaGoogle, limparMapaVisual } from './rotas.js';

// Variáveis Globais de Estado
window.drivers = JSON.parse(localStorage.getItem('cp_drivers')) || [];
window.intervals = JSON.parse(localStorage.getItem('cp_intervals')) || [];
window.assignments = JSON.parse(localStorage.getItem('cp_assignments')) || [];

window.currentInput = "";
window.isPrefixLocked = false;
window.lockedPrefixValue = "";
window.selectedColor = "#2563EB";
window.lastAnalysisResult = null;

// Estados das Rotas
window.partidaLocalizacao = null; 
window.moradasEntregas = []; 
window.rotaOtimizada = []; 
window.definindoPartidaPorMorada = false;

// Referências do DOM
const chkFixarPrefixo = document.getElementById('chk-fixar-prefixo');
const inputPrefixo = document.getElementById('input-prefixo');
const visorCodigo = document.getElementById('visor-codigo');
const btnAnalisar = document.getElementById('btn-analisar');
const modalResultado = document.getElementById('modal-resultado');
const resultadoCorBg = document.getElementById('resultado-cor-bg');
const resultadoCodigo = document.getElementById('resultado-codigo');
const resultadoMotorista = document.getElementById('resultado-motorista');
const btnConfirmarAtribuir = document.getElementById('btn-confirmar-atribuir');
const chkPrioridade = document.getElementById('chk-prioridade');

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

const btnGpsPartida = document.getElementById('btn-gps-partida');
const btnBuscarPartida = document.getElementById('btn-buscar-partida');
const statusPartida = document.getElementById('status-partida');
const buscaMoradaInput = document.getElementById('busca-morada');
const listaMoradasAdicionadas = document.getElementById('lista-moradas-adicionadas');
const btnLimparEnderecos = document.getElementById('btn-limpar-enderecos');
const btnOtimizarRota = document.getElementById('btn-otimizar-rota');
const listaRotaFinal = document.getElementById('lista-rota-final');

document.addEventListener('DOMContentLoaded', () => {
    carregarGoogleMapsScript();
    setupNavigation(showTab);
    setupKeypad();
    setupPrefixLock();
    setupForms();
    renderColorPicker();
    setupResetLeituras();
    setupRotasLogic();
    updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
    
    // Renderização inicial das abas secundárias
    renderDrivers(window.drivers, listaMotoristas, window.deleteDriver);
    renderIntervals(window.intervals, window.drivers, listaIntervalos, window.deleteInterval);
    updateMotoristaSelect(window.drivers, selectMotorista);
    renderSummary();
});

function carregarGoogleMapsScript() {
    if (typeof google !== 'undefined') return;
    if (typeof GOOGLE_MAPS_API_KEY === 'undefined' || !GOOGLE_MAPS_API_KEY) {
        console.error("Chave de API do Google Maps não definida no config.js.");
        return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
        console.log("Google Maps SDK carregado.");
        inicializarGoogleAutocomplete(buscaMoradaInput, adicionarMorada);
    };
    script.onerror = () => console.error("Falha ao carregar o SDK do Google Maps.");
    document.head.appendChild(script);
}

// Configuração de eventos do ecrã de rotas
function setupRotasLogic() {
    btnGpsPartida.addEventListener('click', () => {
        statusPartida.textContent = "A obter localização do GPS...";
        if (!navigator.geolocation) {
            alert("O seu telemóvel não suporta Geolocalização.");
            statusPartida.textContent = "Partida: Erro de GPS";
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                obterEnderecoPorGPSGoogle(lat, lng, (morada) => {
                    if (morada) {
                        window.partidaLocalizacao = morada;
                        statusPartida.innerHTML = `<strong>Partida:</strong> ${morada.address}`;
                    } else {
                        usarFallbackGPS(lat, lng);
                    }
                });
            },
            () => {
                alert("Verifique as permissões de localização do seu telemóvel.");
                statusPartida.textContent = "Partida: Permissão negada";
            },
            { enableHighAccuracy: true }
        );
    });

    btnBuscarPartida.addEventListener('click', () => {
        window.definindoPartidaPorMorada = true;
        buscaMoradaInput.placeholder = "Procure no Google a morada de PARTIDA...";
        buscaMoradaInput.focus();
    });

    btnLimparEnderecos.addEventListener('click', () => {
        window.moradasEntregas = [];
        window.rotaOtimizada = [];
        document.getElementById('container-mapa').classList.add('hidden');
        document.getElementById('container-rota-ordenada').classList.add('hidden');
        limparMapaVisual();
        renderMoradasAdicionadas();
    });

    btnOtimizarRota.addEventListener('click', () => {
        if (!window.partidaLocalizacao) return alert("Por favor, defina um ponto de Partida primeiro.");
        if (window.moradasEntregas.length === 0) return alert("Adicione pelo menos uma morada de entrega.");
        otimizarItinerarioComVizinhoMaisProximo();
    });
}

function adicionarMorada(morada) {
    if (window.definindoPartidaPorMorada) {
        window.partidaLocalizacao = morada;
        statusPartida.innerHTML = `<strong>Partida:</strong> ${morada.address}`;
        window.definindoPartidaPorMorada = false;
        buscaMoradaInput.placeholder = "Comece a digitar a morada aqui...";
    } else {
        window.moradasEntregas.push(morada);
        renderMoradasAdicionadas();
    }
    buscaMoradaInput.value = "";
}

function renderMoradasAdicionadas() {
    listaMoradasAdicionadas.innerHTML = "";
    if (window.moradasEntregas.length === 0) {
        listaMoradasAdicionadas.innerHTML = `<p class="text-xs text-gray-400 italic text-center py-2">Nenhuma morada adicionada.</p>`;
        return;
    }
    window.moradasEntregas.forEach((morada, index) => {
        const item = document.createElement('div');
        item.className = "flex items-center justify-between p-2 bg-gray-50 rounded border text-xs animate-fade-in";
        item.innerHTML = `
            <div class="flex-1 truncate pr-2">
                <strong class="text-gray-500 flex-shrink-0">#${index + 1}</strong> <span class="text-gray-700">${morada.address}</span>
            </div>
            <button class="text-red-500 font-bold px-1.5 py-0.5 hover:bg-red-50 rounded">X</button>
        `;
        item.querySelector('button').onclick = () => {
            window.moradasEntregas = window.moradasEntregas.filter(m => m.id !== morada.id);
            renderMoradasAdicionadas();
        };
        listaMoradasAdicionadas.appendChild(item);
    });
}

function otimizarItinerarioComVizinhoMaisProximo() {
    let atual = { lat: window.partidaLocalizacao.lat, lng: window.partidaLocalizacao.lng };
    let restantes = [...window.moradasEntregas];
    window.rotaOtimizada = [];

    while (restantes.length > 0) {
        let indiceMaisProximo = -1, menorDistancia = Infinity;
        for (let i = 0; i < restantes.length; i++) {
            const dist = calcularDistanciaHaversine(atual.lat, atual.lng, restantes[i].lat, restantes[i].lng);
            if (dist < menorDistancia) { menorDistancia = dist; indiceMaisProximo = i; }
        }

        if (indiceMaisProximo !== -1) {
            const paragem = restantes[indiceMaisProximo];
            paragem.distanciaDoAnterior = menorDistancia;
            window.rotaOtimizada.push(paragem);
            atual = { lat: paragem.lat, lng: paragem.lng };
            restantes.splice(indiceMaisProximo, 1);
        }
    }

    document.getElementById('container-mapa').classList.remove('hidden');
    document.getElementById('container-rota-ordenada').classList.remove('hidden');
    renderizarItinerarioOtimizado();
    desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
}

function renderizarItinerarioOtimizado() {
    listaRotaFinal.innerHTML = "";
    window.rotaOtimizada.forEach((paragem, index) => {
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
            <a href="${linkGoogleMaps}" target="_blank" class="bg-green-600 hover:bg-green-700 text-white font-bold px-3 py-2 rounded-lg text-xs flex items-center space-x-1 whitespace-nowrap shadow-sm">
                <i class="fa-solid fa-location-arrow"></i> <span>Navegar</span>
            </a>
        `;
        listaRotaFinal.appendChild(item);
    });
}

function usarFallbackGPS(lat, lng) {
    window.partidaLocalizacao = { lat, lng, address: `Localização GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})` };
    statusPartida.innerHTML = `<strong>Partida:</strong> Localização GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
}

// Teclado Numérico
function setupKeypad() {
    document.querySelectorAll('.btn-key').forEach(button => {
        button.addEventListener('click', () => {
            const val = button.getAttribute('data-val');
            const maxDigits = window.isPrefixLocked ? 3 : 7;
            if (window.currentInput.length < maxDigits) {
                window.currentInput += val;
                updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
            }
        });
    });

    document.getElementById('btn-key-clear').addEventListener('click', () => {
        window.currentInput = "";
        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
    });

    document.getElementById('btn-key-backspace').addEventListener('click', () => {
        window.currentInput = window.currentInput.slice(0, -1);
        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
    });
}

function setupPrefixLock() {
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

function setupForms() {
    formMotorista.addEventListener('submit', (e) => {
        handleDriverSubmit(e, window.drivers, window.selectedColor, () => {
            renderDrivers(window.drivers, listaMotoristas, window.deleteDriver);
            renderSummary();
            updateMotoristaSelect(window.drivers, selectMotorista);
        });
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

        if (startClean.length !== 7 || endClean.length !== 7) return alert('Insira códigos postais completos (ex: 2700-123).');
        if (parseInt(startClean, 10) > parseInt(endClean, 10)) return alert('Código inicial não pode ser maior.');

        const newInterval = { id: 'i_' + Date.now(), driverId, start: `${startClean.substring(0, 4)}-${startClean.substring(4, 7)}`, end: `${endClean.substring(0, 4)}-${endClean.substring(4, 7)}` };
        window.intervals.push(newInterval);
        saveData(window.drivers, window.intervals, window.assignments);

        intInicioInput.value = ""; intFimInput.value = "";
        renderIntervals(window.intervals, window.drivers, listaIntervalos, window.deleteInterval);
        alert('Intervalo criado!');
    });
}

function renderColorPicker() {
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
    btnLimparLeituras.addEventListener('click', () => {
        if (confirm("Deseja realmente limpar todas as leituras?")) {
            window.assignments = [];
            saveData(window.drivers, window.intervals, window.assignments);
            renderSummary();
        }
    });
}

// Métodos globais de exclusão (chamados por botões dinâmicos)
window.deleteDriver = (id) => {
    if (confirm("Apagar este motorista removerá os seus intervalos e leituras. Confirmar?")) {
        window.drivers = window.drivers.filter(d => d.id !== id);
        window.intervals = window.intervals.filter(i => i.driverId !== id);
        window.assignments = window.assignments.filter(a => a.driverId !== id);
        saveData(window.drivers, window.intervals, window.assignments);
        renderDrivers(window.drivers, listaMotoristas, window.deleteDriver);
        renderSummary();
        updateMotoristaSelect(window.drivers, selectMotorista);
    }
};

window.deleteInterval = (id) => {
    if (confirm("Deseja apagar este intervalo?")) {
        window.intervals = window.intervals.filter(i => i.id !== id);
        saveData(window.drivers, window.intervals, window.assignments);
        renderIntervals(window.intervals, window.drivers, listaIntervalos, window.deleteInterval);
    }
};

function sanitizeDigits(str) { return str.replace(/\D/g, ''); }