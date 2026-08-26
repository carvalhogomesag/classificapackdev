/**
 * main.js
 * Versão v76.6 - Com Fecho de Turno Atómico e Persistência Resiliente
 * Faz: Atua como ponto de entrada principal da app. Restaura o estado de rotas do LocalStorage,
 *      sincroniza Firestore em tempo real permitindo tanto a proteção contra perda no F5
 *      quanto o encerramento limpo e definitivo do turno.
 * Depende de: ./state.js, ./storage.js, ./ui.js, ./motoristas.js, ./setores.js, ./triagem.js, ./rotas.js, ./maps.js, ./pwa.js, ./ui-menu.js, ./firebase-init.js
 */

import './state.js'; // Garante o arranque do estado global
import { saveData, safeJSONParse } from './storage.js';
import { setupNavigation, showTab, setupKeypad, setupPrefixLock, updateVisor, aplicarPermissoesPorRole } from './ui.js';
import { renderDrivers, handleDriverSubmit } from './motoristas.js';
import './setores.js';
import { setupTriagemLogic, setupCancelButtons, setupVozTriagemLogic, setupCameraOcrLogic } from './triagem.js';
import { setupRotasLogic, setupModaisEdicao, setupVozLogic, sincronizarInterfaceRota, sincronizarPersistencia } from './rotas.js';
import { setupPWAInstallationLogic } from './pwa.js';
import { inicializarGoogleAutocompleteTriagem } from './maps.js';
import { setupMenuLateral } from './ui-menu.js';

// Importa instâncias seguras do Firebase
import { auth, db } from './firebase-init.js';

// =========================================================================
// PALETE DE CORES DOS MOTORISTAS (ALTO CONTRASTE)
// =========================================================================
const colorPalette = [
    "#E31A1C", // Vermelho Vivo
    "#1F78B4", // Azul Real
    "#33A02C", // Verde Kelly
    "#FF7F00", // Laranja Puro
    "#6A3D9A", // Roxo Intenso
    "#FFD700", // Amarelo Ouro
    "#F012BE", // Rosa Magenta
    "#00A3E0", // Azul Ciano/Capri
    "#8B4513", // Castanho Terra
    "#85E000", // Verde Lima
    "#001F3F", // Azul Marinho Escuro
    "#008080"  // Verde Teal
];

// Variáveis para guardar o cancelamento seguro de conexões ativas do Firestore
let unsubDrivers = null;
let unsubAssignments = null;
let unsubRoute = null;

// =========================================================================
// RESTAURAÇÃO INSTANTÂNEA DO LOCALSTORAGE NO ARRANQUE
// =========================================================================
function restaurarEstadoLocalImediato() {
    try {
        window.partidaLocalizacao = safeJSONParse('cp_partida', null);
        window.moradasEntregas = safeJSONParse('cp_entregas', []);
        window.rotaOtimizada = safeJSONParse('cp_rota_otimizada', []);
        window.dataRotaSelecionada = safeJSONParse('cp_data_rota', "");
        window.rotaIniciada = safeJSONParse('cp_rota_iniciada', false);
        window.isRouteOptimized = safeJSONParse('cp_is_route_optimized', false);
        window.routingMethodUsed = localStorage.getItem('cp_routing_method') || 'Cloud';

        window.tripStarted = safeJSONParse('cp_trip_started', false);
        window.tripCompleted = safeJSONParse('cp_trip_completed', false);
        window.odometerStart = safeJSONParse('cp_odometer_start', 0);
        window.odometerStartHour = safeJSONParse('cp_odometer_start_hour', "");
        window.odometerEnd = safeJSONParse('cp_odometer_end', 0);
        window.odometerEndHour = safeJSONParse('cp_odometer_end_hour', "");
        window.lastOdometer = safeJSONParse('cp_last_odometer', 0);

        console.log(`[BOOT] Estado restaurado: rotaIniciada = ${window.rotaIniciada}, ${window.moradasEntregas.length} paragens.`);
    } catch (e) {
        console.warn("[BOOT] Aviso ao restaurar estado local:", e);
    }
}

