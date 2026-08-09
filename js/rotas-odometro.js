/**
 * js/rotas-odometro.js
 * Versão v70.9 - Módulo de Gestão de Odómetro e Diário de Bordo
 * Faz: Controla os modais de registo de quilometragem de saída (início do percurso)
 *      e chegada (encerramento do turno), calculando totais percorridos e resetando o turno.
 * Depende de: ./maps.js, ./rotas.js
 */

import { limparMapaVisual } from './maps.js';
import { sincronizarPersistencia, sincronizarInterfaceRota } from './rotas.js';

/**
 * Abre o modal de registo de KM de Saída (Início de Rota)
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

    if (inputHora) inputHora.value = horaStr;
    if (inputKm) inputKm.value = window.lastOdometer || "";
    if (txtMinimo) txtMinimo.textContent = `Mínimo exigido: ${window.lastOdometer || 0} KM`;

    modal.classList.remove('hidden');

    const btnConfirmar = document.getElementById('btn-confirmar-saida-km');
    const btnCancelar = document.getElementById('btn-cancelar-saida-km');

    btnConfirmar.onclick = () => {
        const kmVal = parseFloat(inputKm.value);
        const horaVal = inputHora.value.trim();

        if (isNaN(kmVal) || kmVal < (window.lastOdometer || 0)) {
            alert(`Erro de validação: O valor de quilometragem de partida não pode ser menor do que o último registo final (${window.lastOdometer || 0} KM).`);
            return;
        }
        if (!horaVal) {
            alert("Por favor, introduza um horário de partida válido.");
            return;
        }

        window.tripStarted = true;
        window.tripCompleted = false;
        window.odometerStart = kmVal;
        window.odometerStartHour = horaVal;
        window.lastOdometer = kmVal;

        sincronizarPersistencia();
        modal.classList.add('hidden');
        if (typeof callback === 'function') callback();
    };

    btnCancelar.onclick = () => modal.classList.add('hidden');
}

/**
 * Abre o modal de registo de KM de Chegada (Encerramento de Turno)
 */
export function abrirModalOdometroChegada() {
    const modal = document.getElementById('modal-odometro-chegada');
    if (!modal) return;

    const agora = new Date();
    const horaStr = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    
    const inputHora = document.getElementById('odometer-chegada-hora') || document.getElementById('odometro-chegada-hora');
    const inputKm = document.getElementById('odometro-chegada-km');
    const txtMinimo = document.getElementById('odometro-chegada-minimo');

    if (inputHora) inputHora.value = horaStr;
    if (inputKm) inputKm.value = "";
    if (txtMinimo) txtMinimo.textContent = `Mínimo de partida: ${window.odometerStart || 0} KM`;

    modal.classList.remove('hidden');

    const btnConfirmar = document.getElementById('btn-confirmar-chegada-km');
    const btnCancelar = document.getElementById('btn-cancelar-chegada-km');

    btnConfirmar.onclick = () => {
        const kmVal = parseFloat(inputKm.value);
        const horaVal = inputHora ? inputHora.value.trim() : "";

        if (isNaN(kmVal) || kmVal < window.odometerStart) {
            alert(`Erro de validação: O valor de quilometragem final não pode ser inferior ao valor de saída (${window.odometerStart} KM).`);
            return;
        }
        if (!horaVal) {
            alert("Por favor, introduza um horário de regresso válido.");
            return;
        }

        alert(`Turno Encerrado com Sucesso!\n\nPartida: ${window.odometerStart} KM às ${window.odometerStartHour}\nChegada: ${kmVal} KM às ${horaVal}\nTotal Percorrido: ${(kmVal - window.odometerStart).toFixed(1)} km`);

        window.tripCompleted = true;
        window.odometerEnd = kmVal;
        window.odometerEndHour = horaVal;
        window.lastOdometer = kmVal;

        window.partidaLocalizacao = null;
        window.moradasEntregas = [];
        window.rotaOtimizada = [];
        window.isRouteOptimized = false;
        window.dataRotaSelecionada = "";
        window.rotaIniciada = false;
        window.tripStarted = false;
        window.tripCompleted = false;
        window.odometerStart = 0;
        window.odometerStartHour = "";
        window.odometerEnd = 0;
        window.odometerEndHour = "";

        localStorage.removeItem('cp_last_navigated_id');
        limparMapaVisual();

        sincronizarPersistencia();
        modal.classList.add('hidden');
        sincronizarInterfaceRota();
    };

    btnCancelar.onclick = () => modal.classList.add('hidden');
}