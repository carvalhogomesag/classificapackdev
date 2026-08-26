/**
 * ui.js
 * Versão v76.2 - Controlo de Navegação, Interface, Ecrã de Relatórios e Permissões em Tempo Real
 * Faz: Controla a alternância entre todos os ecrãs (Triagem, Motoristas, Bricks, Rotas e Relatórios),
 *      redesenha a interface de rotas ao tocar na aba, atualiza o visor principal, teclado
 *      numérico e segurança por nível de acesso (Role Gestor vs Motorista).
 * Depende de: ./rotas.js
 */

import { sincronizarInterfaceRota } from './rotas.js';

/**
 * Configura os listeners dos botões de navegação inferior
 */
export function setupNavigation(showTab) {
    const navTriagem = document.getElementById('nav-triagem');
    const navRotas = document.getElementById('nav-rotas');
    const navMotoristas = document.getElementById('nav-motoristas');
    const navIntervalos = document.getElementById('nav-intervalos');
    const navRelatorios = document.getElementById('nav-relatorios');

    if (navTriagem) navTriagem.addEventListener('click', () => showTab('triagem'));
    if (navRotas) navRotas.addEventListener('click', () => showTab('rotas'));
    if (navMotoristas) navMotoristas.addEventListener('click', () => showTab('motoristas'));
    if (navIntervalos) navIntervalos.addEventListener('click', () => showTab('intervalos'));
    if (navRelatorios) navRelatorios.addEventListener('click', () => showTab('relatorios'));
}

/**
 * Controla a alternância visual entre os ecrãs e persiste a escolha por segurança
 */
