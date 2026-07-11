/**
 * storage.js
 * Faz: Gere a persistência de dados física (leitura e escrita defensiva no LocalStorage do telemóvel), garantindo que as informações de motoristas, turnos e rotas persistam.
 * NÃO faz: Não gere o estado ativo em memória (tarefa do state.js) nem valida regras geográficas de Mafra.
 * Depende de: Nenhuns módulos externos (módulo independente utilitário).
 */

/**
 * Lê os dados guardados no telemóvel de forma segura.
 * Se o telemóvel nunca tiver corrido a aplicação antes, devolve uma lista vazia ou valor padrão.
 * 
 * @param {string} key - A chave física guardada no telemóvel (ex: 'cp_drivers')
 * @param {any} fallback - O valor padrão a devolver caso não exista nada guardado
 */
export function safeJSONParse(key, fallback) {
    try {
        const item = localStorage.getItem(key);
        if (item === null || item === undefined || item === "undefined") {
            return fallback;
        }
        return JSON.parse(item);
    } catch (e) {
        console.error(`Erro ao ler dados para a chave "${key}":`, e);
        return fallback;
    }
}

/**
 * Grava fisicamente no telemóvel todos os dados importantes da aplicação num único ciclo.
 */
export function saveData(drivers, intervals, assignments, partida, entregas, rota, dataRota, iniciada, zones = []) {
    localStorage.setItem('cp_drivers', JSON.stringify(drivers));
    localStorage.setItem('cp_intervals', JSON.stringify(intervals));
    localStorage.setItem('cp_assignments', JSON.stringify(assignments));
    
    // Gravação física do itinerário e planeamento das rotas
    localStorage.setItem('cp_partida', JSON.stringify(partida));
    localStorage.setItem('cp_entregas', JSON.stringify(entregas));
    localStorage.setItem('cp_rota_otimizada', JSON.stringify(rota));
    localStorage.setItem('cp_data_rota', JSON.stringify(dataRota));
    localStorage.setItem('cp_rota_iniciada', JSON.stringify(iniciada));

    // Gravação física das Zonas/Setores territoriais criados
    localStorage.setItem('cp_zones', JSON.stringify(zones));
}