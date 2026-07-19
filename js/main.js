/**
 * main.js
 * Faz: Atua como ponto de entrada (bootstrapper) principal da app. Carrega de forma assíncrona os partials HTML, importa e ativa o estado global, e inicializa as escutas de eventos e renderizações de todos os sub-módulos.
 * NÃO faz: Não executa diretamente lógica de dados, georreferenciação ou renderizadores de listas (delegação direta aos módulos importados).
 * Depende de: ./state.js, ./storage.js, ./ui.js, ./motoristas.js, ./setores.js, ./triagem.js, ./rotas.js, ./maps.js, ./pwa.js
 */

import './state.js'; // Garante o arranque do estado global e migração física imediata de dados
import { saveData } from './storage.js';
import { setupNavigation, showTab, setupKeypad, setupPrefixLock, updateVisor } from './ui.js';
import { renderDrivers, handleDriverSubmit } from './motoristas.js';
import { handleSectorSubmit } from './setores.js';
import { setupTriagemLogic, setupCancelButtons, setupVozTriagemLogic, setupCameraOcrLogic } from './triagem.js';
import { setupRotasLogic, setupModaisEdicao, setupVozLogic, sincronizarInterfaceRota } from './rotas.js';
import { setupPWAInstallationLogic } from './pwa.js';
import { inicializarGoogleAutocompleteTriagem } from './maps.js';

// ==========================================
// PALETE DE CORES DOS MOTORISTAS
// ==========================================
const colorPalette = [
    "#2563EB", "#DC2626", "#059669", "#EA580C", 
    "#7C3AED", "#DB2777", "#0891B2", "#D97706", 
    "#0D9488", "#4F46E5", "#E11D48", "#4B5563"
];

// =========================================================================
// CARREGADOR ASSÍNCRONO DOS FICHEIROS PARCIAIS (TEMPLATES HTML)
// =========================================================================
async function carregarPartials() {
    const partials = [
        { id: 'container-view-triagem', path: 'partials/triagem.html' },
        { id: 'container-view-motoristas', path: 'partials/motoristas.html' },
        { id: 'container-view-intervalos', path: 'partials/setores.html' },
        { id: 'container-view-rotas', path: 'partials/rotas.html' }
    ];

    for (const p of partials) {
        const el = document.getElementById(p.id);
        if (el) {
            try {
                // Caminhos relativos para total portabilidade em servidores de produção e PWA local
                const response = await fetch(p.path);
                if (response.ok) {
                    el.innerHTML = await response.text();
                } else {
                    console.error(`Erro ao carregar ficheiro HTML parcial: ${p.path}`);
                }
            } catch (err) {
                console.error(`Erro de rede ao ligar ao ficheiro parcial: ${p.path}`, err);
            }
        }
    }
}

// ==========================================
// INICIALIZAÇÃO DO AUTOCOMPLETE DE MORADAS
// ==========================================
// NOTA: o autocomplete de morada das ROTAS foi removido daqui de propósito.
// A criação de rotas passou a exigir o Código Postal como campo obrigatório
// (verdade absoluta), com morada apenas como complemento opcional — fluxo
// tratado por processarAdicaoPorPostal() dentro de rotas.js, não por aqui.
function inicializarTodosAutocompletes() {
    const buscaMoradaTriagemInput = document.getElementById('busca-morada-triagem');
    if (buscaMoradaTriagemInput) {
        inicializarGoogleAutocompleteTriagem(buscaMoradaTriagemInput, (postalCode, formattedAddress) => {
            if (postalCode) {
                const cleanCode = postalCode.replace(/\D/g, '');
                
                if (cleanCode.length === 7) {
                    window.currentInput = cleanCode;
                    
                    const visorCodigo = document.getElementById('visor-codigo');
                    if (visorCodigo) {
                        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
                    }
                    
                    console.log(`Código Postal georreferenciado: ${postalCode}. A processar triagem...`);
                    
                    const btnAnalisar = document.getElementById('btn-analisar');
                    if (btnAnalisar) {
                        btnAnalisar.click();
                    }
                } else if (cleanCode.length >= 4) {
                    window.currentInput = cleanCode;
                    const visorCodigo = document.getElementById('visor-codigo');
                    if (visorCodigo) {
                        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
                    }
                    alert(`A morada selecionada contém apenas um código postal parcial (${postalCode}). Por favor, complete os 3 dígitos restantes usando o teclado.`);
                }
            } else {
                alert("O Google encontrou o endereço mas não conseguiu extrair um Código Postal de 7 dígitos específico. Por favor, introduza manualmente.");
            }
            
            buscaMoradaTriagemInput.value = "";
        });
    }
}

