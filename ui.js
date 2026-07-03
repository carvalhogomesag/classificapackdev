// ui.js
export function setupNavigation(showTab) {
    document.getElementById('nav-triagem').addEventListener('click', () => showTab('triagem'));
    document.getElementById('nav-motoristas').addEventListener('click', () => showTab('motoristas'));
    document.getElementById('nav-intervalos').addEventListener('click', () => showTab('intervalos'));
    document.getElementById('nav-rotas').addEventListener('click', () => showTab('rotas'));
}

export function showTab(tabName) {
    ['view-triagem', 'view-motoristas', 'view-intervalos', 'view-rotas'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    document.getElementById(`view-${tabName}`).classList.remove('hidden');
    
    // Reset cores navegação
    ['nav-triagem', 'nav-motoristas', 'nav-intervalos', 'nav-rotas'].forEach(id => {
        document.getElementById(id).classList.remove('text-blue-600', 'font-bold');
        document.getElementById(id).classList.add('text-gray-400', 'font-semibold');
    });
    document.getElementById(`nav-${tabName}`).classList.add('text-blue-600', 'font-bold');
    document.getElementById(`nav-${tabName}`).classList.remove('text-gray-400', 'font-semibold');
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