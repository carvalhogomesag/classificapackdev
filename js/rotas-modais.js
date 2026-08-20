/**
 * js/rotas-modais.js
 * Versão v74.1 - Módulo de Modais de Edição Simplificada e Re-sequenciação de Paragens
 * Faz: Controla o modal de edição detalhada de entregas/recolhas (morada, observações,
 *      tipo de operação, prioridade) e a alteração manual de sequência de rota.
 * Alteração v74.1: Preserva o estado isNewUnconfirmed (laranja saltitante) ao salvar observações.
 * Depende de: ./rotas-geografia.js, ./maps.js, ./rotas.js
 */

import { resolveBrickForZip } from './rotas-geografia.js';
import { calcularDistanciaHaversine, desenharMapaGoogle } from './maps.js';
import { 
    sincronizarPersistencia, 
    renderMoradasAdicionadas, 
    renderizarItinerarioOtimizado 
} from './rotas.js';

let itemSendoEditado = null;

const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://classificapack-backend.onrender.com';

// =========================================================================
// CONFIRMAÇÃO DIRETA DA POSIÇÃO DA NOVA AÇÃO (DESATIVA O BOUNCE E O LARANJA)
// =========================================================================
export function confirmarPosicaoParagem(paragemId) {
    const paragem = window.rotaOtimizada.find(p => p.id === paragemId);
    if (paragem) {
        paragem.isNewUnconfirmed = false;
        const originalPre = window.moradasEntregas.find(m => m.id === paragemId);
        if (originalPre) originalPre.isNewUnconfirmed = false;

        sincronizarPersistencia();
        renderizarItinerarioOtimizado();
        desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
    }
}
window.confirmarPosicaoParagem = confirmarPosicaoParagem;

// ==========================================
// RE-SEQUENCIAÇÃO DE ENTREGA (ALTERAR POSIÇÃO E CONFIRMAR)
// ==========================================
export function abrirModalAlterarSequencia(indexAtual, paragem) {
    const modal = document.getElementById('modal-alterar-sequencia');
    if (!modal) return;

    const txtMorada = document.getElementById('txt-seq-morada');
    const txtPosAtual = document.getElementById('txt-seq-pos-atual');
    const inputNovaPos = document.getElementById('input-seq-nova-pos');

    if (txtMorada) txtMorada.textContent = paragem.address;
    if (txtPosAtual) txtPosAtual.textContent = indexAtual + 1;
    if (inputNovaPos) {
        inputNovaPos.value = indexAtual + 1;
        inputNovaPos.max = window.rotaOtimizada.length;
    }

    modal.classList.remove('hidden');

    const btnConfirmar = document.getElementById('btn-confirmar-sequencia');
    const btnCancelar = document.getElementById('btn-cancelar-sequencia');

    btnConfirmar.onclick = () => {
        const novaPos = parseInt(inputNovaPos.value);
        if (isNaN(novaPos) || novaPos < 1 || novaPos > window.rotaOtimizada.length) {
            alert(`Erro: Introduza uma posição válida entre 1 e ${window.rotaOtimizada.length}.`);
            return;
        }

        const novoIndex = novaPos - 1;

        // Ao alterar a ordem, a posição fica confirmada (desativa o bounce)
        paragem.isNewUnconfirmed = false;
        const originalPre = window.moradasEntregas.find(m => m.id === paragem.id);
        if (originalPre) originalPre.isNewUnconfirmed = false;

        if (indexAtual !== novoIndex) {
            const item = window.rotaOtimizada.splice(indexAtual, 1)[0];
            window.rotaOtimizada.splice(novoIndex, 0, item);

            window.rotaOtimizada.forEach((p, idx) => {
                p.distanciaDoAnterior = calcularDistanciaHaversine(
                    idx === 0 ? window.partidaLocalizacao.lat : window.rotaOtimizada[idx - 1].lat,
                    idx === 0 ? window.partidaLocalizacao.lng : window.rotaOtimizada[idx - 1].lng,
                    p.lat,
                    p.lng
                );
            });

            window.moradasEntregas = [...window.rotaOtimizada];
        }

        sincronizarPersistencia();
        renderizarItinerarioOtimizado();
        desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);

        modal.classList.add('hidden');
    };

    btnCancelar.onclick = () => modal.classList.add('hidden');
}
window.abrirModalAlterarSequencia = abrirModalAlterarSequencia;

