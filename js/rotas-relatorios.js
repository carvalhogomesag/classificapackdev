/**
 * ============================================================================
 * CLASSIFICA PACK - MÓDULO DE RELATÓRIOS DE TURNO E CENTRO DE ANÁLISE DESKTOP
 * Ficheiro: js/rotas-relatorios.js
 * Versão: v75.0 - Controlador Completo do Centro de Análise e Relatórios Desktop-First
 * Função: Agrupa dados da rota finalizada por Brick, calcula métricas de
 *         eficiência (Eventos/Hora, Eventos/KM), gera médias por CP7 e
 *         alimenta o ecrã completo de Relatórios do Gestor.
 * ============================================================================
 */

import { resolveBrickForZip } from './rotas-geografia.js';
import { db } from './firebase-init.js';

// Cache interna de médias calculadas e concelho selecionado nos relatórios
let ultimasMediasCalculadasDesktop = [];
let concelhoRelatoriosAtivo = "MAFRA";

/**
 * Valida se existem encomendas/recolhas pendentes na rota atual.
 * @param {Array} listaMoradas - Array de objetos de moradas/entregas da rota
 * @returns {Object} - { temPendencias: boolean, totalPendentes: number, pendentes: Array }
 */
export function verificarPendenciasRota(listaMoradas = []) {
  const pendentes = listaMoradas.filter(m => {
    const status = (m.status || 'pendente').toLowerCase();
    return status === 'pendente' || status === 'em_andamento' || status === 'nao_visitado';
  });

  return {
    temPendencias: pendentes.length > 0,
    totalPendentes: pendentes.length,
    pendentes: pendentes
  };
}

/**
 * Agrupa as entregas/recolhas por Brick para o relatório do turno corrente.
 * @param {Array} listaMoradas - Array de objetos de moradas/entregas da rota
 * @returns {Object} - Mapeamento com contagem de totais, entregas, recolhas e falhas por Brick
 */
export function agruparObjetosPorBrick(listaMoradas = []) {
  const relatorioBricks = {};

  listaMoradas.forEach(item => {
    const cp = item.codigoPostal || item.zipCode || item.cp || item.address || '';
    const postalMatch = String(cp).match(/\d{4}-\d{3}/);
    const cpFormatado = postalMatch ? postalMatch[0] : String(cp);

    const brickInfo = resolveBrickForZip(cpFormatado);
    const brickId = brickInfo?.brickId || item.brickId || 'BRICK_DESCONHECIDO';
    const brickNome = brickInfo?.brickName || brickInfo?.nome || item.brickName || item.brickNome || item.freguesia || 'Sem Brick Definido';

    if (!relatorioBricks[brickId]) {
      relatorioBricks[brickId] = {
        brickId: String(brickId),
        nomeBrick: String(brickNome),
        concelho: String(item.concelho || 'Não Especificado'),
        totalAlocados: 0,
        entregasConcluidas: 0,
        recolhasConcluidas: 0,
        falhas: 0,
        pendentes: 0,
        totalEventos: 0
      };
    }

    relatorioBricks[brickId].totalAlocados += 1;

    const status = String(item.status || '').toLowerCase();
    const tipo = String(item.tipoOperacao || item.tipo || 'entrega').toLowerCase();

    if (status === 'concluido' || status === 'entregue' || status === 'sucesso') {
      if (tipo === 'recolha') {
        relatorioBricks[brickId].recolhasConcluidas += 1;
      } else {
        relatorioBricks[brickId].entregasConcluidas += 1;
      }
      relatorioBricks[brickId].totalEventos += 1;
    } else if (status === 'falha' || status === 'incidencia' || status === 'recusado' || status === 'ausente') {
      relatorioBricks[brickId].falhas += 1;
      relatorioBricks[brickId].totalEventos += 1;
    } else {
      relatorioBricks[brickId].pendentes += 1;
    }
  });

  return relatorioBricks;
}

/**
 * Gera a estrutura completa do relatório de encerramento de turno.
 * @param {Object} dadosTurno - { driverId, driverName, kmInicial, kmFinal, horaInicio, horaFim, concelho }
 * @param {Array} listaMoradas - Lista de moradas da rota
 * @returns {Object} Relatório estruturado pronto para gravação
 */
