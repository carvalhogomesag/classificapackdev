/**
 * motoristas.js
 * Faz: Gere o registo, edição, eliminação, listagem e coloração dos motoristas ativos, bem como a associação exclusiva aos setores.
 * NÃO faz: Não cria setores geográficos (setores.js) nem processa algoritmos de voz ou triagem (triagem.js).
 * Depende de: ./storage.js
 */

import { saveData } from './storage.js';

// =========================================================================
// FUNÇÃO INTERNA AUXILIAR DE PERSISTÊNCIA
// =========================================================================
function sincronizarPersistencia() {
    saveData(
        window.drivers, 
        [], // intervals obsoletos
        window.assignments,
        window.partidaLocalizacao,
        window.moradasEntregas,
        window.rotaOtimizada,
        window.dataRotaSelecionada, 
        window.rotaIniciada,
        window.sectors
    );
}

// =========================================================================
// RENDERIZAÇÃO DA LISTA DE MOTORISTAS ATIVOS
// =========================================================================
export function renderDrivers(drivers, sectors, listaMotoristas, deleteDriver, editDriver) {
    if (!listaMotoristas) return;
    listaMotoristas.innerHTML = drivers.length === 0 
        ? '<p class="text-sm text-gray-400 italic text-center py-4">Nenhum motorista registado.</p>' 
        : '';
    
    drivers.forEach(driver => {
        const driverSectorIds = Array.isArray(driver.sectorIds) ? driver.sectorIds : [];
        const sectorNames = driverSectorIds
            .map(sid => sectors.find(s => s.id === sid))
            .filter(Boolean)
            .map(s => s.name);

        const sectorBadgesHtml = sectorNames.length > 0
            ? sectorNames.map(name => `<span class="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100 text-[9px] font-bold">${name}</span>`).join('')
            : '<span class="italic text-gray-400 text-[10px]">Sem Setor associado</span>';

        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-gray-50 border rounded-lg text-xs animate-fade-in";
        div.innerHTML = `
            <div class="flex-1 truncate pr-2">
                <div class="flex items-center space-x-3">
                    <span class="w-4 h-4 rounded-full border shadow-sm" style="background-color: ${driver.color}"></span>
                    <span class="font-semibold text-gray-700">${driver.name}</span>
                </div>
                <div class="text-[10px] text-gray-400 mt-1.5 flex items-center flex-wrap gap-1">
                    <i class="fa-solid fa-map-location-dot mr-0.5"></i> ${sectorBadgesHtml}
                </div>
            </div>
            <div class="flex items-center space-x-1 flex-shrink-0">
                <button class="btn-edit-motorista text-blue-500 hover:text-blue-700 font-bold p-1.5"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-del-motorista text-red-500 hover:text-red-700 font-bold p-1.5"><i class="fa-solid fa-trash-can"></i></button>
            </div>
        `;
        div.querySelector('.btn-edit-motorista').onclick = () => editDriver(driver);
        div.querySelector('.btn-del-motorista').onclick = () => deleteDriver(driver.id);
        listaMotoristas.appendChild(div);
    });
}

// =========================================================================
// SUBMISSÃO E EDIÇÃO DE MOTORISTA
// =========================================================================
export function handleDriverSubmit(e, drivers, selectedColor, renderCallback) {
    e.preventDefault();
    const nomeInput = document.getElementById('nome-motorista');
    const checkboxesContainer = document.getElementById('checkboxes-setores-motorista');
    const btnSubmit = document.getElementById('btn-submit-motorista');
    const btnCancelar = document.getElementById('btn-cancelar-motorista');
    
    const nome = nomeInput.value.trim();
    if (!nome) return;

    const checkedBoxes = checkboxesContainer ? checkboxesContainer.querySelectorAll('input[type="checkbox"]:checked') : [];
    const sectorIds = Array.from(checkedBoxes).map(cb => cb.value);

    if (sectorIds.length === 0) {
        alert('Por favor, selecione pelo menos um Setor para o motorista.');
        return;
    }

    const emEdicao = window.driverSendoEditado;

    // Validação de Segurança: Garante que nenhum dos setores já esteja em uso por outro motorista ativo
    const setorDuplicado = sectorIds.find(sid =>
        drivers.some(d => Array.isArray(d.sectorIds) && d.sectorIds.includes(sid) && (!emEdicao || d.id !== emEdicao.id))
    );

    if (setorDuplicado) {
        alert('Erro de Segurança: um dos setores selecionados já está atribuído a outro motorista.');
        return;
    }

    if (emEdicao) {
        const driverIndex = drivers.findIndex(d => d.id === emEdicao.id);
        if (driverIndex !== -1) {
            drivers[driverIndex].name = nome;
            drivers[driverIndex].color = selectedColor;
            drivers[driverIndex].sectorIds = sectorIds;
        }
        window.driverSendoEditado = null;
    } else {
        drivers.push({ 
            id: 'd_' + Date.now(), 
            name: nome, 
            color: selectedColor,
            sectorIds: sectorIds 
        });
    }

    sincronizarPersistencia();
    
    nomeInput.value = "";
    if (btnSubmit) btnSubmit.textContent = "Adicionar Motorista";
    if (btnCancelar) btnCancelar.classList.add('hidden');

    renderCallback();
    alert(emEdicao ? 'Motorista atualizado com sucesso!' : 'Motorista registado com sucesso!');
}

