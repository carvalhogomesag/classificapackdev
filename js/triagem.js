/**
 * triagem.js
 * Faz: Controla toda a lógica de triagem, cálculo de motorista e Brick (Localidade) designados para o código postal de 7 dígitos, processamento OCR com câmara e estatísticas de contagem do turno.
 *      Implementa algoritmo de dupla passagem para priorizar localidades específicas sobre as capitais genéricas homónimas.
 *      NOVO: Deteta automaticamente se o código pertence a Mafra ou Sintra pelo prefixo do código postal.
 *      NOVO: Divide o sumário de leituras em dois blocos claros (Mafra e Sintra) para melhor usabilidade do gestor.
 *      NOVO: Grava as confirmações de triagem diretamente na coleção 'assignments' do Firestore para sincronização em nuvem de imediato.
 *      MELHORADO: Suporta a lógica de Bricks por centenas, limpando os parênteses ao calcular a localidade capital (catch-all).
 * NÃO faz: Não gere ecrãs de planeamento ou Jitter do mapa do condutor (rotas.js / maps.js).
 * Depende de: ./geografia-data.js, ./storage.js, ./voz.js, ./ui.js, ./firebase-init.js (para aceder ao db)
 */

import { GEOGRAPHY } from './geografia-data.js';
import { saveData } from './storage.js';
import { criarReconhecimentoVoz } from './voz.js';
import { updateVisor } from './ui.js';

// Importa a instância ativa do Firestore
import { db } from './firebase-init.js';

// =========================================================================
// FUNÇÕES AUXILIARES DE LIMPEZA E PERSISTÊNCIA
// =========================================================================
function sanitizeDigits(str) { 
    return str.replace(/\D/g, ''); 
}

function sincronizarPersistencia() {
    saveData(
        window.drivers, 
        [], // intervals obsoletos
        window.assignments,
        window.partidaLocalizacao,
        window.moradasEntregas,
        window.rotaOtimizada,
        window.dataRotaSelecionada, 
        window.rotaIniciada
    );
}

// Auxiliar para detetar o concelho correspondente ao código postal fornecido
function obterConcelhoPorCodigoPostal(zip) {
    if (!zip) return "MAFRA";
    const cleanPrefix = sanitizeDigits(zip).substring(0, 4);
    // Códigos postais de Sintra começam por 2705, 2710, 2715 ou 2725
    if (cleanPrefix === "2705" || cleanPrefix === "2710" || cleanPrefix === "2715" || cleanPrefix === "2725") {
        return "SINTRA";
    }
    return "MAFRA"; // Padrão/Fallback para Mafra (2640, 2655, 2665, etc.)
}

// Auxiliar para detetar se uma localidade é a capital genérica (catch-all) de uma freguesia
function isCatchAllLocality(freguesia, localidade) {
    const cleanFreg = freguesia.replace(/\s+MFR$/i, "").replace(/\s+\(U\.F\.\)$/i, "").toLowerCase();
    
    // Remove os parênteses de centenas (ex: "Sintra (000-099)" passa a "sintra") para fins de comparação
    const cleanLoc = localidade.replace(/\s*\(\d{3}-\d{3}\)$/, "").toLowerCase();
    
    if (cleanLoc === cleanFreg) return true;
    // Exceções de normalização:
    if (cleanFreg === "são miguel de alcainça" && cleanLoc === "alcainça") return true;
    return false;
}