// =========================================================================
// CARREGAMENTO SEGURO DO SDK GOOGLE MAPS DESDE CDN
// =========================================================================
function carregarGoogleMapsScript() {
    if (typeof google !== 'undefined' && google.maps && google.maps.places) {
        console.log("Google Maps já carregado em cache. Inicializando inputs...");
        inicializarTodosAutocompletes();
        return;
    }

    if (typeof GOOGLE_MAPS_API_KEY === 'undefined' || !GOOGLE_MAPS_API_KEY) {
        console.error("Chave de API do Google Maps não foi configurada no config.js.");
        return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
        console.log("Google Maps SDK carregado pela primeira vez.");
        inicializarTodosAutocompletes();
    };
    script.onerror = () => console.error("Falha ao efetuar download do SDK do Google Maps.");
    document.head.appendChild(script);
}

// =========================================================================
// RENDERIZADOR DA PALETE DE CORES VISUAL PARA MOTORISTAS
// =========================================================================
function renderColorPicker() {
    const colorPickerContainer = document.getElementById('color-picker-container');
    if (!colorPickerContainer) return;

    colorPickerContainer.innerHTML = "";
    colorPalette.forEach((color, idx) => {
        const btn = document.createElement('button');
        btn.type = "button";
        btn.style.backgroundColor = color;
        btn.className = `h-10 w-full rounded-lg border-2 transition-all duration-150 ${idx === 0 ? 'border-black scale-110' : 'border-transparent'}`;
        btn.addEventListener('click', () => {
            window.selectedColor = color;
            Array.from(colorPickerContainer.children).forEach(child => {
                child.classList.remove('border-black', 'scale-110');
                child.classList.add('border-transparent');
            });
            btn.classList.add('border-black', 'scale-110');
        });
        colorPickerContainer.appendChild(btn);
    });
}

// =========================================================================
// GESTÃO DE FORMULÁRIOS OPERACIONAIS (MOTORISTAS E SETORES)
// =========================================================================
function setupForms() {
    const formMotorista = document.getElementById('form-motorista');
    const formSetor = document.getElementById('form-setor');
    const listaMotoristas = document.getElementById('lista-motoristas');

    if (formMotorista && listaMotoristas) {
        formMotorista.addEventListener('submit', (e) => {
            handleDriverSubmit(e, window.drivers, window.selectedColor, () => {
                renderDrivers(window.drivers, window.sectors, listaMotoristas, window.deleteDriver, window.editDriver);
                window.atualizarSummaryUI();
                window.renderizarSetoresUI();
            });
        });
    }

    if (formSetor) {
        formSetor.addEventListener('submit', (e) => {
            handleSectorSubmit(e, window.sectors, () => {
                window.renderizarSetoresUI();
                if (listaMotoristas) {
                    renderDrivers(window.drivers, window.sectors, listaMotoristas, window.deleteDriver, window.editDriver);
                }
            });
        });
    }
}

// ==========================================
// CENTRALIZAÇÃO DA LIMPEZA DE LEITURAS
// ==========================================
function setupResetLeituras() {
    const btnLimparLeituras = document.getElementById('btn-limpar-leituras');
    if (btnLimparLeituras) {
        btnLimparLeituras.addEventListener('click', () => {
            if (confirm("Deseja realmente limpar todas as leituras?")) {
                window.assignments = [];
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
                window.atualizarSummaryUI();
            }
        });
    }
}

// =========================================================================
// CICLO DE VIDA DO DOM: CARREGAMENTO DE FICHEIROS E ATIVAÇÃO DOS MÓDULOS
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Descarrega os ecrãs parciais e injeta-os nas tags corretas do index.html
    await carregarPartials();

    // 2. Dispara a ligação ao SDK da Google
    carregarGoogleMapsScript();

    // 3. Inicializa todos os subsistemas operacionais agora que os ecrãs já existem no DOM
    setupNavigation(showTab);
    setupKeypad();
    setupPrefixLock();
    setupForms();
    renderColorPicker();
    setupResetLeituras();
    setupRotasLogic();
    setupModaisEdicao();
    setupTriagemLogic();
    setupCancelButtons(); 
    setupVozLogic(); 
    setupVozTriagemLogic(); 
    setupCameraOcrLogic(); 
    setupPWAInstallationLogic(); 

    // 4. Desenha o estado inicial do visor numérico
    const visorCodigo = document.getElementById('visor-codigo');
    if (visorCodigo) {
        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
    }
    
    // 5. Renderizações visuais automáticas baseadas nas memórias físicas do telemóvel
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
    
    sincronizarInterfaceRota();

    // 6. Restaura de forma persistente o separador ativo aberto antes do fecho da app
    const activeTab = localStorage.getItem('cp_active_tab') || 'triagem';
    showTab(activeTab);

    // 7. Correção tátil para telemóveis (evita falhas de duplo toque nas sugestões do Google Autocomplete)
    document.addEventListener('touchend', (e) => {
        const itemSugerido = e.target.closest('.pac-item');
        if (itemSugerido) {
            itemSugerido.click();
        }
    }, { passive: true });
});