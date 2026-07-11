/**
 * setores.js
 * Faz: Desenha e gere os setores geográficos ativos, renderiza a árvore hierárquica interativa de Mafra e garante a exclusividade de cada localidade.
 * NÃO faz: Não gere o registo de motoristas (motoristas.js) nem as coordenadas geográficas dos mapas das rotas (maps.js).
 * Depende de: ./geografia-data.js, ./storage.js, ./motoristas.js
 */

import { GEOGRAPHY } from './geografia-data.js';
import { saveData } from './storage.js';
import { renderDrivers, renderSectorCheckboxes } from './motoristas.js';

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
// RENDERIZAÇÃO DA LISTA DE SETORES ATIVOS
// =========================================================================
export function renderSectors(sectors, listaSetores, deleteSector, editSector) {
    if (!listaSetores) return;
    listaSetores.innerHTML = sectors.length === 0 
        ? '<p class="text-sm text-gray-400 italic text-center py-4">Nenhum sector registado.</p>' 
        : '';

    sectors.forEach(sector => {
        const subAreasHtml = sector.areaNames
            .map(item => {
                if (item.includes('|')) {
                    const [freg, loc] = item.split('|');
                    return `<div class="bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded border border-blue-100 text-[10px] font-bold shadow-sm flex items-center space-x-1"><i class="fa-solid fa-map-pin mr-0.5 text-blue-400"></i> <span>${freg} - ${loc}</span></div>`;
                } else {
                    return `<div class="bg-green-50 text-green-700 px-2.5 py-0.5 rounded border border-green-100 text-[10px] font-bold shadow-sm flex items-center space-x-1"><i class="fa-solid fa-map mr-0.5 text-green-400"></i> <span>${item} (Totalidade)</span></div>`;
                }
            })
            .join("");

        const div = document.createElement('div');
        div.className = "p-3 bg-gray-50 border rounded-lg text-xs animate-fade-in space-y-2";
        div.innerHTML = `
            <div class="flex items-center justify-between font-bold text-gray-800 border-b pb-1.5">
                <span class="text-sm"><i class="fa-solid fa-map-location-dot text-blue-500 mr-1"></i> ${sector.name}</span>
                <div class="flex items-center space-x-2">
                    <button class="btn-edit-setor text-blue-500 hover:text-blue-700 p-1"><i class="fa-solid fa-pen text-xs"></i></button>
                    <button class="btn-del-setor text-red-500 hover:text-red-700 p-1"><i class="fa-solid fa-trash-can text-xs"></i></button>
                </div>
            </div>
            <div class="flex flex-wrap gap-1 pt-1">
                ${subAreasHtml || '<div class="italic text-gray-400">Nenhum território atribuído.</div>'}
            </div>
        `;
        div.querySelector('.btn-edit-setor').onclick = () => editSector(sector);
        div.querySelector('.btn-del-setor').onclick = () => deleteSector(sector.id);
        listaSetores.appendChild(div);
    });
}