// =========================================================================
// ALGORITMO DE RESOLUÇÃO GEOGRÁFICA DE BRICK E MOTORISTA (COM PRIORIZAÇÃO)
// =========================================================================
export function findBrickAndDriverForZip(zip, drivers) {
    if (!zip || !drivers) return { brickId: null, brickName: null, driver: null };
    const normalizedZip = zip.trim(); // Esperado: "2640-401" ou "2705-011"
    
    // Deteta de forma inteligente e autónoma se é Mafra ou Sintra com base no CP7 digitado
    const concelho = obterConcelhoPorCodigoPostal(normalizedZip);

    let matchedFreguesia = null;
    let matchedLocalidade = null;

    if (!GEOGRAPHY[concelho]) {
        return { brickId: null, brickName: null, driver: null };
    }

    // PASSAGEM 1: Mira laser - Procura apenas nas localidades específicas (ignorando as catch-all genéricas)
    for (const [freguesia, localidades] of Object.entries(GEOGRAPHY[concelho])) {
        for (const [localidade, cpList] of Object.entries(localidades)) {
            // Se for localidade catch-all (ex: Mafra na freguesia MAFRA ou Sintra na freguesia SINTRA U.F.), ignora nesta primeira passagem
            if (isCatchAllLocality(freguesia, localidade)) {
                continue;
            }

            if (cpList.includes(normalizedZip)) {
                matchedFreguesia = freguesia;
                matchedLocalidade = localidade;
                break;
            }
        }
        if (matchedFreguesia) break;
    }

    // PASSAGEM 2: Fallback - Se não encontrou em nenhuma específica, procura nas genéricas (catch-all)
    if (!matchedFreguesia) {
        for (const [freguesia, localidades] of Object.entries(GEOGRAPHY[concelho])) {
            for (const [localidade, cpList] of Object.entries(localidades)) {
                if (isCatchAllLocality(freguesia, localidade)) {
                    if (cpList.includes(normalizedZip)) {
                        matchedFreguesia = freguesia;
                        matchedLocalidade = localidade;
                        break;
                    }
                }
            }
            if (matchedFreguesia) break;
        }
    }

    if (!matchedFreguesia) {
        return { brickId: null, brickName: null, driver: null, concelho };
    }

    const brickId = `${matchedFreguesia}|${matchedLocalidade}`;
    const brickName = matchedLocalidade;

    // Encontra o motorista ativo que tem esta localidade (Brick) assinalada na sua lista
    const driver = drivers.find(d => Array.isArray(d.brickIds) && d.brickIds.includes(brickId));

    return { brickId, brickName, driver, concelho };
}

// ==========================================
// MANTIDO POR EXIGÊNCIAS DE EVENTOS AUXILIARES
// ==========================================
export function findDriverForZip(zip, sectors, drivers) {
    const res = findBrickAndDriverForZip(zip, drivers);
    return res.driver;
}

