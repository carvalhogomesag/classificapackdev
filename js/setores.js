/**
 * setores.js
 * Versão v77.2 - Módulo Integral de Bricks Dinâmicos, Mapeamento CP7, Auditoria e Importador Oficial CTT
 * Faz: Gere a criação, agrupamento visual no mapa, edição e eliminação de Bricks personalizados;
 *      integra a base de dados de Códigos Postais (CP7), mapeamento manual de coordenadas,
 *      atribuição de motoristas, Auditoria de Saldo Zero e Motor de Processamento Oficial dos CTT (todos_cp.txt).
 * Depende de: ./geografia-data.js, ./cp7-data.js, ./storage.js, ./firebase-init.js
 */

import { GEOGRAPHY, obterEnderecoHigienizado } from './geografia-data.js';
import { CP7_DATABASE } from './cp7-data.js';
import { saveData, safeJSONParse } from './storage.js';
import { db } from './firebase-init.js';

// Concelho ativo na interface ("SINTRA" ou "MAFRA")
let concelhoAtivo = "SINTRA";

// ID do Brick atualmente selecionado para visualização/gestão na coluna direita
let brickSelecionadoId = null;

// Estados do Construtor de Bricks
let isConstructorMode = false;
let editingBrickId = null; // null = novo brick; string = id do brick em edição
let selectedCP7s = new Set();
let selectedBrickColor = "#10B981";

// Filtros do Mapa
let apenasOrfaos = false;
let miniPinosVisiveis = true;
let drawerCp7Aberto = false;

// Flag anti-concorrência
let isLocalBrickUpdating = false;

// Paleta oficial de cores de Bricks
const BRICK_PALETTE = [
    "#10B981", // Emerald
    "#3B82F6", // Blue
    "#F59E0B", // Amber
    "#EF4444", // Red
    "#8B5CF6", // Purple
    "#06B6D4", // Cyan
    "#EC4899", // Pink
    "#F97316", // Orange
    "#14B8A6", // Teal
    "#6366F1", // Indigo
    "#84CC16", // Lime
    "#64748B"  // Slate
];

// Instâncias internas seguras do Google Maps
let dashboardMap = null;
let dashboardInfoWindow = null;
let cp7MarkersMap = new Map(); // Chave: cp7 string -> google.maps.Marker

// Cache de Bricks Dinâmicos criados pelo utilizador
let customBricks = safeJSONParse('cp_custom_bricks', []);

// Cache de Coordenadas de CP7s (Base Estática + Pontos Manuais)
let cp7CoordsCache = { ...(CP7_DATABASE || {}) };

try {
    const cachedCp7 = localStorage.getItem('cp_cp7_coords');
    if (cachedCp7) {
        const parsed = JSON.parse(cachedCp7);
        cp7CoordsCache = { ...cp7CoordsCache, ...parsed };
    }
} catch (e) {
    console.warn("[SETORES] Aviso ao ler cache local de CP7s:", e);
}

function salvarCustomBricks() {
    try {
        localStorage.setItem('cp_custom_bricks', JSON.stringify(customBricks));
    } catch (e) {
        console.warn("[SETORES] Erro ao persistir Bricks no LocalStorage:", e);
    }
}

function salvarCacheCp7() {
    try {
        localStorage.setItem('cp_cp7_coords', JSON.stringify(cp7CoordsCache));
    } catch (e) {
        console.warn("[SETORES] Erro ao persistir cache local de CP7s:", e);
    }
}

// =========================================================================
// SINCRONIZAÇÃO EM TEMPO REAL COM O FIRESTORE
// =========================================================================
let isFirestoreSynced = false;

async function sincronizarBricksFirestore() {
    if (isFirestoreSynced || !db) return;

    try {
        // 1. Carrega Bricks Dinâmicos do Firestore
        const snapBricks = await db.collection('customBricks').get();
        if (!snapBricks.empty) {
            const bricksFirestore = [];
            snapBricks.forEach(doc => {
                const data = doc.data();
                bricksFirestore.push({
                    id: doc.id,
                    nome: data.nome || "Brick Sem Nome",
                    concelho: (data.concelho || "SINTRA").toUpperCase(),
                    cor: data.cor || "#10B981",
                    cp7List: Array.isArray(data.cp7List) ? data.cp7List : [],
                    driverId: data.driverId || null,
                    criadoEm: data.criadoEm || "",
                    atualizadoEm: data.atualizadoEm || ""
                });
            });
            customBricks = bricksFirestore;
            salvarCustomBricks();
        }

        // 2. Carrega Coordenadas de CP7s Individuais
        const snapCp7 = await db.collection('postalCodeCoordinates').get();
        snapCp7.forEach(doc => {
            const data = doc.data();
            if (data && typeof data.lat === 'number' && typeof data.lng === 'number') {
                cp7CoordsCache[doc.id] = {
                    lat: data.lat,
                    lng: data.lng,
                    concelho: (data.concelho || "SINTRA").toUpperCase(),
                    criadoEm: data.criadoEm || ""
                };
            }
        });
        salvarCacheCp7();

        isFirestoreSynced = true;
        renderizarSetoresUI();
    } catch (err) {
        console.warn("[SETORES] Aviso ao sincronizar com Firestore:", err);
    }
}

