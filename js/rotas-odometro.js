/**
 * js/rotas-odometro.js
 * Versão v76.6 - Módulo de Gestão de Odómetro com Fecho de Turno Atómico e Descomplicado
 * Faz: Controla o registo e retificação do KM de saída e executa o encerramento limpo
 *      do turno de trabalho, reinicializando a rota localmente e na nuvem de forma síncrona.
 * Depende de: ./maps.js, ./rotas.js
 */

import { limparMapaVisual } from './maps.js';
import { sincronizarPersistencia, sincronizarInterfaceRota } from './rotas.js';

/**
 * Abre o modal de registo ou retificação de KM de Saída (Início / Correção de Rota)
 * @param {Function} [callback] - Função a ser executada após confirmação com sucesso
 */
export function abrirModalOdometroSaida(callback) {
    const modal = document.getElementById('modal-odometro-saida');
    if (!modal) return;

    const agora = new Date();
    const horaStr = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    
    const inputHora = document.getElementById('odometro-saida-hora');
    const inputKm = document.getElementById('odometro-saida-km');
    const txtMinimo = document.getElementById('odometro-saida-minimo');
    const modalTitulo = modal.querySelector('h3') || document.getElementById('modal-odometro-saida-titulo');
    const btnConfirmar = document.getElementById('btn-confirmar-saida-km');
    const btnCancelar = document.getElementById('btn-cancelar-saida-km');

    const isEdicao = Boolean(window.tripStarted && window.odometerStart);

    if (modalTitulo) {
        modalTitulo.textContent = isEdicao ? "Corrigir KM de Saída" : "Registo de Odómetro (Saída)";
    }

    if (inputHora) {
        inputHora.value = window.odometerStartHour || horaStr;
    }

    if (inputKm) {
        inputKm.value = isEdicao ? window.odometerStart : (window.lastOdometer || "");
    }

    if (txtMinimo) {
        txtMinimo.textContent = isEdicao 
            ? `Valor atual: ${window.odometerStart} KM` 
            : `Último registo: ${window.lastOdometer || 0} KM`;
    }

    if (btnConfirmar) {
        btnConfirmar.innerHTML = isEdicao 
            ? '<i class="fa-solid fa-check mr-1.5"></i> Atualizar KM' 
            : '<i class="fa-solid fa-play mr-1.5"></i> Confirmar Saída';
    }

    modal.classList.remove('hidden');

    btnConfirmar.onclick = () => {
        const kmVal = parseFloat(inputKm.value) || 0;
        const horaVal = inputHora ? inputHora.value.trim() : horaStr;

        window.tripStarted = true;
        window.tripCompleted = false;
        window.odometerStartTimestamp = new Date().toISOString();
        window.odometerStart = kmVal;
        window.odometerStartHour = horaVal;
        window.lastOdometer = kmVal;

        sincronizarPersistencia();
        sincronizarInterfaceRota();

        modal.classList.add('hidden');
        if (typeof callback === 'function') callback();
    };

    if (btnCancelar) {
        btnCancelar.onclick = () => modal.classList.add('hidden');
    }
}

/**
 * Encerramento Direto, Limpo e Atómico do Turno de Trabalho
 */
export function abrirModalOdometroChegada() {
    const confirmar = confirm("Deseja realmente finalizar o turno de trabalho atual e limpar o itinerário da rota?");
    if (!confirmar) return;

    try {
        // 1. Reset das variáveis em memória
        window.rotaIniciada = false;
        window.isRouteOptimized = false;
        window.tripStarted = false;
        window.tripCompleted = true;

        window.partidaLocalizacao = null;
        window.moradasEntregas = [];
        window.rotaOtimizada = [];
        window.dataRotaSelecionada = "";

        window.odometerStart = 0;
        window.odometerStartHour = "";
        window.odometerStartTimestamp = null;
        window.odometerEnd = 0;
        window.odometerEndHour = "";

        // 2. Limpeza física forçada do LocalStorage
        localStorage.setItem('cp_rota_iniciada', 'false');
        localStorage.setItem('cp_entregas', '[]');
        localStorage.setItem('cp_rota_otimizada', '[]');
        localStorage.setItem('cp_is_route_optimized', 'false');
        localStorage.setItem('cp_partida', 'null');
        localStorage.setItem('cp_data_rota', '""');
        localStorage.setItem('cp_trip_started', 'false');
        localStorage.setItem('cp_trip_completed', 'true');
        localStorage.removeItem('cp_last_navigated_id');
        
        // 3. Limpeza visual e sincronização na Nuvem
        limparMapaVisual();
        sincronizarPersistencia();
        sincronizarInterfaceRota();

        alert("✅ Turno finalizado com sucesso!");
    } catch (erro) {
        console.error("Erro ao encerrar turno:", erro);
        sincronizarInterfaceRota();
    }
}

/**
 * Configura o gatilho de clique para edição do odómetro de saída
 */
export function configurarGatilhoEdicaoOdometro() {
    const btnEditar = document.getElementById('btn-editar-odometro-saida');
    const cardSaida = document.getElementById('card-odometro-resumo-saida');

    if (btnEditar && !btnEditar.dataset.bound) {
        btnEditar.addEventListener('click', (e) => {
            e.stopPropagation();
            abrirModalOdometroSaida();
        });
        btnEditar.dataset.bound = "true";
    }

    if (cardSaida && !cardSaida.dataset.bound) {
        cardSaida.addEventListener('click', () => {
            abrirModalOdometroSaida();
        });
        cardSaida.dataset.bound = "true";
    }
}