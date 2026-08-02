/**
 * geografia-data.js
 * Faz: Funciona como ponto de entrada central (agregador) para a base geográfica.
 *      Importa as bases de dados de Mafra e Sintra de forma modular e exporta um único objeto GEOGRAPHY.
 * NÃO faz: Não contém dados rígidos (hardcoded) para manter o ficheiro leve e modular.
 * Depende de: './geografia-mafra.js' e './geografia-sintra.js'
 */

import { MAFRA } from './geografia-mafra.js';
import { SINTRA } from './geografia-sintra.js';

export const GEOGRAPHY = {
    "MAFRA": MAFRA,
    "SINTRA": SINTRA
};