// =========================================================================
// CONFIGURAÇÃO DOS EVENTOS DO CONSTRUTOR, MAPA E IMPORTADOR CTT
// =========================================================================
function configurarEventosConstrutor() {
    const btnIniciar = document.getElementById('btn-iniciar-criacao-brick');
    const btnCancelar = document.getElementById('btn-cancelar-construtor');
    const btnLimpar = document.getElementById('btn-limpar-selecao-cp7');
    const btnGravar = document.getElementById('btn-gravar-novo-brick');
    const btnFiltroOrfaos = document.getElementById('btn-filtro-mapa-orfaos');
    const btnToggleMiniPinos = document.getElementById('btn-toggle-mini-pinos');
    const seletorConcelho = document.getElementById('select-concelho-setores');

    // Botões do Importador CTT
    const btnAbrirCtt = document.getElementById('btn-abrir-importador-ctt');
    const btnFecharCtt = document.getElementById('btn-fechar-modal-ctt');
    const btnCancelarCtt = document.getElementById('btn-cancelar-modal-ctt');

    if (seletorConcelho && !seletorConcelho.dataset.listenerAtivo) {
        seletorConcelho.value = concelhoAtivo;
        seletorConcelho.addEventListener('change', (e) => {
            concelhoAtivo = e.target.value.toUpperCase();
            brickSelecionadoId = null;
            cancelarModoConstrutor();
            renderizarSetoresUI();
            if (dashboardMap) {
                const centerCoords = concelhoAtivo === "SINTRA" ? { lat: 38.8000, lng: -9.3800 } : { lat: 38.9500, lng: -9.3000 };
                dashboardMap.setCenter(centerCoords);
            }
        });
        seletorConcelho.dataset.listenerAtivo = "true";
    }

    if (btnIniciar && !btnIniciar.dataset.bound) {
        btnIniciar.addEventListener('click', () => {
            abrirModoConstrutor();
        });
        btnIniciar.dataset.bound = "true";
    }

    if (btnCancelar && !btnCancelar.dataset.bound) {
        btnCancelar.addEventListener('click', () => {
            cancelarModoConstrutor();
        });
        btnCancelar.dataset.bound = "true";
    }

    if (btnLimpar && !btnLimpar.dataset.bound) {
        btnLimpar.addEventListener('click', () => {
            selectedCP7s.clear();
            atualizarUISelecaoConstrutor();
            desenharPinosMapa();
        });
        btnLimpar.dataset.bound = "true";
    }

    if (btnGravar && !btnGravar.dataset.bound) {
        btnGravar.addEventListener('click', () => {
            gravarBrickConstrutor();
        });
        btnGravar.dataset.bound = "true";
    }

    if (btnFiltroOrfaos && !btnFiltroOrfaos.dataset.bound) {
        btnFiltroOrfaos.addEventListener('click', () => {
            apenasOrfaos = !apenasOrfaos;
            const texto = document.getElementById('texto-filtro-mapa-orfaos');
            if (apenasOrfaos) {
                btnFiltroOrfaos.className = "bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-extrabold px-3 py-1.5 rounded-xl border border-amber-600 flex items-center justify-center space-x-1.5 transition cursor-pointer shadow-xs";
                if (texto) texto.textContent = "A Ver Apenas Órfãos";
            } else {
                btnFiltroOrfaos.className = "bg-gray-100 hover:bg-gray-200 text-gray-700 text-[11px] font-extrabold px-3 py-1.5 rounded-xl border border-gray-300 flex items-center justify-center space-x-1.5 transition cursor-pointer shadow-xs";
                if (texto) texto.textContent = "Mostrar Todos os CP7s";
            }
            desenharPinosMapa();
        });
        btnFiltroOrfaos.dataset.bound = "true";
    }

    if (btnToggleMiniPinos && !btnToggleMiniPinos.dataset.bound) {
        btnToggleMiniPinos.addEventListener('click', () => {
            miniPinosVisiveis = !miniPinosVisiveis;
            const icone = document.getElementById('icone-toggle-mini-pinos');
            const texto = document.getElementById('texto-toggle-mini-pinos');

            if (miniPinosVisiveis) {
                btnToggleMiniPinos.className = "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-extrabold px-3 py-1.5 rounded-xl border border-indigo-200 flex items-center justify-center space-x-1.5 transition cursor-pointer shadow-xs";
                if (icone) icone.className = "fa-solid fa-eye text-indigo-600";
                if (texto) texto.textContent = "Mini-Pinos CP7";
            } else {
                btnToggleMiniPinos.className = "bg-gray-100 hover:bg-gray-200 text-gray-500 text-[11px] font-extrabold px-3 py-1.5 rounded-xl border border-gray-300 flex items-center justify-center space-x-1.5 transition cursor-pointer shadow-xs opacity-80";
                if (icone) icone.className = "fa-solid fa-eye-slash text-gray-500";
                if (texto) texto.textContent = "Mini-Pinos Ocultos";
            }

            for (const marker of cp7MarkersMap.values()) {
                marker.setVisible(miniPinosVisiveis);
            }
        });
        btnToggleMiniPinos.dataset.bound = "true";
    }

    // Modal Importador CTT
    if (btnAbrirCtt && !btnAbrirCtt.dataset.bound) {
        btnAbrirCtt.addEventListener('click', () => {
            abrirModalImportadorCTT();
        });
        btnAbrirCtt.dataset.bound = "true";
    }

    if (btnFecharCtt && !btnFecharCtt.dataset.bound) {
        btnFecharCtt.addEventListener('click', fecharModalImportadorCTT);
        btnFecharCtt.dataset.bound = "true";
    }

    if (btnCancelarCtt && !btnCancelarCtt.dataset.bound) {
        btnCancelarCtt.addEventListener('click', fecharModalImportadorCTT);
        btnCancelarCtt.dataset.bound = "true";
    }

    configurarUploadCTT();
    renderColorPalette();
    popularSelectMotoristas();
}

function renderColorPalette() {
    const container = document.getElementById('palette-brick-colors');
    if (!container) return;

    container.innerHTML = BRICK_PALETTE.map(cor => `
        <button type="button" 
                onclick="window.selecionarCorBrick('${cor}')"
                class="w-6 h-6 rounded-full flex-shrink-0 transition-transform cursor-pointer border-2 ${selectedBrickColor === cor ? 'border-gray-900 scale-125 shadow-sm ring-2 ring-emerald-400' : 'border-white hover:scale-110'}"
                style="background-color: ${cor};">
        </button>
    `).join('');
}
window.selecionarCorBrick = function(cor) {
    selectedBrickColor = cor;
    renderColorPalette();
};

function popularSelectMotoristas(selectedDriverId = "") {
    const select = document.getElementById('select-brick-motorista');
    if (!select) return;

    const drivers = window.drivers || [];
    const driversDoConcelho = drivers.filter(d => {
        const concs = Array.isArray(d.concelhos) ? d.concelhos : ["MAFRA"];
        return concs.includes(concelhoAtivo);
    });

    select.innerHTML = `
        <option value="">-- Sem Motorista (Apenas Agrupar) --</option>
        ${driversDoConcelho.map(d => `
            <option value="${d.id}" ${d.id === selectedDriverId ? 'selected' : ''}>
                ${d.name}
            </option>
        `).join('')}
    `;
}

