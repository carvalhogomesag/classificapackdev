// gestao.js
import { saveData } from './storage.js';

/**
 * Renderiza a lista de motoristas cadastrados com a indicação da sua Zona
 */
export function renderDrivers(drivers, zones, listaMotoristas, deleteDriver) {
    if (!listaMotoristas) return;
    listaMotoristas.innerHTML = drivers.length === 0 ? '<p class="text-sm text-gray-400 italic text-center py-4">Nenhum motorista registado.</p>' : '';
    
    drivers.forEach(driver => {
        const zone = zones.find(z => z.id === driver.zoneId);
        const zoneName = zone ? zone.name : "Sem Zona associada";

        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-gray-50 border rounded-lg text-xs animate-fade-in";
        div.innerHTML = `
            <div class="flex-1 truncate pr-2">
                <div class="flex items-center space-x-3">
                    <span class="w-4 h-4 rounded-full border shadow-sm" style="background-color: ${driver.color}"></span>
                    <span class="font-semibold text-gray-700">${driver.name}</span>
                </div>
                <div class="text-[10px] text-gray-400 mt-1">
                    <i class="fa-solid fa-map-location-dot"></i> Zona: <span class="font-medium text-gray-600">${zoneName}</span>
                </div>
            </div>
            <button class="text-red-500 hover:text-red-700 font-bold p-1"><i class="fa-solid fa-trash-can"></i></button>
        `;
        div.querySelector('button').onclick = () => deleteDriver(driver.id);
        listaMotoristas.appendChild(div);
    });
}

/**
 * Processa a submissão de cadastro de um novo motorista associado a uma Zona
 */
export function handleDriverSubmit(e, drivers, selectedColor, renderCallback) {
    e.preventDefault();
    const nomeInput = document.getElementById('nome-motorista');
    const zonaSelect = document.getElementById('select-zona-motorista');
    
    const nome = nomeInput.value.trim();
    const zoneId = zonaSelect ? zonaSelect.value : "";
    
    if (!nome) return;
    if (!zoneId) {
        alert('Por favor, crie e selecione uma Zona para o motorista.');
        return;
    }

    drivers.push({ 
        id: 'd_' + Date.now(), 
        name: nome, 
        color: selectedColor,
        zoneId: zoneId 
    });

    saveData(
        drivers, 
        JSON.parse(localStorage.getItem('cp_intervals')) || [], 
        JSON.parse(localStorage.getItem('cp_assignments')) || [],
        JSON.parse(localStorage.getItem('cp_partida')) || null,
        JSON.parse(localStorage.getItem('cp_entregas')) || [],
        JSON.parse(localStorage.getItem('cp_rota_otimizada')) || [],
        JSON.parse(localStorage.getItem('cp_data_rota')) || "",
        JSON.parse(localStorage.getItem('cp_rota_iniciada')) || false,
        JSON.parse(localStorage.getItem('cp_zones')) || []
    );
    
    nomeInput.value = "";
    if (zonaSelect) zonaSelect.value = "";
    renderCallback();
    alert('Motorista registado!');
}

/**
 * Atualiza as opções de escolha de Zonas no formulário de motoristas
 */
export function updateZoneSelect(zones, selectZona) {
    if (!selectZona) return;
    selectZona.innerHTML = `<option value="">Selecione uma zona...</option>`;
    zones.forEach(zone => {
        const opt = document.createElement('option');
        opt.value = zone.id;
        opt.textContent = zone.name;
        selectZona.appendChild(opt);
    });
}

/**
 * Processa a submissão de cadastro de um novo Intervalo Nomeado
 */