// =========================================================================
// SUBMISSÃO E EDIÇÃO DE SETOR
// =========================================================================
export function handleSectorSubmit(e, sectors, renderCallback) {
    e.preventDefault();
    const nomeInput = document.getElementById('setor-nome');
    const checkboxesContainer = document.getElementById('checkboxes-areas');
    const btnSubmit = document.getElementById('btn-submit-setor');
    const btnCancelar = document.getElementById('btn-cancelar-setor');
    
    const name = nomeInput.value.trim();
    if (!name) return;

    // Obtém todas as seleções feitas (freguesias ou localidades)
    const checkedBoxes = checkboxesContainer.querySelectorAll('input[type="checkbox"]:checked');
    const selectedAreas = Array.from(checkedBoxes).map(cb => cb.value);

    if (selectedAreas.length === 0) {
        alert('Por favor, selecione pelo menos uma área geográfica para compor o Setor.');
        return;
    }

    const emEdicao = window.sectorSendoEditado;

    // Validação de redundância para garantir que a área não pertence a outro setor
    const areaDuplicada = selectedAreas.find(area => 
        sectors.some(s => s.areaNames && s.areaNames.includes(area) && (!emEdicao || s.id !== emEdicao.id))
    );

    if (areaDuplicada) {
        alert(`Erro de Segurança: A área geográfica ou sub-localidade "${areaDuplicada}" já está sob a alçada de outro setor ativo.`);
        return;
    }

    if (emEdicao) {
        const sectorIndex = sectors.findIndex(s => s.id === emEdicao.id);
        if (sectorIndex !== -1) {
            sectors[sectorIndex].name = name;
            sectors[sectorIndex].areaNames = selectedAreas;
        }
        window.sectorSendoEditado = null;
    } else {
        sectors.push({
            id: 's_' + Date.now(),
            name: name,
            areaNames: selectedAreas
        });
    }

    sincronizarPersistencia();

    nomeInput.value = "";
    if (btnSubmit) btnSubmit.textContent = "Criar Setor";
    if (btnCancelar) btnCancelar.classList.add('hidden');

    renderCallback();
    alert(emEdicao ? 'Setor atualizado com sucesso!' : 'Setor criado com sucesso!');
}

