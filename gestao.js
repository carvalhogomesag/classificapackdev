// gestao.js
import { saveData } from './storage.js';

/**
 * Renderiza a lista de motoristas cadastrados
 */
export function renderDrivers(drivers, listaMotoristas, deleteDriver) {
    if (!listaMotoristas) return;
    listaMotoristas.innerHTML = drivers.length === 0 ? '<p class="text-sm text-gray-400 italic text-center py-4">Nenhum motorista registado.</p>' : '';
    
    drivers.forEach(driver => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-gray-50 border rounded-lg text-xs animate-fade-in";
        div.innerHTML = `
            <div class="flex items-center space-x-3">
                <span class="w-4 h-4 rounded-full border shadow-sm" style="background-color: ${driver.color}"></span>
                <span class="font-semibold text-gray-700">${driver.name}</span>
            </div>
            <button class="text-red-500 hover:text-red-700 font-bold p-1"><i class="fa-solid fa-trash-can"></i></button>
        `;
        div.querySelector('button').onclick = () => deleteDriver(driver.id);
        listaMotoristas.appendChild(div);
    });
}

/**
 * Processa a submissão de cadastro de um novo motorista
 */
export function handleDriverSubmit(e, drivers, selectedColor, renderCallback) {
    e.preventDefault();
    const nomeInput = document.getElementById('nome-motorista');
    const nome = nomeInput.value.trim();
    if (!nome) return;

    drivers.push({ id: 'd_' + Date.now(), name: nome, color: selectedColor });
    saveData(
        drivers, 
        JSON.parse(localStorage.getItem('cp_intervals')) || [], 
        JSON.parse(localStorage.getItem('cp_assignments')) || [],
        JSON.parse(localStorage.getItem('cp_partida')) || null,
        JSON.parse(localStorage.getItem('cp_entregas')) || [],
        JSON.parse(localStorage.getItem('cp_rota_otimizada')) || [],
        JSON.parse(localStorage.getItem('cp_data_rota')) || "",
        JSON.parse(localStorage.getItem('cp_rota_iniciada')) || false
    );
    
    nomeInput.value = "";
    renderCallback();
    alert('Motorista registado!');
}

/**
 * Atualiza as opções de escolha de motoristas no formulário de intervalos
 */
export function updateMotoristaSelect(drivers, selectMotorista) {
    if (!selectMotorista) return;
    selectMotorista.innerHTML = `<option value="">Selecione um motorista...</option>`;
    drivers.forEach(driver => {
        const opt = document.createElement('option');
        opt.value = driver.id;
        opt.textContent = driver.name;
        selectMotorista.appendChild(opt);
    });
}

/**
 * Renderiza a lista de intervalos e suas regras de zonas
 */
export function renderIntervals(intervals, drivers, listaIntervalos, deleteInterval) {
    if (!listaIntervalos) return;
    listaIntervalos.innerHTML = intervals.length === 0 ? '<p class="text-sm text-gray-400 italic text-center py-4">Nenhum intervalo registado.</p>' : '';
    
    intervals.forEach(interval => {
        const driver = drivers.find(d => d.id === interval.driverId);
        const driverName = driver ? driver.name : "Removido";
        const driverColor = driver ? driver.color : "#9CA3AF";

        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-gray-50 border rounded-lg text-xs animate-fade-in";
        div.innerHTML = `
            <div class="flex-1 truncate pr-2">
                <div class="font-bold text-gray-800">${interval.start} <i class="fa-solid fa-arrow-right text-[10px] text-gray-400 px-1"></i> ${interval.end}</div>
                <div class="flex items-center space-x-1.5 mt-0.5 text-[10px] text-gray-500">
                    <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${driverColor}"></span>
                    <span>${driverName}</span>
                </div>
            </div>
            <button class="text-red-500 hover:text-red-700 p-1"><i class="fa-solid fa-trash-can"></i></button>
        `;
        div.querySelector('button').onclick = () => deleteInterval(interval.id);
        listaIntervalos.appendChild(div);
    });
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