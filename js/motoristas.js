/**
 * motoristas.js
 * Faz: Gere o registo, edição, eliminação, listagem e coloração dos motoristas ativos, integrando diretamente as gravações no Cloud Firestore.
 * NÃO faz: Não gere a atribuição geográfica direta de Bricks (atribuídos no painel de Bricks).
 * Depende de: ./firebase-init.js (para aceder ao banco de dados Firestore db)
 */

import { db } from './firebase-init.js';

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
// SUBMISSÃO E EDIÇÃO DE MOTORISTA (GRAVAÇÃO DIRETA NO FIRESTORE!)
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
        // Atualiza o motorista no Firestore
        db.collection('drivers').doc(emEdicao.id).update({
            name: nome,
            color: selectedColor
        }).then(() => {
            console.log("[FIREBASE] Motorista atualizado com sucesso no Firestore.");
        }).catch((err) => {
            console.error("[FIREBASE] Erro ao atualizar motorista:", err);
            alert("Erro de ligação: Não foi possível atualizar o motorista.");
        });
        window.driverSendoEditado = null;
    } else {
        // Insere o novo motorista no Firestore
        const newId = 'd_' + Date.now();
        db.collection('drivers').doc(newId).set({ 
            id: newId, 
            name: nome, 
            color: selectedColor,
            brickIds: [] // Inicia uma lista de Bricks vazia para nova atribuição
        }).then(() => {
            console.log("[FIREBASE] Novo motorista inserido com sucesso no Firestore.");
        }).catch((err) => {
            console.error("[FIREBASE] Erro ao inserir motorista:", err);
            alert("Erro de ligação: Não foi possível registar o motorista.");
        });
    }
    
    nomeInput.value = "";
    if (btnSubmit) btnSubmit.textContent = "Adicionar Motorista";
    if (btnCancelar) btnCancelar.classList.add('hidden');

    renderCallback();
}

// ==========================================
// REGISTO DA ASSINATURA DA JANELA TÁTIL
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
        // Elimina o motorista do Firestore de forma síncrona
        db.collection('drivers').doc(id).delete()
            .then(() => {
                console.log("[FIREBASE] Motorista eliminado no Firestore.");
            })
            .catch((err) => {
                console.error("[FIREBASE] Erro ao eliminar motorista:", err);
                alert("Erro de ligação: Não foi possível apagar o motorista.");
            });
    }
};