export function handleIntervalSubmit(e, intervals, renderCallback) {
    e.preventDefault();
    const nomeInput = document.getElementById('int-nome');
    const inicioInput = document.getElementById('int-inicio');
    const fimInput = document.getElementById('int-fim');

    const name = nomeInput.value.trim();
    const start = inicioInput.value.trim();
    const end = fimInput.value.trim();

    if (!name || !start || !end) return;

    intervals.push({
        id: 'i_' + Date.now(),
        name: name,
        start: start,
        end: end
    });

    saveData(
        JSON.parse(localStorage.getItem('cp_drivers')) || [],
        intervals,
        JSON.parse(localStorage.getItem('cp_assignments')) || [],
        JSON.parse(localStorage.getItem('cp_partida')) || null,
        JSON.parse(localStorage.getItem('cp_entregas')) || [],
        JSON.parse(localStorage.getItem('cp_rota_otimizada')) || [],
        JSON.parse(localStorage.getItem('cp_data_rota')) || "",
        JSON.parse(localStorage.getItem('cp_rota_iniciada')) || false,
        JSON.parse(localStorage.getItem('cp_zones')) || []
    );

    nomeInput.value = "";
    inicioInput.value = "";
    fimInput.value = "";
    renderCallback();
    alert('Intervalo registado!');
}

/**
 * Renderiza a lista de intervalos individuais e a Zona a que pertencem
 */
export function renderIntervals(intervals, zones, listaIntervalos, deleteInterval) {
    if (!listaIntervalos) return;
    listaIntervalos.innerHTML = intervals.length === 0 ? '<p class="text-sm text-gray-400 italic text-center py-4">Nenhum intervalo registado.</p>' : '';
    
    intervals.forEach(interval => {
        const parentZone = zones.find(z => z.intervalIds && z.intervalIds.includes(interval.id));
        const zoneName = parentZone ? parentZone.name : "Não agrupado";

        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-gray-50 border rounded-lg text-xs animate-fade-in";
        div.innerHTML = `
            <div class="flex-1 truncate pr-2">
                <div class="font-bold text-gray-800 flex items-center justify-between">
                    <span>${interval.name}</span>
                    <span class="text-gray-400 font-mono text-[10px]">${interval.start} <i class="fa-solid fa-arrow-right text-[8px]"></i> ${interval.end}</span>
                </div>
                <div class="text-[10px] text-gray-400 mt-1">
                    <i class="fa-solid fa-folder-open"></i> Grupo/Zona: <span class="font-medium text-gray-600">${zoneName}</span>
                </div>
            </div>
            <button class="text-red-500 hover:text-red-700 p-1"><i class="fa-solid fa-trash-can"></i></button>
        `;
        div.querySelector('button').onclick = () => deleteInterval(interval.id);
        listaIntervalos.appendChild(div);
    });
}

/**
 * Processa a submissão de uma nova Zona (agrupador de intervalos)
 */
export function handleZoneSubmit(e, zones, renderCallback) {
    e.preventDefault();
    const nomeInput = document.getElementById('zona-nome');
    const checkboxesContainer = document.getElementById('checkboxes-intervalos');
    
    const name = nomeInput.value.trim();
    if (!name) return;

    const checkedBoxes = checkboxesContainer.querySelectorAll('input[type="checkbox"]:checked');
    const selectedIntervalIds = Array.from(checkedBoxes).map(cb => cb.value);

    if (selectedIntervalIds.length === 0) {
        alert('Por favor, selecione pelo menos um intervalo para compor a Zona.');
        return;
    }

    zones.push({
        id: 'z_' + Date.now(),
        name: name,
        intervalIds: selectedIntervalIds
    });

    saveData(
        JSON.parse(localStorage.getItem('cp_drivers')) || [],
        JSON.parse(localStorage.getItem('cp_intervals')) || [],
        JSON.parse(localStorage.getItem('cp_assignments')) || [],
        JSON.parse(localStorage.getItem('cp_partida')) || null,
        JSON.parse(localStorage.getItem('cp_entregas')) || [],
        JSON.parse(localStorage.getItem('cp_rota_otimizada')) || [],
        JSON.parse(localStorage.getItem('cp_data_rota')) || "",
        JSON.parse(localStorage.getItem('cp_rota_iniciada')) || false,
        zones
    );

    nomeInput.value = "";
    renderCallback();
    alert('Zona criada!');
}