function abrirModoConstrutor(brickExistente = null) {
    isConstructorMode = true;
    selectedCP7s.clear();

    const painel = document.getElementById('painel-construtor-brick');
    const aviso = document.getElementById('aviso-modo-selecao-mapa');
    const inputNome = document.getElementById('input-brick-nome');
    const titulo = document.getElementById('titulo-painel-construtor');
    const btnTexto = document.getElementById('btn-gravar-brick-texto');

    if (brickExistente) {
        editingBrickId = brickExistente.id;
        if (inputNome) inputNome.value = brickExistente.nome;
        selectedBrickColor = brickExistente.cor || "#10B981";
        popularSelectMotoristas(brickExistente.driverId || "");
        if (Array.isArray(brickExistente.cp7List)) {
            brickExistente.cp7List.forEach(cp => selectedCP7s.add(cp));
        }
        if (titulo) titulo.textContent = `Editar Brick: ${brickExistente.nome}`;
        if (btnTexto) btnTexto.textContent = "Atualizar Brick";
    } else {
        editingBrickId = null;
        if (inputNome) inputNome.value = "";
        selectedBrickColor = BRICK_PALETTE[Math.floor(Math.random() * BRICK_PALETTE.length)];
        popularSelectMotoristas();
        if (titulo) titulo.textContent = "Modo Construtor de Brick (Agrupamento de CP7s)";
        if (btnTexto) btnTexto.textContent = "Gravar Brick";
    }

    renderColorPalette();
    atualizarUISelecaoConstrutor();

    if (painel) painel.classList.remove('hidden');
    if (aviso) aviso.classList.remove('hidden');

    desenharPinosMapa();
}

function cancelarModoConstrutor() {
    isConstructorMode = false;
    editingBrickId = null;
    selectedCP7s.clear();

    const painel = document.getElementById('painel-construtor-brick');
    const aviso = document.getElementById('aviso-modo-selecao-mapa');

    if (painel) painel.classList.add('hidden');
    if (aviso) aviso.classList.add('hidden');

    desenharPinosMapa();
}

function atualizarUISelecaoConstrutor() {
    const badge = document.getElementById('badge-cp7-selecionados-count');
    if (badge) {
        badge.textContent = `${selectedCP7s.size} CP7s Selecionados`;
    }
}

