/**
 * motoristas.js
 * Faz: Gere o registo, edição, eliminação, listagem e coloração dos motoristas ativos, adaptando para a contagem direta de Bricks associados.
 * NÃO faz: Não gere a atribuição geográfica direta de Bricks (atribuídos no painel de Bricks).
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
        window.rotaIniciada
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
        const brickCount = Array.isArray(driver.brickIds) ? driver.brickIds.length : 0;

        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-gray-50 border rounded-lg text-xs animate-fade-in";
        div.innerHTML = `
            <div class="flex-1 truncate pr-2">
                <div class="flex items-center space-x-3">
                    <span class="w-4 h-4 rounded-full border shadow-sm flex-shrink-0" style="background-color: ${driver.color}"></span>
                    <span class="font-semibold text-gray-700 text-sm">${driver.name}</span>
                </div>
                <div class="text-[10px] text-gray-400 mt-1.5 flex items-center flex-wrap gap-1">
                    <i class="fa-solid fa-boxes-stacked mr-0.5"></i>
                    <span class="font-bold text-blue-600">${brickCount} Localidades (Bricks)</span> associadas
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
    const btnSubmit = document.getElementById('btn-submit-motorista');
    const btnCancelar = document.getElementById('btn-cancelar-motorista');
    
    const nome = nomeInput.value.trim();
    if (!nome) return;

    const emEdicao = window.driverSendoEditado;

    if (emEdicao) {
        const driverIndex = drivers.findIndex(d => d.id === emEdicao.id);
        if (driverIndex !== -1) {
            drivers[driverIndex].name = nome;
            drivers[driverIndex].color = selectedColor;
        }
        window.driverSendoEditado = null;
    } else {
        drivers.push({ 
            id: 'd_' + Date.now(), 
            name: nome, 
            color: selectedColor,
            brickIds: [] // Inicia uma lista de Bricks vazia para nova atribuição
        });
    }

    sincronizarPersistencia();
    
    nomeInput.value = "";
    if (btnSubmit) btnSubmit.textContent = "Adicionar Motorista";
    if (btnCancelar) btnCancelar.classList.add('hidden');

    renderCallback();
    alert(emEdicao ? 'Motorista atualizado com sucesso!' : 'Motorista registado com sucesso!');
}

// ==========================================
// REGISTO DA ASSINATURA DA JANELA TÁTIL (NOVO)
// ==========================================
window.renderizarMotoristasUI = () => {
    const listaMotoristas = document.getElementById('lista-motoristas');
    if (listaMotoristas) {
        renderDrivers(window.drivers, [], listaMotoristas, window.deleteDriver, window.editDriver);
    }
};

// ==========================================
// FUNÇÃO DESATIVADA COM A SIMPLIFICAÇÃO DOS SETORES
// ==========================================
export function renderSectorCheckboxes() {
    // Mantido apenas assinatura de compatibilidade para evitar quebras em main.js
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
};

window.cancelarEdicaoDriver = () => {
    window.driverSendoEditado = null;

    const nomeInput = document.getElementById('nome-motorista');
    const btnSubmit = document.getElementById('btn-submit-motorista');
    const btnCancelar = document.getElementById('btn-cancelar-motorista');

    if (nomeInput) nomeInput.value = "";
    if (btnSubmit) btnSubmit.textContent = "Adicionar Motorista";
    if (btnCancelar) btnCancelar.classList.add('hidden');
};

window.deleteDriver = (id) => {
    if (confirm("Ao apagar este motorista, as suas contagens de pacotes também serão removidas. Confirmar?")) {
        window.drivers = window.drivers.filter(d => d.id !== id);
        window.assignments = window.assignments.filter(a => a.driverId !== id); 
        sincronizarPersistencia();
        
        if (typeof window.renderizarMotoristasUI === 'function') {
            window.renderizarMotoristasUI();
        }
        if (typeof window.renderizarSetoresUI === 'function') {
            window.renderizarSetoresUI();
        }
        if (typeof window.atualizarSummaryUI === 'function') {
            window.atualizarSummaryUI();
        }
    }
};