// =========================================================================
// DESENHO DA ÁRVORE HIERÁRQUICA DE MAFRA (CONCELHO -> FREGUESIA -> LOCALIDADE)
// =========================================================================
export function renderAreaCheckboxes(sectors, container, editingId = null) {
    if (!container) return;
    container.innerHTML = "";

    const concelho = "MAFRA";
    const freguesiasList = Object.keys(GEOGRAPHY[concelho]).sort();

    const freguesiasOcupadasTotalidade = new Set();
    const localidadesOcupadas = new Map();

    sectors.forEach(s => {
        if (editingId && s.id === editingId) return;
        
        const areaNames = Array.isArray(s.areaNames) ? s.areaNames : [];
        areaNames.forEach(item => {
            if (item.includes('|')) {
                const [freg, loc] = item.split('|');
                localidadesOcupadas.set(item, s.name);
            } else {
                freguesiasOcupadasTotalidade.add(item);
                const subLocalidades = Object.keys(GEOGRAPHY[concelho][item] || {});
                subLocalidades.forEach(loc => {
                    localidadesOcupadas.set(`${item}|${loc}`, s.name);
                });
            }
        });
    });

    const concelhoTitle = document.createElement('div');
    concelhoTitle.className = "text-xs font-black uppercase tracking-wider text-blue-800 bg-blue-50 p-2 rounded mb-2 flex items-center space-x-1.5";
    concelhoTitle.innerHTML = `<i class="fa-solid fa-city"></i> <span>CONCELHO: ${concelho}</span>`;
    container.appendChild(concelhoTitle);

    const treeContainer = document.createElement('div');
    treeContainer.className = "space-y-3 pl-1";

    freguesiasList.forEach(freguesiaName => {
        const localidades = GEOGRAPHY[concelho][freguesiaName];
        const subLocalidadesKeys = Object.keys(localidades).sort();

        const freguesiaBloqueadaTotalmente = freguesiasOcupadasTotalidade.has(freguesiaName);
        const temSubLocalidadeOcupada = subLocalidadesKeys.some(loc => localidadesOcupadas.has(`${freguesiaName}|${loc}`));
        const impedeMarcarTotalidade = freguesiaBloqueadaTotalmente || temSubLocalidadeOcupada;

        const belongsToEditingSectorTotal = !!(editingId && sectors.some(s => s.id === editingId && s.areaNames && s.areaNames.includes(freguesiaName)));

        const fregDiv = document.createElement('div');
        fregDiv.className = "border rounded-lg bg-white overflow-hidden shadow-xs border-gray-200";

        const header = document.createElement('div');
        header.className = "flex items-center justify-between p-2.5 bg-gray-50 border-b select-none";
        
        let checkboxHtml = "";
        if (impedeMarcarTotalidade) {
            checkboxHtml = `
                <input type="checkbox" disabled class="rounded text-gray-300 border-gray-200 w-4 h-4 cursor-not-allowed">
                <span class="font-bold text-gray-400 line-through text-xs">${freguesiaName}</span>
                <span class="text-[9px] bg-red-50 text-red-600 px-1 py-0.5 rounded border border-red-100 font-bold ml-1.5">Território Parcial</span>
            `;
        } else {
            checkboxHtml = `
                <input type="checkbox" name="freguesia-check" value="${freguesiaName}" ${belongsToEditingSectorTotal ? 'checked' : ''} class="freg-checkbox rounded text-blue-600 focus:ring-blue-500 border-gray-300 w-4 h-4 cursor-pointer">
                <span class="font-bold text-gray-700 text-xs">${freguesiaName}</span>
                <span class="text-[9px] bg-green-50 text-green-700 px-1 py-0.5 rounded border border-green-200 font-bold ml-1.5">Livre</span>
            `;
        }

        header.innerHTML = `
            <div class="flex items-center space-x-2">
                <button type="button" class="btn-expand-tree text-gray-500 hover:text-blue-600 font-mono text-sm px-1.5 py-0.5 rounded border bg-white focus:outline-none shadow-sm transition">
                    +
                </button>
                <div class="flex items-center space-x-1">
                    ${checkboxHtml}
                </div>
            </div>
            <span class="text-[9px] text-gray-400 italic font-semibold">${subLocalidadesKeys.length} áreas</span>
        `;

        const subContainer = document.createElement('div');
        subContainer.className = "hidden p-2 bg-gray-50/50 border-t border-dashed space-y-2.5 pl-7 animate-fade-in";

        subLocalidadesKeys.forEach(locName => {
            const locKey = `${freguesiaName}|${locName}`;
            const donoSetor = localidadesOcupadas.get(locKey);
            
            const belongsToEditingSectorLoc = !!(editingId && sectors.some(s => s.id === editingId && s.areaNames && s.areaNames.includes(locKey)));

            const locLabel = document.createElement('label');

            if (donoSetor) {
                locLabel.className = "flex items-center justify-between p-1.5 rounded bg-gray-100/30 text-gray-400 cursor-not-allowed select-none text-[11px]";
                locLabel.innerHTML = `
                    <div class="flex items-center space-x-2">
                        <input type="checkbox" disabled class="rounded text-gray-300 border-gray-200 w-3.5 h-3.5 cursor-not-allowed">
                        <span class="font-bold text-gray-400 line-through">${locName}</span>
                    </div>
                    <span class="text-[8px] bg-gray-100 text-gray-500 font-extrabold px-1 rounded border">
                        Com: ${donoSetor}
                    </span>
                `;
            } else {
                locLabel.className = "flex items-center justify-between p-1.5 rounded hover:bg-white border border-transparent hover:border-gray-100 cursor-pointer text-[11px] text-gray-700 transition";
                locLabel.innerHTML = `
                    <div class="flex items-center space-x-2">
                        <input type="checkbox" name="localidade-check" value="${locKey}" ${belongsToEditingSectorLoc || belongsToEditingSectorTotal ? 'checked' : ''} class="loc-checkbox rounded text-blue-600 focus:ring-blue-500 border-gray-300 w-3.5 h-3.5 cursor-pointer">
                        <span class="font-bold">${locName}</span>
                    </div>
                    <span class="text-[8px] bg-green-50 text-green-700 font-extrabold px-1 rounded border border-green-200">
                        Livre
                    </span>
                `;
            }
            subContainer.appendChild(locLabel);
        });

        fregDiv.appendChild(header);
        fregDiv.appendChild(subContainer);
        treeContainer.appendChild(fregDiv);

        const btnExpand = header.querySelector('.btn-expand-tree');
        btnExpand.addEventListener('click', (e) => {
            e.stopPropagation();
            if (subContainer.classList.contains('hidden')) {
                subContainer.classList.remove('hidden');
                btnExpand.textContent = "−";
            } else {
                subContainer.classList.add('hidden');
                btnExpand.textContent = "+";
            }
        });

        const parentCheckbox = header.querySelector('.freg-checkbox');
        if (parentCheckbox) {
            parentCheckbox.addEventListener('change', (e) => {
                const isChecked = e.target.checked;
                subContainer.querySelectorAll('.loc-checkbox:not(:disabled)').forEach(childCb => {
                    childCb.checked = isChecked;
                });
            });
        }

        subContainer.querySelectorAll('.loc-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                if (!e.target.checked && parentCheckbox) {
                    parentCheckbox.checked = false;
                }
            });
        });
    });

    container.appendChild(treeContainer);
}