// =========================================================================
// CONFIGURAÇÃO DOS MODAIS DE EDIÇÃO DE PARAGEM
// =========================================================================
export function setupModaisEdicao() {
    const btnCancelarEdicao = document.getElementById('btn-cancelar-edicao');
    const btnSalvarEdicao = document.getElementById('btn-salvar-edicao');

    if (!btnCancelarEdicao || !btnSalvarEdicao) return;

    btnCancelarEdicao.addEventListener('click', () => {
        const modalEditarParagem = document.getElementById('modal-editar-paragem');
        if (modalEditarParagem) modalEditarParagem.classList.add('hidden');
        itemSendoEditado = null;
    });

    btnSalvarEdicao.addEventListener('click', async () => {
        if (!itemSendoEditado) return;

        const editMoradaTexto = document.getElementById('edit-morada-texto');
        const editMoradaObs = document.getElementById('edit-morada-obs');
        const editMoradaPrioridade = document.getElementById('edit-morada-prioridade');
        const editTipoOperacaoInput = document.getElementById('edit-tipo-operacao');

        if (!editMoradaTexto || !editMoradaObs) return;

        const novaMorada = editMoradaTexto.value.trim();
        const novaObs = editMoradaObs.value.trim();
        const novaPrioridade = editMoradaPrioridade ? editMoradaPrioridade.checked : false;
        const novoTipoOperacao = editTipoOperacaoInput ? editTipoOperacaoInput.value : "Entrega";

        if (!novaMorada) {
            alert("A morada de entrega não pode ficar em branco.");
            return;
        }

        const textoOriginalBotao = btnSalvarEdicao.innerHTML;
        btnSalvarEdicao.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> A geolocalizar...';
        btnSalvarEdicao.disabled = true;

        try {
            if (novaMorada !== itemSendoEditado._originalAddress) {
                const response = await fetch(`${API_BASE_URL}/api/geocode`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ postalCode: "", address: novaMorada })
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || "Falha ao validar a nova morada geográfica.");
                }

                itemSendoEditado.lat = data.lat;
                itemSendoEditado.lng = data.lng;
                itemSendoEditado.address = data.address;

                const postalCodeMatch = data.address.match(/\d{4}-\d{3}/);
                if (postalCodeMatch) {
                    const { brickId, brickName } = resolveBrickForZip(postalCodeMatch[0], window.drivers);
                    itemSendoEditado.brickId = brickId;
                    itemSendoEditado.brickName = brickName;
                } else {
                    const { brickId, brickName } = resolveBrickForZip(novaMorada, window.drivers);
                    if (brickId) {
                        itemSendoEditado.brickId = brickId;
                        itemSendoEditado.brickName = brickName;
                    }
                }
            }

            // ATENÇÃO: Mantém o isNewUnconfirmed intacto! Não desativa o salto nem a cor laranja aqui.
            itemSendoEditado.observation = novaObs;
            itemSendoEditado.priority = novaPrioridade;
            itemSendoEditado.tipoOperacao = novoTipoOperacao;

            let itemIndexPre = window.moradasEntregas.findIndex(m => m.id === itemSendoEditado.id);
            let itemIndexPos = window.rotaOtimizada.findIndex(m => m.id === itemSendoEditado.id);

            if (itemIndexPre !== -1) {
                window.moradasEntregas[itemIndexPre] = { ...itemSendoEditado };
            }

            if (itemIndexPos !== -1) {
                window.rotaOtimizada[itemIndexPos] = { ...itemSendoEditado };

                window.rotaOtimizada.forEach((p, idx) => {
                    p.distanciaDoAnterior = calcularDistanciaHaversine(
                        idx === 0 ? window.partidaLocalizacao.lat : window.rotaOtimizada[idx - 1].lat,
                        idx === 0 ? window.partidaLocalizacao.lng : window.rotaOtimizada[idx - 1].lng,
                        p.lat,
                        p.lng
                    );
                });
            }

            sincronizarPersistencia();
            renderMoradasAdicionadas();
            if (window.rotaOtimizada.length > 0) {
                renderizarItinerarioOtimizado();
                desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
            }

            const modalEditarParagem = document.getElementById('modal-editar-paragem');
            if (modalEditarParagem) modalEditarParagem.classList.add('hidden');
            itemSendoEditado = null;

        } catch (err) {
            console.error("[PWA] Erro ao gravar edição de paragem:", err);
            alert(`Erro ao atualizar a paragem: ${err.message}`);
        } finally {
            btnSalvarEdicao.innerHTML = textoOriginalBotao;
            btnSalvarEdicao.disabled = false;
        }
    });

    const editTipoEntrega = document.getElementById('edit-tipo-entrega');
    const editTipoRecolha = document.getElementById('edit-tipo-recolha');
    const editTipoOperacaoInput = document.getElementById('edit-tipo-operacao');

    if (editTipoEntrega && editTipoRecolha && editTipoOperacaoInput) {
        editTipoEntrega.addEventListener('click', () => {
            editTipoOperacaoInput.value = "Entrega";
            editTipoEntrega.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-blue-600 text-white shadow transition-all focus:outline-none cursor-pointer";
            editTipoRecolha.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 transition-all focus:outline-none cursor-pointer";
        });

        editTipoRecolha.addEventListener('click', () => {
            editTipoOperacaoInput.value = "Recolha";
            editTipoRecolha.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-purple-600 text-white shadow transition-all focus:outline-none cursor-pointer";
            editTipoEntrega.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 transition-all focus:outline-none cursor-pointer";
        });
    }
}