// =========================================================================
// PAINEL DE RESUMO DE LEITURAS / TRIPULAÇÃO
// =========================================================================
export function renderSummary(assignments, drivers, painelResumo) {
    if (!painelResumo) return;
    painelResumo.innerHTML = "";

    const totalLeituras = assignments.length;
    const totalPrioritarios = assignments.filter(a => a.priority === true).length; 

    const headerDiv = document.createElement('div');
    headerDiv.className = "flex justify-between items-center pb-2 border-b text-sm font-semibold text-gray-700";
    headerDiv.innerHTML = `
        <span>Total Processado:</span>
        <div class="flex items-center space-x-1.5">
            <span class="bg-blue-600 text-white px-2.5 py-0.5 rounded-full text-xs font-bold" title="Total de encomendas">${totalLeituras} un</span>
            ${totalPrioritarios > 0 ? `<span class="bg-orange-500 text-white px-2.5 py-0.5 rounded-full text-xs font-bold flex items-center space-x-1" title="Prioritárias"><i class="fa-solid fa-circle-exclamation"></i> <span>${totalPrioritarios}</span></span>` : ''}
        </div>
    `;
    painelResumo.appendChild(headerDiv);

    if (drivers.length === 0) {
        painelResumo.innerHTML += `<p class="text-xs text-gray-400 italic text-center py-2">Registe motoristas para ver o resumo.</p>`;
        return;
    }

    // MELHORADO: Criamos uma grelha responsiva de duas colunas para dividir Mafra e Sintra
    const gridContainer = document.createElement('div');
    gridContainer.className = "grid grid-cols-1 md:grid-cols-2 gap-4 mt-3";

    // Coluna Mafra
    const colMafra = document.createElement('div');
    colMafra.className = "space-y-1.5 p-3 bg-blue-50/25 rounded-lg border border-blue-100/50";
    colMafra.innerHTML = `
        <h4 class="text-[10px] font-black uppercase text-blue-700 bg-blue-100/50 px-2 py-1 rounded flex items-center space-x-1 mb-2">
            <i class="fa-solid fa-map-pin text-[9px]"></i> <span>Concelho de Mafra</span>
        </h4>
        <div class="space-y-1.5" id="lista-resumo-mafra"></div>
    `;

    // Coluna Sintra
    const colSintra = document.createElement('div');
    colSintra.className = "space-y-1.5 p-3 bg-amber-50/25 rounded-lg border border-amber-100/50";
    colSintra.innerHTML = `
        <h4 class="text-[10px] font-black uppercase text-amber-700 bg-amber-100/50 px-2 py-1 rounded flex items-center space-x-1 mb-2">
            <i class="fa-solid fa-map-pin text-[9px]"></i> <span>Concelho de Sintra</span>
        </h4>
        <div class="space-y-1.5" id="lista-resumo-sintra"></div>
    `;

    gridContainer.appendChild(colMafra);
    gridContainer.appendChild(colSintra);
    painelResumo.appendChild(gridContainer);

    const listMafra = colMafra.querySelector('#lista-resumo-mafra');
    const listSintra = colSintra.querySelector('#lista-resumo-sintra');

    let temMafra = false;
    let temSintra = false;

    drivers.forEach(driver => {
        const totalDriver = assignments.filter(a => a.driverId === driver.id).length;
        const totalPrioritariosDriver = assignments.filter(a => a.driverId === driver.id && a.priority === true).length;
        const percent = totalLeituras > 0 ? Math.round((totalDriver / totalLeituras) * 100) : 0;

        const row = document.createElement('div');
        row.className = "flex items-center justify-between text-xs py-1 hover:bg-white/60 px-1 rounded transition duration-100";
        row.innerHTML = `
            <div class="flex items-center space-x-2 truncate pr-1">
                <span class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: ${driver.color}"></span>
                <span class="font-medium text-gray-700 truncate">${driver.name}</span>
            </div>
            <div class="flex items-center space-x-1.5 font-bold text-gray-900 flex-shrink-0">
                <span>${totalDriver} un</span>
                ${totalPrioritariosDriver > 0 ? `<span class="bg-orange-100 text-orange-700 text-[10px] px-1 py-0.5 rounded font-bold flex items-center" title="Prioritários"><i class="fa-solid fa-circle-exclamation text-[8px] mr-0.5"></i> ${totalPrioritariosDriver}</span>` : ''}
                <span class="text-gray-400 text-[10px] font-normal">(${percent}%)</span>
            </div>
        `;

        // Atribui o motorista ao seu respetivo bloco com base no concelho de atuação
        const concelhos = Array.isArray(driver.concelhos) ? driver.concelhos : ["MAFRA"];
        
        if (concelhos.includes("MAFRA")) {
            listMafra.appendChild(row.cloneNode(true));
            temMafra = true;
        }
        if (concelhos.includes("SINTRA")) {
            listSintra.appendChild(row);
            temSintra = true;
        }
    });

    if (!temMafra) {
        listMafra.innerHTML = `<p class="text-[10px] text-gray-400 italic py-2 text-center">Sem motoristas registados.</p>`;
    }
    if (!temSintra) {
        listSintra.innerHTML = `<p class="text-[10px] text-gray-400 italic py-2 text-center">Sem motoristas registados.</p>`;
    }

    // Bloco para contagens de encomendas "Sem Motorista Atribuído" (Caso existam)
    const totalSemMotorista = assignments.filter(a => a.driverId === null).length;
    const totalSemMotoristaPrioridade = assignments.filter(a => a.driverId === null && a.priority === true).length;
    
    if (totalSemMotorista > 0) {
        const percentSem = Math.round((totalSemMotorista / totalLeituras) * 100);
        const rowSem = document.createElement('div');
        rowSem.className = "flex items-center justify-between text-xs py-2 border-t border-dashed mt-3 pt-2";
        rowSem.innerHTML = `
            <div class="flex items-center space-x-2 text-gray-500">
                <span class="w-3.5 h-3.5 rounded-full bg-gray-400"></span>
                <span class="font-medium italic">Sem Motorista Atribuído</span>
            </div>
            <div class="flex items-center space-x-2 font-bold text-red-600">
                <span>${totalSemMotorista} un</span>
                ${totalSemMotoristaPrioridade > 0 ? `<span class="bg-orange-100 text-orange-700 text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center"><i class="fa-solid fa-circle-exclamation text-[8px] mr-0.5"></i> ${totalSemMotoristaPrioridade}</span>` : ''}
                <span class="text-gray-400 text-[10px] font-normal">(${percentSem}%)</span>
            </div>
        `;
        painelResumo.appendChild(rowSem);
    }
}

// ==========================================
// ASSINATURA GLOBAL DO ATUALIZADOR DE RESUMO (WINDOW)
// ==========================================
window.atualizarSummaryUI = () => {
    renderSummary(window.assignments, window.drivers, document.getElementById('painel-resumo'));
};