// Manter alias de compatibilidade com versões antigas
export const renderIntervalCheckboxes = renderAreaCheckboxes;

// =========================================================================
// CENTRALIZAÇÃO E ATUALIZAÇÃO DA INTERFACE DE SETORES
// =========================================================================
window.renderizarSetoresUI = () => {
    const listaSetores = document.getElementById('lista-setores');
    if (listaSetores) {
        renderSectors(window.sectors, listaSetores, window.deleteSector, window.editSector);
    }

    const checkboxesAreas = document.getElementById('checkboxes-areas');
    if (checkboxesAreas) {
        const editingId = window.sectorSendoEditado ? window.sectorSendoEditado.id : null;
        renderAreaCheckboxes(window.sectors, checkboxesAreas, editingId);
    }

    const checkboxesSetoresMotorista = document.getElementById('checkboxes-setores-motorista');
    if (checkboxesSetoresMotorista) {
        const editingDriverId = window.driverSendoEditado ? window.driverSendoEditado.id : null;
        renderSectorCheckboxes(window.sectors, checkboxesSetoresMotorista, window.drivers, editingDriverId);
    }
};

// =========================================================================
// ASSINATURAS GLOBAIS (WINDOW) PARA COMPATIBILIDADE INTEGRAL COM EVENTOS
// =========================================================================
window.editSector = (sector) => {
    window.sectorSendoEditado = sector;

    const nomeInput = document.getElementById('setor-nome');
    const btnSubmit = document.getElementById('btn-submit-setor');
    const btnCancelar = document.getElementById('btn-cancelar-setor');

    if (nomeInput) nomeInput.value = sector.name;
    if (btnSubmit) btnSubmit.textContent = "Guardar Alterações";
    if (btnCancelar) btnCancelar.classList.remove('hidden');

    window.renderizarSetoresUI();
};

window.cancelarEdicaoSector = () => {
    window.sectorSendoEditado = null;

    const nomeInput = document.getElementById('setor-nome');
    const btnSubmit = document.getElementById('btn-submit-setor');
    const btnCancelar = document.getElementById('btn-cancelar-setor');

    if (nomeInput) nomeInput.value = "";
    if (btnSubmit) btnSubmit.textContent = "Criar Setor";
    if (btnCancelar) btnCancelar.classList.add('hidden');

    window.renderizarSetoresUI();
};

window.deleteSector = (id) => {
    if (confirm("Deseja apagar este Setor? As localidades associadas ficarão novamente livres e os motoristas associados a ele perderão essa atribuição.")) {
        window.sectors = window.sectors.filter(s => s.id !== id);
        
        // Remove o setor apagado da lista de setores de cada motorista afetado
        window.drivers.forEach(drv => {
            if (Array.isArray(drv.sectorIds)) {
                drv.sectorIds = drv.sectorIds.filter(sid => sid !== id);
            }
        });

        sincronizarPersistencia();
        window.renderizarSetoresUI();
        
        const listaMotoristas = document.getElementById('lista-motoristas');
        if (listaMotoristas) {
            renderDrivers(window.drivers, window.sectors, listaMotoristas, window.deleteDriver, window.editDriver);
        }
    }
};