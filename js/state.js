/**
 * state.js
 * Faz: Inicializa e gere o estado global da aplicação em memória (propriedades anexadas ao objeto global 'window') e executa a migração de dados de motoristas antigos.
 * NÃO faz: Não grava diretamente no LocalStorage do telemóvel (esta persistência física é delegada para o módulo storage.js).
 * Depende de: ./storage.js (para ler os valores guardados de forma segura)
 */

import { safeJSONParse } from './storage.js';

// ==========================================
// ESTADO GLOBAL DA APLICAÇÃO (RECUPERAÇÃO SEGURA)
// ==========================================
window.drivers = safeJSONParse('cp_drivers', []);
window.assignments = safeJSONParse('cp_assignments', []);
window.sectors = safeJSONParse('cp_zones', []); // Setores carregados em memória

// ==========================================
// MIGRAÇÃO DE DADOS AUTOMÁTICA
// Converte motoristas antigos (com 'sectorId' único) para o novo
// modelo (com 'sectorIds' em lista/array), permitindo múltiplos setores.
// ==========================================
window.drivers.forEach(driver => {
    if (!Array.isArray(driver.sectorIds)) {
        driver.sectorIds = driver.sectorId ? [driver.sectorId] : [];
    }
    delete driver.sectorId;
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
window.sectorSendoEditado = null;

// ==========================================
// ESTADOS DAS ROTAS E ITINERÁRIOS DO TURNO
// ==========================================
window.partidaLocalizacao = safeJSONParse('cp_partida', null);
window.moradasEntregas = safeJSONParse('cp_entregas', []);
window.rotaOtimizada = safeJSONParse('cp_rota_otimizada', []);
window.dataRotaSelecionada = safeJSONParse('cp_data_rota', "");
window.rotaIniciada = safeJSONParse('cp_rota_iniciada', false);
window.definindoPartidaPorMorada = false;