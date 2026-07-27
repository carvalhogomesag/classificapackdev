/**
 * main.js
 * Faz: Atua como ponto de entrada (bootstrapper) principal da app. Carrega de forma assíncrona os partials HTML, importa e ativa o estado global, e inicializa as escutas de eventos e renderizações de todos os sub-módulos.
 *      NOVO: Escuta as mudanças de utilizador do Firebase Auth, valida permissões no Firestore e gere o overlay do formulário de login de forma segura.
 *      NOVO: Inicia e pára escuta ativa do Firestore onSnapshot ao ligar e desligar sessão.
 *      NOVO: Escuta em tempo real as leituras de triagem da data de hoje para manter contagens globais automáticas.
 *      NOVO: Sincroniza e herda a rota ativa em tempo real para o driver que iniciou sessão.
 *      NOVO: Bloqueia e oculta reativamente a barra de navegação inferior global antes de iniciar sessão na nuvem.
 * NÃO faz: Não executa diretamente lógica de dados, georreferenciação ou renderizadores de listas (delegação direta aos módulos importados).
 * Depende de: ./state.js, ./storage.js, ./ui.js, ./motoristas.js, ./setores.js, ./triagem.js, ./rotas.js, ./maps.js, ./pwa.js, ./firebase-init.js
 */

import './state.js'; // Garante o arranque do estado global e migração física imediata de dados
import { saveData } from './storage.js';
import { setupNavigation, showTab, setupKeypad, setupPrefixLock, updateVisor, aplicarPermissoesPorRole } from './ui.js';
import { renderDrivers, handleDriverSubmit } from './motoristas.js';
import './setores.js'; // Ativa e regista o novo motor tátil de Bricks e atribuições
import { setupTriagemLogic, setupCancelButtons, setupVozTriagemLogic, setupCameraOcrLogic } from './triagem.js';
import { setupRotasLogic, setupModaisEdicao, setupVozLogic, sincronizarInterfaceRota } from './rotas.js';
import { setupPWAInstallationLogic } from './pwa.js';
import { inicializarGoogleAutocompleteTriagem } from './maps.js';

// Importa instâncias seguras do Firebase para o arranque de sessão
import { auth, db } from './firebase-init.js';

// ==========================================
// PALETE DE CORES DOS MOTORISTAS
// ==========================================
const colorPalette = [
    "#2563EB", "#DC2626", "#059669", "#EA580C", 
    "#7C3AED", "#DB2777", "#0891B2", "#D97706", 
    "#0D9488", "#4F46E5", "#E11D48", "#4B5563"
];

// Variáveis para guardar o cancelamento seguro de conexões ativas do Firestore
let unsubDrivers = null;
let unsubAssignments = null;
let unsubRoute = null;

// ==========================================
// ESCUTA ATIVA EM TEMPO REAL NO FIRESTORE (MOTORISTAS)
// ==========================================
function escutarDriversEmTempoReal() {
    if (unsubDrivers) {
        unsubDrivers(); // Evita conexões duplicadas abertas
    }

    console.log("[FIREBASE] A iniciar escuta em tempo real de motoristas...");
    unsubDrivers = db.collection('drivers').onSnapshot((querySnapshot) => {
        const drivers = [];
        querySnapshot.forEach((doc) => {
            drivers.push(doc.data());
        });

        // Sincroniza em memória global
        window.drivers = drivers;
        console.log("[FIREBASE] Motoristas sincronizados em tempo real:", window.drivers.length);

        // Grava no localStorage como cache secundário offline de salvaguarda
        localStorage.setItem('cp_drivers', JSON.stringify(window.drivers));

        // Redesenha instantaneamente todas as interfaces tátil
        const listaMotoristas = document.getElementById('lista-motoristas');
        if (listaMotoristas) {
            renderDrivers(window.drivers, [], listaMotoristas, window.deleteDriver, window.editDriver);
        }
        if (typeof window.renderizarSetoresUI === 'function') {
            window.renderizarSetoresUI();
        }
    }, (error) => {
        console.error("[FIREBASE] Erro ao escutar motoristas no Firestore:", error);
    });
}

