/**
 * js/ui-menu.js
 * Versão v74.3 - Módulo Modularizado de Gestão do Menu Lateral e Sub-Modais
 * Faz: Auto-inicializa a abertura/fecho do menu lateral em lista limpa e controla
 *      individualmente os 3 modais dedicados (Navegador Preferido, Prefixo Padrão
 *      e Relatórios do Gestor), além da exibição de conta ativa e fecho de sessão (logout).
 * Depende de: ./navigation.js, ./firebase-init.js
 */

import { obterNavegadorPreferido, definirNavegadorPreferido } from './navigation.js';

/**
 * Retorna o prefixo padrão de 4 dígitos guardado (ou '2640' por omissão)
 */
export function obterPrefixoPadrao() {
    return localStorage.getItem('cp_default_prefix') || '2640';
}

/**
 * Guarda o prefixo padrão sanitizado (4 dígitos)
 */
export function definirPrefixoPadrao(prefix) {
    const cleanPrefix = (prefix || '').replace(/\D/g, '').substring(0, 4);
    const finalPrefix = cleanPrefix.length === 4 ? cleanPrefix : '2640';
    localStorage.setItem('cp_default_prefix', finalPrefix);
    console.log(`[MENU] Prefixo padrão guardado: ${finalPrefix}`);
    return finalPrefix;
}

/**
 * Atualiza os textos/subtítulos visíveis no menu lateral com base nas preferências guardadas
 */
function atualizarSubtitulosMenu() {
    const subNav = document.getElementById('menu-subtitulo-navegador');
    const subPref = document.getElementById('menu-subtitulo-prefixo');

    if (subNav) {
        const navAtual = obterNavegadorPreferido();
        subNav.textContent = navAtual === 'waze' ? 'Waze' : 'Google Maps';
    }

    if (subPref) {
        const prefixoAtual = obterPrefixoPadrao();
        subPref.textContent = `CP: ${prefixoAtual}-`;
    }
}

/**
 * Atualiza os estilos visuais dos botões de seleção de navegador dentro do modal
 */
function atualizarEstilosModalNavegador() {
    const navAtual = obterNavegadorPreferido();
    const botoesNav = document.querySelectorAll('.pref-nav-btn');

    botoesNav.forEach(btn => {
        const navType = btn.getAttribute('data-nav');
        if (navType === navAtual) {
            btn.className = "pref-nav-btn p-4 rounded-2xl border-2 border-blue-600 text-xs font-black text-center flex flex-col items-center justify-center space-y-2 bg-blue-50 text-blue-700 shadow-sm transition-all cursor-pointer ring-2 ring-blue-400/30";
        } else {
            btn.className = "pref-nav-btn p-4 rounded-2xl border border-gray-200 text-xs font-bold text-center flex flex-col items-center justify-center space-y-2 bg-gray-50 text-gray-700 hover:bg-gray-100 transition-all cursor-pointer opacity-70 hover:opacity-100";
        }
    });
}

/**
 * Configuração dos 3 Modais Dedicados do Menu
 */