// =========================================================================
// SELEÇÃO DE SETORES LIVRES NAS CHECKBOXES DO MOTORISTA
// =========================================================================
export function renderSectorCheckboxes(sectors, container, drivers = [], editingDriverId = null) {
    if (!container) return;
    container.innerHTML = "";

    if (sectors.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-400 italic text-center py-2">Nenhum setor registado. Crie um setor primeiro.</p>';
        return;
    }

    sectors.forEach(sector => {
        const driverOwner = drivers.find(d => Array.isArray(d.sectorIds) && d.sectorIds.includes(sector.id) && d.id !== editingDriverId);
        const belongsToEditingDriver = !!(editingDriverId && drivers.some(d => d.id === editingDriverId && Array.isArray(d.sectorIds) && d.sectorIds.includes(sector.id)));

        const label = document.createElement('label');

        if (driverOwner) {
            label.className = "flex items-center justify-between p-2 rounded bg-gray-100/50 text-gray-400 cursor-not-allowed select-none";
            label.innerHTML = `
                <div class="flex items-center space-x-2">
                    <input type="checkbox" disabled class="rounded text-gray-300 border-gray-200 w-4 h-4 cursor-not-allowed">
                    <span class="font-bold text-gray-400 line-through text-xs">${sector.name}</span>
                </div>
                <span class="text-[9px] bg-gray-100 text-gray-500 font-bold px-1.5 py-0.5 rounded border">
                    Com: ${driverOwner.name}
                </span>
            `;
        } else {
            label.className = "flex items-center justify-between p-2 rounded hover:bg-gray-100 cursor-pointer text-xs";
            label.innerHTML = `
                <div class="flex items-center space-x-2 text-gray-700">
                    <input type="checkbox" value="${sector.id}" ${belongsToEditingDriver ? 'checked' : ''} class="rounded text-blue-600 focus:ring-blue-500 border-gray-300 w-4 h-4 cursor-pointer">
                    <span class="font-bold">${sector.name}</span>
                </div>
                <span class="text-[9px] bg-green-50 text-green-700 font-bold px-1.5 py-0.5 rounded border border-green-200">
                    Livre
                </span>
            `;
        }
        container.appendChild(label);
    });
}

// =========================================================================
// ASSINATURAS GLOBAIS (WINDOW) PARA COMPATIBILIDADE INTEGRAL COM EVENTOS
// =========================================================================
window.editDriver = (driver) => {
    window.driverSendoEditado = driver;

    const nomeInput = document.getElementById('nome-motorista');
    const btnSubmit = document.getElementById('btn-submit-motorista');
    const btnCancelar = document.getElementById('btn-cancelar-motorista');

    if (nomeInput) nomeInput.value = driver.name;
    if (btnSubmit) btnSubmit.textContent = "Guardar Alterações";
    if (btnCancelar) btnCancelar.classList.remove('hidden');

    // Sincroniza a cor na palete de seleção visual
    window.selectedColor = driver.color;
    const colorPickerContainer = document.getElementById('color-picker-container');
    if (colorPickerContainer) {
        Array.from(colorPickerContainer.children).forEach(btn => {
            if (btn.style.backgroundColor === driver.color || btn.style.backgroundColor.replace(/\s/g, "") === driver.color.toLowerCase()) {
                btn.classList.add('border-black', 'scale-110');
            } else {
                btn.classList.remove('border-black', 'scale-110');
            }
        });
    }

    if (typeof window.renderizarSetoresUI === 'function') {
        window.renderizarSetoresUI();
    }
};

window.cancelarEdicaoDriver = () => {
    window.driverSendoEditado = null;

    const nomeInput = document.getElementById('nome-motorista');
    const btnSubmit = document.getElementById('btn-submit-motorista');
    const btnCancelar = document.getElementById('btn-cancelar-motorista');

    if (nomeInput) nomeInput.value = "";
    if (btnSubmit) btnSubmit.textContent = "Adicionar Motorista";
    if (btnCancelar) btnCancelar.classList.add('hidden');

    if (typeof window.renderizarSetoresUI === 'function') {
        window.renderizarSetoresUI();
    }
};

window.deleteDriver = (id) => {
    if (confirm("Ao apagar este motorista, as suas contagens de pacotes também serão removidas. Confirmar?")) {
        window.drivers = window.drivers.filter(d => d.id !== id);
        window.assignments = window.assignments.filter(a => a.driverId !== id); 
        sincronizarPersistencia();
        
        const listaMotoristas = document.getElementById('lista-motoristas');
        if (listaMotoristas) {
            renderDrivers(window.drivers, window.sectors, listaMotoristas, window.deleteDriver, window.editDriver);
        }
        
        if (typeof window.renderizarSetoresUI === 'function') {
            window.renderizarSetoresUI();
        }
        if (typeof window.atualizarSummaryUI === 'function') {
            window.atualizarSummaryUI();
        }
    }
};