// ==========================================
// ESCUTA ATIVA EM TEMPO REAL NO FIRESTORE (TRIAGENS DA DATA DE HOJE!)
// ==========================================
function escutarAssignmentsEmTempoReal() {
    if (unsubAssignments) {
        unsubAssignments();
    }

    // Filtra reativamente apenas as leituras da data de hoje para velocidade extrema no armazém!
    const hoje = new Date().toISOString().split('T')[0];
    console.log(`[FIREBASE] A escutar leituras da data de hoje (${hoje}) no Firestore...`);

    unsubAssignments = db.collection('assignments').where('date', '==', hoje)
        .onSnapshot((querySnapshot) => {
            const list = [];
            querySnapshot.forEach((doc) => {
                list.push(doc.data());
            });

            window.assignments = list;
            console.log("[FIREBASE] Leituras de hoje sincronizadas:", window.assignments.length);

            // Gravação física local como cache de salvaguarda
            localStorage.setItem('cp_assignments', JSON.stringify(window.assignments));

            // Redesenha o painel de resumo de contagem em tempo real
            if (typeof window.atualizarSummaryUI === 'function') {
                window.atualizarSummaryUI();
            }
        }, (err) => {
            console.error("[FIREBASE] Erro ao carregar triagens de hoje no Firestore:", err);
        });
}

// ==========================================
// ESCUTA ATIVA EM TEMPO REAL NO FIRESTORE (ROTA ATIVA DO DRIVER AUTENTICADO!)
// ==========================================
function escutarRotaEmTempoReal(uid) {
    if (unsubRoute) {
        unsubRoute();
    }

    console.log(`[FIREBASE] A sincronizar rota pessoal em tempo real para o UID: ${uid}`);

    unsubRoute = db.collection('routes').doc(uid).onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            window.partidaLocalizacao = data.partidaLocalizacao || null;
            window.moradasEntregas = data.moradasEntregas || [];
            window.rotaOtimizada = data.rotaOtimizada || [];
            window.dataRotaSelecionada = data.dataRotaSelecionada || "";
            window.rotaIniciada = data.rotaIniciada || false;
            console.log("[FIREBASE] Rota do condutor carregada com sucesso do Firestore.");
        } else {
            console.log("[FIREBASE] Nenhuma rota activa encontrada na nuvem. A iniciar limpo.");
            window.partidaLocalizacao = null;
            window.moradasEntregas = [];
            window.rotaOtimizada = [];
            window.dataRotaSelecionada = "";
            window.rotaIniciada = false;
        }

        // Atualiza a cache física local offline do telemóvel
        localStorage.setItem('cp_partida', JSON.stringify(window.partidaLocalizacao));
        localStorage.setItem('cp_entregas', JSON.stringify(window.moradasEntregas));
        localStorage.setItem('cp_rota_otimizada', JSON.stringify(window.rotaOtimizada));
        localStorage.setItem('cp_data_rota', JSON.stringify(window.dataRotaSelecionada));
        localStorage.setItem('cp_rota_iniciada', JSON.stringify(window.rotaIniciada));

        // Redesenha e atualiza reativamente o ecrã e o mapa do condutor
        sincronizarInterfaceRota();
    }, (err) => {
        console.error("[FIREBASE] Erro ao sincronizar rota em nuvem:", err);
    });
}

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
// GESTÃO DE FORMULÁRIOS OPERACIONAIS (MOTORISTAS)
// =========================================================================
function setupForms() {
    const formMotorista = document.getElementById('form-motorista');
    const listaMotoristas = document.getElementById('lista-motoristas');

    if (formMotorista && listaMotoristas) {
        formMotorista.addEventListener('submit', (e) => {
            handleDriverSubmit(e, window.drivers, window.selectedColor, () => {
                renderDrivers(window.drivers, [], listaMotoristas, window.deleteDriver, window.editDriver);
                window.atualizarSummaryUI();
                window.renderizarSetoresUI();
            });
        });
    }
}

// ==========================================
// CENTRALIZAÇÃO DE LIMPEZA DE LEITURAS (GRAVAÇÃO EM BATCH NO FIRESTORE!)
// ==========================================
function setupResetLeituras() {
    const btnLimparLeituras = document.getElementById('btn-limpar-leituras');
    if (btnLimparLeituras) {
        btnLimparLeituras.addEventListener('click', async () => {
            if (confirm("Deseja realmente limpar todas as leituras de hoje na nuvem?")) {
                const hoje = new Date().toISOString().split('T')[0];
                try {
                    // Consulta todas as leituras de hoje no Firestore e elimina-as em lote síncrono (Batch)
                    const snapshot = await db.collection('assignments').where('date', '==', hoje).get();
                    const batch = db.batch();
                    snapshot.forEach((doc) => {
                        batch.delete(doc.ref);
                    });
                    await batch.commit();
                    console.log("[FIREBASE] Leituras de hoje limpas com sucesso no Firestore.");
                } catch (err) {
                    console.error("[FIREBASE] Erro ao limpar leituras:", err);
                    alert("Erro de ligação: Não foi possível limpar as leituras na nuvem.");
                }
            }
        });
    }
}

