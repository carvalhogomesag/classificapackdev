/**
 * js/rotas.js
 * Versão v70.4 - Orquestrador Leve com Correção do Switcher Principal de Rota
 * Faz: Liga os botões e ecrãs de rotas aos subsistemas isolados de geocodificação, 
 *      otimização de rotas, odómetros, navegação inteligente e switchers principais/modais.
 * Depende de: ./storage.js, ./voz.js, ./maps.js, ./firebase-init.js, ./navigation.js, ./odometer.js, ./geocoding.js, ./route-optimizer.js
 */

import { saveData } from './storage.js';
import { criarReconhecimentoVoz } from './voz.js';
import { desenharMapaGoogle, limparMapaVisual } from './maps.js';

// Importa os módulos isolados e especializados
import { abrirNavegacao } from './navigation.js';
import { abrirModalOdometroSaida, abrirModalOdometroChegada } from './odometer.js';
import { resolveBrickForZip, configurarEscutaCodigoPostalParaLimites, inicializarAutocompleteMorada } from './geocoding.js';
import { otimizarItinerarioComVizinhoMaisProximo, renderizarItinerarioOtimizado } from './route-optimizer.js';

// Importa a instância ativa do Firestore
import { db } from './firebase-init.js';

let itemSendoEditado = null; 
let autocompleteInstancia = null;

// =========================================================================
// DETETOR INTELIGENTE DE AMBIENTE (LOCAL VS PRODUÇÃO)
// =========================================================================
const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://classificapack-backend.onrender.com';

// ==========================================
// CENTRALIZAÇÃO DA PERSISTÊNCIA DAS ROTAS
// ==========================================
function sincronizarPersistencia() {
    saveData(
        window.drivers, [], window.assignments,
        window.partidaLocalizacao, window.moradasEntregas,
        window.rotaOtimizada, window.dataRotaSelecionada, window.rotaIniciada
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
        }).catch((err) => console.error("[FIREBASE] Erro ao sincronizar rota:", err));
    }
}

window.sincronizarPersistenciaGlobal = sincronizarPersistencia;

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

