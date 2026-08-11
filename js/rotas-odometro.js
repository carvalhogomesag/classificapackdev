/**
 * js/rotas-odometro.js
 * Versão v71.1 - Módulo de Gestão de Odómetro, Diário de Bordo e Relatórios
 * Faz: Controla os modais de registo de quilometragem de saída (início do percurso)
 *      e chegada (encerramento do turno), calculando totais percorridos, gerando
 *      o relatório de desempenho por Brick e salvando no Firestore.
 * Depende de: ./maps.js, ./rotas.js, ./rotas-relatorios.js
 */

import { limparMapaVisual } from './maps.js';
import { sincronizarPersistencia, sincronizarInterfaceRota } from './rotas.js';
import { 
  verificarPendenciasRota, 
  calcularMetricasRelatorio, 
  salvarRelatorioNoFirestore 
} from './rotas-relatorios.js';

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
        window.odometerStartTimestamp = new Date().toISOString(); // Registo preciso de início
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

    btnConfirmar.onclick = async () => {
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

        // 1. REGRA DE OURO DE NEGÓCIO: Verificar se existem pendências na rota
        const listaMoradasAtuais = window.moradasEntregas || [];
        const validacaoPendencias = verificarPendenciasRota(listaMoradasAtuais);

        if (validacaoPendencias.temPendencias) {
            alert(`🚨 NÃO É POSSÍVEL ENCERRAR O TURNO!\n\nExistem ${validacaoPendencias.totalPendentes} objeto(s) com estado PENDENTE na sua rota.\n\nPor favor, conclua o registo de todas as entregas/recolhas ou registe os motivos de falha antes de encerrar o turno.`);
            return;
        }

        // Disable no botão para evitar duplo clique
        btnConfirmar.disabled = true;
        btnConfirmar.innerText = "A gerar relatório...";

        try {
            // 2. Preparar dados para o Relatório de Turno
            const driver = window.currentDriver || window.driverAtual || {};
            const driverId = driver.id || driver.uid || localStorage.getItem('cp_driver_id') || 'DRIVER_SESSAO';
            const driverName = driver.nome || driver.name || localStorage.getItem('cp_driver_name') || 'Motorista';

            // Determinar o ISO de Início
            let horaInicioIso = window.odometerStartTimestamp;
            if (!horaInicioIso && window.odometerStartHour) {
                const [h, m] = window.odometerStartHour.split(':').map(Number);
                const dSaida = new Date();
                if (!isNaN(h) && !isNaN(m)) {
                    dSaida.setHours(h, m, 0, 0);
                }
                horaInicioIso = dSaida.toISOString();
            }
            if (!horaInicioIso) horaInicioIso = new Date().toISOString();

            const dadosTurno = {
                driverId: driverId,
                driverName: driverName,
                kmInicial: window.odometerStart || 0,
                kmFinal: kmVal,
                horaInicio: horaInicioIso,
                horaFim: new Date().toISOString(),
                concelho: window.currentConcelho || window.concelhoAtivo || 'Mafra/Sintra'
            };

            // 3. Calcular métricas por Brick e de Desempenho
            const relatorioCalculado = calcularMetricasRelatorio(dadosTurno, listaMoradasAtuais);

            // 4. Salvar na coleção 'relatorios_turnos' do Firestore (com higienização)
            await salvarRelatorioNoFirestore(relatorioCalculado);

            // 5. Exibir resumo e confirmação
            const numBricks = Object.keys(relatorioCalculado.detalhamentoPorBrick).length;
            alert(
                `🎉 TURNO ENCERRADO E RELATÓRIO GRAVADO NA NUVEM!\n\n` +
                `⏱️ Duração: ${relatorioCalculado.telemetriaTurno.duracaoHoras}h (${relatorioCalculado.telemetriaTurno.duracaoMinutos} min)\n` +
                `🛣️ Distância: ${relatorioCalculado.telemetriaTurno.kmPercorridos} KM\n` +
                `📊 Média: ${relatorioCalculado.metricasEficiencia.eventosPorHora} evt/hora | ${relatorioCalculado.metricasEficiencia.eventosPorKm} evt/KM\n` +
                `📦 Bricks Atendidos: ${numBricks}\n\n` +
                `Relatório armazenado com sucesso no backend!`
            );

        } catch (erro) {
            console.error("Erro ao gerar/salvar relatório de turno:", erro);
            const msgDetalhada = erro?.message || String(erro);
            alert(`Atenção: Ocorreu um erro ao gravar o relatório no Firestore:\n\n${msgDetalhada}\n\nO registo do odómetro local foi processado.`);
        } finally {
            // 6. Reset completo do estado da rota do turno
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
            window.odometerStartTimestamp = null;
            window.odometerEnd = 0;
            window.odometerEndHour = "";

            localStorage.removeItem('cp_last_navigated_id');
            limparMapaVisual();

            sincronizarPersistencia();
            modal.classList.add('hidden');
            sincronizarInterfaceRota();

            btnConfirmar.disabled = false;
            btnConfirmar.innerText = "Confirmar Chegada";
        }
    };

    btnCancelar.onclick = () => modal.classList.add('hidden');
}