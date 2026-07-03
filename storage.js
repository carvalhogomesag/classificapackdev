// storage.js
export function saveData(drivers, intervals, assignments, partida, entregas, rota, dataRota, iniciada) {
    localStorage.setItem('cp_drivers', JSON.stringify(drivers));
    localStorage.setItem('cp_intervals', JSON.stringify(intervals));
    localStorage.setItem('cp_assignments', JSON.stringify(assignments));
    
    // Gravação persistente do planeamento de rotas
    localStorage.setItem('cp_partida', JSON.stringify(partida));
    localStorage.setItem('cp_entregas', JSON.stringify(entregas));
    localStorage.setItem('cp_rota_otimizada', JSON.stringify(rota));
    localStorage.setItem('cp_data_rota', JSON.stringify(dataRota));
    localStorage.setItem('cp_rota_iniciada', JSON.stringify(iniciada));
}