/**
 * Renderiza a lista de Zonas criadas e mostra os intervalos agregados dentro de cada uma
 */
export function renderZones(zones, intervals, listaZonas, deleteZone) {
    if (!listaZonas) return;
    listaZonas.innerHTML = zones.length === 0 ? '<p class="text-sm text-gray-400 italic text-center py-4">Nenhuma zona registada.</p>' : '';

    zones.forEach(zone => {
        const subIntervalsHtml = zone.intervalIds
            .map(id => {
                const found = intervals.find(i => i.id === id);
                return found ? `<div>• ${found.name} <span class="font-mono text-[9px] text-gray-400">(${found.start} a ${found.end})</span></div>` : null;
            })
            .filter(Boolean)
            .join("");

        const div = document.createElement('div');
        div.className = "p-3 bg-gray-50 border rounded-lg text-xs animate-fade-in space-y-2";
        div.innerHTML = `
            <div class="flex items-center justify-between font-bold text-gray-800 border-b pb-1.5">
                <span class="text-sm"><i class="fa-solid fa-map-location-dot text-blue-500 mr-1"></i> ${zone.name}</span>
                <button class="text-red-500 hover:text-red-700 p-1"><i class="fa-solid fa-trash-can text-xs"></i></button>
            </div>
            <div class="text-[10px] text-gray-500 pl-4 space-y-0.5">
                ${subIntervalsHtml || '<div class="italic text-gray-400">Nenhum intervalo associado.</div>'}
            </div>
        `;
        div.querySelector('button').onclick = () => deleteZone(zone.id);
        listaZonas.appendChild(div);
    });
}

/**
 * Preenche a caixa de seleção de intervalos na área de criação de zonas
 */
export function renderIntervalCheckboxes(intervals, container) {
    if (!container) return;
    if (intervals.length === 0) {
        container.innerHTML = `<p class="text-xs text-gray-400 italic text-center py-2">Crie intervalos primeiro.</p>`;
        return;
    }

    container.innerHTML = "";
    intervals.forEach(interval => {
        const label = document.createElement('label');
        label.className = "flex items-center space-x-2 text-xs text-gray-700 cursor-pointer p-1 rounded hover:bg-gray-100";
        label.innerHTML = `
            <input type="checkbox" value="${interval.id}" class="rounded text-green-600 focus:ring-green-500 border-gray-300 w-4 h-4">
            <span class="truncate"><strong>${interval.name}</strong> (${interval.start} a ${interval.end})</span>
        `;
        container.appendChild(label);
    });
}

/**
 * Função de resolução de triagem: Determina o motorista a partir de um código postal
 */
export function findDriverForZip(zip, intervals, zones, drivers) {
    function zipToNumber(zipStr) {
        if (!zipStr) return 0;
        return parseInt(zipStr.replace(/[^0-9]/g, ""), 10);
    }

    const targetNum = zipToNumber(zip);
    if (isNaN(targetNum) || targetNum === 0) return null;

    // 1. Procurar o intervalo numérico onde o CP se enquadra
    const matchedInterval = intervals.find(interval => {
        const startNum = zipToNumber(interval.start);
        const endNum = zipToNumber(interval.end);
        return targetNum >= startNum && targetNum <= endNum;
    });

    if (!matchedInterval) return null;

    // 2. Encontrar a Zona que possui este ID de intervalo
    const matchedZone = zones.find(zone => zone.intervalIds && zone.intervalIds.includes(matchedInterval.id));
    if (!matchedZone) return null;

    // 3. Encontrar o motorista atribuído a essa Zona
    const matchedDriver = drivers.find(driver => driver.zoneId === matchedZone.id);
    return matchedDriver || null; 
}

