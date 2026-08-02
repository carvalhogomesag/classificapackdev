/**
 * motoristas.js
 * Faz: Gere o registo, edição, eliminação, listagem e coloração dos motoristas ativos, integrando diretamente as gravações no Cloud Firestore.
 *      NOVO: Suporta múltiplos concelhos de atuação (concelhos: ["MAFRA", "SINTRA"]) por motorista e filtragem reativa no ecrã.
 * NÃO faz: Não gere a atribuição geográfica direta de Bricks (atribuídos no painel de Bricks).
 * Depende de: ./firebase-init.js (para aceder ao banco de dados Firestore db)
 */

import { db } from './firebase-init.js';

// Concelho que está atualmente selecionado no filtro do ecrã de motoristas ("MAFRA" ou "SINTRA")
let concelhoMotoristasAtivo = "MAFRA";

// =========================================================================
// RENDERIZAÇÃO DA LISTA DE MOTORISTAS ATIVOS
// =========================================================================
export function renderDrivers(drivers, sectors, listaMotoristas, deleteDriver, editDriver) {
    if (!listaMotoristas) return;
    listaMotoristas.innerHTML = drivers.length === 0 
        ? '<p class="text-sm text-gray-400 italic text-center py-4">Nenhum motorista registado para este concelho.</p>' 
        : '';
    
    drivers.forEach(driver => {
        const brickCount = Array.isArray(driver.brickIds) ? driver.brickIds.length : 0;
        const concelhosArr = Array.isArray(driver.concelhos) ? driver.concelhos : ["MAFRA"];

        // Criar emblemas (badges) visuais de concelho
        const badgesHtml = concelhosArr.map(c => {
            if (c === "SINTRA") {
                return `<span class="text-[8px] bg-amber-50 text-amber-700 font-extrabold px-1.5 py-0.5 rounded border border-amber-200">Sintra</span>`;
            }
            return `<span class="text-[8px] bg-blue-50 text-blue-700 font-extrabold px-1.5 py-0.5 rounded border border-blue-200">Mafra</span>`;
        }).join(" ");

        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-gray-50 border rounded-lg text-xs animate-fade-in";
        div.innerHTML = `
            <div class="flex-1 truncate pr-2">
                <div class="flex items-center space-x-3">
                    <span class="w-4 h-4 rounded-full border shadow-sm flex-shrink-0" style="background-color: ${driver.color}"></span>
                    <span class="font-semibold text-gray-700 text-sm truncate">${driver.name}</span>
                    <div class="flex items-center space-x-1">${badgesHtml}</div>
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
    
    const nome = nomeInput.value.trim();
    if (!nome) return;

    // Recolhe os concelhos assinalados no formulário
    const concelhos = [];
    if (document.getElementById('concelho-mafra')?.checked) concelhos.push("MAFRA");
    if (document.getElementById('concelho-sintra')?.checked) concelhos.push("SINTRA");

    if (concelhos.length === 0) {
        alert("Aviso: Por favor, selecione pelo menos um concelho de atuação para o motorista.");
        return;
    }

    const emEdicao = window.driverSendoEditado;

    if (emEdicao) {
        // Atualiza o motorista no Firestore
        db.collection('drivers').doc(emEdicao.id).update({
            name: nome,
            color: selectedColor,
            concelhos: concelhos
        }).then(() => {
            console.log("[FIREBASE] Motorista atualizado com sucesso no Firestore.");
            window.cancelarEdicaoDriver();
            renderCallback();
        }).catch((err) => {
            console.error("[FIREBASE] Erro ao atualizar motorista:", err);
            alert("Erro de ligação: Não foi possível atualizar o motorista.");
        });
    } else {
        // Insere o novo motorista no Firestore
        const newId = 'd_' + Date.now();
        db.collection('drivers').doc(newId).set({ 
            id: newId, 
            name: nome, 
            color: selectedColor,
            brickIds: [], // Inicia uma lista de Bricks vazia para nova atribuição
            concelhos: concelhos
        }).then(() => {
            console.log("[FIREBASE] Novo motorista inserido com sucesso no Firestore.");
            window.cancelarEdicaoDriver();
            renderCallback();
        }).catch((err) => {
            console.error("[FIREBASE] Erro ao inserir motorista:", err);
            alert("Erro de ligação: Não foi possível registar o motorista.");
        });
    }
}

// ==========================================
// REGISTO DA ASSINATURA DA JANELA TÁTIL
// ==========================================
window.renderizarMotoristasUI = () => {
    // Configura o seletor de concelho ativo da gestão de motoristas
    const seletor = document.getElementById('select-concelho-motoristas');
    if (seletor) {
        seletor.value = concelhoMotoristasAtivo;
        if (!seletor.dataset.listenerAtivo) {
            seletor.addEventListener('change', (e) => {
                concelhoMotoristasAtivo = e.target.value;
                window.renderizarMotoristasUI();
            });
            seletor.dataset.listenerAtivo = "true";
        }
    }

    const listaMotoristas = document.getElementById('lista-motoristas');
    if (listaMotoristas) {
        // Filtra os motoristas ativos com base no concelho selecionado no topo do painel
        const filteredDrivers = window.drivers.filter(driver => {
            const concelhos = Array.isArray(driver.concelhos) ? driver.concelhos : ["MAFRA"];
            return concelhos.includes(concelhoMotoristasAtivo);
        });

        renderDrivers(filteredDrivers, [], listaMotoristas, window.deleteDriver, window.editDriver);
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

    // Sincroniza os concelhos de atuação do motorista nas checkboxes
    const mafraCheck = document.getElementById('concelho-mafra');
    const sintraCheck = document.getElementById('concelho-sintra');
    const concelhos = Array.isArray(driver.concelhos) ? driver.concelhos : ["MAFRA"];

    if (mafraCheck) mafraCheck.checked = concelhos.includes("MAFRA");
    if (sintraCheck) sintraCheck.checked = concelhos.includes("SINTRA");

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

    // Repoem o estado padrão das checkboxes do formulário
    const mafraCheck = document.getElementById('concelho-mafra');
    const sintraCheck = document.getElementById('concelho-sintra');
    if (mafraCheck) mafraCheck.checked = true;
    if (sintraCheck) sintraCheck.checked = false;
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