export function calcularMetricasRelatorio(dadosTurno, listaMoradas = []) {
  const horaInicioDate = new Date(dadosTurno.horaInicio);
  const horaFimDate = new Date(dadosTurno.horaFim || Date.now());

  const duracaoMs = Math.max(0, horaFimDate.getTime() - horaInicioDate.getTime());
  const duracaoMinutos = Math.round(duracaoMs / (1000 * 60));
  const duracaoHoras = parseFloat((duracaoMinutos / 60).toFixed(2));

  const kmInicial = Number(dadosTurno.kmInicial) || 0;
  const kmFinal = Number(dadosTurno.kmFinal) || 0;
  const kmPercorridos = Math.max(0, kmFinal - kmInicial);

  const resumoBricks = agruparObjetosPorBrick(listaMoradas);

  let totalEntregas = 0;
  let totalRecolhas = 0;
  let totalFalhas = 0;
  let totalPendentes = 0;

  Object.values(resumoBricks).forEach(b => {
    totalEntregas += b.entregasConcluidas;
    totalRecolhas += b.recolhasConcluidas;
    totalFalhas += b.falhas;
    totalPendentes += b.pendentes;
  });

  const totalEventosConcluidos = totalEntregas + totalRecolhas + totalFalhas;

  const eventosPorHora = duracaoHoras > 0 ? parseFloat((totalEventosConcluidos / duracaoHoras).toFixed(2)) : 0;
  const entregasPorHora = duracaoHoras > 0 ? parseFloat((totalEntregas / duracaoHoras).toFixed(2)) : 0;
  const recolhasPorHora = duracaoHoras > 0 ? parseFloat((totalRecolhas / duracaoHoras).toFixed(2)) : 0;
  const falhasPorHora = duracaoHoras > 0 ? parseFloat((totalFalhas / duracaoHoras).toFixed(2)) : 0;

  const eventosPorKm = kmPercorridos > 0 ? parseFloat((totalEventosConcluidos / kmPercorridos).toFixed(2)) : 0;
  const entregasPorKm = kmPercorridos > 0 ? parseFloat((totalEntregas / kmPercorridos).toFixed(2)) : 0;

  const dataAtualISO = new Date().toISOString().split('T')[0];

  return {
    dataRelatorio: dataAtualISO,
    dataHoraCriacao: new Date().toISOString(),
    driverId: String(dadosTurno.driverId || 'MOTORISTA_NAO_IDENTIFICADO'),
    driverName: String(dadosTurno.driverName || 'Motorista'),
    concelho: String(dadosTurno.concelho || 'Mafra/Sintra'),
    telemetriaTurno: {
      horaInicio: horaInicioDate.toISOString(),
      horaFim: horaFimDate.toISOString(),
      duracaoMinutos: duracaoMinutos,
      duracaoHoras: duracaoHoras,
      kmInicial: kmInicial,
      kmFinal: kmFinal,
      kmPercorridos: kmPercorridos
    },
    resumoEventos: {
      totalObjetosAlocados: listaMoradas.length,
      totalEventosFinalizados: totalEventosConcluidos,
      totalEntregas: totalEntregas,
      totalRecolhas: totalRecolhas,
      totalFalhas: totalFalhas,
      totalPendentes: totalPendentes
    },
    metricasEficiencia: {
      eventosPorHora: eventosPorHora,
      entregasPorHora: entregasPorHora,
      recolhasPorHora: recolhasPorHora,
      falhasPorHora: falhasPorHora,
      eventosPorKm: eventosPorKm,
      entregasPorKm: entregasPorKm
    },
    detalhamentoPorBrick: resumoBricks
  };
}

/**
 * Salva o relatório de encerramento de turno diretamente na coleção 'relatorios_turnos' do Firestore.
 * @param {Object} relatorioFinal - Objeto com os dados do relatório formatado
 * @returns {Promise<string>} ID do documento gerado no Firestore
 */