// ==========================================
// TRATAMENTO DE ENVIO DE CÓDIGO POSTAL + MORADA
// ==========================================
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
        
        // Lê do campo oculto principal do ecrã de rotas
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
                renderizarItinerarioOtimizado(sincronizarPersistencia, abrirModalEdicaoParagem);
                desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
            }

            abrirModalEdicaoParagem(novaMorada);
        }

        inputPostal.value = "";
        if (inputMorada) inputMorada.value = "";
        
        // Reseta o switcher principal para Entrega após adicionar com sucesso
        const btnEntregaPrin = document.getElementById('tipo-entrega');
        if (btnEntregaPrin) btnEntregaPrin.click();

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
                ${isRecolha ? `<span class="bg-purple-100 text-purple-700 text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded border border-purple-200 ml-1.5">Recolha</span>` : ''}
                ${morada.priority ? `<span class="bg-orange-500 text-white text-[8px] font-bold uppercase px-1 py-0.5 rounded ml-1.5">Prioritária</span>` : ''}
                ${morada.observation ? `<p class="text-[10px] text-blue-500 font-semibold italic mt-0.5 truncate">Nota: ${morada.observation}</p>` : ''}
            </div>
            <div class="flex items-center space-x-1.5 flex-shrink-0">
                <button class="btn-edit-morada text-blue-500 font-bold p-1 hover:bg-blue-50 rounded"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-del-morada text-red-500 font-bold p-1 hover:bg-red-50 rounded">X</button>
            </div>
        `;
        
        item.querySelector('.btn-edit-morada').onclick = () => abrirModalEdicaoParagem(morada);
        
        item.querySelector('.btn-del-morada').onclick = () => {
            if (!confirm(`Tem a certeza que deseja excluir esta entrega?\nMorada: ${morada.address}`)) return;

            window.moradasEntregas = window.moradasEntregas.filter(m => m.id !== morada.id);
            window.rotaOtimizada = window.rotaOtimizada.filter(m => m.id !== morada.id); 
            
            renderMoradasAdicionadas();
            
            if (window.rotaOtimizada.length > 0) {
                renderizarItinerarioOtimizado(sincronizarPersistencia, abrirModalEdicaoParagem);
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

// ==========================================
// CONFIGURAÇÃO DOS PREFIXOS RÁPIDOS
// ==========================================
function setupPrefixosRapidosLogic() {
    const inputPostal = document.getElementById('rota-codigo-postal');
    if (!inputPostal) return;

    function injetarPrefixo(prefixoVal) {
        const digitos = (prefixoVal || '').replace(/\D/g, '');
        if (digitos.length !== 4) return false;

        inputPostal.value = `${digitos}-`;
        inputPostal.focus();
        inputPostal.setSelectionRange(inputPostal.value.length, inputPostal.value.length);
        inputPostal.dispatchEvent(new Event('input', { bubbles: true }));
        inputPostal.dispatchEvent(new CustomEvent('prefixo-aplicado', { bubbles: true }));
        return true;
    }

    const botoesPrefixo = document.querySelectorAll('.btn-prefixo-rapido');
    botoesPrefixo.forEach(btn => {
        if (btn.dataset.prefixoBound) return;
        btn.dataset.prefixoBound = "true";
        btn.addEventListener('click', () => {
            injetarPrefixo(btn.getAttribute('data-prefixo') || btn.textContent.trim());
        });
    });

    const inputPrefixoManual = document.getElementById('prefixo-manual');
    const btnInserirPrefixo = document.getElementById('btn-inserir-prefixo');

    if (inputPrefixoManual && btnInserirPrefixo && !btnInserirPrefixo.dataset.prefixoBound) {
        btnInserirPrefixo.dataset.prefixoBound = "true";
        btnInserirPrefixo.addEventListener('click', () => {
            const sucesso = injetarPrefixo(inputPrefixoManual.value);
            if (!sucesso) {
                alert("Por favor, introduza um prefixo de Código Postal com exatamente 4 números.");
                inputPrefixoManual.focus();
            }
        });
    }
}

// ==========================================
// GESTÃO DO SWITCHER PRINCIPAL DE TIPO DE OPERAÇÃO (ENTREGA / RECOLHA)
// ==========================================
function setupTipoOperacaoLogic() {
    const btnEntrega = document.getElementById('tipo-entrega');
    const btnRecolha = document.getElementById('tipo-recolha');
    const inputTipoOperacao = document.getElementById('rota-tipo-operacao');

    if (!btnEntrega || !btnRecolha || !inputTipoOperacao) return;

    if (btnEntrega.dataset.tipoBound === "true") return;
    btnEntrega.dataset.tipoBound = "true";
    btnRecolha.dataset.tipoBound = "true";

    const selecionarTipo = (tipo) => {
        inputTipoOperacao.value = tipo;
        if (tipo === "Recolha") {
            btnRecolha.className = "flex-1 py-2.5 text-xs font-black rounded-lg text-center bg-purple-600 text-white shadow transition-all cursor-pointer focus:outline-none";
            btnEntrega.className = "flex-1 py-2.5 text-xs font-bold rounded-lg text-center text-gray-500 transition-all cursor-pointer focus:outline-none";
        } else {
            btnEntrega.className = "flex-1 py-2.5 text-xs font-black rounded-lg text-center bg-blue-600 text-white shadow transition-all cursor-pointer focus:outline-none";
            btnRecolha.className = "flex-1 py-2.5 text-xs font-bold rounded-lg text-center text-gray-500 transition-all cursor-pointer focus:outline-none";
        }
    };

    btnEntrega.addEventListener('click', () => selecionarTipo("Entrega"));
    btnRecolha.addEventListener('click', () => selecionarTipo("Recolha"));
    
    selecionarTipo("Entrega");
}

// ==========================================
// GESTÃO DO SWITCHER DO MODAL DE EDIÇÃO
// ==========================================
function setupSwitcherTipoOperacaoModal() {
    const btnEntrega = document.getElementById('edit-tipo-entrega');
    const btnRecolha = document.getElementById('edit-tipo-recolha');
    const inputTipoOperacao = document.getElementById('edit-tipo-operacao');

    if (!btnEntrega || !btnRecolha || !inputTipoOperacao) return;

    if (btnEntrega.dataset.switcherBound === "true") return;
    btnEntrega.dataset.switcherBound = "true";
    btnRecolha.dataset.switcherBound = "true";

    const definirTipo = (tipo) => {
        if (tipo === "Recolha") {
            inputTipoOperacao.value = "Recolha";
            btnRecolha.className = "flex-1 py-2.5 text-xs font-black rounded-lg text-center bg-purple-600 text-white shadow transition-all cursor-pointer focus:outline-none";
            btnEntrega.className = "flex-1 py-2.5 text-xs font-bold rounded-lg text-center text-gray-500 transition-all cursor-pointer focus:outline-none";
        } else {
            inputTipoOperacao.value = "Entrega";
            btnEntrega.className = "flex-1 py-2.5 text-xs font-black rounded-lg text-center bg-blue-600 text-white shadow transition-all cursor-pointer focus:outline-none";
            btnRecolha.className = "flex-1 py-2.5 text-xs font-bold rounded-lg text-center text-gray-500 transition-all cursor-pointer focus:outline-none";
        }
    };

    btnEntrega.addEventListener('click', () => definirTipo("Entrega"));
    btnRecolha.addEventListener('click', () => definirTipo("Recolha"));

    inputTipoOperacao._definirTipoUI = definirTipo;
}

// ==========================================
// INTERFACE E GESTÃO DE TURNOS (ORQUESTRADOR)
// ==========================================
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

    autocompleteInstancia = inicializarAutocompleteMorada('rota-morada-completa', API_BASE_URL);
    configurarEscutaCodigoPostalParaLimites(autocompleteInstancia);
    setupPrefixosRapidosLogic();
    setupTipoOperacaoLogic();

    if (btnPlaneamento && btnConducao) {
        btnPlaneamento.addEventListener('click', () => alternarModoRota('planeamento'));
        btnConducao.addEventListener('click', () => alternarModoRota('conducao'));
    }

    if (btnAdicionarPostal) btnAdicionarPostal.addEventListener('click', () => processarAdicaoPorPostal());

    if (btnIniciarRota && dataRotaInput) {
        btnIniciarRota.addEventListener('click', () => {
            const dataSelecionada = dataRotaInput.value;
            if (!dataSelecionada) return alert("Por favor, selecione uma data para continuar.");
            const d = new Date(dataSelecionada);
            window.dataRotaSelecionada = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
            
            window.tripStarted = false;
            window.tripCompleted = false;
            window.odometerStart = 0;
            window.odometerStartHour = "";
            window.odometerEnd = 0;
            window.odometerEndHour = "";
            window.rotaIniciada = true;

            sincronizarPersistencia();
            sincronizarInterfaceRota();
        });
    }

    if (btnGpsPartida && statusPartida) {
        btnGpsPartida.addEventListener('click', () => {
            statusPartida.textContent = "A obter geolocalização do GPS...";
            if (!navigator.geolocation) return alert("O seu telemóvel não suporta GPS.");

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    obterEnderecoPorGPSGoogle(lat, lng, (moradaGps) => {
                        window.partidaLocalizacao = moradaGps || { lat, lng, address: `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})` };
                        statusPartida.innerHTML = `<strong>Partida:</strong> ${window.partidaLocalizacao.address}`;
                        sincronizarPersistencia();
                    });
                },
                () => alert("Não foi possível aceder ao GPS."),
                { enableHighAccuracy: true }
            );
        });
    }

    if (btnBuscarPartida) {
        btnBuscarPartida.addEventListener('click', () => {
            window.definindoPartidaPorMorada = true;
            alert("Introduza o Código Postal e a rua de PARTIDA pretendida e clique em 'Adicionar Pacote'!");
            document.getElementById('rota-codigo-postal')?.focus();
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
            
            otimizarItinerarioComVizinhoMaisProximo(
                API_BASE_URL, 
                () => sincronizarPersistencia(), 
                () => sincronizarInterfaceRota(),
                abrirModalOdometroSaida,
                abrirNavegacao,
                abrirModalEdicaoParagem
            );
        });
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
            statusPartida.innerHTML = window.partidaLocalizacao 
                ? `<strong>Partida:</strong> ${window.partidaLocalizacao.address}`
                : "Partida: Localização não definida";
        }

        renderMoradasAdicionadas();
        setTimeout(() => {
            autocompleteInstancia = inicializarAutocompleteMorada('rota-morada-completa', API_BASE_URL);
            configurarEscutaCodigoPostalParaLimites(autocompleteInstancia);
            setupPrefixosRapidosLogic();
            setupTipoOperacaoLogic();
            setupSwitcherTipoOperacaoModal();
        }, 100);
        alternarModoRota(localStorage.getItem('cp_modo_rota') || 'planeamento');

        if (window.rotaOtimizada.length > 0) {
            document.getElementById('container-mapa')?.classList.remove('hidden');
            document.getElementById('container-rota-ordenada')?.classList.remove('hidden');
            renderizarItinerarioOtimizado(sincronizarPersistencia, abrirModalEdicaoParagem);
            setTimeout(() => desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada), 300);
        } else {
            document.getElementById('container-mapa')?.classList.add('hidden');
            document.getElementById('container-rota-ordenada')?.classList.add('hidden');
            document.getElementById('estatisticas-rota')?.classList.add('hidden');
        }
    } else {
        containerSetupRota.classList.remove('hidden');
        containerPlaneadorRota.classList.add('hidden');
        if (dataRotaInput) dataRotaInput.value = new Date().toISOString().split('T')[0];
    }
}

export function setupModaisEdicao() {
    const btnCancelarEdicao = document.getElementById('btn-cancelar-edicao');
    const btnSalvarEdicao = document.getElementById('btn-salvar-edicao');

    if (!btnCancelarEdicao || !btnSalvarEdicao) return;

    setupSwitcherTipoOperacaoModal();

    btnCancelarEdicao.addEventListener('click', () => {
        document.getElementById('modal-editar-paragem')?.classList.add('hidden');
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

        if (!novaMorada) return alert("A morada de entrega não pode ficar em branco.");

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
                if (!response.ok) throw new Error(data.error || "Falha ao validar a nova morada.");

                itemSendoEditado.lat = data.lat;
                itemSendoEditado.lng = data.lng;
                itemSendoEditado.address = data.address;

                const postalCodeMatch = data.address.match(/\d{4}-\d{3}/);
                const { brickId, brickName } = resolveBrickForZip(postalCodeMatch ? postalCodeMatch[0] : novaMorada, window.drivers);
                if (brickId) {
                    itemSendoEditado.brickId = brickId;
                    itemSendoEditado.brickName = brickName;
                }
            }

            itemSendoEditado.isNewUnconfirmed = false;
            itemSendoEditado.observation = novaObs;
            itemSendoEditado.priority = novaPrioridade;
            itemSendoEditado.tipoOperacao = novoTipoOperacao;

            const idxPre = window.moradasEntregas.findIndex(m => m.id === itemSendoEditado.id);
            if (idxPre !== -1) window.moradasEntregas[idxPre] = { ...itemSendoEditado };

            const idxPos = window.rotaOtimizada.findIndex(m => m.id === itemSendoEditado.id);
            if (idxPos !== -1) {
                window.rotaOtimizada[idxPos] = { ...itemSendoEditado };
                window.rotaOtimizada.forEach((p, idx) => {
                    p.distanciaDoAnterior = calcularDistanciaHaversine(
                        idx === 0 ? window.partidaLocalizacao.lat : window.rotaOtimizada[idx - 1].lat,
                        idx === 0 ? window.partidaLocalizacao.lng : window.rotaOtimizada[idx - 1].lng,
                        p.lat, p.lng
                    );
                });
            }

            sincronizarPersistencia();
            renderMoradasAdicionadas();
            if (window.rotaOtimizada.length > 0) {
                renderizarItinerarioOtimizado(sincronizarPersistencia, abrirModalEdicaoParagem);
                desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
            }

            document.getElementById('modal-editar-paragem')?.classList.add('hidden');
            itemSendoEditado = null;

        } catch (err) {
            console.error("Erro ao gravar edição:", err);
            alert(`Erro ao atualizar: ${err.message}`);
        } finally {
            btnSalvarEdicao.innerHTML = textoOriginalBotao;
            btnSalvarEdicao.disabled = false;
        }
    });
}

export function abrirModalEdicaoParagem(paragem) {
    const modalEditarParagem = document.getElementById('modal-editar-paragem');
    const editMoradaTexto = document.getElementById('edit-morada-texto');
    const editMoradaObs = document.getElementById('edit-morada-obs');
    const editMoradaPrioridade = document.getElementById('edit-morada-prioridade');
    const editTipoOperacaoInput = document.getElementById('edit-tipo-operacao');

    if (!modalEditarParagem || !editMoradaTexto || !editMoradaObs) return;

    itemSendoEditado = paragem;
    itemSendoEditado._originalAddress = paragem.address;

    editMoradaTexto.value = paragem.address;
    editMoradaObs.value = paragem.observation || "";
    if (editMoradaPrioridade) editMoradaPrioridade.checked = !!paragem.priority;

    const tipoAtual = paragem.tipoOperacao || "Entrega";
    if (editTipoOperacaoInput && typeof editTipoOperacaoInput._definirTipoUI === 'function') {
        editTipoOperacaoInput._definirTipoUI(tipoAtual);
    }

    modalEditarParagem.classList.remove('hidden');
    setTimeout(() => {
        editMoradaObs.focus();
        editMoradaObs.select();
    }, 150);
}