// ==========================================
// ESCUTA ATIVA EM TEMPO REAL NO FIRESTORE (MOTORISTAS)
// ==========================================
function escutarDriversEmTempoReal() {
    if (unsubDrivers) {
        unsubDrivers();
    }

    console.log("[FIREBASE] A iniciar escuta em tempo real de motoristas...");
    unsubDrivers = db.collection('drivers').onSnapshot((querySnapshot) => {
        const drivers = [];
        querySnapshot.forEach((doc) => {
            drivers.push(doc.data());
        });

        window.drivers = drivers;
        console.log("[FIREBASE] Motoristas sincronizados em tempo real:", window.drivers.length);

        localStorage.setItem('cp_drivers', JSON.stringify(window.drivers));

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
// ESCUTA ATIVA EM TEMPO REAL NO FIRESTORE (TRIAGENS DE HOJE)
// ==========================================
function escutarAssignmentsEmTempoReal() {
    if (unsubAssignments) {
        unsubAssignments();
    }

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

            localStorage.setItem('cp_assignments', JSON.stringify(window.assignments));

            if (typeof window.atualizarSummaryUI === 'function') {
                window.atualizarSummaryUI();
            }
        }, (err) => {
            console.error("[FIREBASE] Erro ao carregar triagens de hoje no Firestore:", err);
        });
}

// ==========================================
// ESCUTA ATIVA NO FIRESTORE COM FECHO DE TURNO CORRETO E PROTEÇÃO ANTI-PERDA
// ==========================================
function escutarRotaEmTempoReal(uid) {
    if (unsubRoute) {
        unsubRoute();
    }

    console.log(`[FIREBASE] A sincronizar rota em tempo real para o UID: ${uid}`);

    unsubRoute = db.collection('routes').doc(uid).onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            const cloudRotaIniciada = Boolean(data.rotaIniciada);
            const cloudEntregas = Array.isArray(data.moradasEntregas) ? data.moradasEntregas : [];

            // Se a nuvem indica que o turno NÃO está iniciado (turno encerrado):
            if (!cloudRotaIniciada) {
                window.rotaIniciada = false;
                window.isRouteOptimized = false;
                window.tripStarted = false;
                window.tripCompleted = Boolean(data.tripCompleted);
                window.moradasEntregas = [];
                window.rotaOtimizada = [];
                window.partidaLocalizacao = null;
                window.dataRotaSelecionada = "";
                window.odometerStart = 0;
                window.odometerStartHour = "";
                window.odometerEnd = 0;
                window.odometerEndHour = "";
            } else {
                // Turno ATIVO na nuvem:
                window.rotaIniciada = true;
                window.isRouteOptimized = Boolean(data.isRouteOptimized);
                window.tripStarted = Boolean(data.tripStarted);
                window.tripCompleted = false;
                window.partidaLocalizacao = data.partidaLocalizacao || null;
                window.moradasEntregas = cloudEntregas;
                window.rotaOtimizada = Array.isArray(data.rotaOtimizada) ? data.rotaOtimizada : [];
                window.dataRotaSelecionada = data.dataRotaSelecionada || "";
                window.routingMethodUsed = data.routingMethodUsed || 'Cloud';
                window.odometerStart = data.odometerStart || 0;
                window.odometerStartHour = data.odometerStartHour || "";
                window.odometerEnd = data.odometerEnd || 0;
                window.odometerEndHour = data.odometerEndHour || "";
                window.lastOdometer = data.lastOdometer || 0;
            }

            console.log(`[FIREBASE] Rota atualizada da nuvem: rotaIniciada = ${window.rotaIniciada}, ${window.moradasEntregas.length} paragens.`);
        } else {
            console.log("[FIREBASE] Nenhum documento de rota na nuvem.");
        }

        // Persistência local síncrona
        saveData(
            window.drivers, 
            [], 
            window.assignments,
            window.partidaLocalizacao,
            window.moradasEntregas,
            window.rotaOtimizada,
            window.dataRotaSelecionada, 
            window.rotaIniciada
        );

        localStorage.setItem('cp_is_route_optimized', JSON.stringify(window.isRouteOptimized || false));
        localStorage.setItem('cp_routing_method', window.routingMethodUsed || 'Cloud');
        localStorage.setItem('cp_trip_started', JSON.stringify(window.tripStarted || false));
        localStorage.setItem('cp_trip_completed', JSON.stringify(window.tripCompleted || false));
        localStorage.setItem('cp_odometer_start', JSON.stringify(window.odometerStart || 0));
        localStorage.setItem('cp_odometer_start_hour', JSON.stringify(window.odometerStartHour || ""));
        localStorage.setItem('cp_odometer_end', JSON.stringify(window.odometerEnd || 0));
        localStorage.setItem('cp_odometer_end_hour', JSON.stringify(window.odometerEndHour || ""));
        localStorage.setItem('cp_last_odometer', JSON.stringify(window.lastOdometer || 0));

        sincronizarInterfaceRota();
    }, (err) => {
        console.error("[FIREBASE] Erro ao escutar rota na nuvem:", err);
    });
}

// =========================================================================
// CARREGADOR ASSÍNCRONO DOS FICHEIROS PARCIAIS
// =========================================================================
async function carregarPartials() {
    const partials = [
        { id: 'container-view-triagem', path: 'partials/triagem.html' },
        { id: 'container-view-motoristas', path: 'partials/motoristas.html' },
        { id: 'container-view-intervalos', path: 'partials/setores.html' },
        { id: 'container-view-rotas', path: 'partials/rotas.html' },
        { id: 'container-view-relatorios', path: 'partials/relatorios.html' }
    ];

    for (const p of partials) {
        const el = document.getElementById(p.id);
        if (el) {
            try {
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
                    
                    const btnAnalisar = document.getElementById('btn-analisar');
                    if (btnAnalisar) btnAnalisar.click();
                } else if (cleanCode.length >= 4) {
                    window.currentInput = cleanCode;
                    const visorCodigo = document.getElementById('visor-codigo');
                    if (visorCodigo) {
                        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
                    }
                    alert(`A morada selecionada contém apenas um código postal parcial (${postalCode}). Por favor, complete os 3 dígitos.`);
                }
            } else {
                alert("O Google não conseguiu extrair um Código Postal de 7 dígitos. Introduza manualmente.");
            }
            buscaMoradaTriagemInput.value = "";
        });
    }
}

