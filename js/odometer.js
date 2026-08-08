/**
 * js/odometer.js
 * Faz: Gere exclusivamente os modais de registo de quilometragem de saída e de chegada (odómetro),
 *      validando os mínimos obrigatórios, calculando o total percorrido na rota e limpando o estado.
 * Depende de: ./storage.js, ./maps.js
 */

import { limparMapaVisual } from './maps.js';

// ==========================================
// MÓDULO DE ODÓMETRO E GESTÃO DE TURNOS
// ==========================================

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

    if (btnConfirmar) {
        btnConfirmar.onclick = () => {
            const kmVal = parseFloat(inputKm.value);
            const horaVal = inputHora ? inputHora.value.trim() : "";

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

            if (typeof window.sincronizarPersistenciaGlobal === 'function') {
                window.sincronizarPersistenciaGlobal();
            }

            modal.classList.add('hidden');
            if (typeof callback === 'function') callback();
        };
    }

    if (btnCancelar) {
        btnCancelar.onclick = () => modal.classList.add('hidden');
    }
}

export function abrirModalOdometroChegada(onTurnoEncerradoCallback) {
    const modal = document.getElementById('modal-odometro-chegada');
    if (!modal) return;

    const agora = new Date();
    const horaStr = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    
    // ATENÇÃO À CORREÇÃO DO ID (compatível com 'odometer-chegada-hora' ou 'odometro-chegada-hora')
    const inputHora = document.getElementById('odometer-chegada-hora') || document.getElementById('odometro-chegada-hora');
    const inputKm = document.getElementById('odometro-chegada-km');
    const txtMinimo = document.getElementById('odometro-chegada-minimo');

    if (inputHora) inputHora.value = horaStr;
    if (inputKm) inputKm.value = "";
    if (txtMinimo) txtMinimo.textContent = `Mínimo de partida: ${window.odometerStart || 0} KM`;

    modal.classList.remove('hidden');

    const btnConfirmar = document.getElementById('btn-confirmar-chegada-km');
    const btnCancelar = document.getElementById('btn-cancelar-chegada-km');

    if (btnConfirmar) {
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

            const totalPercorrido = kmVal - window.odometerStart;
            alert(`Turno Encerrado com Sucesso!\n\nPartida: ${window.odometerStart} KM às ${window.odometerStartHour}\nChegada: ${kmVal} KM às ${horaVal}\nTotal Percorrido: ${totalPercorrido.toFixed(1)} km`);

            window.tripCompleted = true;
            window.odometerEnd = kmVal;
            window.odometerEndHour = horaVal;
            window.lastOdometer = kmVal;

            window.partidaLocalizacao = null;
            window.moradasEntregas = [];
            window.rotaOtimizada = [];
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

            if (typeof window.sincronizarPersistenciaGlobal === 'function') {
                window.sincronizarPersistenciaGlobal();
            }

            modal.classList.add('hidden');

            if (typeof onTurnoEncerradoCallback === 'function') {
                onTurnoEncerradoCallback();
            }
        };
    }

    if (btnCancelar) {
        btnCancelar.onclick = () => modal.classList.add('hidden');
    }
}