/**
 * js/ui-menu.js
 * Faz: Gere a abertura/fecho do menu lateral (hambúrguer), a seleção de preferência
 *      de navegação (Google Maps vs Waze), exibe o email do utilizador ativo
 *      e gere o botão de fecho de sessão (logout) global.
 * Depende de: ./navigation.js, ./firebase-init.js
 */

import { obterNavegadorPreferido, definirNavegadorPreferido } from './navigation.js';

export function setupMenuLateral() {
    const btnAbrir = document.getElementById('btn-abrir-menu');
    const btnFechar = document.getElementById('btn-fechar-menu');
    const overlay = document.getElementById('menu-lateral-overlay');
    const conteudo = document.getElementById('menu-lateral-conteudo');
    const userEmailSpan = document.getElementById('menu-user-email');
    const btnLogout = document.getElementById('menu-btn-logout');

    if (!btnAbrir || !overlay || !conteudo) return;

    // Função para abrir o menu
    const abrirMenu = () => {
        overlay.classList.remove('hidden');
        setTimeout(() => {
            conteudo.classList.remove('-translate-x-full');
        }, 10);

        // Atualiza o email do utilizador logado se disponível no estado global ou firebase
        if (window.currentUserEmail && userEmailSpan) {
            userEmailSpan.textContent = window.currentUserEmail;
        } else if (window.firebase && firebase.auth().currentUser && userEmailSpan) {
            userEmailSpan.textContent = firebase.auth().currentUser.email || "Utilizador Autenticado";
        } else if (userEmailSpan) {
            userEmailSpan.textContent = "Sessão Ativa";
        }

        atualizarEstilosBotoesNavegador();
    };

    // Função para fechar o menu
    const fecharMenu = () => {
        conteudo.classList.add('-translate-x-full');
        setTimeout(() => {
            overlay.classList.add('hidden');
        }, 300);
    };

    btnAbrir.addEventListener('click', abrirMenu);
    if (btnFechar) btnFechar.addEventListener('click', fecharMenu);
    
    // Fecha ao clicar fora do painel (no fundo escuro)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            fecharMenu();
        }
    });

    // Configuração dos botões de preferência de navegador (Google Maps vs Waze)
    const botoesNav = document.querySelectorAll('.pref-nav-btn');
    botoesNav.forEach(btn => {
        btn.addEventListener('click', () => {
            const navEscolha = btn.getAttribute('data-nav');
            definirNavegadorPreferido(navEscolha);
            atualizarEstilosBotoesNavegador();
        });
    });

    // Configuração do botão de Logout no menu
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
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
        });
    }
}

// Atualiza o visual dos botões no menu para destacar o navegador ativo
function atualizarEstilosBotoesNavegador() {
    const navAtual = obterNavegadorPreferido();
    const botoesNav = document.querySelectorAll('.pref-nav-btn');

    botoesNav.forEach(btn => {
        const navType = btn.getAttribute('data-nav');
        if (navType === navAtual) {
            // Estilo ativo (destacado em azul corporativo)
            btn.className = "pref-nav-btn p-3 rounded-xl border-2 border-blue-600 text-xs font-black text-center flex flex-col items-center justify-center space-y-1 bg-blue-50 text-blue-700 shadow-sm transition-all cursor-pointer";
        } else {
            // Estilo inativo
            btn.className = "pref-nav-btn p-3 rounded-xl border border-gray-200 text-xs font-bold text-center flex flex-col items-center justify-center space-y-1 bg-gray-50 text-gray-700 transition-all cursor-pointer";
        }
    });
}