function carregarGoogleMapsScript() {
    if (typeof google !== 'undefined' && google.maps && google.maps.places) {
        inicializarTodosAutocompletes();
        return;
    }

    if (typeof GOOGLE_MAPS_API_KEY === 'undefined' || !GOOGLE_MAPS_API_KEY) {
        console.error("Chave de API do Google Maps não configurada.");
        return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => inicializarTodosAutocompletes();
    document.head.appendChild(script);
}

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

function setupResetLeituras() {
    const btnLimparLeituras = document.getElementById('btn-limpar-leituras');
    if (btnLimparLeituras) {
        btnLimparLeituras.addEventListener('click', async () => {
            if (confirm("Deseja realmente limpar todas as leituras de hoje na nuvem?")) {
                const hoje = new Date().toISOString().split('T')[0];
                try {
                    const snapshot = await db.collection('assignments').where('date', '==', hoje).get();
                    const batch = db.batch();
                    snapshot.forEach((doc) => batch.delete(doc.ref));
                    await batch.commit();
                    console.log("[FIREBASE] Leituras de hoje limpas com sucesso.");
                } catch (err) {
                    console.error("[FIREBASE] Erro ao limpar leituras:", err);
                }
            }
        });
    }
}

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
}

function inicializarMonitorizacaoAuth() {
    auth.onAuthStateChanged(async (user) => {
        const modalLogin = document.getElementById('modal-login');
        const btnLogout = document.getElementById('btn-logout');
        const navBarraInferior = document.getElementById('nav-barra-inferior');

        if (user) {
            window.currentUserUid = user.uid;
            window.currentUserEmail = user.email;

            console.log(`[AUTH] Utilizador ativo: ${user.email} (UID: ${user.uid})`);

            if (navBarraInferior) navBarraInferior.classList.remove('hidden');

            escutarDriversEmTempoReal();
            escutarAssignmentsEmTempoReal();
            escutarRotaEmTempoReal(user.uid);

            try {
                const userDocRef = db.collection('users').doc(user.uid);
                const doc = await userDocRef.get();
                
                let userRole = 'Motorista';

                if (doc.exists) {
                    const data = doc.data();
                    userRole = data.role || 'Motorista';
                    await userDocRef.set({ 
                        email: user.email,
                        lastLogin: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                } else {
                    await userDocRef.set({
                        email: user.email,
                        role: 'Motorista',
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                }

                console.log(`[AUTH] Permissões aplicadas: Role "${userRole}"`);
                aplicarPermissoesPorRole(userRole);
            } catch (err) {
                console.warn("[AUTH] Aviso ao verificar permissões:", err);
                aplicarPermissoesPorRole('Motorista');
            }

            if (modalLogin) modalLogin.classList.add('hidden');
            if (btnLogout) btnLogout.classList.remove('hidden');
        } else {
            window.currentUserUid = null;
            window.currentUserEmail = null;

            if (navBarraInferior) navBarraInferior.classList.add('hidden');

            if (unsubDrivers) { unsubDrivers(); unsubDrivers = null; }
            if (unsubAssignments) { unsubAssignments(); unsubAssignments = null; }
            if (unsubRoute) { unsubRoute(); unsubRoute = null; }

            if (modalLogin) modalLogin.classList.remove('hidden');
            if (btnLogout) btnLogout.classList.add('hidden');
        }
    });
}

// =========================================================================
// CICLO DE VIDA DO DOM
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Restauração imediata offline-first do disco
    restaurarEstadoLocalImediato();

    // 2. Carregamento dos componentes HTML parciais e scripts
    await carregarPartials();
    carregarGoogleMapsScript();

    setupNavigation(showTab);
    setupKeypad();
    setupPrefixLock();
    setupForms();
    setupAuthForms();
    inicializarMonitorizacaoAuth();
    renderColorPicker();
    setupResetLeituras();
    setupRotasLogic();
    setupModaisEdicao();
    setupTriagemLogic();
    setupCancelButtons(); 
    setupPWAInstallationLogic();
    setupMenuLateral();

    const visorCodigo = document.getElementById('visor-codigo');
    if (visorCodigo) {
        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
    }
    
    const listaMotoristas = document.getElementById('lista-motoristas');
    if (listaMotoristas) {
        renderDrivers(window.drivers, [], listaMotoristas, window.deleteDriver, window.editDriver);
    }
    
    if (typeof window.renderizarSetoresUI === 'function') window.renderizarSetoresUI();
    if (typeof window.atualizarSummaryUI === 'function') window.atualizarSummaryUI();
    
    // 3. Sincroniza a interface da rota
    sincronizarInterfaceRota();

    const activeTab = localStorage.getItem('cp_active_tab') || 'triagem';
    showTab(activeTab);

    document.addEventListener('touchend', (e) => {
        const itemSugerido = e.target.closest('.pac-item');
        if (itemSugerido) itemSugerido.click();
    }, { passive: true });
});