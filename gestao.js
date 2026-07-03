// gestao.js
import { saveData } from './storage.js';

export function renderDrivers(drivers, listaMotoristas, deleteDriver) {
    listaMotoristas.innerHTML = drivers.length === 0 ? '<p class="text-center italic">Nenhum motorista.</p>' : '';
    drivers.forEach(driver => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-gray-50 border rounded-lg text-xs";
        div.innerHTML = `
            <div class="flex items-center space-x-2">
                <span class="w-4 h-4 rounded-full" style="background-color: ${driver.color}"></span>
                <span>${driver.name}</span>
            </div>
            <button class="text-red-500">X</button>
        `;
        div.querySelector('button').onclick = () => deleteDriver(driver.id);
        listaMotoristas.appendChild(div);
    });
}

export function handleDriverSubmit(e, drivers, selectedColor, renderCallback) {
    e.preventDefault();
    const nome = document.getElementById('nome-motorista').value;
    drivers.push({ id: 'd_' + Date.now(), name: nome, color: selectedColor });
    saveData(drivers, JSON.parse(localStorage.getItem('cp_intervals')), JSON.parse(localStorage.getItem('cp_assignments')));
    renderCallback();
}