function configurarModaisDoMenu() {
    // -------------------------------------------------------------
    // 1. MODAL DE NAVEGADOR PREFERIDO
    // -------------------------------------------------------------
    const itemMenuNav = document.getElementById('menu-item-navegador');
    const modalNav = document.getElementById('modal-menu-navegador');
    const btnFecharNavX = document.getElementById('btn-fechar-modal-nav');
    const btnFecharNavOk = document.getElementById('btn-fechar-modal-nav-ok');
    const botoesNav = document.querySelectorAll('.pref-nav-btn');

    const fecharModalNav = () => {
        if (modalNav) modalNav.classList.add('hidden');
        atualizarSubtitulosMenu();
    };

    if (itemMenuNav && modalNav && !itemMenuNav.dataset.bound) {
        itemMenuNav.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            atualizarEstilosModalNavegador();
            modalNav.classList.remove('hidden');
        });
        itemMenuNav.dataset.bound = "true";
    }

    if (btnFecharNavX) btnFecharNavX.onclick = fecharModalNav;
    if (btnFecharNavOk) btnFecharNavOk.onclick = fecharModalNav;

    botoesNav.forEach(btn => {
        btn.onclick = () => {
            const navEscolha = btn.getAttribute('data-nav');
            definirNavegadorPreferido(navEscolha);
            atualizarEstilosModalNavegador();
            atualizarSubtitulosMenu();
        };
    });

    // -------------------------------------------------------------
    // 2. MODAL DE PREFIXO PADRÃO
    // -------------------------------------------------------------
    const itemMenuPrefixo = document.getElementById('menu-item-prefixo');
    const modalPrefixo = document.getElementById('modal-menu-prefixo');
    const inputPrefixo = document.getElementById('input-modal-prefixo');
    const btnFecharPrefX = document.getElementById('btn-fechar-modal-prefixo');
    const btnCancelarPref = document.getElementById('btn-cancelar-modal-prefixo');
    const btnSalvarPref = document.getElementById('btn-salvar-modal-prefixo');

    const fecharModalPrefixo = () => {
        if (modalPrefixo) modalPrefixo.classList.add('hidden');
    };

    if (itemMenuPrefixo && modalPrefixo && !itemMenuPrefixo.dataset.bound) {
        itemMenuPrefixo.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (inputPrefixo) {
                inputPrefixo.value = obterPrefixoPadrao();
            }
            modalPrefixo.classList.remove('hidden');
            setTimeout(() => {
                if (inputPrefixo) {
                    inputPrefixo.focus();
                    inputPrefixo.select();
                }
            }, 100);
        });
        itemMenuPrefixo.dataset.bound = "true";
    }

    if (btnFecharPrefX) btnFecharPrefX.onclick = fecharModalPrefixo;
    if (btnCancelarPref) btnCancelarPref.onclick = fecharModalPrefixo;

    if (btnSalvarPref && inputPrefixo) {
        btnSalvarPref.onclick = () => {
            const val = inputPrefixo.value.replace(/\D/g, '').substring(0, 4);
            if (val.length !== 4) {
                alert("Por favor, introduza exatamente 4 números para o prefixo (Ex: 2640, 2710).");
                inputPrefixo.focus();
                return;
            }

            definirPrefixoPadrao(val);
            atualizarSubtitulosMenu();

            const inputRotasPrefixo = document.getElementById('prefixo-manual');
            if (inputRotasPrefixo) {
                inputRotasPrefixo.value = val;
            }

            fecharModalPrefixo();
        };
    }

    // -------------------------------------------------------------
    // 3. MODAL DE ATALHO PARA RELATÓRIOS DO GESTOR
    // -------------------------------------------------------------
    const itemMenuRelatorios = document.getElementById('menu-item-relatorios');
    const modalRelatorios = document.getElementById('modal-menu-relatorios');
    const btnFecharRelX = document.getElementById('btn-fechar-modal-relatorios-menu');
    const btnIrParaRelatorios = document.getElementById('btn-ir-para-relatorios');
    const overlayMenu = document.getElementById('menu-lateral-overlay');
    const conteudoMenu = document.getElementById('menu-lateral-conteudo');

    const fecharModalRelatorios = () => {
        if (modalRelatorios) modalRelatorios.classList.add('hidden');
    };

    if (itemMenuRelatorios && modalRelatorios && !itemMenuRelatorios.dataset.bound) {
        itemMenuRelatorios.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            modalRelatorios.classList.remove('hidden');
        });
        itemMenuRelatorios.dataset.bound = "true";
    }

    if (btnFecharRelX) btnFecharRelX.onclick = fecharModalRelatorios;

    if (btnIrParaRelatorios) {
        btnIrParaRelatorios.onclick = () => {
            fecharModalRelatorios();

            // Fecha o menu lateral
            if (conteudoMenu) conteudoMenu.classList.add('-translate-x-full');
            setTimeout(() => {
                if (overlayMenu) overlayMenu.classList.add('hidden');
            }, 300);

            // Troca para a aba de Bricks (onde está o painel de relatórios)
            if (typeof window.showTab === 'function') {
                window.showTab('intervalos');
            } else {
                const navBricksBtn = document.getElementById('nav-intervalos');
                if (navBricksBtn) navBricksBtn.click();
            }
        };
    }
}

/**
 * Inicialização principal do Menu Hambúrguer
 */
export function setupMenuLateral() {
    const btnAbrir = document.getElementById('btn-abrir-menu');
    const btnFechar = document.getElementById('btn-fechar-menu');
    const overlay = document.getElementById('menu-lateral-overlay');
    const conteudo = document.getElementById('menu-lateral-conteudo');
    const userEmailSpan = document.getElementById('menu-user-email');
    const btnLogout = document.getElementById('menu-btn-logout');

    if (!btnAbrir || !overlay || !conteudo) return;

    // Função para abrir o menu lateral
    const abrirMenu = () => {
        overlay.classList.remove('hidden');
        setTimeout(() => {
            conteudo.classList.remove('-translate-x-full');
        }, 10);

        if (window.currentUserEmail && userEmailSpan) {
            userEmailSpan.textContent = window.currentUserEmail;
        } else if (window.firebase && firebase.auth().currentUser && userEmailSpan) {
            userEmailSpan.textContent = firebase.auth().currentUser.email || "Utilizador Autenticado";
        } else if (userEmailSpan) {
            userEmailSpan.textContent = "Sessão Ativa";
        }

        atualizarSubtitulosMenu();
    };

    // Função para fechar o menu lateral
    const fecharMenu = () => {
        conteudo.classList.add('-translate-x-full');
        setTimeout(() => {
            overlay.classList.add('hidden');
        }, 300);
    };

    btnAbrir.onclick = abrirMenu;
    if (btnFechar) btnFechar.onclick = fecharMenu;
    
    // Fecha ao clicar fora do painel
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            fecharMenu();
        }
    };

    // Configura os 3 sub-modais
    configurarModaisDoMenu();

    // Configuração do botão de Logout
    if (btnLogout) {
        btnLogout.onclick = () => {
            const confirmar = confirm("Tem a certeza que deseja terminar sessão?");
            if (!confirmar) return;

            if (window.firebase && firebase.auth()) {
                firebase.auth().signOut().then(() => {
                    localStorage.clear();
                    window.location.reload();
                }).catch((error) => {
                    console.error("Erro ao terminar sessão:", error);
                    window.location.reload();
                });
            } else {
                localStorage.clear();
                window.location.reload();
            }
        };
    }

    atualizarSubtitulosMenu();
}

// AUTO-INICIALIZAÇÃO GARANTIDA: Executa imediatamente ou quando o DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupMenuLateral);
} else {
    setupMenuLateral();
}

window.setupMenuLateral = setupMenuLateral;