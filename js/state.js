/**
 * state.js
 * Versão v70.9 - Com Indicador Explícito de Rota Otimizada
 * Faz: Inicializa e gere o estado global da aplicação em memória.
 * NÃO faz: Não grava diretamente no LocalStorage do telemóvel/PC.
 * Depende de: ./storage.js
 */

import { safeJSONParse } from './storage.js';

// ==========================================
// ESTADO GLOBAL DA APLICAÇÃO (RECUPERAÇÃO SEGURA)
// ==========================================
window.drivers = safeJSONParse('cp_drivers', []);
window.assignments = safeJSONParse('cp_assignments', []);

// Guarda o ID exclusivo do utilizador com sessão iniciada na nuvem
window.currentUserUid = null;

// ==========================================
// MIGRAÇÃO DE DADOS AUTOMÁTICA
// ==========================================
window.drivers.forEach(driver => {
    if (!Array.isArray(driver.brickIds)) {
        driver.brickIds = [];
    }
    delete driver.sectorId;
    delete driver.sectorIds;
});

// ==========================================
// ESTADOS INTERNOS DO TECLADO E TRIAGEM
// ==========================================
window.currentInput = "";
window.isPrefixLocked = false;
window.lockedPrefixValue = "";
window.selectedColor = "#2563EB";
window.lastAnalysisResult = null;

// ==========================================
// ESTADOS DE CONTROLO DE EDIÇÃO EM CURSO
// ==========================================
window.driverSendoEditado = null;

// ==========================================
// ESTADOS DAS ROTAS E ITINERÁRIOS DO TURNO
// ==========================================
window.partidaLocalizacao = safeJSONParse('cp_partida', null);
window.moradasEntregas = safeJSONParse('cp_entregas', []);
window.rotaOtimizada = safeJSONParse('cp_rota_otimizada', []);
window.dataRotaSelecionada = safeJSONParse('cp_data_rota', "");
window.rotaIniciada = safeJSONParse('cp_rota_iniciada', false);

// NOVO: Flag explícito que indica se a rota já passou pela Otimização da Google
window.isRouteOptimized = safeJSONParse('cp_is_route_optimized', false);

window.definindoPartidaPorMorada = false;

// Guarda reativamente o tipo de cálculo utilizado no percurso
window.routingMethodUsed = localStorage.getItem('cp_routing_method') || 'Cloud';

// ==========================================
// ESTADO GERAL DE ODÓMETRO / DIÁRIO DE BORDO
// ==========================================
window.tripStarted = safeJSONParse('cp_trip_started', false);
window.tripCompleted = safeJSONParse('cp_trip_completed', false);
window.odometerStart = safeJSONParse('cp_odometer_start', 0);
window.odometerStartHour = safeJSONParse('cp_odometer_start_hour', "");
window.odometerEnd = safeJSONParse('cp_odometer_end', 0);
window.odometerEndHour = safeJSONParse('cp_odometer_end_hour', "");
window.lastOdometer = safeJSONParse('cp_last_odometer', 0);