// =========================================================================
// ENTRADA DE SESSÃO DO FORMULÁRIO DE LOGIN CLOUD
// =========================================================================
function setupAuthForms() {
    const formLogin = document.getElementById('form-login');
    const btnSubmit = document.getElementById('btn-login-submit');

    if (formLogin) {
        formLogin.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value.trim();
            const senha = document.getElementById('login-senha').value;

            if (btnSubmit) {
                btnSubmit.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> <span>A autenticar...</span>';
                btnSubmit.disabled = true;
            }

            try {
                await auth.signInWithEmailAndPassword(email, senha);
                console.log("[AUTH] Login efetuado com sucesso!");
            } catch (err) {
                console.error("[AUTH] Falha ao iniciar sessão:", err);
                alert("Falha ao iniciar sessão: Email ou palavra-passe incorretos.");
            } finally {
                if (btnSubmit) {
                    btnSubmit.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> <span>Entrar no Sistema</span>';
                    btnSubmit.disabled = false;
                }
            }
        });
    }

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            if (confirm("Deseja realmente terminar a sua sessão?")) {
                try {
                    await auth.signOut();
                    showTab('triagem'); // Redireciona limpo para triagem ao sair
                } catch (err) {
                    console.error("[AUTH] Erro ao terminar sessão:", err);
                }
            }
        });
    }
}

// ==========================================
// ESCUTADOR DE ALTERAÇÃO DE ESTADO DE AUTENTICAÇÃO E PERFIS DO FIRESTORE
// ==========================================
function inicializarMonitorizacaoAuth() {
    auth.onAuthStateChanged(async (user) => {
        const modalLogin = document.getElementById('modal-login');
        const btnLogout = document.getElementById('btn-logout');
        const navBarraInferior = document.getElementById('nav-barra-inferior');

        if (user) {
            console.log("[AUTH] Utilizador autenticado:", user.email);
            window.currentUserUid = user.uid; // Grava o UID na memória global de rotas

            // Revela a barra de navegação inferior global ao iniciar sessão com sucesso!
            if (navBarraInferior) navBarraInferior.classList.remove('hidden');

            // Liga o ouvinte em tempo real no Firestore para sincronizar motoristas de imediato!
            escutarDriversEmTempoReal();
            escutarAssignmentsEmTempoReal();
            escutarRotaEmTempoReal(user.uid);

            // Carrega o documento do utilizador a partir da coleção 'users' no Firestore
            try {
                const doc = await db.collection('users').doc(user.uid).get();
                if (doc.exists) {
                    const userData = doc.data();
                    const role = userData.role || 'Motorista'; // Fallback seguro
                    console.log("[AUTH] Perfil carregado do Firestore. Role:", role);
                    
                    aplicarPermissoesPorRole(role);
                } else {
                    console.warn("[AUTH] O documento do utilizador não existe. Assumindo permissões básicas.");
                    aplicarPermissoesPorRole('Motorista');
                }
            } catch (err) {
                console.error("[AUTH] Erro ao consultar perfil no Firestore:", err);
                aplicarPermissoesPorRole('Motorista');
            }

            if (modalLogin) modalLogin.classList.add('hidden'); // Desbloqueia e oculta ecrã de login
            if (btnLogout) btnLogout.classList.remove('hidden'); // Revela botão de logout
        } else {
            console.log("[AUTH] Nenhum utilizador ativo. A bloquear ecrã...");
            window.currentUserUid = null;

            // Oculta a barra de navegação inferior global de forma reativa antes de iniciar sessão!
            if (navBarraInferior) navBarraInferior.classList.add('hidden');

            // Desliga todos os ouvintes em tempo real para poupar dados de internet ao terminar sessão
            if (unsubDrivers) {
                unsubDrivers();
                unsubDrivers = null;
            }
            if (unsubAssignments) {
                unsubAssignments();
                unsubAssignments = null;
            }
            if (unsubRoute) {
                unsubRoute();
                unsubRoute = null;
            }

            if (modalLogin) modalLogin.classList.remove('hidden'); // Exibe obrigatoriamente ecrã de login
            if (btnLogout) btnLogout.classList.add('hidden'); // Oculta botão de logout
        }
    });
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
    setupAuthForms(); // Configura os eventos de login/logout
    inicializarMonitorizacaoAuth(); // Liga o monitor de segurança e acessos por perfil
    renderColorPicker();
    setupResetLeituras();
    setupRotasLogic();
    setupModaisEdicao();
    setupTriagemLogic();
    setupCancelButtons(); 
    setupPWAInstallationLogic(); 

    // 4. Desenha o estado inicial do visor numérico
    const visorCodigo = document.getElementById('visor-codigo');
    if (visorCodigo) {
        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
    }
    
    // 5. Renderizações visuais automáticas baseadas nas memórias físicas
    const listaMotoristas = document.getElementById('lista-motoristas');
    if (listaMotoristas) {
        renderDrivers(window.drivers, [], listaMotoristas, window.deleteDriver, window.editDriver);
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