/**
 * Renderiza o resumo de leituras diárias de triagem
 */
export function renderSummary(assignments, drivers, painelResumo) {
    if (!painelResumo) return;
    painelResumo.innerHTML = "";

    const totalLeituras = assignments.length;
    const totalPrioritarios = assignments.filter(a => a.priority === true).length; 

    const headerDiv = document.createElement('div');
    headerDiv.className = "flex justify-between items-center pb-2 border-b text-sm font-semibold text-gray-700";
    headerDiv.innerHTML = `
        <span>Total Processado:</span>
        <div class="flex items-center space-x-1.5">
            <span class="bg-blue-600 text-white px-2.5 py-0.5 rounded-full text-xs font-bold" title="Total de encomendas">${totalLeituras} un</span>
            ${totalPrioritarios > 0 ? `<span class="bg-orange-500 text-white px-2.5 py-0.5 rounded-full text-xs font-bold flex items-center space-x-1" title="Prioritárias"><i class="fa-solid fa-circle-exclamation"></i> <span>${totalPrioritarios}</span></span>` : ''}
        </div>
    `;
    painelResumo.appendChild(headerDiv);

    if (drivers.length === 0) {
        painelResumo.innerHTML += `<p class="text-xs text-gray-400 italic text-center py-2">Registe motoristas para ver o resumo.</p>`;
        return;
    }

    drivers.forEach(driver => {
        const totalDriver = assignments.filter(a => a.driverId === driver.id).length;
        const totalPrioritariosDriver = assignments.filter(a => a.driverId === driver.id && a.priority === true).length;
        const percent = totalLeituras > 0 ? Math.round((totalDriver / totalLeituras) * 100) : 0;

        const row = document.createElement('div');
        row.className = "flex items-center justify-between text-xs py-1";
        row.innerHTML = `
            <div class="flex items-center space-x-2">
                <span class="w-3.5 h-3.5 rounded-full" style="background-color: ${driver.color}"></span>
                <span class="font-medium text-gray-700">${driver.name}</span>
            </div>
            <div class="flex items-center space-x-2 font-bold text-gray-900">
                <span>${totalDriver} un</span>
                ${totalPrioritariosDriver > 0 ? `<span class="bg-orange-100 text-orange-700 text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center space-x-0.5" title="Prioritários"><i class="fa-solid fa-circle-exclamation text-[8px]"></i> <span>${totalPrioritariosDriver}</span></span>` : ''}
                <span class="text-gray-400 text-[10px] font-normal">(${percent}%)</span>
            </div>
        `;
        painelResumo.appendChild(row);
    });

    const totalSemMotorista = assignments.filter(a => a.driverId === null).length;
    const totalSemMotoristaPrioridade = assignments.filter(a => a.driverId === null && a.priority === true).length;
    
    if (totalSemMotorista > 0) {
        const percentSem = Math.round((totalSemMotorista / totalLeituras) * 100);
        const rowSem = document.createElement('div');
        rowSem.className = "flex items-center justify-between text-xs py-1 border-t border-dashed mt-1 pt-1";
        rowSem.innerHTML = `
            <div class="flex items-center space-x-2 text-gray-500">
                <span class="w-3.5 h-3.5 rounded-full bg-gray-400"></span>
                <span class="font-medium italic">Sem Motorista</span>
            </div>
            <div class="flex items-center space-x-2 font-bold text-red-600">
                <span>${totalSemMotorista} un</span>
                ${totalSemMotoristaPrioridade > 0 ? `<span class="bg-orange-100 text-orange-700 text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center space-x-0.5"><i class="fa-solid fa-circle-exclamation text-[8px]"></i> <span>${totalSemMotoristaPrioridade}</span></span>` : ''}
                <span class="text-gray-400 text-[10px] font-normal">(${percentSem}%)</span>
            </div>
        `;
        painelResumo.appendChild(rowSem);
    }
}