/**
 * Abre o modal de edição da paragem de forma simplificada e polimórfica.
 * @param {Object|number} paragemOuIndex - Objeto paragem ou índice numérico da lista
 * @param {string|boolean} modoOuEstaNaRota - Modo ('conducao'|'planeamento') ou booleano
 */
export function abrirModalEdicaoParagem(paragemOuIndex, modoOuEstaNaRota) {
    const modalEditarParagem = document.getElementById('modal-editar-paragem');
    const editMoradaTexto = document.getElementById('edit-morada-texto');
    const editMoradaObs = document.getElementById('edit-morada-obs');
    const editMoradaPrioridade = document.getElementById('edit-morada-prioridade');

    if (!modalEditarParagem || !editMoradaTexto || !editMoradaObs) return;

    let paragem = paragemOuIndex;

    if (typeof paragemOuIndex === 'number') {
        if (modoOuEstaNaRota === 'conducao' && window.rotaOtimizada && window.rotaOtimizada[paragemOuIndex]) {
            paragem = window.rotaOtimizada[paragemOuIndex];
        } else if (window.moradasEntregas && window.moradasEntregas[paragemOuIndex]) {
            paragem = window.moradasEntregas[paragemOuIndex];
        }
    }

    if (!paragem || typeof paragem !== 'object') {
        console.warn("[PWA] Paragem inválida ou não encontrada para abrir modal:", paragemOuIndex);
        return;
    }

    itemSendoEditado = paragem;
    itemSendoEditado._originalAddress = paragem.address || "";

    editMoradaTexto.value = paragem.address || "";
    editMoradaObs.value = paragem.observation || "";
    if (editMoradaPrioridade) {
        editMoradaPrioridade.checked = !!paragem.priority;
    }

    const tipoOperacao = paragem.tipoOperacao || "Entrega";
    const editTipoEntrega = document.getElementById('edit-tipo-entrega');
    const editTipoRecolha = document.getElementById('edit-tipo-recolha');
    const editTipoOperacaoInput = document.getElementById('edit-tipo-operacao');

    if (editTipoEntrega && editTipoRecolha && editTipoOperacaoInput) {
        editTipoOperacaoInput.value = tipoOperacao;
        if (tipoOperacao === "Recolha") {
            editTipoRecolha.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-purple-600 text-white shadow transition-all focus:outline-none cursor-pointer";
            editTipoEntrega.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 transition-all focus:outline-none cursor-pointer";
        } else {
            editTipoEntrega.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-blue-600 text-white shadow transition-all focus:outline-none cursor-pointer";
            editTipoRecolha.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 transition-all focus:outline-none cursor-pointer";
        }
    }

    modalEditarParagem.classList.remove('hidden');

    setTimeout(() => {
        editMoradaObs.focus();
        editMoradaObs.select();
    }, 150);
}