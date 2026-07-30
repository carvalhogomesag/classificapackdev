javascript
/**
 * state.js
 * Faz: Inicializa e gere o estado global da aplicação em memória (propriedades anexadas ao objeto global 'window').
 *      Removido o conceito de setores; agora os motoristas contêm diretamente a lista de Bricks (Localidades) atribuídos.
 * NÃO faz: Não grava diretamente no LocalStorage do telemóvel/PC (esta persistência física é delegada para o módulo storage.js).
 * Depende de: ./storage.js (para ler os valores guardados de forma segura)
 */

import { safeJSONParse } from './storage.js';

// ==========================================
// ESTADO GLOBAL DA APLICAÇÃO (RECUPERAÇÃO SEGURA)
// ==========================================
window.drivers = safeJSONParse('cp_drivers', []);
window.assignments = safeJSONParse('cp_assignments', []);

// NOVO: Guarda o ID exclusivo do utilizador com sessão iniciada na nuvem
window.currentUserUid = null;

// ==========================================
// MIGRAÇÃO DE DADOS AUTOMÁTICA
// Garante que cada motorista possui o array 'brickIds' para guardar as localidades atribuídas
// ==========================================
window.drivers.forEach(driver => {
    if (!Array.isArray(driver.brickIds)) {
        driver.brickIds = [];
    }
    // Removemos propriedades legadas de setores para limpar a estrutura
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