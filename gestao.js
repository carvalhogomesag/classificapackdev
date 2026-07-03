// gestao.js
import { saveData } from './storage.js';

export function renderDrivers(drivers, listaMotoristas, deleteDriver) {
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

export function handleDriverSubmit(e, drivers, selectedColor, renderCallback) {
    e.preventDefault();
    const nomeInput = document.getElementById('nome-motorista');
    const nome = nomeInput.value.trim();
    if (!nome) return;

    drivers.push({ id: 'd_' + Date.now(), name: nome, color: selectedColor });
    saveData(drivers, JSON.parse(localStorage.getItem('cp_intervals')) || [], JSON.parse(localStorage.getItem('cp_assignments')) || []);
    
    nomeInput.value = "";
    renderCallback();
    alert('Motorista registado!');
}

export function updateMotoristaSelect(drivers, selectMotorista) {
    selectMotorista.innerHTML = `<option value="">Selecione um motorista...</option>`;
    drivers.forEach(driver => {
        const opt = document.createElement('option');
        opt.value = driver.id;
        opt.textContent = driver.name;
        selectMotorista.appendChild(opt);
    });
}

export function renderIntervals(intervals, drivers, listaIntervalos, deleteInterval) {
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