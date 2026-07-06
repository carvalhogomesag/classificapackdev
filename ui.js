// ui.js

/**
 * Configura os listeners dos botões de navegação inferior
 */
export function setupNavigation(showTab) {
    document.getElementById('nav-triagem').addEventListener('click', () => showTab('triagem'));
    document.getElementById('nav-motoristas').addEventListener('click', () => showTab('motoristas'));
    document.getElementById('nav-intervalos').addEventListener('click', () => showTab('intervalos'));
    document.getElementById('nav-rotas').addEventListener('click', () => showTab('rotas'));
}

/**
 * Controla a alternância visual entre os ecrãs e persiste a escolha por segurança
 */
export function showTab(tabName) {
    // Guarda o separador ativo para que ao reabrir/regressar, a app continue onde estava
    localStorage.setItem('cp_active_tab', tabName);

    const views = ['view-triagem', 'view-motoristas', 'view-intervalos', 'view-rotas'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    const activeView = document.getElementById(`view-${tabName}`);
    if (activeView) activeView.classList.remove('hidden');
    
    // Reset dos estilos visuais dos botões do menu
    ['triagem', 'motoristas', 'intervalos', 'rotas'].forEach(id => {
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

    // Corrige renderização do mapa Google se entrar na aba Rotas
    if (tabName === 'rotas' && window.googleMapInstance) {
        setTimeout(() => {
            google.maps.event.trigger(window.googleMapInstance, "resize");
            if (window.rotaOtimizada && window.rotaOtimizada.length > 0) {
                window.ajustarLimitesMapaGoogle();
            }
        }, 200);
    }
}

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
                window.lockedPrefixValue = "2700";
                inputPrefixo.value = "2700";
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