// =========================================================================
// LÓGICA DE DETEÇÃO DE CÓDIGOS E MODAL DE LEITURAS (TRIAGEM - GRAVAÇÃO EM CLOUD!)
// =========================================================================
export function setupTriagemLogic() {
    const btnAnalisar = document.getElementById('btn-analisar');
    const btnConfirmarAtribuir = document.getElementById('btn-confirmar-atribuir');
    const modalResultado = document.getElementById('modal-resultado');

    function cancelarAtribuicao() {
        if (modalResultado) modalResultado.classList.add('hidden');
        window.lastAnalysisResult = null;
        
        // Limpa visor ao fechar (cancelamento no clique fora do modal)
        window.currentInput = "";
        const visorCodigo = document.getElementById('visor-codigo');
        if (visorCodigo) {
            updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
        }
    }

    if (btnAnalisar) {
        btnAnalisar.addEventListener('click', () => {
            let zipToAnalyze = "";
            if (window.isPrefixLocked) {
                zipToAnalyze = window.lockedPrefixValue + window.currentInput;
            } else {
                zipToAnalyze = window.currentInput;
            }

            const cleanDigits = sanitizeDigits(zipToAnalyze);
            if (cleanDigits.length !== 7) {
                alert("Por favor, introduza um Código Postal válido com 7 dígitos.");
                return;
            }

            const formattedZip = `${cleanDigits.substring(0, 4)}-${cleanDigits.substring(4, 7)}`;
            
            // Resolução dinâmica priorizada de Brick (Localidade) e Motorista
            const { brickId, brickName, driver, concelho } = findBrickAndDriverForZip(formattedZip, window.drivers);
            
            const resultadoCodigo = document.getElementById('resultado-codigo');
            const resultadoMotorista = document.getElementById('resultado-motorista');
            const resultadoCorBg = document.getElementById('resultado-cor-bg');
            const chkPrioridade = document.getElementById('chk-prioridade');
            
            const resultadoBrickLabel = document.getElementById('resultado-brick-label');
            const modalBrickOverride = document.getElementById('modal-brick-override');

            if (resultadoCodigo) resultadoCodigo.textContent = formattedZip;
            
            // Popula o override dropdown com as localidades ativas
            if (modalBrickOverride) {
                modalBrickOverride.innerHTML = '<option value="">Sem Alteração (Auto)</option>';
                window.drivers.forEach(drv => {
                    if (Array.isArray(drv.brickIds)) {
                        drv.brickIds.forEach(id => {
                            const opt = document.createElement('option');
                            opt.value = id; 
                            opt.textContent = `${id.split('|')[0]} - ${id.split('|')[1]} (${drv.name})`;
                            modalBrickOverride.appendChild(opt);
                        });
                    }
                });
            }

            if (!brickId) {
                // Código Postal NÃO encontrado na base de dados de Mafra ou Sintra (Aviso de Alerta)
                if (resultadoMotorista) resultadoMotorista.textContent = "CP Não Encontrado";
                if (resultadoBrickLabel) resultadoBrickLabel.textContent = `Confirmar Código Postal (${concelho})`;
                if (resultadoCorBg) resultadoCorBg.style.backgroundColor = "#EA580C"; // Cor Laranja de Alerta
                
                window.lastAnalysisResult = { 
                    zip: formattedZip, 
                    driverId: null,
                    brickId: null,
                    brickName: "Não Encontrado",
                    isInvalid: true,
                    concelho: concelho
                };
            } else {
                // CASO: Código Postal VÁLIDO
                if (resultadoBrickLabel) {
                    resultadoBrickLabel.textContent = `${brickId.split('|')[0]} - ${brickName} (${concelho})`;
                }

                if (driver) {
                    if (resultadoMotorista) resultadoMotorista.textContent = driver.name;
                    if (resultadoCorBg) resultadoCorBg.style.backgroundColor = driver.color;
                    window.lastAnalysisResult = { 
                        zip: formattedZip, 
                        driverId: driver.id,
                        brickId: brickId,
                        brickName: brickName,
                        isInvalid: false,
                        concelho: concelho
                    };
                } else {
                    if (resultadoMotorista) resultadoMotorista.textContent = "Sem Motorista";
                    if (resultadoCorBg) resultadoCorBg.style.backgroundColor = "#9CA3AF"; 
                    window.lastAnalysisResult = { 
                        zip: formattedZip, 
                        driverId: null,
                        brickId: brickId,
                        brickName: brickName,
                        isInvalid: false,
                        concelho: concelho
                    };
                }
            }

            if (chkPrioridade) chkPrioridade.checked = false;
            if (modalResultado) modalResultado.classList.remove('hidden');
        });
    }

    if (btnConfirmarAtribuir && modalResultado) {
        btnConfirmarAtribuir.addEventListener('click', () => {
            if (!window.lastAnalysisResult) return;

            const chkPrioridade = document.getElementById('chk-prioridade');
            const isPriority = chkPrioridade ? chkPrioridade.checked : false;

            const modalBrickOverride = document.getElementById('modal-brick-override');
            let finalDriverId = window.lastAnalysisResult.driverId;
            let finalBrickId = window.lastAnalysisResult.brickId;
            let finalBrickName = window.lastAnalysisResult.brickName;

            if (modalBrickOverride && modalBrickOverride.value) {
                const selectedBrickId = modalBrickOverride.value;
                const ownerDriver = window.drivers.find(d => Array.isArray(d.brickIds) && d.brickIds.includes(selectedBrickId));
                
                finalDriverId = ownerDriver ? ownerDriver.id : null;
                finalBrickId = selectedBrickId;
                finalBrickName = selectedBrickId.split('|')[1];
            }

            // NOVO: Grava a leitura de triagem diretamente na coleção global 'assignments' no Firestore!
            db.collection('assignments').add({
                id: 'a_' + Date.now(),
                zip: window.lastAnalysisResult.zip,
                driverId: finalDriverId,
                brickId: finalBrickId,
                brickName: finalBrickName,
                priority: isPriority,
                concelho: window.lastAnalysisResult.concelho || obterConcelhoPorCodigoPostal(window.lastAnalysisResult.zip),
                date: new Date().toISOString().split('T')[0],
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            }).then(() => {
                console.log("[FIREBASE] Triagem guardada com sucesso no Firestore.");
            }).catch((err) => {
                console.error("[FIREBASE] Erro ao gravar triagem:", err);
                alert("Erro de ligação: Não foi possível sincronizar a triagem na nuvem.");
            });

            modalResultado.classList.add('hidden');
            
            // Limpa imediatamente o visor do teclado virtual ao confirmar
            window.currentInput = "";
            const visorCodigo = document.getElementById('visor-codigo');
            if (visorCodigo) {
                updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
            }
            window.lastAnalysisResult = null;
        });
    }

    if (modalResultado) {
        modalResultado.addEventListener('click', (e) => {
            if (e.target === modalResultado) {
                cancelarAtribuicao();
            }
        });
    }
}

