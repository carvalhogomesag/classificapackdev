/**
 * js/rotas-modais.js
 * Versão v82.0 - Modais de Edição com Atribuição de Bloco (Cluster) e Inserção Cirúrgica Anti-Caos
 * Faz: Controla o modal de edição detalhada de entregas/recolhas, permitindo associar qualquer paragem
 *      diretamente a um Bloco (Cluster) existente ou desassociar;
 *      ao associar a um bloco, realiza o encaixe cirúrgico da paragem junto das outras daquele bloco;
 *      mantém a re-sequenciação manual e confirmação de posição.
 * Depende de: ./rotas-geografia.js, ./maps.js, ./rotas.js, ./rotas-laco.js
 */

import { resolveBrickForZip } from './rotas-geografia.js';
import { calcularDistanciaHaversine, desenharMapaGoogle } from './maps.js';
import { 
    sincronizarPersistencia, 
    renderMoradasAdicionadas, 
    renderizarItinerarioOtimizado 
} from './rotas.js';
import { renderizarPainelMultiClusters } from './rotas-laco.js';

let itemSendoEditado = null;

const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://classificapack-backend.onrender.com';

/**
 * Obtém todos os blocos (clusters) ativos existentes na rota atual
 */
function obterListaClustersDisponiveis() {
    const lista = (window.rotaOtimizada && window.rotaOtimizada.length > 0) ? window.rotaOtimizada : window.moradasEntregas;
    const clustersMap = new Map();

    if (Array.isArray(lista)) {
        lista.forEach(p => {
            if (p.isClusterGroup && p.clusterGroupId && !clustersMap.has(p.clusterGroupId)) {
                clustersMap.set(p.clusterGroupId, {
                    id: p.clusterGroupId,
                    nome: p.clusterGroupName || "Bloco",
                    cor: p.clusterColor || "#8B5CF6",
                    borda: p.clusterBorder || "#6D28D9"
                });
            }
        });
    }

    return Array.from(clustersMap.values());
}

/**
 * Injeta ou atualiza o seletor de Bloco (Cluster) dentro do modal de edição
 */
