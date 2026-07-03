// ui.js
export function setupNavigation(showTab) {
    document.getElementById('nav-triagem').addEventListener('click', () => showTab('triagem'));
    document.getElementById('nav-motoristas').addEventListener('click', () => showTab('motoristas'));
    document.getElementById('nav-intervalos').addEventListener('click', () => showTab('intervalos'));
    document.getElementById('nav-rotas').addEventListener('click', () => showTab('rotas'));
}

export function showTab(tabName) {
    const views = ['view-triagem', 'view-motoristas', 'view-intervalos', 'view-rotas'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    const activeView = document.getElementById(`view-${tabName}`);
    if (activeView) activeView.classList.remove('hidden');
    
    // Reset estilos navegação
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

    // Corrige renderização do mapa se entrar na aba Rotas
    if (tabName === 'rotas' && window.googleMapInstance) {
        setTimeout(() => {
            google.maps.event.trigger(window.googleMapInstance, "resize");
            if (window.rotaOtimizada && window.rotaOtimizada.length > 0) {
                window.ajustarLimitesMapaGoogle();
            }
        }, 200);
    }
}

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
    visorCodigo.textContent = output;
}