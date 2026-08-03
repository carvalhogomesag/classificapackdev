/**
 * geografia-data.js
 * Faz: Funciona como ponto de entrada central (agregador) para a base geográfica.
 *      Importa as bases de dados de Mafra e Sintra e agrupa dinamicamente CPs por centenas 
 *      dos últimos 3 dígitos se a localidade contiver múltiplos códigos postais.
 * NÃO faz: Não contém dados rígidos (hardcoded) para manter o ficheiro leve e modular.
 * Depende de: './geografia-mafra.js' e './geografia-sintra.js'
 */

import { MAFRA as RAW_MAFRA } from './geografia-mafra.js';
import { SINTRA as RAW_SINTRA } from './geografia-sintra.js';

/**
 * Agrupa os códigos postais das localidades de cada freguesia pelas centenas do sufixo de 3 dígitos (ex: 000-099, 100-199).
 */
function agruparLocalidadesPorCentenas(rawGeography) {
    const groupedGeography = {};

    for (const [freguesia, localidades] of Object.entries(rawGeography)) {
        groupedGeography[freguesia] = {};

        for (const [localidade, cpList] of Object.entries(localidades)) {
            if (!Array.isArray(cpList) || cpList.length === 0) continue;

            // Se a localidade tiver apenas 1 CP, mantém-na como está para evitar sobrecarga visual
            if (cpList.length <= 1) {
                groupedGeography[freguesia][localidade] = cpList;
            } else {
                const grupos = {};

                cpList.forEach(cp => {
                    const partes = cp.split('-');
                    if (partes.length < 2) return;

                    const sufixoTexto = partes[1].trim();
                    const sufixoNumero = parseInt(sufixoTexto, 10);

                    if (isNaN(sufixoNumero)) {
                        const rangeKey = "Outros";
                        if (!grupos[rangeKey]) grupos[rangeKey] = [];
                        grupos[rangeKey].push(cp);
                        return;
                    }

                    // Determina a centena (ex: 157 -> centena 1 -> 100 a 199)
                    const centena = Math.floor(sufixoNumero / 100);
                    const de = centena * 100;
                    const ate = de + 99;

                    const rangeKey = `${String(de).padStart(3, '0')}-${String(ate).padStart(3, '0')}`;

                    if (!grupos[rangeKey]) grupos[rangeKey] = [];
                    grupos[rangeKey].push(cp);
                });

                // Insere cada sub-grupo como uma nova localidade (Brick) independente na árvore
                for (const [rangeKey, listaCps] of Object.entries(grupos)) {
                    const nomeNovoBrick = `${localidade} (${rangeKey})`;
                    groupedGeography[freguesia][nomeNovoBrick] = listaCps;
                }
            }
        }
    }

    return groupedGeography;
}

/**
 * Constrói um endereço livre de parênteses e formatado com o primeiro CP real do Brick.
 * Formato gerado: "2705-100 Colares, Sintra, Portugal" (altamente compreendido pelo Google).
 * 
 * @param {string} nomeBrick - O nome do Brick (ex: "Colares (100-199)")
 * @param {Array<string>} listaCps - Lista de CPs associados a este Brick
 * @param {string} freguesia - Nome da freguesia ativa
 * @param {string} concelho - Nome do concelho ativo (Sintra ou Mafra)
 * @returns {string} Endereço higienizado pronto para pesquisa
 */
export function obterEnderecoHigienizado(nomeBrick, listaCps, freguesia, concelho) {
    // Remove parênteses e intervalos de texto do nome (ex: "Colares (100-199)" -> "Colares")
    const localidadeLimpa = nomeBrick.replace(/\s*\(.*?\)\s*/g, '').trim();

    // Se tivermos códigos postais reais na lista, utilizamos o primeiro como representante preciso
    if (Array.isArray(listaCps) && listaCps.length > 0) {
        const cpRepresentante = listaCps[0];
        return `${cpRepresentante} ${localidadeLimpa}, ${concelho}, Portugal`;
    }

    // Fallback caso a lista de CPs esteja temporariamente vazia
    return `${localidadeLimpa}, ${freguesia}, ${concelho}, Portugal`;
}

export const GEOGRAPHY = {
    "MAFRA": agruparLocalidadesPorCentenas(RAW_MAFRA),
    "SINTRA": agruparLocalidadesPorCentenas(RAW_SINTRA)
};