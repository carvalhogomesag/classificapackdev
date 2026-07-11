/**
 * triagem.js
 * Faz: Controla toda a lógica de triagem, cálculo de motorista designado para código postal de 7 dígitos, processamento OCR com câmara e estatísticas de contagem do turno.
 * NÃO faz: Não gere ecrãs de planeamento ou Jitter do mapa do condutor (rotas.js / maps.js).
 * Depende de: ./geografia-data.js, ./storage.js, ./voz.js, ./ui.js
 */

import { GEOGRAPHY } from './geografia-data.js';
import { saveData } from './storage.js';
import { criarReconhecimentoVoz } from './voz.js';
import { updateVisor } from './ui.js';

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
        window.rotaIniciada,
        window.sectors
    );
}

// =========================================================================
// ALGORITMO DE TRIAGEM HIERÁRQUICA E DETEÇÃO DE MOTORISTA
// =========================================================================
export function findDriverForZip(zip, sectors, drivers) {
    if (!zip) return null;
    const normalizedZip = zip.trim(); // Formato esperado: "2665-018"

    let matchedFreguesia = null;
    let matchedLocalidade = null;
    const concelho = "MAFRA";

    // 1. Cruza o código postal de 7 dígitos com a lista estática de Mafra
    for (const [freguesia, localidades] of Object.entries(GEOGRAPHY[concelho])) {
        for (const [localidade, cpList] of Object.entries(localidades)) {
            if (cpList.includes(normalizedZip)) {
                matchedFreguesia = freguesia;
                matchedLocalidade = localidade;
                break;
            }
        }
        if (matchedFreguesia) break;
    }

    if (!matchedFreguesia) return null;

    // 2. Procura o Setor ativo encarregue deste território
    const matchedSector = sectors.find(s => {
        const areaNames = Array.isArray(s.areaNames) ? s.areaNames : [];
        return areaNames.includes(matchedFreguesia) || areaNames.includes(`${matchedFreguesia}|${matchedLocalidade}`);
    });

    if (!matchedSector) return null;

    // 3. Devolve o motorista ativo que tem este Setor sob a sua responsabilidade
    const matchedDriver = drivers.find(d => Array.isArray(d.sectorIds) && d.sectorIds.includes(matchedSector.id));
    return matchedDriver || null; 
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

    drivers.forEach(driver => {
        const totalDriver = assignments.filter(a => a.driverId === driver.id).length;
        const totalPrioritariosDriver = assignments.filter(a => a.driverId === driver.id && a.priority === true).length;
        const percent = totalLeituras > 0 ? Math.round((totalDriver / totalLeituras) * 100) : 0;

        const row = document.createElement('div');
        row.className = "flex items-center justify-between text-xs py-1";
        row.innerHTML = `
            <div class="flex items-center space-x-2">
                <span class="w-3.5 h-3.5 rounded-full" style="background-color: ${driver.color}"></span>
                <span class="font-medium text-gray-700">${driver.name}</span>
            </div>
            <div class="flex items-center space-x-2 font-bold text-gray-900">
                <span>${totalDriver} un</span>
                ${totalPrioritariosDriver > 0 ? `<span class="bg-orange-100 text-orange-700 text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center space-x-0.5" title="Prioritários"><i class="fa-solid fa-circle-exclamation text-[8px]"></i> <span>${totalPrioritariosDriver}</span></span>` : ''}
                <span class="text-gray-400 text-[10px] font-normal">(${percent}%)</span>
            </div>
        `;
        painelResumo.appendChild(row);
    });

    const totalSemMotorista = assignments.filter(a => a.driverId === null).length;
    const totalSemMotoristaPrioridade = assignments.filter(a => a.driverId === null && a.priority === true).length;
    
    if (totalSemMotorista > 0) {
        const percentSem = Math.round((totalSemMotorista / totalLeituras) * 100);
        const rowSem = document.createElement('div');
        rowSem.className = "flex items-center justify-between text-xs py-1 border-t border-dashed mt-1 pt-1";
        rowSem.innerHTML = `
            <div class="flex items-center space-x-2 text-gray-500">
                <span class="w-3.5 h-3.5 rounded-full bg-gray-400"></span>
                <span class="font-medium italic">Sem Motorista</span>
            </div>
            <div class="flex items-center space-x-2 font-bold text-red-600">
                <span>${totalSemMotorista} un</span>
                ${totalSemMotoristaPrioridade > 0 ? `<span class="bg-orange-100 text-orange-700 text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center space-x-0.5"><i class="fa-solid fa-circle-exclamation text-[8px]"></i> <span>${totalSemMotoristaPrioridade}</span></span>` : ''}
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
// LÓGICA DE DETEÇÃO DE CÓDIGOS E MODAL DE LEITURAS (TRIAGEM)
// =========================================================================
export function setupTriagemLogic() {
    const btnAnalisar = document.getElementById('btn-analisar');
    const btnConfirmarAtribuir = document.getElementById('btn-confirmar-atribuir');
    const btnCancelarAtribuir = document.getElementById('btn-cancelar-atribuir');
    const modalResultado = document.getElementById('modal-resultado');

    function cancelarAtribuicao() {
        if (modalResultado) modalResultado.classList.add('hidden');
        window.lastAnalysisResult = null;
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
            const driver = findDriverForZip(formattedZip, window.sectors, window.drivers);
            
            const resultadoCodigo = document.getElementById('resultado-codigo');
            const resultadoMotorista = document.getElementById('resultado-motorista');
            const resultadoCorBg = document.getElementById('resultado-cor-bg');
            const chkPrioridade = document.getElementById('chk-prioridade');

            if (resultadoCodigo) resultadoCodigo.textContent = formattedZip;
            
            if (driver) {
                if (resultadoMotorista) resultadoMotorista.textContent = driver.name;
                if (resultadoCorBg) resultadoCorBg.style.backgroundColor = driver.color;
                window.lastAnalysisResult = { zip: formattedZip, driverId: driver.id };
            } else {
                if (resultadoMotorista) resultadoMotorista.textContent = "Sem Motorista";
                if (resultadoCorBg) resultadoCorBg.style.backgroundColor = "#9CA3AF"; 
                window.lastAnalysisResult = { zip: formattedZip, driverId: null };
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

            window.assignments.push({
                id: 'a_' + Date.now(),
                zip: window.lastAnalysisResult.zip,
                driverId: window.lastAnalysisResult.driverId,
                priority: isPriority,
                date: new Date().toISOString().split('T')[0]
            });

            sincronizarPersistencia();
            window.atualizarSummaryUI();

            modalResultado.classList.add('hidden');
            window.currentInput = "";
            const visorCodigo = document.getElementById('visor-codigo');
            if (visorCodigo) {
                updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
            }
            window.lastAnalysisResult = null;
        });
    }

    if (btnCancelarAtribuir) {
        btnCancelarAtribuir.addEventListener('click', cancelarAtribuicao);
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

// =========================================================================
// RECONHECIMENTO DE VOZ DA TRIAGEM (MÉTODO UNIFICADO VIA VOZ.JS)
// =========================================================================
export function setupVozTriagemLogic() {
    const btnVoz = document.getElementById('btn-voz-triagem');
    const buscaMoradaInput = document.getElementById('busca-morada-triagem');
    const micAtivo = document.getElementById('mic-ativo-triagem');
    const micInativo = document.getElementById('mic-inativo-triagem');

    if (!btnVoz || !buscaMoradaInput) return;

    criarReconhecimentoVoz({
        btnElement: btnVoz,
        micAtivoElement: micAtivo,
        micInativoElement: micInativo,
        activeClasses: ['bg-red-500', 'text-white', 'border-red-600'],
        inactiveClasses: ['bg-blue-50', 'text-blue-700', 'border-blue-200'],
        onResult: (transcript) => {
            buscaMoradaInput.value = transcript;
            console.log("Voz captada na Triagem:", transcript);

            if (typeof google !== 'undefined' && google.maps && google.maps.Geocoder) {
                const geocoder = new google.maps.Geocoder();
                geocoder.geocode({ address: transcript + ", Mafra, Portugal", componentRestrictions: { country: 'PT' } }, (results, status) => {
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
                                
                                console.log(`Morada ditada detetada com sucesso! Código: ${postalCode}`);
                                
                                const btnAnalisar = document.getElementById('btn-analisar');
                                if (btnAnalisar) btnAnalisar.click();
                            } else {
                                alert(`Morada detetada por voz: "${matchedPlace.formatted_address}".\nContudo, o Código Postal está incompleto (${postalCode}). Insira manualmente.`);
                            }
                        } else {
                            alert(`Encontrámos a morada ditada: "${matchedPlace.formatted_address}".\nMas não conseguimos extrair o Código Postal de 7 dígitos.`);
                        }
                    } else {
                        buscaMoradaInput.dispatchEvent(new Event('input', { bubbles: true }));
                        buscaMoradaInput.focus();
                    }
                });
            } else {
                buscaMoradaInput.dispatchEvent(new Event('input', { bubbles: true }));
                buscaMoradaInput.focus();
            }
        }
    });
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

    if (moradaCandidata.trim().length > 6) {
        return moradaCandidata.trim() + ", Mafra, Portugal";
    }

    return linhasLimpas.slice(0, 2).join(', ') + ", Mafra, Portugal";
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