async function gravarBrickConstrutor() {
    const inputNome = document.getElementById('input-brick-nome');
    const selectMotorista = document.getElementById('select-brick-motorista');
    const nome = inputNome ? inputNome.value.trim() : "";
    const driverId = selectMotorista ? selectMotorista.value || null : null;

    if (!nome) {
        alert("Por favor, introduza um nome para o Brick (ex: Portela de Sintra Sul).");
        if (inputNome) inputNome.focus();
        return;
    }

    if (selectedCP7s.size === 0) {
        alert("Por favor, selecione pelo menos 1 Código Postal no mapa para formar este Brick.");
        return;
    }

    const agora = new Date();
    const hoje = `${String(agora.getDate()).padStart(2, '0')}/${String(agora.getMonth() + 1).padStart(2, '0')}/${agora.getFullYear()}`;
    const cp7Array = Array.from(selectedCP7s);

    if (editingBrickId) {
        const index = customBricks.findIndex(b => b.id === editingBrickId);
        if (index !== -1) {
            customBricks[index].nome = nome;
            customBricks[index].cor = selectedBrickColor;
            customBricks[index].cp7List = cp7Array;
            customBricks[index].driverId = driverId;
            customBricks[index].atualizadoEm = hoje;

            removerCP7sDeOutrosBricks(cp7Array, editingBrickId);
        }
    } else {
        const novoBrick = {
            id: `brick_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            nome: nome,
            concelho: concelhoAtivo,
            cor: selectedBrickColor,
            cp7List: cp7Array,
            driverId: driverId,
            criadoEm: hoje,
            atualizadoEm: hoje
        };

        removerCP7sDeOutrosBricks(cp7Array, novoBrick.id);
        customBricks.push(novoBrick);
        brickSelecionadoId = novoBrick.id;
    }

    salvarCustomBricks();

    if (db) {
        try {
            const brickSalvo = customBricks.find(b => b.id === (editingBrickId || brickSelecionadoId));
            if (brickSalvo) {
                await db.collection('customBricks').doc(brickSalvo.id).set(brickSalvo, { merge: true });
                console.log(`[SETORES] Brick "${brickSalvo.nome}" sincronizado no Firestore.`);
            }
        } catch (err) {
            console.warn("[SETORES] Aviso ao guardar Brick no Firestore:", err);
        }
    }

    cancelarModoConstrutor();
    renderizarSetoresUI();
    alert(`🎉 SUCESSO!\n\nBrick "${nome}" guardado com ${cp7Array.length} Códigos Postais.`);
}

function removerCP7sDeOutrosBricks(cp7List, brickIdAtual) {
    const cpSet = new Set(cp7List);
    customBricks.forEach(b => {
        if (b.id !== brickIdAtual && Array.isArray(b.cp7List)) {
            b.cp7List = b.cp7List.filter(cp => !cpSet.has(cp));
        }
    });
}

// =========================================================================
// RENDERIZAÇÃO DA LISTA DE BRICKS CRIADOS (COLUNA ESQUERDA)
// =========================================================================
function renderListaBricksCriados() {
    const container = document.getElementById('lista-bricks-criados');
    const badgeTotal = document.getElementById('stat-total-bricks-count');
    if (!container) return;

    const drivers = window.drivers || [];
    const bricksDoConcelho = customBricks.filter(b => (b.concelho || "SINTRA").toUpperCase() === concelhoAtivo.toUpperCase());

    if (badgeTotal) badgeTotal.textContent = bricksDoConcelho.length;

    if (bricksDoConcelho.length === 0) {
        container.innerHTML = `
            <div class="py-12 text-center text-gray-400 space-y-2">
                <i class="fa-solid fa-layer-group text-3xl text-gray-300"></i>
                <p class="text-xs italic font-bold">Nenhum Brick configurado em ${concelhoAtivo}.</p>
                <button type="button" onclick="document.getElementById('btn-iniciar-criacao-brick').click()"
                        class="text-xs text-emerald-600 font-extrabold hover:underline cursor-pointer">
                    Clique aqui para criar o primeiro Brick
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = bricksDoConcelho.map(b => {
        const isSelected = b.id === brickSelecionadoId;
        const motorista = drivers.find(d => d.id === b.driverId);
        const qtdCp7 = Array.isArray(b.cp7List) ? b.cp7List.length : 0;

        return `
            <div onclick="window.selecionarBrick('${b.id}')"
                 class="p-3 rounded-xl border-2 transition-all cursor-pointer ${
                     isSelected 
                         ? 'border-blue-600 bg-blue-50/70 shadow-sm ring-2 ring-blue-500/20' 
                         : 'border-gray-150 bg-white hover:border-gray-300 hover:bg-gray-50'
                 }">
                <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-2.5 truncate">
                        <span class="w-4 h-4 rounded-full flex-shrink-0 shadow-xs border" style="background-color: ${b.cor};"></span>
                        <h4 class="text-xs font-black text-gray-800 truncate">${b.nome}</h4>
                    </div>
                    <span class="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">
                        ${qtdCp7} CPs
                    </span>
                </div>
                
                <div class="flex items-center justify-between pt-2 mt-1.5 border-t border-gray-100 text-[10px]">
                    <span class="text-gray-500 flex items-center space-x-1 truncate">
                        <i class="fa-solid fa-user text-[9px] text-gray-400"></i>
                        <span class="font-bold truncate">${motorista ? motorista.name : 'Sem Motorista'}</span>
                    </span>
                    <div class="flex items-center space-x-1.5 flex-shrink-0">
                        <button type="button" onclick="event.stopPropagation(); window.editarBrick('${b.id}')"
                                class="text-blue-600 hover:text-blue-800 p-1 font-bold text-[10px]" title="Editar Brick">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button type="button" onclick="event.stopPropagation(); window.eliminarBrick('${b.id}')"
                                class="text-red-500 hover:text-red-700 p-1 font-bold text-[10px]" title="Eliminar Brick">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// =========================================================================
// DETALHES DO BRICK SELECIONADO (COLUNA DIREITA)
// =========================================================================
function renderDetalhesBrickSelecionado() {
    const container = document.getElementById('container-detalhes-brick-selecionado');
    const labelNome = document.getElementById('label-brick-detalhe-nome');
    if (!container) return;

    const brick = customBricks.find(b => b.id === brickSelecionadoId);

    if (!brick) {
        if (labelNome) {
            labelNome.textContent = "Nenhum Selecionado";
            labelNome.className = "text-[10px] font-black uppercase bg-gray-100 text-gray-500 px-2.5 py-0.5 rounded border";
            labelNome.style.backgroundColor = "";
        }
        container.innerHTML = `
            <div class="text-center py-12 space-y-2">
                <i class="fa-solid fa-hand-pointer text-gray-300 text-3xl"></i>
                <p class="text-xs text-gray-400 font-bold italic">Selecione um Brick na lista à esquerda para gerir os seus códigos postais ou alterar o motorista.</p>
            </div>
        `;
        return;
    }

    if (labelNome) {
        labelNome.textContent = brick.nome;
        labelNome.className = "text-[10px] font-black uppercase text-white px-2.5 py-0.5 rounded shadow-xs";
        labelNome.style.backgroundColor = brick.cor;
    }

    const drivers = window.drivers || [];
    const driversDoConcelho = drivers.filter(d => {
        const concs = Array.isArray(d.concelhos) ? d.concelhos : ["MAFRA"];
        return concs.includes(concelhoAtivo);
    });

    const cpList = Array.isArray(brick.cp7List) ? brick.cp7List : [];

    container.innerHTML = `
        <div class="space-y-3.5">
            <!-- 1. BARRA DE AÇÕES RÁPIDAS -->
            <div class="flex items-center justify-between bg-gray-50 p-3 rounded-xl border border-gray-200 flex-wrap gap-2">
                <div class="flex items-center space-x-2">
                    <span class="w-5 h-5 rounded-full flex-shrink-0 border" style="background-color: ${brick.cor};"></span>
                    <div>
                        <h4 class="text-xs font-black text-gray-800">${brick.nome}</h4>
                        <span class="text-[10px] text-gray-400 font-mono">${cpList.length} Códigos Postais incluídos</span>
                    </div>
                </div>

                <div class="flex items-center space-x-2">
                    <button type="button" onclick="window.editarBrick('${brick.id}')"
                            class="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-[11px] px-3 py-1.5 rounded-lg border border-emerald-200 flex items-center space-x-1 cursor-pointer">
                        <i class="fa-solid fa-plus text-[10px]"></i>
                        <span>Adicionar/Editar no Mapa</span>
                    </button>
                    <button type="button" onclick="window.eliminarBrick('${brick.id}')"
                            class="bg-red-50 hover:bg-red-100 text-red-600 font-bold text-[11px] px-3 py-1.5 rounded-lg border border-red-200 flex items-center space-x-1 cursor-pointer">
                        <i class="fa-solid fa-trash-can text-[10px]"></i>
                        <span>Eliminar</span>
                    </button>
                </div>
            </div>

            <!-- 2. ALTERAR MOTORISTA DESIGNADO -->
            <div class="p-3 bg-white rounded-xl border border-gray-200 space-y-1.5">
                <label class="block text-[10px] font-black text-gray-600 uppercase">
                    Estante de Arrumação (Motorista):
                </label>
                <div class="flex items-center space-x-2">
                    <select id="select-brick-detail-driver" onchange="window.alterarMotoristaDoBrick('${brick.id}', this.value)"
                            class="flex-1 p-2 bg-gray-50 border border-gray-300 rounded-lg text-xs font-bold text-gray-800 focus:ring-2 focus:ring-blue-500 cursor-pointer">
                        <option value="" ${!brick.driverId ? 'selected' : ''}>-- Sem Motorista Designado --</option>
                        ${driversDoConcelho.map(d => `
                            <option value="${d.id}" ${d.id === brick.driverId ? 'selected' : ''}>
                                ${d.name}
                            </option>
                        `).join('')}
                    </select>
                </div>
            </div>

            <!-- 3. LISTA DE CÓDIGOS POSTAIS DO BRICK -->
            <div class="space-y-2">
                <div class="flex items-center justify-between">
                    <span class="text-[10px] font-black uppercase text-gray-500 tracking-wider">
                        Códigos Postais do Brick (${cpList.length})
                    </span>
                </div>

                <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-56 overflow-y-auto pr-1">
                    ${cpList.map(cp => `
                        <div class="p-2 rounded-lg bg-gray-50 border border-gray-200 text-xs flex items-center justify-between group hover:bg-white hover:border-blue-300 transition">
                            <span onclick="window.focarPinoCP7Mapa('${cp}')" class="font-mono font-bold text-gray-800 cursor-pointer hover:text-blue-600 truncate" title="Centrar no Mapa">
                                ${cp}
                            </span>
                            <button type="button" onclick="window.removerCP7DoBrick('${brick.id}', '${cp}')"
                                    class="text-gray-400 hover:text-red-600 p-0.5 text-[10px] cursor-pointer" title="Remover deste Brick">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

// =========================================================================
// AÇÕES PÚBLICAS DO BRICK (WINDOW)
// =========================================================================
window.selecionarBrick = function(brickId) {
    brickSelecionadoId = brickId;
    renderListaBricksCriados();
    renderDetalhesBrickSelecionado();

    const brick = customBricks.find(b => b.id === brickId);
    if (brick && Array.isArray(brick.cp7List) && brick.cp7List.length > 0 && dashboardMap) {
        const bounds = new google.maps.LatLngBounds();
        let count = 0;
        brick.cp7List.forEach(cp => {
            if (cp7CoordsCache[cp]) {
                bounds.extend(cp7CoordsCache[cp]);
                count++;
            }
        });
        if (count > 0) {
            dashboardMap.fitBounds(bounds);
        }
    }
};

window.editarBrick = function(brickId) {
    const brick = customBricks.find(b => b.id === brickId);
    if (brick) {
        abrirModoConstrutor(brick);
    }
};

window.eliminarBrick = async function(brickId) {
    const brick = customBricks.find(b => b.id === brickId);
    if (!brick) return;

    const confirmar = confirm(`Tem a certeza de que deseja eliminar o Brick "${brick.nome}"?\n\nOs ${brick.cp7List.length} Códigos Postais voltarão a ficar livres/órfãos.`);
    if (!confirmar) return;

    customBricks = customBricks.filter(b => b.id !== brickId);
    if (brickSelecionadoId === brickId) brickSelecionadoId = null;

    salvarCustomBricks();

    if (db) {
        try {
            await db.collection('customBricks').doc(brickId).delete();
            console.log(`[SETORES] Brick "${brick.nome}" eliminado do Firestore.`);
        } catch (err) {
            console.warn("[SETORES] Aviso ao eliminar Brick no Firestore:", err);
        }
    }

    renderizarSetoresUI();
    alert(`Brick "${brick.nome}" eliminado com sucesso.`);
};

window.alterarMotoristaDoBrick = async function(brickId, novoDriverId) {
    const brick = customBricks.find(b => b.id === brickId);
    if (!brick) return;

    brick.driverId = novoDriverId || null;
    salvarCustomBricks();

    if (db) {
        try {
            await db.collection('customBricks').doc(brickId).update({
                driverId: brick.driverId,
                atualizadoEm: new Date().toLocaleDateString('pt-PT')
            });
        } catch (err) {
            console.warn("[SETORES] Aviso ao atualizar motorista do Brick no Firestore:", err);
        }
    }

    renderListaBricksCriados();
    renderDetalhesBrickSelecionado();
    desenharPinosMapa();
};

window.removerCP7DoBrick = async function(brickId, cp7) {
    const brick = customBricks.find(b => b.id === brickId);
    if (!brick || !Array.isArray(brick.cp7List)) return;

    brick.cp7List = brick.cp7List.filter(cp => cp !== cp7);
    salvarCustomBricks();

    if (db) {
        try {
            await db.collection('customBricks').doc(brickId).update({
                cp7List: brick.cp7List,
                atualizadoEm: new Date().toLocaleDateString('pt-PT')
            });
        } catch (err) {
            console.warn("[SETORES] Aviso ao remover CP7 do Brick:", err);
        }
    }

    renderDetalhesBrickSelecionado();
    renderListaBricksCriados();
    atualizarAuditoriaCP7();
    desenharPinosMapa();
};

window.focarPinoCP7Mapa = function(cp7) {
    if (!cp7 || !cp7CoordsCache[cp7] || !dashboardMap) return;
    const data = cp7CoordsCache[cp7];

    dashboardMap.panTo({ lat: data.lat, lng: data.lng });
    dashboardMap.setZoom(16);

    const marker = cp7MarkersMap.get(cp7);
    if (marker && dashboardInfoWindow) {
        dashboardInfoWindow.setContent(`
            <div style="font-family: system-ui, sans-serif; font-size: 11px; padding: 4px;">
                <div style="font-weight: 900; font-size: 13px; color: #1E1B4B; font-family: monospace;">📮 ${cp7}</div>
                <div style="color: #6B7280; font-size: 10px; font-mono; margin-top: 2px;">(${data.lat.toFixed(5)}, ${data.lng.toFixed(5)})</div>
            </div>
        `);
        dashboardInfoWindow.setPosition(marker.getPosition());
        dashboardInfoWindow.open(dashboardMap, marker);
    }
};

// =========================================================================
// AUDITORIA DE COBERTURA 100% (SALDO ZERO DE CP7s)
// =========================================================================
function atualizarAuditoriaCP7() {
    const elTotal = document.getElementById('stat-total-cp7');
    const elAlocados = document.getElementById('stat-alocados-cp7');
    const elSaldo = document.getElementById('stat-saldo-cp7');
    const elLabelSaldo = document.getElementById('label-saldo-cp7');
    const elCardSaldo = document.getElementById('card-saldo-cp7');
    const elBadgeStatus = document.getElementById('badge-saldo-status');
    const elContainerPendentes = document.getElementById('container-cp7-pendentes');
    const elListaPendentes = document.getElementById('lista-cp7-pendentes');

    const todosCp7DoConcelho = Object.keys(cp7CoordsCache).filter(cp => {
        const item = cp7CoordsCache[cp];
        const conc = (item.concelho || "SINTRA").toUpperCase();
        return conc === concelhoAtivo.toUpperCase();
    });

    const cp7sAlocadosSet = new Set();
    const bricksDoConcelho = customBricks.filter(b => (b.concelho || "SINTRA").toUpperCase() === concelhoAtivo.toUpperCase());
    bricksDoConcelho.forEach(b => {
        if (Array.isArray(b.cp7List)) {
            b.cp7List.forEach(cp => cp7sAlocadosSet.add(cp));
        }
    });

    const cp7sOrfaos = todosCp7DoConcelho.filter(cp => !cp7sAlocadosSet.has(cp)).sort();

    const totalCount = todosCp7DoConcelho.length;
    const alocadosCount = cp7sAlocadosSet.size;
    const saldoCount = cp7sOrfaos.length;

    if (elTotal) elTotal.textContent = totalCount;
    if (elAlocados) elAlocados.textContent = alocadosCount;
    if (elSaldo) elSaldo.textContent = saldoCount;

    if (saldoCount === 0 && totalCount > 0) {
        if (elBadgeStatus) {
            elBadgeStatus.className = "text-[9px] font-black uppercase px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200 animate-none";
            elBadgeStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>Cobertura 100% (Saldo Zero)</span>`;
        }
        if (elCardSaldo) elCardSaldo.className = "bg-emerald-50 p-2.5 rounded-xl border border-emerald-200";
        if (elSaldo) elSaldo.className = "block text-base font-black text-emerald-600";
        if (elLabelSaldo) {
            elLabelSaldo.textContent = "Sem Brick";
            elLabelSaldo.className = "text-[9px] font-bold text-emerald-500 uppercase";
        }
        if (elContainerPendentes) elContainerPendentes.classList.add('hidden');
        if (elListaPendentes) elListaPendentes.innerHTML = "";
    } else {
        if (elBadgeStatus) {
            elBadgeStatus.className = "text-[9px] font-black uppercase px-2 py-0.5 rounded border bg-red-50 text-red-700 border-red-200 animate-pulse";
            elBadgeStatus.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>Cobertura Incompleta</span>`;
        }
        if (elCardSaldo) elCardSaldo.className = "bg-red-50 p-2.5 rounded-xl border border-red-200";
        if (elSaldo) elSaldo.className = "block text-base font-black text-red-600";
        if (elLabelSaldo) {
            elLabelSaldo.textContent = "Sem Brick (Órfãos)";
            elLabelSaldo.className = "text-[9px] font-bold text-red-500 uppercase";
        }

        if (elContainerPendentes) elContainerPendentes.classList.remove('hidden');
        if (elListaPendentes) {
            elListaPendentes.innerHTML = cp7sOrfaos.map(cp => `
                <div onclick="window.focarPinoCP7Mapa('${cp}')"
                     class="p-1.5 bg-white border border-red-200 rounded text-center cursor-pointer hover:border-red-400 hover:bg-red-50 transition shadow-2xs">
                    ${cp}
                </div>
            `).join('');
        }
    }
}

// =========================================================================
// INICIALIZAÇÃO DO GOOGLE MAPS
// =========================================================================
function inicializarMapaDashboard() {
    const mapEl = document.getElementById('map-dashboard-bricks');
    if (!mapEl || typeof google === 'undefined') return;

    configurarEventosConstrutor();

    const centerCoords = concelhoAtivo === "SINTRA" ? { lat: 38.8000, lng: -9.3800 } : { lat: 38.9500, lng: -9.3000 };

    if (!dashboardMap) {
        dashboardMap = new google.maps.Map(mapEl, {
            zoom: 11,
            center: centerCoords,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false
        });

        dashboardInfoWindow = new google.maps.InfoWindow({
            disableAutoPan: false
        });

        sincronizarBricksFirestore();
    } else {
        dashboardMap.setCenter(centerCoords);
        google.maps.event.trigger(dashboardMap, 'resize');
    }

    desenharPinosMapa();
}

// =========================================================================
// DESENHO DOS PINOS DE CP7 NO MAPA
// =========================================================================
function desenharPinosMapa() {
    if (!dashboardMap) return;

    const keysDesejadas = new Set();
    const bounds = new google.maps.LatLngBounds();
    let totalPontos = 0;

    const cpToBrickMap = new Map();
    const bricksDoConcelho = customBricks.filter(b => (b.concelho || "SINTRA").toUpperCase() === concelhoAtivo.toUpperCase());
    bricksDoConcelho.forEach(b => {
        if (Array.isArray(b.cp7List)) {
            b.cp7List.forEach(cp => cpToBrickMap.set(cp, b));
        }
    });

    const drivers = window.drivers || [];
    const miniPinSvgPath = "M12 2C8.14 2 5 5.14 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.86-3.14-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z";

    for (const [cp7, data] of Object.entries(cp7CoordsCache)) {
        if (!data || typeof data.lat !== 'number' || typeof data.lng !== 'number') continue;

        const conc = (data.concelho || "SINTRA").toUpperCase();
        if (conc !== concelhoAtivo.toUpperCase()) continue;

        const brickDono = cpToBrickMap.get(cp7);

        if (apenasOrfaos && brickDono && !isConstructorMode) continue;

        const isSelectedInConstructor = selectedCP7s.has(cp7);
        keysDesejadas.add(cp7);

        const coords = { lat: data.lat, lng: data.lng };
        bounds.extend(coords);
        totalPontos++;

        let pinColor = "#9CA3AF";
        let pinStroke = "#4B5563";
        let pinScale = 0.8;

        if (isSelectedInConstructor) {
            pinColor = selectedBrickColor;
            pinStroke = "#FFFFFF";
            pinScale = 1.15;
        } else if (brickDono) {
            pinColor = brickDono.cor || "#10B981";
            pinStroke = "#FFFFFF";
            pinScale = 0.85;
        }

        let marker = cp7MarkersMap.get(cp7);

        if (!marker) {
            marker = new google.maps.Marker({
                position: coords,
                map: dashboardMap,
                visible: miniPinosVisiveis,
                zIndex: isSelectedInConstructor ? 200 : (brickDono ? 100 : 50),
                icon: {
                    path: miniPinSvgPath,
                    fillColor: pinColor,
                    fillOpacity: 0.95,
                    strokeWeight: isSelectedInConstructor ? 2.5 : 1,
                    strokeColor: pinStroke,
                    scale: pinScale,
                    anchor: new google.maps.Point(12, 22)
                },
                title: `CP7: ${cp7} ${brickDono ? `(${brickDono.nome})` : '(Livre)'}`
            });

            marker.addListener('click', () => {
                if (isConstructorMode) {
                    if (selectedCP7s.has(cp7)) {
                        selectedCP7s.delete(cp7);
                    } else {
                        selectedCP7s.add(cp7);
                    }
                    atualizarUISelecaoConstrutor();
                    desenharPinosMapa();
                } else {
                    if (dashboardInfoWindow) {
                        const motorista = brickDono ? drivers.find(d => d.id === brickDono.driverId) : null;

                        dashboardInfoWindow.setContent(`
                            <div style="font-family: system-ui, sans-serif; font-size: 11px; padding: 6px; line-height: 1.4; width: 230px;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                                    <span style="font-weight: 900; font-size: 13px; color: #1E1B4B; font-family: monospace;">
                                        📮 ${cp7}
                                    </span>
                                    <span style="font-size: 8px; font-weight: 800; padding: 2px 5px; border-radius: 4px; ${
                                        brickDono ? `background: ${brickDono.cor}20; color: ${brickDono.cor}; border: 1px solid ${brickDono.cor}40;` : 'background: #F3F4F6; color: #6B7280; border: 1px solid #E5E7EB;'
                                    }">
                                        ${brickDono ? 'EM BRICK' : 'LIVRE / SEM BRICK'}
                                    </span>
                                </div>

                                <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed #E5E7EB; font-size: 10px;">
                                    ${brickDono ? `
                                        <div style="font-weight: 800; color: ${brickDono.cor};">
                                            🧱 Brick: ${brickDono.nome}
                                        </div>
                                        <div style="color: #4B5563; margin-top: 2px;">
                                            👤 Motorista: <strong>${motorista ? motorista.name : 'Sem motorista'}</strong>
                                        </div>
                                    ` : `
                                        <div style="color: #9CA3AF; font-style: italic;">
                                            Ponto livre. Pode ser agrupado num novo Brick.
                                        </div>
                                    `}
                                </div>
                            </div>
                        `);
                        dashboardInfoWindow.setPosition(marker.getPosition());
                        dashboardInfoWindow.open(dashboardMap, marker);
                    }
                }
            });

            cp7MarkersMap.set(cp7, marker);
        } else {
            marker.setPosition(coords);
            marker.setVisible(miniPinosVisiveis);
            marker.setZIndex(isSelectedInConstructor ? 200 : (brickDono ? 100 : 50));
            marker.setIcon({
                path: miniPinSvgPath,
                fillColor: pinColor,
                fillOpacity: 0.95,
                strokeWeight: isSelectedInConstructor ? 2.5 : 1,
                strokeColor: pinStroke,
                scale: pinScale,
                anchor: new google.maps.Point(12, 22)
            });
        }
    }

    for (const [key, marker] of cp7MarkersMap.entries()) {
        if (!keysDesejadas.has(key)) {
            marker.setMap(null);
            cp7MarkersMap.delete(key);
        }
    }

    if (totalPontos > 0 && dashboardMap && !isConstructorMode && !brickSelecionadoId) {
        dashboardMap.fitBounds(bounds);
        google.maps.event.addListenerOnce(dashboardMap, 'bounds_changed', function () {
            if (dashboardMap.getZoom() > 14) {
                dashboardMap.setZoom(14);
            }
        });
    }
}

// =========================================================================
// MÓDULO IMPORTADOR OFICIAL DOS CTT (todos_cp.txt)
// =========================================================================
let cttFileSelected = null;
let cttParsedResults = {
    totalLinhas: 0,
    sintraCount: 0,
    mafraCount: 0,
    cp7sUnicos: new Set(),
    registos: [] // { cp7, rua, localidade, concelho }
};

function abrirModalImportadorCTT() {
    const modal = document.getElementById('modal-importador-ctt');
    if (modal) modal.classList.remove('hidden');
}

function fecharModalImportadorCTT() {
    const modal = document.getElementById('modal-importador-ctt');
    if (modal) modal.classList.add('hidden');
}

function configurarUploadCTT() {
    const dropzone = document.getElementById('dropzone-ctt');
    const inputFile = document.getElementById('input-file-ctt');
    const badgeName = document.getElementById('ctt-file-selected-name');
    const badgeContainer = document.getElementById('ctt-file-selected-badge');
    const btnProcessar = document.getElementById('btn-processar-ctt');
    const btnDownload = document.getElementById('btn-download-cp7-data');

    if (dropzone && !dropzone.dataset.bound) {
        dropzone.addEventListener('click', () => {
            if (inputFile) inputFile.click();
        });

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('border-indigo-600', 'bg-indigo-100/50');
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('border-indigo-600', 'bg-indigo-100/50');
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('border-indigo-600', 'bg-indigo-100/50');
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleSelectedFileCTT(e.dataTransfer.files[0]);
            }
        });
        dropzone.dataset.bound = "true";
    }

    if (inputFile && !inputFile.dataset.bound) {
        inputFile.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                handleSelectedFileCTT(e.target.files[0]);
            }
        });
        inputFile.dataset.bound = "true";
    }

    if (btnProcessar && !btnProcessar.dataset.bound) {
        btnProcessar.addEventListener('click', () => {
            iniciarProcessamentoFicheiroCTT();
        });
        btnProcessar.dataset.bound = "true";
    }

    if (btnDownload && !btnDownload.dataset.bound) {
        btnDownload.addEventListener('click', () => {
            descarregarNovoCp7DataJs();
        });
        btnDownload.dataset.bound = "true";
    }
}

function handleSelectedFileCTT(file) {
    cttFileSelected = file;
    const badgeName = document.getElementById('ctt-file-selected-name');
    const badgeContainer = document.getElementById('ctt-file-selected-badge');
    const btnProcessar = document.getElementById('btn-processar-ctt');

    if (badgeName) badgeName.textContent = file.name;
    if (badgeContainer) badgeContainer.classList.remove('hidden');
    if (btnProcessar) btnProcessar.removeAttribute('disabled');
}

async function iniciarProcessamentoFicheiroCTT() {
    if (!cttFileSelected) {
        alert("Por favor, selecione primeiro o ficheiro todos_cp.txt.");
        return;
    }

    const chkSintra = document.getElementById('chk-filtro-sintra');
    const chkMafra = document.getElementById('chk-filtro-mafra');
    const aceitarSintra = chkSintra ? chkSintra.checked : true;
    const aceitarMafra = chkMafra ? chkMafra.checked : true;

    const containerProgresso = document.getElementById('container-progresso-ctt');
    const labelProgresso = document.getElementById('ctt-progresso-label');
    const percentProgresso = document.getElementById('ctt-progresso-percent');
    const barProgresso = document.getElementById('ctt-progresso-bar');
    const btnProcessar = document.getElementById('btn-processar-ctt');
    const btnDownload = document.getElementById('btn-download-cp7-data');
    const containerPreview = document.getElementById('container-preview-ctt');
    const listaPreview = document.getElementById('lista-preview-ctt');

    if (containerProgresso) containerProgresso.classList.remove('hidden');
    if (btnProcessar) btnProcessar.setAttribute('disabled', 'true');

    cttParsedResults = {
        totalLinhas: 0,
        sintraCount: 0,
        mafraCount: 0,
        cp7sUnicos: new Set(),
        registos: []
    };

    const statTotal = document.getElementById('stat-ctt-total-linhas');
    const statSintra = document.getElementById('stat-ctt-sintra');
    const statMafra = document.getElementById('stat-ctt-mafra');
    const statCp7 = document.getElementById('stat-ctt-cp7-unicos');

    try {
        const textContent = await cttFileSelected.text();
        const linhas = textContent.split(/\r?\n/);
        const totalLinhas = linhas.length;

        let processadas = 0;
        const chunkSize = 5000;

        for (let i = 0; i < totalLinhas; i += chunkSize) {
            const batch = linhas.slice(i, i + chunkSize);

            for (let j = 0; j < batch.length; j++) {
                const linha = batch[j].trim();
                if (!linha) continue;

                cttParsedResults.totalLinhas++;
                const col = linha.split(';');

                if (col.length < 16) continue;

                const dd = col[0].trim();
                const cc = col[1].trim();
                const localidade = col[3] ? col[3].trim() : "";
                const artTipo = col[5] ? col[5].trim() : "";
                const priPrep = col[6] ? col[6].trim() : "";
                const artTitulo = col[7] ? col[7].trim() : "";
                const segPrep = col[8] ? col[8].trim() : "";
                const artDesig = col[9] ? col[9].trim() : "";
                const artLocal = col[10] ? col[10].trim() : "";
                const cp4 = col[14] ? col[14].trim() : "";
                const cp3 = col[15] ? col[15].trim() : "";
                const cpalf = col[16] ? col[16].trim() : "";

                if (!cp4 || !cp3) continue;

                const isSintra = (dd === "11" && cc === "11");
                const isMafra = (dd === "11" && cc === "09");

                if ((isSintra && aceitarSintra) || (isMafra && aceitarMafra)) {
                    const concelhoNome = isSintra ? "Sintra" : "Mafra";
                    const cp7 = `${cp4}-${cp3}`;

                    const ruaPartes = [artTipo, priPrep, artTitulo, segPrep, artDesig].filter(Boolean);
                    let ruaCompleta = ruaPartes.join(' ').replace(/\s+/g, ' ').trim();
                    if (artLocal) {
                        ruaCompleta += ` (${artLocal})`;
                    }

                    cttParsedResults.cp7sUnicos.add(cp7);
                    if (isSintra) cttParsedResults.sintraCount++;
                    if (isMafra) cttParsedResults.mafraCount++;

                    cttParsedResults.registos.push({
                        cp7: cp7,
                        rua: ruaCompleta || localidade || cpalf,
                        localidade: localidade || cpalf,
                        concelho: concelhoNome,
                        cpalf: cpalf
                    });
                }
            }

            processadas += batch.length;
            const pct = Math.min(100, Math.round((processadas / totalLinhas) * 100));

            if (barProgresso) barProgresso.style.width = `${pct}%`;
            if (percentProgresso) percentProgresso.textContent = `${pct}%`;
            if (statTotal) statTotal.textContent = cttParsedResults.totalLinhas.toLocaleString('pt-PT');
            if (statSintra) statSintra.textContent = cttParsedResults.sintraCount.toLocaleString('pt-PT');
            if (statMafra) statMafra.textContent = cttParsedResults.mafraCount.toLocaleString('pt-PT');
            if (statCp7) statCp7.textContent = cttParsedResults.cp7sUnicos.size.toLocaleString('pt-PT');

            // Cede execução ao navegador para não travar a UI
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        if (labelProgresso) {
            labelProgresso.textContent = `✅ Processamento Concluído! Encontrados ${cttParsedResults.registos.length.toLocaleString('pt-PT')} registos oficiais.`;
            labelProgresso.className = "text-emerald-700 font-black";
        }

        // Amostra de Preview
        if (containerPreview && listaPreview) {
            containerPreview.classList.remove('hidden');
            const amostra = cttParsedResults.registos.slice(0, 15);
            listaPreview.innerHTML = amostra.map(r => `
                <div class="flex items-center justify-between border-b border-gray-800 pb-0.5">
                    <span class="text-white font-bold">${r.cp7}</span>
                    <span class="text-gray-300 truncate max-w-[280px]">${r.rua}</span>
                    <span class="text-emerald-400 uppercase text-[9px]">${r.concelho}</span>
                </div>
            `).join('');
        }

        if (btnDownload) btnDownload.classList.remove('hidden');

    } catch (err) {
        console.error("[SETORES] Erro ao processar ficheiro CTT:", err);
        alert("Ocorreu um erro ao processar o ficheiro. Verifique se o formato é válido.");
    } finally {
        if (btnProcessar) btnProcessar.removeAttribute('disabled');
    }
}

function descarregarNovoCp7DataJs() {
    if (cttParsedResults.registos.length === 0) {
        alert("Nenhum registo processado para gerar o ficheiro.");
        return;
    }

    // Agrupa registos por CP7
    const databaseExport = {};

    cttParsedResults.registos.forEach(r => {
        if (!databaseExport[r.cp7]) {
            // Se já tínhamos coordenadas calibradas na cache, preserva-as!
            const coordsExistentes = cp7CoordsCache[r.cp7];
            databaseExport[r.cp7] = {
                rua: r.rua,
                localidade: r.localidade,
                concelho: r.concelho,
                cpalf: r.cpalf,
                lat: coordsExistentes ? coordsExistentes.lat : null,
                lng: coordsExistentes ? coordsExistentes.lng : null
            };
        }
    });

    const fileHeader = `/**
 * cp7-data.js
 * Base Oficial de Códigos Postais (CP7) - Sintra e Mafra
 * Gerado automaticamente a partir da Base Oficial dos CTT (todos_cp.txt)
 * Data de Geração: ${new Date().toLocaleString('pt-PT')}
 * Total de CP7s Únicos: ${Object.keys(databaseExport).length}
 */

export const CP7_DATABASE = ${JSON.stringify(databaseExport, null, 2)};
`;

    const blob = new Blob([fileHeader], { type: 'text/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cp7-data.js';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    alert(`🎉 Ficheiro "cp7-data.js" gerado com sucesso!\n\nSubstitua o ficheiro js/cp7-data.js pelo ficheiro descarregado.`);
}

// =========================================================================
// CENTRALIZAÇÃO E ATUALIZAÇÃO DA INTERFACE DE SETORES (WINDOW)
// =========================================================================
export function renderizarSetoresUI() {
    if (isLocalBrickUpdating) return;

    configurarEventosConstrutor();
    renderListaBricksCriados();
    renderDetalhesBrickSelecionado();
    atualizarAuditoriaCP7();

    setTimeout(inicializarMapaDashboard, 150);
}
window.renderizarSetoresUI = renderizarSetoresUI;