// ==========================================
// CONFIGURAÇÃO DOS BOTÕES "CANCELAR" (EDIÇÕES)
// ==========================================
export function setupCancelButtons() {
    const btnCancelarMotorista = document.getElementById('btn-cancelar-motorista');
    const btnCancelarSetor = document.getElementById('btn-cancelar-setor');

    if (btnCancelarMotorista) {
        btnCancelarMotorista.addEventListener('click', () => {
            window.cancelarEdicaoDriver();
        });
    }

    if (btnCancelarSetor) {
        btnCancelarSetor.addEventListener('click', () => {
            window.cancelarEdicaoSector();
        });
    }
}

// ==========================================
// RECONHECIMENTO DE VOZ DA TRIAGEM (MÉTODO UNIFICADO VIA VOZ.JS)
// ==========================================
export function setupVozTriagemLogic() {
    // Desativado reativamente para manter a triagem pura no Código Postal
}

// =========================================================================
// PRÉ-PROCESSAMENTO DIGITAL DE IMAGEM PARA OCR (CÂMARA)
// =========================================================================
export function preprocessarImagemParaOCR(file, callback) {
    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            const maxDim = 1000;
            let width = img.width;
            let height = img.height;
            if (width > maxDim || height > maxDim) {
                if (width > height) {
                    height = Math.round((height * maxDim) / width);
                    width = maxDim;
                } else {
                    width = Math.round((width * maxDim) / height);
                    height = maxDim;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            
            const imgData = ctx.getImageData(0, 0, width, height);
            const data = imgData.data;
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const v = 0.299 * r + 0.587 * g + 0.114 * b;
                const finalColor = v > 125 ? 255 : 0; // Algoritmo de Binarização defensivo para OCR
                data[i] = finalColor;
                data[i + 1] = finalColor;
                data[i + 2] = finalColor;
            }
            ctx.putImageData(imgData, 0, 0);
            
            canvas.toBlob((blob) => {
                callback(blob);
            }, 'image/jpeg', 0.90);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

// ==========================================
// FILTRAGEM E LIMPEZA DE MORADAS DO OCR
// ==========================================
export function extrairMoradaFocada(text) {
    const lines = text.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 2);

    const regexFiltroLixo = /\b(63300|63369|paq24|meest|ref:|exp:|portes|pagado|bultos|peso|reembolso|eur|fecha|sender|recipient|remetente|destinatario)\b/i;
    const regexMoradaTermos = /(rua|caminho|av|avenida|travessa|beco|largo|praca|nº|n\.\d|lote|casal|quinta|urbanizacao|mafra|ericeira|sintra|encarnacao|carvoeira|cheleiros|gradil|malveira|milharado|sobral|alcainca|venda\s+do\s+pinheiro)/i;

    let moradaCandidata = "";

    const linhasLimpas = lines.filter(line => {
        if (/\d{8,}/.test(line)) return false;
        if (regexFiltroLixo.test(line)) return false;
        return true;
    });

    for (let line of linhasLimpas) {
        if (regexMoradaTermos.test(line)) {
            moradaCandidata += line + " ";
        }
    }

    // Deteta se o texto extraído tem termos de Sintra para direcionar o geocoder no concelho certo
    const isSintraText = /sintra|colares|terrugem|algueirão|mem\s+martins|almargem|pêro\s+pinheiro|montelavar/i.test(text);
    const concelhoName = isSintraText ? "Sintra" : "Mafra";

    if (moradaCandidata.trim().length > 6) {
        return moradaCandidata.trim() + `, ${concelhoName}, Portugal`;
    }

    return linhasLimpas.slice(0, 2).join(', ') + `, ${concelhoName}, Portugal`;
}

// ==========================================
// CONFIGURAÇÃO DOS EVENTOS DA CÂMARA OCR
// ==========================================
export function setupCameraOcrLogic() {
    const btnCamera = document.getElementById('btn-camera-triagem'); // Oculto por defeito, preparado para expansão
    const inputCamera = document.getElementById('input-camera-captura');

    if (!btnCamera || !inputCamera) return;

    btnCamera.addEventListener('click', () => {
        if (typeof Tesseract === 'undefined') {
            alert("A carregar motor de leitura de imagem. Aguarde 2 segundos e tente novamente.");
            return;
        }
        inputCamera.click();
    });

    inputCamera.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        btnCamera.innerHTML = '<i class="fa-solid fa-spinner animate-spin text-lg"></i>';
        btnCamera.disabled = true;

        preprocessarImagemParaOCR(file, (processedBlob) => {
            Tesseract.recognize(
                processedBlob,
                'por',
                { logger: m => console.log(m.status, Math.round(m.progress * 100) + "%") }
            ).then(({ data: { text } }) => {
                const moradaFiltrada = extrairMoradaFocada(text);

                if (typeof google !== 'undefined' && google.maps && google.maps.Geocoder) {
                    const geocoder = new google.maps.Geocoder();
                    geocoder.geocode({ address: moradaFiltrada, componentRestrictions: { country: 'PT' } }, (results, status) => {
                        if (status === "OK" && results[0]) {
                            const matchedPlace = results[0];
                            let postalCode = "";

                            for (const component of matchedPlace.address_components) {
                                if (component.types.includes('postal_code')) {
                                    postalCode = component.long_name;
                                    break;
                                }
                            }

                            if (postalCode) {
                                const cleanCode = postalCode.replace(/\D/g, '');
                                if (cleanCode.length === 7) {
                                    window.currentInput = cleanCode;
                                    const visorCodigo = document.getElementById('visor-codigo');
                                    if (visorCodigo) {
                                        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
                                    }
                                    const btnAnalisar = document.getElementById('btn-analisar');
                                    if (btnAnalisar) btnAnalisar.click();
                                }
                            }
                        }
                    });
                }
            }).finally(() => {
                btnCamera.innerHTML = '<i class="fa-solid fa-camera text-lg"></i>';
                btnCamera.disabled = false;
                inputCamera.value = "";
            });
        });
    });
}