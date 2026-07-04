// storage.js

/**
 * Função defensiva para ler dados do LocalStorage sem quebrar a aplicação
 */
export function safeJSONParse(key, fallback) {
    try {
        const item = localStorage.getItem(key);
        if (item === null || item === undefined || item === "undefined") {
            return fallback;
        }
        return JSON.parse(item);
    } catch (e) {
        console.error(`Erro ao analisar JSON para a chave "${key}":`, e);
        return fallback;
    }
}

/**
 * Grava de forma persistente todos os estados da aplicação no LocalStorage
 */
export function saveData(drivers, intervals, assignments, partida, entregas, rota, dataRota, iniciada, zones = []) {
    localStorage.setItem('cp_drivers', JSON.stringify(drivers));
    localStorage.setItem('cp_intervals', JSON.stringify(intervals));
    localStorage.setItem('cp_assignments', JSON.stringify(assignments));
    
    // Gravação persistente do planeamento de rotas
    localStorage.setItem('cp_partida', JSON.stringify(partida));
    localStorage.setItem('cp_entregas', JSON.stringify(entregas));
    localStorage.setItem('cp_rota_otimizada', JSON.stringify(rota));
    localStorage.setItem('cp_data_rota', JSON.stringify(dataRota));
    localStorage.setItem('cp_rota_iniciada', JSON.stringify(iniciada));

    // Gravação das novas Zonas (Agrupamentos)
    localStorage.setItem('cp_zones', JSON.stringify(zones));
}