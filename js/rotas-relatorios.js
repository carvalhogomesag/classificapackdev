/**
 * ============================================================================
 * CLASSIFICA PACK - MÓDULO DE RELATÓRIOS DE TURNO E DESEMPENHO POR BRICK
 * Ficheiro: js/rotas-relatorios.js
 * Versão: v71.2 - Importação direta e segura do Firestore (firebase-init.js).
 * Função: Agrupa dados da rota finalizada por Brick, calcula métricas de
 *         eficiência (Eventos/Hora, Eventos/KM) e persiste no Firestore.
 * ============================================================================
 */

import { resolveBrickForZip } from './rotas-geografia.js';
import { db } from './firebase-init.js';

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
 * Agrupa as entregas/recolhas por Brick.
 * @param {Array} listaMoradas - Array de objetos de moradas/entregas da rota
 * @returns {Object} - Mapeamento com contagem de totais, entregas, recolhas e falhas por Brick
 */
export function agruparObjetosPorBrick(listaMoradas = []) {
  const relatorioBricks = {};

  listaMoradas.forEach(item => {
    // Resolver o Brick a partir do Código Postal 7 dígitos (CP7)
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
        pendentes: 0
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
    } else if (status === 'falha' || status === 'incidencia' || status === 'recusado' || status === 'ausente') {
      relatorioBricks[brickId].falhas += 1;
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

  // Cálculo da Duração em Minutos e Horas
  const duracaoMs = Math.max(0, horaFimDate.getTime() - horaInicioDate.getTime());
  const duracaoMinutos = Math.round(duracaoMs / (1000 * 60));
  const duracaoHoras = parseFloat((duracaoMinutos / 60).toFixed(2));

  // Quilometragem
  const kmInicial = Number(dadosTurno.kmInicial) || 0;
  const kmFinal = Number(dadosTurno.kmFinal) || 0;
  const kmPercorridos = Math.max(0, kmFinal - kmInicial);

  // Agrupamento por Brick
  const resumoBricks = agruparObjetosPorBrick(listaMoradas);

  // Totalizadores Globais
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

  // Métricas por Hora
  const eventosPorHora = duracaoHoras > 0 ? parseFloat((totalEventosConcluidos / duracaoHoras).toFixed(2)) : 0;
  const entregasPorHora = duracaoHoras > 0 ? parseFloat((totalEntregas / duracaoHoras).toFixed(2)) : 0;
  const recolhasPorHora = duracaoHoras > 0 ? parseFloat((totalRecolhas / duracaoHoras).toFixed(2)) : 0;
  const falhasPorHora = duracaoHoras > 0 ? parseFloat((totalFalhas / duracaoHoras).toFixed(2)) : 0;

  // Métricas por KM
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
 * Tenta obter a instância do Firestore via importação direta (db), window.db ou SDK global.
 * @param {Object} relatorioFinal - Objeto com os dados do relatório formatado
 * @returns {Promise<string>} ID do documento gerado no Firestore
 */
export async function salvarRelatorioNoFirestore(relatorioFinal) {
  // Resolução em cascata segura da instância do Firestore
  const firestoreDb = db || window.db || (typeof firebase !== 'undefined' && firebase.firestore ? firebase.firestore() : null);

  if (!firestoreDb) {
    throw new Error("Não foi possível conectar ao Firestore. Nenhuma instância ativa foi encontrada.");
  }

  // HIGIENIZAÇÃO RÍGIDA: Elimina completamente 'undefined' incompatíveis com o Firestore JS SDK
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

// Exportar para o escopo global para compatibilidade com o sistema de scripts Vanilla
window.rotasRelatorios = {
  verificarPendenciasRota,
  agruparObjetosPorBrick,
  calcularMetricasRelatorio,
  salvarRelatorioNoFirestore
};