export async function salvarRelatorioNoFirestore(relatorioFinal) {
  const firestoreDb = db || window.db || (typeof firebase !== 'undefined' && firebase.firestore ? firebase.firestore() : null);

  if (!firestoreDb) {
    throw new Error("Não foi possível conectar ao Firestore. Nenhuma instância ativa foi encontrada.");
  }

  const payloadSanitizado = JSON.parse(
    JSON.stringify(relatorioFinal, (key, value) => (value === undefined ? null : value))
  );

  try {
    const docRef = await firestoreDb.collection('relatorios_turnos').add(payloadSanitizado);
    console.log("✅ Relatório de Turno salvo com sucesso no Firestore. ID:", docRef.id);
    return docRef.id;
  } catch (error) {
    console.error("❌ Erro ao guardar o relatório de turno no Firestore:", error);
    throw error;
  }
}

/**
 * Consulta o histórico completo de relatórios no Firestore.
 * @param {Object} [filtros] - { driverId, concelho }
 * @returns {Promise<Array>} Lista de relatórios de turno
 */
export async function carregarHistoricoRelatorios(filtros = {}) {
  const firestoreDb = db || window.db || (typeof firebase !== 'undefined' && firebase.firestore ? firebase.firestore() : null);
  if (!firestoreDb) return [];

  try {
    let query = firestoreDb.collection('relatorios_turnos');

    if (filtros.driverId) {
      query = query.where('driverId', '==', filtros.driverId);
    }
    if (filtros.concelho) {
      query = query.where('concelho', '==', filtros.concelho);
    }

    const snapshot = await query.get();
    const relatorios = [];

    snapshot.forEach(doc => {
      relatorios.push({ id: doc.id, ...doc.data() });
    });

    relatorios.sort((a, b) => new Date(b.dataHoraCriacao || 0) - new Date(a.dataHoraCriacao || 0));

    return relatorios;
  } catch (error) {
    console.error("❌ Erro ao consultar histórico de relatórios no Firestore:", error);
    return [];
  }
}

/**
 * Processa a lista histórica de relatórios e calcula as médias e totais por Brick/CP7.
 * @param {Array} relatorios - Lista de relatórios do Firestore
 * @returns {Array} Lista agregada com médias de cada Brick ordenada por volume
 */
export function calcularMediasHistoricasPorBrick(relatorios = []) {
  const mapaBricks = {};

  relatorios.forEach(relatorio => {
    const detalhamento = relatorio.detalhamentoPorBrick || {};

    Object.entries(detalhamento).forEach(([brickId, dados]) => {
      if (!mapaBricks[brickId]) {
        mapaBricks[brickId] = {
          brickId: brickId,
          nomeBrick: dados.nomeBrick || 'Brick Desconhecido',
          concelho: dados.concelho || 'Não Especificado',
          totalTurnosAtendido: 0,
          somaObjetosAlocados: 0,
          somaEntregas: 0,
          somaRecolhas: 0,
          somaFalhas: 0
        };
      }

      mapaBricks[brickId].totalTurnosAtendido += 1;
      mapaBricks[brickId].somaObjetosAlocados += (dados.totalAlocados || 0);
      mapaBricks[brickId].somaEntregas += (dados.entregasConcluidas || 0);
      mapaBricks[brickId].somaRecolhas += (dados.recolhasConcluidas || 0);
      mapaBricks[brickId].somaFalhas += (dados.falhas || 0);
    });
  });

  const listaMedias = Object.values(mapaBricks).map(item => {
    const turnos = Math.max(1, item.totalTurnosAtendido);
    return {
      brickId: item.brickId,
      nomeBrick: item.nomeBrick,
      concelho: item.concelho,
      totalTurnosAtendido: item.totalTurnosAtendido,
      somaTotalObjetos: item.somaObjetosAlocados,
      totalEntregasAcumuladas: item.somaEntregas,
      totalRecolhasAcumuladas: item.somaRecolhas,
      totalFalhasAcumuladas: item.somaFalhas,
      mediaObjetosPorTurno: parseFloat((item.somaObjetosAlocados / turnos).toFixed(1)),
      mediaEntregasPorTurno: parseFloat((item.somaEntregas / turnos).toFixed(1)),
      mediaRecolhasPorTurno: parseFloat((item.somaRecolhas / turnos).toFixed(1)),
      mediaFalhasPorTurno: parseFloat((item.somaFalhas / turnos).toFixed(1))
    };
  });

  listaMedias.sort((a, b) => b.mediaObjetosPorTurno - a.mediaObjetosPorTurno);

  return listaMedias;
}