function popularSeletorBlocosNoModal(paragemAtual) {
    const modalEditar = document.getElementById('modal-editar-paragem');
    if (!modalEditar) return;

    let containerSeletor = document.getElementById('container-seletor-cluster-modal');
    if (!containerSeletor) {
        containerSeletor = document.createElement('div');
        containerSeletor.id = 'container-seletor-cluster-modal';
        containerSeletor.className = 'space-y-1.5 pt-1';

        const btnSalvar = document.getElementById('btn-salvar-edicao');
        const formContainer = btnSalvar ? btnSalvar.closest('.space-y-3.5') || btnSalvar.parentElement : null;
        if (formContainer) {
            formContainer.insertBefore(containerSeletor, btnSalvar.parentElement || btnSalvar);
        }
    }

    const clustersAtivos = obterListaClustersDisponiveis();

    containerSeletor.innerHTML = `
        <label class="block text-xs font-bold text-gray-600 uppercase flex items-center justify-between">
            <span class="flex items-center space-x-1">
                <i class="fa-solid fa-layer-group text-purple-600 mr-1"></i>
                <span>Agrupar no Bloco (Cluster):</span>
            </span>
            <span class="text-[10px] text-gray-400 font-normal lowercase">encaixe cirúrgico</span>
        </label>
        <select id="edit-cluster-select" 
                class="w-full p-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-bold text-gray-800 focus:ring-2 focus:ring-purple-500 cursor-pointer">
            <option value="">-- Sem Bloco (Entrega Avulsa) --</option>
            ${clustersAtivos.map(c => `
                <option value="${c.id}" ${paragemAtual && paragemAtual.clusterGroupId === c.id ? 'selected' : ''}>
                    🔗 ${c.nome} (${c.cor})
                </option>
            `).join('')}
        </select>
    `;
}

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
        const editClusterSelect = document.getElementById('edit-cluster-select');

        if (!editMoradaTexto || !editMoradaObs) return;

        const novaMorada = editMoradaTexto.value.trim();
        const novaObs = editMoradaObs.value.trim();
        const novaPrioridade = editMoradaPrioridade ? editMoradaPrioridade.checked : false;
        const novoTipoOperacao = editTipoOperacaoInput ? editTipoOperacaoInput.value : "Entrega";
        const novoClusterId = editClusterSelect ? editClusterSelect.value : "";

        if (!novaMorada) {
            alert("A morada de entrega não pode ficar em branco.");
            return;
        }

        const textoOriginalBotao = btnSalvarEdicao.innerHTML;
        btnSalvarEdicao.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> A gravar...';
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
                }
            }

            itemSendoEditado.observation = novaObs;
            itemSendoEditado.priority = novaPrioridade;
            itemSendoEditado.tipoOperacao = novoTipoOperacao;

            // ATRIBUIÇÃO OU REMOÇÃO DO BLOCO (CLUSTER)
            if (novoClusterId) {
                const clustersDisponiveis = obterListaClustersDisponiveis();
                const clusterInfo = clustersDisponiveis.find(c => c.id === novoClusterId);

                itemSendoEditado.isClusterGroup = true;
                itemSendoEditado.clusterGroupId = novoClusterId;
                itemSendoEditado.clusterGroupName = clusterInfo ? clusterInfo.nome : "Bloco";
                itemSendoEditado.clusterColor = clusterInfo ? clusterInfo.cor : "#8B5CF6";
                itemSendoEditado.clusterBorder = clusterInfo ? clusterInfo.borda : "#6D28D9";
            } else {
                itemSendoEditado.isClusterGroup = false;
                itemSendoEditado.clusterGroupId = null;
                itemSendoEditado.clusterGroupName = null;
                itemSendoEditado.clusterColor = null;
                itemSendoEditado.clusterBorder = null;
            }

            let itemIndexPre = window.moradasEntregas.findIndex(m => m.id === itemSendoEditado.id);
            if (itemIndexPre !== -1) {
                window.moradasEntregas[itemIndexPre] = { ...itemSendoEditado };
            }

            // ENCAIXE CIRÚRGICO NA ROTA OTIMIZADA: se foi atribuído a um bloco, posiciona junto das outras do mesmo bloco
            if (window.rotaOtimizada && window.rotaOtimizada.length > 0) {
                let itemIndexPos = window.rotaOtimizada.findIndex(m => m.id === itemSendoEditado.id);

                if (itemIndexPos !== -1) {
                    window.rotaOtimizada.splice(itemIndexPos, 1);
                }

                if (itemSendoEditado.isClusterGroup && itemSendoEditado.clusterGroupId) {
                    // Encontra a última paragem daquele mesmo bloco na rota para inserir logo a seguir
                    let ultimoIndexCluster = -1;
                    window.rotaOtimizada.forEach((p, idx) => {
                        if (p.clusterGroupId === itemSendoEditado.clusterGroupId) {
                            ultimoIndexCluster = idx;
                        }
                    });

                    if (ultimoIndexCluster !== -1) {
                        window.rotaOtimizada.splice(ultimoIndexCluster + 1, 0, { ...itemSendoEditado });
                    } else {
                        window.rotaOtimizada.push({ ...itemSendoEditado });
                    }
                } else {
                    window.rotaOtimizada.push({ ...itemSendoEditado });
                }

                // Recalcula distâncias encadeadas
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
            renderizarPainelMultiClusters();

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
 * Abre o modal de edição da paragem e popula o seletor de blocos (clusters)
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

    // Popula o seletor com os blocos disponíveis e marca o bloco atual da paragem
    popularSeletorBlocosNoModal(paragem);

    modalEditarParagem.classList.remove('hidden');

    setTimeout(() => {
        editMoradaObs.focus();
        editMoradaObs.select();
    }, 150);
}