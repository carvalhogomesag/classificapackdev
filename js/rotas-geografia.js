/**
 * js/rotas-geografia.js
 * Versão v70.9 - Módulo de Resolução Geográfica de Bricks e Concelho
 * Faz: Utilitários puros para deteção de Concelho (Mafra/Sintra) e cruzamento
 *      de Códigos Postais (CP7) com a base geográfica para resolver Bricks (Estantes).
 * Depende de: ./geografia-data.js
 */

import { GEOGRAPHY } from './geografia-data.js';

/**
 * Deteta se a localidade é a capital genérica (catch-all) de uma freguesia
 */
export function isCatchAllLocality(freguesia, localidade) {
    const cleanFreg = freguesia.replace(/\s+MFR$/i, "").toLowerCase();
    const cleanLoc = localidade.replace(/\s*\(\d{3}-\d{3}\)$/, "").toLowerCase();
    
    if (cleanLoc === cleanFreg) return true;
    if (cleanFreg === "são miguel de alcainça" && cleanLoc === "alcainça") return true;
    return false;
}

/**
 * Deteta o concelho (MAFRA ou SINTRA) com base no prefixo de 4 dígitos do Código Postal
 */
export function obterConcelhoPorCodigoPostal(zip) {
    if (!zip) return "MAFRA";
    const cleanPrefix = zip.replace(/\D/g, '').substring(0, 4);
    if (cleanPrefix === "2705" || cleanPrefix === "2710" || cleanPrefix === "2715" || cleanPrefix === "2725") {
        return "SINTRA";
    }
    return "MAFRA";
}

/**
 * Encontra o Brick (Freguesia|Localidade) e o Nome correspondente a um Código Postal (CP7)
 */
export function resolveBrickForZip(zip, drivers) {
    if (!zip || !drivers) return { brickId: null, brickName: null };
    const regexZip = /\d{4}-\d{3}/;
    const match = zip.match(regexZip);
    const normalizedZip = match ? match[0] : zip.trim();

    const concelho = obterConcelhoPorCodigoPostal(normalizedZip);

    let matchedFreguesia = null;
    let matchedLocalidade = null;

    if (!GEOGRAPHY[concelho]) return { brickId: null, brickName: null };

    // PASSAGEM 1: Procura nas localidades específicas
    for (const [freguesia, localidades] of Object.entries(GEOGRAPHY[concelho])) {
        for (const [localidade, cpList] of Object.entries(localidades)) {
            if (isCatchAllLocality(freguesia, localidade)) continue;
            if (cpList.includes(normalizedZip)) {
                matchedFreguesia = freguesia;
                matchedLocalidade = localidade;
                break;
            }
        }
        if (matchedFreguesia) break;
    }

    // PASSAGEM 2: Fallback para localidades genéricas (catch-all)
    if (!matchedFreguesia) {
        for (const [freguesia, localidades] of Object.entries(GEOGRAPHY[concelho])) {
            for (const [localidade, cpList] of Object.entries(localidades)) {
                if (isCatchAllLocality(freguesia, localidade) && cpList.includes(normalizedZip)) {
                    matchedFreguesia = freguesia;
                    matchedLocalidade = localidade;
                    break;
                }
            }
            if (matchedFreguesia) break;
        }
    }

    if (!matchedFreguesia) return { brickId: null, brickName: null };

    return { 
        brickId: `${matchedFreguesia}|${matchedLocalidade}`, 
        brickName: matchedLocalidade 
    };
}