export function showTab(tabName) {
    // Guarda o separador ativo para que ao reabrir/regressar, a app continue onde estava
    localStorage.setItem('cp_active_tab', tabName);

    const views = ['view-triagem', 'view-motoristas', 'view-intervalos', 'view-rotas', 'view-relatorios'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    const activeView = document.getElementById(`view-${tabName}`);
    if (activeView) activeView.classList.remove('hidden');
    
    // Reset dos estilos visuais dos botões da barra inferior
    ['triagem', 'rotas'].forEach(id => {
        const btn = document.getElementById(`nav-${id}`);
        if (btn) {
            btn.classList.remove('text-blue-600', 'font-bold');
            btn.classList.add('text-gray-400', 'font-semibold');
        }
    });

    const activeNav = document.getElementById(`nav-${tabName}`);
    if (activeNav) {
        activeNav.classList.add('text-blue-600', 'font-bold');
        activeNav.classList.remove('text-gray-400', 'font-semibold');
    }

    // Dispara a sincronização e carregamento de dados da respetiva aba
    if (tabName === 'intervalos' && typeof window.renderizarSetoresUI === 'function') {
        window.renderizarSetoresUI();
    }
    if (tabName === 'motoristas' && typeof window.renderizarMotoristasUI === 'function') {
        window.renderizarMotoristasUI();
    }
    if (tabName === 'relatorios' && typeof window.renderizarRelatoriosUI === 'function') {
        window.renderizarRelatoriosUI();
    }

    // 🚀 REDESENHO INSTANTÂNEO DA ABA DE ROTAS (PC E TELEMÓVEL)
    if (tabName === 'rotas') {
        sincronizarInterfaceRota();

        if (window.googleMapInstance) {
            setTimeout(() => {
                google.maps.event.trigger(window.googleMapInstance, "resize");
                if (typeof window.ajustarLimitesMapaGoogle === 'function') {
                    window.ajustarLimitesMapaGoogle();
                }
            }, 200);
        }
    }
}
window.showTab = showTab;

/**
 * Bloqueia e oculta os acessos de administração no Menu Hambúrguer para motoristas comuns
 */
export function aplicarPermissoesPorRole(role) {
    const secaoGestorMenu = document.getElementById('menu-secao-gestor');
    const badgeRole = document.getElementById('menu-user-role-badge') || document.getElementById('menu-user-role');
    const userEmailEl = document.getElementById('menu-user-email');
    const roleFormatada = (role || '').toLowerCase();
    
    window.currentUserRole = role;
    localStorage.setItem('cp_user_role', role);

    if (userEmailEl && window.currentUserEmail) {
        userEmailEl.textContent = window.currentUserEmail;
    }

    if (roleFormatada === 'gestor' || roleFormatada === 'admin' || roleFormatada === 'administrador') {
        console.log("[AUTH] A aplicar acessos de nível: Gestor.");
        if (secaoGestorMenu) secaoGestorMenu.classList.remove('hidden');
        if (badgeRole) {
            badgeRole.textContent = "GESTOR (ACESSO TOTAL)";
            badgeRole.className = "text-[10px] font-black uppercase text-emerald-600";
        }
    } else {
        console.log("[AUTH] A aplicar restrições de nível: Motorista.");
        if (secaoGestorMenu) secaoGestorMenu.classList.add('hidden');
        if (badgeRole) {
            badgeRole.textContent = "MOTORISTA";
            badgeRole.className = "text-[10px] font-black uppercase text-blue-600";
        }
        
        // Se estiver num ecrã restrito, redireciona o utilizador para a triagem
        const activeTab = localStorage.getItem('cp_active_tab') || 'triagem';
        if (activeTab === 'motoristas' || activeTab === 'intervalos' || activeTab === 'relatorios') {
            showTab('triagem');
        }
    }
}
window.aplicarPermissoesPorRole = aplicarPermissoesPorRole;

/**
 * Atualiza o painel visor do código postal
 */
export function updateVisor(isPrefixLocked, lockedPrefixValue, currentInput, visorCodigo) {
    let output = "";
    if (isPrefixLocked) {
        const prefix = lockedPrefixValue.padEnd(4, '_');
        const suffix = currentInput.padEnd(3, '_');
        output = `${prefix}-${suffix}`;
    } else {
        const full = currentInput.padEnd(7, '_');
        output = `${full.slice(0, 4)}-${full.slice(4, 7)}`;
    }
    if (visorCodigo) visorCodigo.textContent = output;
}

/**
 * Configura o funcionamento do teclado numérico gigante
 */
export function setupKeypad() {
    const visorCodigo = document.getElementById('visor-codigo');
    
    document.querySelectorAll('.btn-key').forEach(button => {
        button.addEventListener('click', () => {
            const val = button.getAttribute('data-val');
            const maxDigits = window.isPrefixLocked ? 3 : 7;
            if (window.currentInput.length < maxDigits) {
                window.currentInput += val;
                if (visorCodigo) updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
                
                // Quando atinge o número total de dígitos, despoleta de imediato a triagem
                if (window.currentInput.length === maxDigits) {
                    const btnAnalisar = document.getElementById('btn-analisar');
                    if (btnAnalisar) {
                        btnAnalisar.click();
                    }
                }
            }
        });
    });

    const btnClear = document.getElementById('btn-key-clear');
    if (btnClear) {
        btnClear.addEventListener('click', () => {
            window.currentInput = "";
            if (visorCodigo) updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
        });
    }

    const btnBackspace = document.getElementById('btn-key-backspace');
    if (btnBackspace) {
        btnBackspace.addEventListener('click', () => {
            window.currentInput = window.currentInput.slice(0, -1);
            if (visorCodigo) updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
        });
    }
}

/**
 * Configura o travamento de prefixo de código postal
 */
export function setupPrefixLock() {
    const chkFixarPrefixo = document.getElementById('chk-fixar-prefixo');
    const inputPrefixo = document.getElementById('input-prefixo');
    const visorCodigo = document.getElementById('visor-codigo');

    if (!chkFixarPrefixo || !inputPrefixo || !visorCodigo) return;

    chkFixarPrefixo.addEventListener('change', (e) => {
        window.isPrefixLocked = e.target.checked;
        if (window.isPrefixLocked) {
            inputPrefixo.disabled = false;
            inputPrefixo.classList.remove('bg-gray-200', 'text-gray-500');
            inputPrefixo.classList.add('bg-white', 'text-gray-900');
            inputPrefixo.focus();
            
            window.lockedPrefixValue = sanitizeDigits(inputPrefixo.value).substring(0, 4);
            if (!window.lockedPrefixValue) {
                window.lockedPrefixValue = "2640";
                inputPrefixo.value = "2640";
            }
        } else {
            inputPrefixo.disabled = true;
            inputPrefixo.classList.add('bg-gray-200', 'text-gray-500');
            inputPrefixo.classList.remove('bg-white', 'text-gray-900');
        }
        window.currentInput = ""; 
        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
    });

    inputPrefixo.addEventListener('input', (e) => {
        let val = sanitizeDigits(e.target.value).substring(0, 4);
        e.target.value = val;
        window.lockedPrefixValue = val;
        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
    });
}

function sanitizeDigits(str) { 
    return str.replace(/\D/g, ''); 
}