// =========================================================================
// RENDERIZADOR DA TABELA DESKTOP FILTRADA POR PESQUISA DE CP7
// =========================================================================
function renderizarTabelaDesktopFiltrada(termoPesquisa = "") {
  const tbody = document.getElementById('tbody-tabela-relatorios-desktop');
  const badgeTotal = document.getElementById('badge-total-bricks-analisados');
  if (!tbody) return;

  tbody.innerHTML = "";

  const termo = termoPesquisa.toLowerCase().trim();

  const filtrados = ultimasMediasCalculadasDesktop.filter(item => {
    if (!termo) return true;
    const bId = String(item.brickId || '').toLowerCase();
    const nBrick = String(item.nomeBrick || '').toLowerCase();
    return bId.includes(termo) || nBrick.includes(termo);
  });

  if (badgeTotal) {
    badgeTotal.textContent = `${filtrados.length} Zonas Mapeadas`;
  }

  if (filtrados.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="p-8 text-center text-gray-400 italic font-semibold">
          ${termo ? `Nenhum Brick ou Código Postal encontrado para "${termoPesquisa}".` : 'Sem dados de Bricks nos relatórios registados.'}
        </td>
      </tr>`;
    return;
  }

  filtrados.forEach(item => {
    const tr = document.createElement('tr');
    tr.className = "hover:bg-purple-50/40 transition-colors";
    tr.innerHTML = `
      <td class="p-3 font-bold text-gray-800">
        ${item.nomeBrick} 
        <span class="text-[10px] text-purple-600 font-mono font-bold block">${item.brickId}</span>
      </td>
      <td class="p-3 text-center text-[10px] font-bold uppercase text-gray-500">${item.concelho}</td>
      <td class="p-3 text-center text-sm font-black text-green-700 bg-green-50/40">${item.totalEntregasAcumuladas}</td>
      <td class="p-3 text-center text-sm font-black text-purple-700 bg-purple-50/40">${item.totalRecolhasAcumuladas}</td>
      <td class="p-3 text-center text-sm font-bold text-red-500 bg-red-50/30">${item.totalFalhasAcumuladas}</td>
      <td class="p-3 text-center text-base font-black text-blue-700 bg-blue-50/40">${item.mediaObjetosPorTurno}</td>
      <td class="p-3 text-center text-xs font-bold text-gray-600">${item.totalTurnosAtendido} turnos</td>
    `;
    tbody.appendChild(tr);
  });
}

// =========================================================================
// EXIBIÇÃO DE DETALHES DO TURNO EM MODAL EXPANDIDO
// =========================================================================
function exibirModalDetalheTurnoDesktop(relatorio) {
  const modal = document.getElementById('modal-detalhe-relatorio-desktop');
  const conteudo = document.getElementById('conteudo-modal-detalhe-relatorio');
  if (!modal || !conteudo) return;

  const detalhamentoBricks = relatorio.detalhamentoPorBrick || {};
  let bricksHtml = Object.values(detalhamentoBricks).map(b => `
    <div class="p-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between text-xs">
      <div>
        <span class="font-bold text-gray-800 block">${b.nomeBrick}</span>
        <span class="text-[10px] text-gray-400 font-mono">${b.brickId} (${b.concelho})</span>
      </div>
      <div class="flex items-center space-x-3 text-xs font-bold">
        <span class="text-gray-800 font-black">Total: ${b.totalAlocados}</span>
        <span class="text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-100">✓ ${b.entregasConcluidas}</span>
        <span class="text-purple-600 bg-purple-50 px-2 py-0.5 rounded border border-purple-100">📦 ${b.recolhasConcluidas}</span>
        <span class="text-red-500 bg-red-50 px-2 py-0.5 rounded border border-red-100">✗ ${b.falhas}</span>
      </div>
    </div>
  `).join('');

  if (!bricksHtml) bricksHtml = '<p class="text-gray-400 italic">Sem informação de bricks neste registo.</p>';

  conteudo.innerHTML = `
    <div class="bg-purple-50 p-4 rounded-2xl border border-purple-100 flex items-center justify-between">
      <div>
        <span class="font-black text-purple-900 text-base block">${relatorio.driverName}</span>
        <span class="text-xs text-purple-600">Data do Turno: ${relatorio.dataRelatorio} (${new Date(relatorio.dataHoraCriacao).toLocaleTimeString('pt-PT')})</span>
      </div>
      <span class="text-xs bg-purple-200 text-purple-800 font-black px-3 py-1 rounded-full uppercase">${relatorio.concelho}</span>
    </div>

    <div class="grid grid-cols-3 gap-3 text-center">
      <div class="bg-gray-50 p-3 rounded-xl border border-gray-150">
        <span class="text-gray-400 block font-bold text-[10px] uppercase">Duração do Percurso</span>
        <span class="font-black text-gray-800 text-base block">${relatorio.telemetriaTurno?.duracaoHoras || 0}h (${relatorio.telemetriaTurno?.duracaoMinutos || 0} min)</span>
      </div>
      <div class="bg-gray-50 p-3 rounded-xl border border-gray-150">
        <span class="text-gray-400 block font-bold text-[10px] uppercase">Quilómetros Percorridos</span>
        <span class="font-black text-gray-800 text-base block">${relatorio.telemetriaTurno?.kmPercorridos || 0} KM</span>
      </div>
      <div class="bg-purple-50/50 p-3 rounded-xl border border-purple-100">
        <span class="text-purple-500 block font-bold text-[10px] uppercase">Eficiência Horária</span>
        <span class="font-black text-purple-700 text-base block">${relatorio.metricasEficiencia?.eventosPorHora || 0} evt/hora</span>
      </div>
    </div>

    <div class="space-y-2">
      <span class="font-bold text-gray-700 uppercase text-xs block">Desdobramento de Carga por Brick / Estante:</span>
      <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
        ${bricksHtml}
      </div>
    </div>
  `;

  modal.classList.remove('hidden');

  const btnFecharX = document.getElementById('btn-fechar-modal-detalhe-relatorio');
  const btnFecharOk = document.getElementById('btn-fechar-modal-detalhe-ok');

  const fecharModal = () => modal.classList.add('hidden');
  if (btnFecharX) btnFecharX.onclick = fecharModal;
  if (btnFecharOk) btnFecharOk.onclick = fecharModal;
}

// =========================================================================
// RENDERIZAÇÃO COMPLETA DA PÁGINA DESKTOP DE RELATÓRIOS DO GESTOR
// =========================================================================
export async function renderizarRelatoriosUI() {
  const tbody = document.getElementById('tbody-tabela-relatorios-desktop');
  const containerHistorico = document.getElementById('lista-turnos-historico-desktop');
  const inputPesquisa = document.getElementById('filtro-pesquisa-cp7-desktop');
  const seletorConcelho = document.getElementById('select-concelho-relatorios');
  const btnRecarregar = document.getElementById('btn-recarregar-dados-relatorios');

  if (!tbody || !containerHistorico) return;

  // Configuração dos controlos de topo
  if (seletorConcelho && !seletorConcelho.dataset.bound) {
    seletorConcelho.value = concelhoRelatoriosAtivo;
    seletorConcelho.addEventListener('change', (e) => {
      concelhoRelatoriosAtivo = e.target.value;
      renderizarRelatoriosUI();
    });
    seletorConcelho.dataset.bound = "true";
  }

  if (btnRecarregar && !btnRecarregar.dataset.bound) {
    btnRecarregar.addEventListener('click', () => renderizarRelatoriosUI());
    btnRecarregar.dataset.bound = "true";
  }

  try {
    const relatorios = await carregarHistoricoRelatorios({ concelho: concelhoRelatoriosAtivo });

    const elTurnos = document.getElementById('kpi-total-turnos');
    const elDuracao = document.getElementById('kpi-duracao-media');
    const elEvtHora = document.getElementById('kpi-eventos-hora');
    const elEvtKm = document.getElementById('kpi-eventos-km');

    if (relatorios.length === 0) {
      if (elTurnos) elTurnos.textContent = "0";
      if (elDuracao) elDuracao.textContent = "0.0h";
      if (elEvtHora) elEvtHora.textContent = "0.0";
      if (elEvtKm) elEvtKm.textContent = "0.0";

      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="p-8 text-center text-gray-400 italic">Nenhum turno finalizado registado para ${concelhoRelatoriosAtivo}.</td>
        </tr>`;
      containerHistorico.innerHTML = `
        <p class="text-xs text-gray-400 italic text-center py-8">Nenhum histórico registado.</p>`;
      return;
    }

    let somaDuracao = 0;
    let somaEvtHora = 0;
    let somaEvtKm = 0;

    relatorios.forEach(r => {
      somaDuracao += (r.telemetriaTurno?.duracaoHoras || 0);
      somaEvtHora += (r.metricasEficiencia?.eventosPorHora || 0);
      somaEvtKm += (r.metricasEficiencia?.eventosPorKm || 0);
    });

    const totalTurnos = relatorios.length;
    if (elTurnos) elTurnos.textContent = totalTurnos;
    if (elDuracao) elDuracao.textContent = `${(somaDuracao / totalTurnos).toFixed(1)}h`;
    if (elEvtHora) elEvtHora.textContent = (somaEvtHora / totalTurnos).toFixed(1);
    if (elEvtKm) elEvtKm.textContent = (somaEvtKm / totalTurnos).toFixed(1);

    // Calcular e guardar médias para a tabela
    ultimasMediasCalculadasDesktop = calcularMediasHistoricasPorBrick(relatorios);

    // Ativar escuta em tempo real da caixa de pesquisa por CP7
    if (inputPesquisa && !inputPesquisa.dataset.bound) {
      inputPesquisa.addEventListener('input', (e) => {
        renderizarTabelaDesktopFiltrada(e.target.value);
      });
      inputPesquisa.dataset.bound = "true";
    }

    renderizarTabelaDesktopFiltrada(inputPesquisa ? inputPesquisa.value : "");

    // Renderizar a lista histórica de turnos à direita
    containerHistorico.innerHTML = "";
    relatorios.forEach(r => {
      const dateObj = new Date(r.dataHoraCriacao || r.dataRelatorio);
      const dataStr = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()}`;
      const horaStr = `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;

      const card = document.createElement('div');
      card.className = "p-4 bg-gray-50 hover:bg-purple-50/50 border border-gray-200 hover:border-purple-300 rounded-2xl flex items-center justify-between transition-all cursor-pointer shadow-2xs";
      card.innerHTML = `
        <div class="space-y-1">
          <div class="flex items-center space-x-2">
            <span class="font-bold text-gray-800 text-xs">${r.driverName || 'Motorista'}</span>
            <span class="text-[10px] bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full font-mono font-bold">${dataStr} ${horaStr}</span>
          </div>
          <div class="text-[11px] text-gray-500 flex items-center space-x-3">
            <span>⏱️ ${r.telemetriaTurno?.duracaoHoras || 0}h</span>
            <span>🛣️ ${r.telemetriaTurno?.kmPercorridos || 0} KM</span>
            <span>📦 ${r.resumoEventos?.totalObjetosAlocados || 0} pacotes</span>
          </div>
        </div>
        <button type="button" class="btn-ver-detalhe-desktop bg-purple-600 hover:bg-purple-700 text-white font-bold text-[10px] px-3 py-2 rounded-xl transition-all cursor-pointer shadow-xs">
          Ver Turno
        </button>
      `;

      card.querySelector('.btn-ver-detalhe-desktop').addEventListener('click', (e) => {
        e.stopPropagation();
        exibirModalDetalheTurnoDesktop(r);
      });

      card.addEventListener('click', () => {
        exibirModalDetalheTurnoDesktop(r);
      });

      containerHistorico.appendChild(card);
    });

  } catch (err) {
    console.error("❌ Erro ao renderizar Centro de Relatórios Desktop:", err);
  }
}

// Exportações Globais
window.rotasRelatorios = {
  verificarPendenciasRota,
  agruparObjetosPorBrick,
  calcularMetricasRelatorio,
  salvarRelatorioNoFirestore,
  carregarHistoricoRelatorios,
  calcularMediasHistoricasPorBrick,
  renderizarRelatoriosUI
};

window.renderizarRelatoriosUI = renderizarRelatoriosUI;