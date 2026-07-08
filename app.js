// app.js
import { setupNavigation, showTab, updateVisor, setupKeypad, setupPrefixLock } from './ui.js';
import { saveData, safeJSONParse } from './storage.js';
import { 
    renderDrivers, 
    handleDriverSubmit, 
    renderSectorCheckboxes, 
    renderSummary,
    renderSectors,
    renderAreaCheckboxes,
    handleSectorSubmit,
    findDriverForZip
} from './gestao.js';
import { 
    inicializarGoogleAutocomplete, 
    inicializarGoogleAutocompleteTriagem, // Importa o inicializador específico de Triagem
    obterEnderecoPorGPSGoogle, 
    calcularDistanciaHaversine, 
    desenharMapaGoogle, 
    limparMapaVisual 
} from './rotas.js';

// ==========================================
// PALETE DE CORES GLOBAL
// ==========================================
const colorPalette = [
    "#2563EB", "#DC2626", "#059669", "#EA580C", 
    "#7C3AED", "#DB2777", "#0891B2", "#D97706", 
    "#0D9488", "#4F46E5", "#E11D48", "#4B5563"
];

// ==========================================
// ESTADO GLOBAL DA APLICAÇÃO (RECUPERAÇÃO SEGURA)
// ==========================================
window.drivers = safeJSONParse('cp_drivers', []);
window.assignments = safeJSONParse('cp_assignments', []);
window.sectors = safeJSONParse('cp_zones', []); // Setores em memória

// MIGRAÇÃO DE DADOS: converte motoristas antigos (sectorId único) para o novo
// modelo (sectorIds: array), já que agora um motorista pode ter vários setores.
window.drivers.forEach(driver => {
    if (!Array.isArray(driver.sectorIds)) {
        driver.sectorIds = driver.sectorId ? [driver.sectorId] : [];
    }
    delete driver.sectorId;
});

window.currentInput = "";
window.isPrefixLocked = false;
window.lockedPrefixValue = "";
window.selectedColor = "#2563EB";
window.lastAnalysisResult = null;

// Estados para controle de edição activa
window.driverSendoEditado = null;
window.sectorSendoEditado = null;

// Estados das Rotas com Recuperação de Memória Ativa e Segura
window.partidaLocalizacao = safeJSONParse('cp_partida', null);
window.moradasEntregas = safeJSONParse('cp_entregas', []);
window.rotaOtimizada = safeJSONParse('cp_rota_otimizada', []);
window.dataRotaSelecionada = safeJSONParse('cp_data_rota', "");
window.rotaIniciada = safeJSONParse('cp_rota_iniciada', false);
window.definindoPartidaPorMorada = false;

// Estado para controle de edição de paragens
let itemSendoEditado = null; 

// ==========================================
// CENTRAL DE MODOS: PLANEAMENTO VS CONDUÇÃO
// ==========================================
function alternarModoRota(modo) {
    const btnPlaneamento = document.getElementById('btn-modo-planeamento');
    const btnConducao = document.getElementById('btn-modo-conducao');
    const planningControls = document.getElementById('planning-controls');

    if (!btnPlaneamento || !btnConducao || !planningControls) return;

    if (modo === 'conducao') {
        planningControls.classList.add('hidden');
        
        // Atualização estética dos botões seletores
        btnConducao.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-white text-blue-600 shadow transition-all";
        btnPlaneamento.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 transition-all";
        
        localStorage.setItem('cp_modo_rota', 'conducao');
    } else {
        planningControls.classList.remove('hidden');
        
        // Atualização estética dos botões seletores
        btnPlaneamento.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-white text-blue-600 shadow transition-all";
        btnConducao.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 transition-all";
        
        localStorage.setItem('cp_modo_rota', 'planeamento');
    }
}

// ==========================================
// LÓGICA DE OCR (CÂMARA / LEITURA DE ETIQUETA COM IA)
// ==========================================
function setupCameraOcrLogic() {
    const btnCamera = document.getElementById('btn-camera-triagem');
    const inputCamera = document.getElementById('input-camera-captura');

    if (!btnCamera || !inputCamera) return;

    btnCamera.addEventListener('click', () => {
        // Verifica se a biblioteca Tesseract.js foi carregada no index.html
        if (typeof Tesseract === 'undefined') {
            alert("Erro: A biblioteca de leitura de imagem (OCR) ainda não foi descarregada. Verifique a ligação à Internet.");
            return;
        }
        // Dispara o input de ficheiro nativo com captura de câmara
        inputCamera.click();
    });

    inputCamera.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // Feedback visual no botão enquanto processa
        btnCamera.innerHTML = '<i class="fa-solid fa-spinner animate-spin text-lg"></i>';
        btnCamera.disabled = true;

        console.log("Iniciando leitura OCR na imagem selecionada...");

        // Executa o motor Tesseract.js localmente no telemóvel
        Tesseract.recognize(
            file,
            'por', // Reconhecer em Português
            { logger: m => console.log(m) }
        ).then(({ data: { text } }) => {
            console.log("Texto extraído da etiqueta:", text);

            if (!text || !text.trim()) {
                alert("Não foi possível detetar nenhum texto legível na fotografia. Aproxime mais a câmara e garanta que há boa iluminação.");
                return;
            }

            // Remove quebras de linha e limpa espaços extras para enviar à Google
            const cleanAddress = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

            // Usamos a API de Geocodificação da Google para pesquisar o endereço detetado e extrair o código postal estruturado
            if (typeof google !== 'undefined' && google.maps && google.maps.Geocoder) {
                const geocoder = new google.maps.Geocoder();
                geocoder.geocode({ address: cleanAddress, componentRestrictions: { country: 'PT' } }, (results, status) => {
                    if (status === "OK" && results[0]) {
                        const matchedPlace = results[0];
                        let postalCode = "";

                        // Procura o código postal de 7 dígitos nos componentes
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

                                alert(`Morada detetada com sucesso:\n"${matchedPlace.formatted_address}"\n\nCódigo Postal: ${postalCode}`);

                                // Dispara a triagem automática
                                const btnAnalisar = document.getElementById('btn-analisar');
                                if (btnAnalisar) btnAnalisar.click();
                            } else {
                                alert(`Encontrámos a morada:\n"${matchedPlace.formatted_address}"\n\nMas o Código Postal está incompleto: ${postalCode}. Digite os dígitos em falta.`);
                            }
                        } else {
                            alert(`Encontrámos a morada:\n"${matchedPlace.formatted_address}"\n\nMas não conseguimos extrair o Código Postal de 7 dígitos. Digite manualmente.`);
                        }
                    } else {
                        // Fallback: Coloca o texto extraído no campo de busca para o utilizador ajustar
                        document.getElementById('busca-morada-triagem').value = cleanAddress;
                        alert("Não foi possível geolocalizar automaticamente. Colocámos o texto detetado no campo de pesquisa para poder ajustar.");
                    }
                });
            } else {
                // Fallback sem Google Maps Geocoder ativo
                document.getElementById('busca-morada-triagem').value = cleanAddress;
                alert("Texto extraído com sucesso! Ajuste-o na caixa de pesquisa.");
            }
        }).catch(err => {
            console.error("Erro no processamento OCR:", err);
            alert("Falha ao ler a imagem. Tente tirar a foto novamente com foco no texto.");
        }).finally(() => {
            // Repõe o estado original do botão
            btnCamera.innerHTML = '<i class="fa-solid fa-camera text-lg"></i>';
            btnCamera.disabled = false;
            inputCamera.value = ""; // Limpa o ficheiro para permitir novos cliques
        });
    });
}

// ==========================================
// FUNÇÕES GLOBAIS DE EDIÇÃO E CANCELAMENTO
// ==========================================
window.editDriver = (driver) => {
    window.driverSendoEditado = driver;

    const nomeInput = document.getElementById('nome-motorista');
    const btnSubmit = document.getElementById('btn-submit-motorista');
    const btnCancelar = document.getElementById('btn-cancelar-motorista');

    if (nomeInput) nomeInput.value = driver.name;
    if (btnSubmit) btnSubmit.textContent = "Guardar Alterações";
    if (btnCancelar) btnCancelar.classList.remove('hidden');

    // Sincroniza a cor do motorista na palete visual
    window.selectedColor = driver.color;
    const colorPickerContainer = document.getElementById('color-picker-container');
    if (colorPickerContainer) {
        Array.from(colorPickerContainer.children).forEach(btn => {
            if (btn.style.backgroundColor === driver.color || btn.style.backgroundColor.replace(/\s/g, "") === driver.color.toLowerCase()) {
                btn.classList.add('border-black', 'scale-110');
            } else {
                btn.classList.remove('border-black', 'scale-110');
            }
        });
    }

    // Recarrega as checkboxes de setores, libertando a(s) vaga(s) do seu próprio motorista
    // e pré-marcando os setores que já lhe pertencem
    renderizarSetoresUI();
};

window.cancelarEdicaoDriver = () => {
    window.driverSendoEditado = null;

    const nomeInput = document.getElementById('nome-motorista');
    const btnSubmit = document.getElementById('btn-submit-motorista');
    const btnCancelar = document.getElementById('btn-cancelar-motorista');

    if (nomeInput) nomeInput.value = "";
    if (btnSubmit) btnSubmit.textContent = "Adicionar Motorista";
    if (btnCancelar) btnCancelar.classList.add('hidden');

    renderizarSetoresUI();
};

window.editSector = (sector) => {
    window.sectorSendoEditado = sector;

    const nomeInput = document.getElementById('setor-nome');
    const btnSubmit = document.getElementById('btn-submit-setor');
    const btnCancelar = document.getElementById('btn-cancelar-setor');

    if (nomeInput) nomeInput.value = sector.name;
    if (btnSubmit) btnSubmit.textContent = "Guardar Alterações";
    if (btnCancelar) btnCancelar.classList.remove('hidden');

    // Recarrega as checkboxes libertando as áreas deste setor para edição
    renderizarSetoresUI();
};

window.cancelarEdicaoSector = () => {
    window.sectorSendoEditado = null;

    const nomeInput = document.getElementById('setor-nome');
    const btnSubmit = document.getElementById('btn-submit-setor');
    const btnCancelar = document.getElementById('btn-cancelar-setor');

    if (nomeInput) nomeInput.value = "";
    if (btnSubmit) btnSubmit.textContent = "Criar Setor";
    if (btnCancelar) btnCancelar.classList.add('hidden');

    renderizarSetoresUI();
};

// ==========================================
// INICIALIZAÇÃO DOS AUTOCOMPLETES DO GOOGLE
// ==========================================
function inicializarTodosAutocompletes() {
    // Autocomplete para o planeador de rotas (Aba Rotas)
    const buscaMoradaInput = document.getElementById('busca-morada');
    if (buscaMoradaInput) {
        inicializarGoogleAutocomplete(buscaMoradaInput, adicionarMorada);
    }

    // Autocomplete específico para encontrar o código postal (Aba Triagem)
    const buscaMoradaTriagemInput = document.getElementById('busca-morada-triagem');
    if (buscaMoradaTriagemInput) {
        inicializarGoogleAutocompleteTriagem(buscaMoradaTriagemInput, (postalCode, formattedAddress) => {
            if (postalCode) {
                // Limpa traços do código postal e guarda-o sem caracteres especiais
                const cleanCode = postalCode.replace(/\D/g, '');
                
                // Se tivermos os 7 dígitos completos do Código Postal
                if (cleanCode.length === 7) {
                    window.currentInput = cleanCode;
                    
                    const visorCodigo = document.getElementById('visor-codigo');
                    if (visorCodigo) {
                        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
                    }
                    
                    console.log(`Código Postal extraído com sucesso: ${postalCode}. A iniciar triagem automática...`);
                    
                    // DISPARO AUTOMÁTICO: clica no botão Analisar para poupar um toque ao operador!
                    const btnAnalisar = document.getElementById('btn-analisar');
                    if (btnAnalisar) {
                        btnAnalisar.click();
                    }
                } else if (cleanCode.length >= 4) {
                    // Se o código for parcial (apenas 4 dígitos), preenchemos no visor mas avisamos para completar
                    window.currentInput = cleanCode;
                    const visorCodigo = document.getElementById('visor-codigo');
                    if (visorCodigo) {
                        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
                    }
                    alert(`A morada selecionada contém apenas um código postal parcial (${postalCode}). Por favor, complete os 3 dígitos restantes usando o teclado.`);
                }
            } else {
                alert("O Google encontrou o endereço mas não extraiu um Código Postal de 7 dígitos específico. Por favor, introduza manualmente.");
            }
            
            // Limpa o input de pesquisa de triagem para a próxima leitura
            buscaMoradaTriagemInput.value = "";
        });
    }
}

// ==========================================
// CARREGAMENTO SEGURO DO SDK GOOGLE MAPS
// ==========================================
function carregarGoogleMapsScript() {
    // CORRIGIDO: Se a variável 'google' já existir em cache no telemóvel, 
    // não paramos a execução; inicializamos os autocompletes diretamente!
    if (typeof google !== 'undefined' && google.maps && google.maps.places) {
        console.log("Google Maps já carregado em cache. Inicializando inputs...");
        inicializarTodosAutocompletes();
        return;
    }

    if (typeof GOOGLE_MAPS_API_KEY === 'undefined' || !GOOGLE_MAPS_API_KEY) {
        console.error("Chave de API do Google Maps não foi definida no config.js.");
        return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
        console.log("Google Maps SDK carregado pela primeira vez.");
        inicializarTodosAutocompletes();
    };
    script.onerror = () => console.error("Falha ao carregar o SDK do Google Maps.");
    document.head.appendChild(script);
}

// ==========================================
// INICIALIZAÇÃO DA APLICAÇÃO
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    carregarGoogleMapsScript();
    setupNavigation(showTab);
    setupKeypad();
    setupPrefixLock();
    setupForms();
    renderColorPicker();
    setupResetLeituras();
    setupRotasLogic();
    setupModaisEdicao();
    setupTriagemLogic();
    setupCancelButtons(); // Ativa os ouvintes dos botões "Cancelar" das edições
    setupVozLogic(); // Ativa o reconhecimento por voz
    setupCameraOcrLogic(); // NOVO: Ativa o leitor inteligente de câmara
    
    const visorCodigo = document.getElementById('visor-codigo');
    if (visorCodigo) {
        updateVisor(window.isPrefixLocked, window.lockedPrefixValue, window.currentInput, visorCodigo);
    }
    
    // Renderizações Iniciais Seguras
    const listaMotoristas = document.getElementById('lista-motoristas');
    if (listaMotoristas) {
        renderDrivers(window.drivers, window.sectors, listaMotoristas, window.deleteDriver, window.editDriver);
    }
    
    renderizarSetoresUI();
    atualizarSummaryUI();
    sincronizarInterfaceRota();

    // RESTAURAÇÃO DE SEPARADOR ATIVO (Evita que o PWA volte para a triagem ao reabrir)
    const activeTab = localStorage.getItem('cp_active_tab') || 'triagem';
    showTab(activeTab);

    // AJUSTE DE TOQUE PARA TELEMÓVEIS (Evita bloqueio de seleção no Autocomplete do Google)
    document.addEventListener('touchend', (e) => {
        const itemSugerido = e.target.closest('.pac-item');
        if (itemSugerido) {
            itemSugerido.click();
        }
    }, { passive: true });
});

// ==========================================
// CENTRALIZAÇÃO E ATUALIZAÇÃO DA INTERFACE DE SETORES
// ==========================================
function renderizarSetoresUI() {
    const listaSetores = document.getElementById('lista-setores');
    if (listaSetores) {
        renderSectors(window.sectors, listaSetores, window.deleteSector, window.editSector);
    }

    const checkboxesAreas = document.getElementById('checkboxes-areas');
    if (checkboxesAreas) {
        const editingId = window.sectorSendoEditado ? window.sectorSendoEditado.id : null;
        renderAreaCheckboxes(window.sectors, checkboxesAreas, editingId);
    }

    const checkboxesSetoresMotorista = document.getElementById('checkboxes-setores-motorista');
    if (checkboxesSetoresMotorista) {
        const editingDriverId = window.driverSendoEditado ? window.driverSendoEditado.id : null;
        renderSectorCheckboxes(window.sectors, checkboxesSetoresMotorista, window.drivers, editingDriverId);
    }
}

function atualizarSummaryUI() {
    renderSummary(window.assignments, window.drivers, document.getElementById('painel-resumo'));
}

// ==========================================
// LÓGICA DE RECONHECIMENTO DE VOZ (MICROFONE)
// ==========================================
function setupVozLogic() {
    const btnVoz = document.getElementById('btn-voz');
    const buscaMoradaInput = document.getElementById('busca-morada');
    const micAtivo = document.getElementById('microfone-ativo');
    const micInativo = document.getElementById('microfone-inativo');

    if (!btnVoz || !buscaMoradaInput) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        btnVoz.classList.add('hidden'); // Oculta o microfone se o browser não suportar
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-PT'; // Configurado para Português de Portugal
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    btnVoz.addEventListener('click', () => {
        try {
            recognition.start();
        } catch (err) {
            console.warn("Reconhecimento de voz já em execução:", err);
        }
    });

    recognition.onstart = () => {
        if (micAtivo) micAtivo.classList.remove('hidden');
        if (micInativo) micInativo.classList.add('hidden');
        btnVoz.classList.remove('bg-blue-50', 'text-blue-700');
        btnVoz.classList.add('bg-red-500', 'text-white');
    };

    recognition.onend = () => {
        if (micAtivo) micAtivo.classList.add('hidden');
        if (micInativo) micInativo.classList.remove('hidden');
        btnVoz.classList.remove('bg-blue-50', 'text-blue-700');
        btnVoz.classList.add('bg-red-500', 'text-white');
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        buscaMoradaInput.value = transcript;
        
        // Simula a digitação para abrir o menu do Google Autocomplete automaticamente
        buscaMoradaInput.dispatchEvent(new Event('input', { bubbles: true }));
        buscaMoradaInput.focus();
    };

    recognition.onerror = (event) => {
        console.error("Erro no reconhecimento de voz:", event.error);
    };
}

// ==========================================
// CONFIGURAÇÃO DOS BOTÕES "CANCELAR" (EDIÇÕES)
// ==========================================
function setupCancelButtons() {
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
// LÓGICA DE TRIAGEM
// ==========================================
function setupTriagemLogic() {
    const btnAnalisar = document.getElementById('btn-analisar');
    const btnConfirmarAtribuir = document.getElementById('btn-confirmar-atribuir');
    const btnCancelarAtribuir = document.getElementById('btn-cancelar-atribuir');
    const modalResultado = document.getElementById('modal-resultado');

    // Fecha o modal de resultado sem gravar a atribuição, mantendo o código
    // já digitado no visor para que o utilizador possa corrigi-lo se necessário.
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
            atualizarSummaryUI();

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
// LÓGICA DAS ROTAS DO TURNO
// ==========================================
function setupRotasLogic() {
    const btnIniciarRota = document.getElementById('btn-iniciar-rota');
    const dataRotaInput = document.getElementById('data-rota');
    const btnEncerrarRota = document.getElementById('btn-encerrar-rota');
    const btnGpsPartida = document.getElementById('btn-gps-partida');
    const btnBuscarPartida = document.getElementById('btn-buscar-partida');
    const btnLimparEnderecos = document.getElementById('btn-limpar-enderecos');
    const btnOtimizarRota = document.getElementById('btn-otimizar-rota');
    const statusPartida = document.getElementById('status-partida');
    const buscaMoradaInput = document.getElementById('busca-morada');

    // Seletores de modo de ecrã
    const btnPlaneamento = document.getElementById('btn-modo-planeamento');
    const btnConducao = document.getElementById('btn-modo-conducao');

    if (btnPlaneamento && btnConducao) {
        btnPlaneamento.addEventListener('click', () => alternarModoRota('planeamento'));
        btnConducao.addEventListener('click', () => alternarModoRota('conducao'));
    }

    if (btnIniciarRota && dataRotaInput) {
        btnIniciarRota.addEventListener('click', () => {
            const dataSelecionada = dataRotaInput.value;
            if (!dataSelecionada) {
                alert("Por favor, selecione uma data para continuar.");
                return;
            }
            const d = new Date(dataSelecionada);
            const dataFormatada = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
            window.dataRotaSelecionada = dataFormatada;
            window.rotaIniciada = true;
            sincronizarPersistencia();
            sincronizarInterfaceRota();
        });
    }

    if (btnEncerrarRota) {
        btnEncerrarRota.addEventListener('click', () => {
            if (confirm("Tem a certeza de que deseja encerrar a rota atual? Isto limpará o itinerário planeado.")) {
                window.partidaLocalizacao = null;
                window.moradasEntregas = [];
                window.rotaOtimizada = [];
                window.dataRotaSelecionada = "";
                window.rotaIniciada = false;
                localStorage.removeItem('cp_last_navigated_id'); // Limpa registo da última paragem
                limparMapaVisual();
                sincronizarPersistencia();
                sincronizarInterfaceRota();
            }
        });
    }

    if (btnGpsPartida && statusPartida) {
        btnGpsPartida.addEventListener('click', () => {
            statusPartida.textContent = "A obter geolocalização do GPS...";
            if (!navigator.geolocation) {
                alert("O seu telemóvel não suporta Geolocalização.");
                statusPartida.textContent = "Partida: Erro no GPS";
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    obterEnderecoPorGPSGoogle(lat, lng, (moradaGps) => {
                        if (moradaGps) {
                            window.partidaLocalizacao = moradaGps;
                            statusPartida.innerHTML = `<strong>Partida:</strong> ${moradaGps.address}`;
                        } else {
                            window.partidaLocalizacao = { lat, lng, address: `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})` };
                            statusPartida.innerHTML = `<strong>Partida:</strong> GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
                        }
                        sincronizarPersistencia();
                    });
                },
                () => {
                    alert("Não foi possível aceder ao GPS. Verifique as permissões.");
                    statusPartida.textContent = "Partida: Permissão negada";
                },
                { enableHighAccuracy: true }
            );
        });
    }

    if (btnBuscarPartida && buscaMoradaInput) {
        btnBuscarPartida.addEventListener('click', () => {
            window.definindoPartidaPorMorada = true;
            buscaMoradaInput.placeholder = "Procure a morada de PARTIDA...";
            buscaMoradaInput.focus();
        });
    }

    if (btnLimparEnderecos) {
        btnLimparEnderecos.addEventListener('click', () => {
            window.moradasEntregas = [];
            window.rotaOtimizada = [];
            localStorage.removeItem('cp_last_navigated_id');
            document.getElementById('container-mapa').classList.add('hidden');
            document.getElementById('container-rota-ordenada').classList.add('hidden');
            document.getElementById('estatisticas-rota').classList.add('hidden');
            limparMapaVisual();
            renderMoradasAdicionadas();
            sincronizarPersistencia();
        });
    }

    if (btnOtimizarRota) {
        btnOtimizarRota.addEventListener('click', () => {
            if (!window.partidaLocalizacao) return alert("Por favor, defina um ponto de Partida primeiro.");
            if (window.moradasEntregas.length === 0) return alert("Adicione pelo menos uma morada de entrega.");
            otimizarItinerarioComVizinhoMaisProximo();
        });
    }
}

function sincronizarInterfaceRota() {
    const containerSetupRota = document.getElementById('container-setup-rota');
    const containerPlaneadorRota = document.getElementById('container-planeador-rota');
    const displayDataRota = document.getElementById('display-data-rota');
    const statusPartida = document.getElementById('status-partida');
    const dataRotaInput = document.getElementById('data-rota');

    if (!containerSetupRota || !containerPlaneadorRota) return;

    if (window.rotaIniciada) {
        containerSetupRota.classList.add('hidden');
        containerPlaneadorRota.classList.remove('hidden');
        if (displayDataRota) displayDataRota.textContent = window.dataRotaSelecionada;

        if (statusPartida) {
            if (window.partidaLocalizacao) {
                statusPartida.innerHTML = `<strong>Partida:</strong> ${window.partidaLocalizacao.address}`;
            } else {
                statusPartida.textContent = "Partida: Localização não definida";
            }
        }

        renderMoradasAdicionadas();

        // Recupera o modo ativo de visualização (Planeamento vs Condução)
        const modoSalvo = localStorage.getItem('cp_modo_rota') || 'planeamento';
        alternarModoRota(modoSalvo);

        if (window.rotaOtimizada.length > 0) {
            const containerMapa = document.getElementById('container-mapa');
            const containerRotaOrdenada = document.getElementById('container-rota-ordenada');
            if (containerMapa) containerMapa.classList.remove('hidden');
            if (containerRotaOrdenada) containerRotaOrdenada.classList.remove('hidden');
            
            renderizarItinerarioOtimizado();
            
            setTimeout(() => {
                desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
            }, 300);
        } else {
            const containerMapa = document.getElementById('container-mapa');
            const containerRotaOrdenada = document.getElementById('container-rota-ordenada');
            const estatisticasRota = document.getElementById('estatisticas-rota');
            if (containerMapa) containerMapa.classList.add('hidden');
            if (containerRotaOrdenada) containerRotaOrdenada.classList.add('hidden');
            if (estatisticasRota) estatisticasRota.classList.add('hidden');
        }

    } else {
        containerSetupRota.classList.remove('hidden');
        containerPlaneadorRota.classList.add('hidden');
        if (dataRotaInput) {
            const hoje = new Date();
            dataRotaInput.value = hoje.toISOString().split('T')[0];
        }
    }
}

function adicionarMorada(morada) {
    const buscaMoradaInput = document.getElementById('busca-morada');
    const statusPartida = document.getElementById('status-partida');

    if (window.definindoPartidaPorMorada) {
        window.partidaLocalizacao = morada;
        if (statusPartida) statusPartida.innerHTML = `<strong>Partida:</strong> ${morada.address}`;
        window.definindoPartidaPorMorada = false;
        if (buscaMoradaInput) buscaMoradaInput.placeholder = "Comece a digitar a morada aqui...";
        sincronizarPersistencia();
    } else {
        morada.status = "Pendente"; 
        morada.observation = ""; 
        window.moradasEntregas.push(morada);
        renderMoradasAdicionadas();
        sincronizarPersistencia();
        abrirModalEdicaoParagem(morada, false);
    }
    if (buscaMoradaInput) buscaMoradaInput.value = "";
}

function renderMoradasAdicionadas() {
    const listaMoradasAdicionadas = document.getElementById('lista-moradas-adicionadas');
    if (!listaMoradasAdicionadas) return;

    listaMoradasAdicionadas.innerHTML = "";
    if (window.moradasEntregas.length === 0) {
        listaMoradasAdicionadas.innerHTML = `<p class="text-xs text-gray-400 italic text-center py-2">Nenhuma morada adicionada.</p>`;
        return;
    }
    window.moradasEntregas.forEach((morada, index) => {
        const item = document.createElement('div');
        item.className = "flex items-center justify-between p-2 bg-gray-50 rounded border text-xs animate-fade-in space-x-2";
        item.innerHTML = `
            <div class="flex-1 truncate">
                <strong class="text-gray-500">#${index + 1}</strong> <span>${morada.address}</span>
                ${morada.observation ? `<p class="text-[10px] text-blue-500 font-semibold italic mt-0.5 truncate">Nota: ${morada.observation}</p>` : ''}
            </div>
            <div class="flex items-center space-x-1.5 flex-shrink-0">
                <button class="btn-edit-morada text-blue-500 font-bold p-1 hover:bg-blue-50 rounded"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-del-morada text-red-500 font-bold p-1 hover:bg-red-50 rounded">X</button>
            </div>
        `;
        
        item.querySelector('.btn-edit-morada').onclick = () => abrirModalEdicaoParagem(morada, false);
        
        item.querySelector('.btn-del-morada').onclick = () => {
            window.moradasEntregas = window.moradasEntregas.filter(m => m.id !== morada.id);
            window.rotaOtimizada = window.rotaOtimizada.filter(m => m.id !== morada.id); // Sincroniza a remoção na rota ativa
            
            renderMoradasAdicionadas();
            
            if (window.rotaOtimizada.length > 0) {
                renderizarItinerarioOtimizado();
                desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
            } else {
                const containerMapa = document.getElementById('container-mapa');
                const containerRotaOrdenada = document.getElementById('container-rota-ordenada');
                const estatisticasRota = document.getElementById('estatisticas-rota');
                if (containerMapa) containerMapa.classList.add('hidden');
                if (containerRotaOrdenada) containerRotaOrdenada.classList.add('hidden');
                if (estatisticasRota) estatisticasRota.classList.add('hidden');
                limparMapaVisual();
            }
            
            sincronizarPersistencia();
        };

        listaMoradasAdicionadas.appendChild(item);
    });
}

function otimizarItinerarioComVizinhoMaisProximo() {
    let atual = { lat: window.partidaLocalizacao.lat, lng: window.partidaLocalizacao.lng };
    let restantes = [...window.moradasEntregas];
    window.rotaOtimizada = [];

    while (restantes.length > 0) {
        let indiceMaisProximo = -1;
        let menorDistancia = Infinity;

        for (let i = 0; i < restantes.length; i++) {
            const dist = calcularDistanciaHaversine(atual.lat, atual.lng, restantes[i].lat, restantes[i].lng);
            if (dist < menorDistancia) {
                menorDistancia = dist;
                indiceMaisProximo = i;
            }
        }

        if (indiceMaisProximo !== -1) {
            const paragem = restantes[indiceMaisProximo];
            paragem.distanciaDoAnterior = menorDistancia;
            window.rotaOtimizada.push(paragem);
            atual = { lat: paragem.lat, lng: paragem.lng };
            restantes.splice(indiceMaisProximo, 1);
        }
    }

    const containerMapa = document.getElementById('container-mapa');
    const containerRotaOrdenada = document.getElementById('container-rota-ordenada');
    if (containerMapa) containerMapa.classList.remove('hidden');
    if (containerRotaOrdenada) containerRotaOrdenada.classList.remove('hidden');

    renderizarItinerarioOtimizado();
    sincronizarPersistencia();
    
    setTimeout(() => {
        desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
    }, 300);

    // MUDANÇA AUTOMÁTICA DE MODO: Otimizou? Entra logo em Modo Condução (ecrã focado)
    alternarModoRota('conducao');
}

function renderizarItinerarioOtimizado() {
    const listaRotaFinal = document.getElementById('lista-rota-final');
    if (!listaRotaFinal) return;

    listaRotaFinal.innerHTML = "";
    
    // Recupera a última paragem onde o motorista clicou em "Navegar"
    const lastNavigatedId = localStorage.getItem('cp_last_navigated_id');

    window.rotaOtimizada.forEach((paragem, index) => {
        const item = document.createElement('div');
        item.id = `paragem-${paragem.id}`; // Define ID para podermos focar por scroll
        
        let statusColor = "bg-blue-600";
        if (paragem.status === "Entregue") statusColor = "bg-green-500";
        if (paragem.status === "Falhou") statusColor = "bg-red-500";

        const isLastNavigated = paragem.id === lastNavigatedId;

        // Visual estético diferenciado e destacado para o item ativo que está em navegação
        if (isLastNavigated) {
            item.className = "p-3 rounded-xl flex flex-col space-y-2 animate-fade-in border-2 border-blue-500 bg-blue-50/70 shadow-md ring-4 ring-blue-100";
        } else {
            item.className = "bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex flex-col space-y-2 animate-fade-in";
        }

        const linkGoogleMaps = `https://www.google.com/maps/dir/?api=1&destination=${paragem.lat},${paragem.lng}&travelmode=driving`;
        const primeiraLinhaObs = paragem.observation ? paragem.observation.split('\n')[0] : "";

        item.innerHTML = `
            <div class="flex items-center justify-between space-x-2">
                <div class="flex-1 truncate">
                    <div class="flex items-center space-x-2">
                        <span class="w-5 h-5 rounded-full ${statusColor} text-white font-bold text-[10px] flex items-center justify-center flex-shrink-0 transition-colors">
                            ${index + 1}
                        </span>
                        <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                            A cerca de ${paragem.distanciaDoAnterior.toFixed(2)} km
                        </span>
                        ${isLastNavigated ? `<span class="bg-blue-600 text-white text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide animate-pulse">A navegar</span>` : ''}
                    </div>
                    <p class="text-xs font-semibold text-gray-700 mt-1 truncate" title="${paragem.address}">
                        ${paragem.address}
                    </p>
                    ${primeiraLinhaObs ? `<div class="bg-yellow-50 border border-yellow-100 p-2 rounded mt-1 text-[11px] text-gray-600 font-medium italic truncate"><i class="fa-solid fa-comment-dots text-yellow-500 mr-1"></i> ${primeiraLinhaObs}</div>` : ''}
                </div>
                <div class="flex flex-col space-y-1">
                    <button class="btn-navegar bg-green-600 hover:bg-green-700 text-white font-bold px-3 py-2 rounded-lg text-xs flex items-center justify-center space-x-1 whitespace-nowrap shadow-sm">
                        <i class="fa-solid fa-location-arrow"></i> <span>Navegar</span>
                    </button>
                    <button class="btn-edit-otimizada bg-gray-50 border hover:bg-gray-100 text-gray-700 font-bold px-3 py-1.5 rounded-lg text-[10px] text-center">
                        Editar Info
                    </button>
                </div>
            </div>
            
            <div class="flex space-x-1.5 pt-1.5 border-t border-dashed">
                <button class="btn-status bg-gray-50 text-gray-600 hover:bg-gray-100 text-[10px] font-bold py-1.5 rounded flex-1 border ${!paragem.status || paragem.status === 'Pendente' ? 'ring-2 ring-gray-400' : ''}" data-status="Pendente">
                    Pendente
                </button>
                <button class="btn-status bg-green-50 text-green-700 hover:bg-green-100 text-[10px] font-bold py-1.5 rounded flex-1 border border-green-200 ${paragem.status === 'Entregue' ? 'ring-2 ring-green-500' : ''}" data-status="Entregue">
                    ✓ Entregue
                </button>
                <button class="btn-status bg-red-50 text-red-700 hover:bg-red-100 text-[10px] font-bold py-1.5 rounded flex-1 border border-red-200 ${paragem.status === 'Failed' || paragem.status === 'Falhou' ? 'ring-2 ring-red-500' : ''}" data-status="Falhou">
                    ✗ Falhou
                </button>
            </div>
        `;

        item.querySelector('.btn-edit-otimizada').onclick = () => abrirModalEdicaoParagem(paragem, true);

        // AÇÃO DO BOTÃO NAVEGAR: Regista a ação antes de lançar o Maps
        item.querySelector('.btn-navegar').onclick = () => {
            localStorage.setItem('cp_last_navigated_id', paragem.id);
            renderizarItinerarioOtimizado(); // Força o destaque instantâneo na UI
            window.open(linkGoogleMaps, '_blank');
        };

        item.querySelectorAll('.btn-status').forEach(btn => {
            btn.onclick = () => {
                const novoStatus = btn.getAttribute('data-status');
                paragem.status = novoStatus;
                
                const idx = window.moradasEntregas.findIndex(m => m.id === paragem.id);
                if (idx !== -1) {
                    window.moradasEntregas[idx].status = novoStatus;
                }
                
                sincronizarPersistencia();
                renderizarItinerarioOtimizado();
                desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
            };
        });

        listaRotaFinal.appendChild(item);
    });

    renderEstatisticasRota();

    // CENTRAÇÃO AUTOMÁTICA: Faz o scroll suave do telemóvel para a paragem atual
    if (lastNavigatedId) {
        setTimeout(() => {
            const elementoAlvo = document.getElementById(`paragem-${lastNavigatedId}`);
            if (elementoAlvo) {
                elementoAlvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 150);
    }
}

// ==========================================
// PAINEL DE ESTATÍSTICAS DO TURNO (À PROVA DE FALHAS)
// ==========================================
function renderEstatisticasRota() {
    const htmlEl = document.getElementById('estatisticas-rota');
    const statTotal = document.getElementById('stat-total');
    const statEntregues = document.getElementById('stat-entregues');
    const statFalhas = document.getElementById('stat-falhas'); 
    const statPendentes = document.getElementById('stat-pendentes');

    if (!htmlEl) return;

    htmlEl.classList.remove('hidden');

    const total = window.rotaOtimizada.length;
    const entregues = window.rotaOtimizada.filter(p => p.status === "Entregue").length;
    const falhadas = window.rotaOtimizada.filter(p => p.status === "Failed" || p.status === "Falhou").length;
    const pendentes = window.rotaOtimizada.filter(p => !p.status || p.status === "Pendente").length;

    if (statTotal) statTotal.textContent = total;
    if (statEntregues) statEntregues.textContent = entregues;
    if (statFalhas) statFalhas.textContent = falhadas;
    if (statPendentes) statPendentes.textContent = pendentes;
}

// ==========================================
// MODAL DE EDIÇÃO DE MORADA / OBSERVAÇÃO
// ==========================================
function setupModaisEdicao() {
    const btnCancelarEdicao = document.getElementById('btn-cancelar-edicao');
    const btnSalvarEdicao = document.getElementById('btn-salvar-edicao');

    if (!btnCancelarEdicao || !btnSalvarEdicao) return;

    btnCancelarEdicao.addEventListener('click', () => {
        const modalEditarParagem = document.getElementById('modal-editar-paragem');
        if (modalEditarParagem) modalEditarParagem.classList.add('hidden');
        itemSendoEditado = null;
    });

    btnSalvarEdicao.addEventListener('click', () => {
        if (!itemSendoEditado) return;

        const editMoradaTexto = document.getElementById('edit-morada-texto');
        const editMoradaObs = document.getElementById('edit-morada-obs');
        if (!editMoradaTexto || !editMoradaObs) return;

        const novaMorada = editMoradaTexto.value.trim();
        const novaObs = editMoradaObs.value.trim();

        if (!novaMorada) {
            alert("A morada de entrega não pode ficar em branco.");
            return;
        }

        let itemIndexPre = window.moradasEntregas.findIndex(m => m.id === itemSendoEditado.id);
        let itemIndexPos = window.rotaOtimizada.findIndex(m => m.id === itemSendoEditado.id);

        if (itemIndexPre !== -1) {
            window.moradasEntregas[itemIndexPre].address = novaMorada;
            window.moradasEntregas[itemIndexPre].observation = novaObs;
        }

        if (itemIndexPos !== -1) {
            window.rotaOtimizada[itemIndexPos].address = novaMorada;
            window.rotaOtimizada[itemIndexPos].observation = novaObs;
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
    });
}

function abrirModalEdicaoParagem(paragem, estaNaRotaOtimizada) {
    const modalEditarParagem = document.getElementById('modal-editar-paragem');
    const editMoradaTexto = document.getElementById('edit-morada-texto');
    const editMoradaObs = document.getElementById('edit-morada-obs');

    if (!modalEditarParagem || !editMoradaTexto || !editMoradaObs) return;

    itemSendoEditado = paragem;
    editMoradaTexto.value = paragem.address;
    editMoradaObs.value = paragem.observation || "";
    modalEditarParagem.classList.remove('hidden');

    setTimeout(() => {
        editMoradaObs.focus();
        editMoradaObs.select();
    }, 150);
}

function sincronizarPersistencia() {
    saveData(
        window.drivers, 
        [], // cp_intervals obsoletos
        window.assignments,
        window.partidaLocalizacao,
        window.moradasEntregas,
        window.rotaOtimizada,
        window.dataRotaSelecionada, 
        window.rotaIniciada,
        window.sectors // os setores são salvos na posição original de zonas
    );
}

window.ajustarLimitesMapaGoogle = () => {
    if (window.rotaOtimizada && window.rotaOtimizada.length > 0) {
        ajustarLimitesMapaGoogleInterno();
    }
};

function ajustarLimitesMapaGoogleInterno() {
    if (typeof google === 'undefined' || !window.googleMapInstance || !window.partidaLocalizacao) return;
    const limits = new google.maps.LatLngBounds();
    limits.extend(new google.maps.LatLng(window.partidaLocalizacao.lat, window.partidaLocalizacao.lng));
    window.rotaOtimizada.forEach(p => limits.extend(new google.maps.LatLng(p.lat, p.lng)));
    window.googleMapInstance.fitBounds(limits);
}

// ==========================================
// GESTÃO DE FORMULÁRIOS E DADOS
// ==========================================
function setupForms() {
    const formMotorista = document.getElementById('form-motorista');
    const formSetor = document.getElementById('form-setor');

    const listaMotoristas = document.getElementById('lista-motoristas');

    if (formMotorista && listaMotoristas) {
        formMotorista.addEventListener('submit', (e) => {
            handleDriverSubmit(e, window.drivers, window.selectedColor, () => {
                renderDrivers(window.drivers, window.sectors, listaMotoristas, window.deleteDriver, window.editDriver);
                atualizarSummaryUI();
                renderizarSetoresUI(); // Atualiza os setores livres nas checkboxes do motorista
            });
        });
    }

    if (formSetor) {
        formSetor.addEventListener('submit', (e) => {
            handleSectorSubmit(e, window.sectors, () => {
                renderizarSetoresUI();
                if (listaMotoristas) {
                    renderDrivers(window.drivers, window.sectors, listaMotoristas, window.deleteDriver, window.editDriver);
                }
            });
        });
    }
}

function renderColorPicker() {
    const colorPickerContainer = document.getElementById('color-picker-container');
    if (!colorPickerContainer) return;

    colorPickerContainer.innerHTML = "";
    colorPalette.forEach((color, idx) => {
        const btn = document.createElement('button');
        btn.type = "button";
        btn.style.backgroundColor = color;
        btn.className = `h-10 w-full rounded-lg border-2 transition-all duration-150 ${idx === 0 ? 'border-black scale-110' : 'border-transparent'}`;
        btn.addEventListener('click', () => {
            window.selectedColor = color;
            Array.from(colorPickerContainer.children).forEach(child => {
                child.classList.remove('border-black', 'scale-110');
                child.classList.add('border-transparent');
            });
            btn.classList.add('border-black', 'scale-110');
        });
        colorPickerContainer.appendChild(btn);
    });
}

function setupResetLeituras() {
    const btnLimparLeituras = document.getElementById('btn-limpar-leituras');
    if (btnLimparLeituras) {
        btnLimparLeituras.addEventListener('click', () => {
            if (confirm("Deseja realmente limpar todas as leituras?")) {
                window.assignments = [];
                sincronizarPersistencia();
                atualizarSummaryUI();
            }
        });
    }
}

// Métodos Globais de Exclusão Adaptados
window.deleteDriver = (id) => {
    if (confirm("Ao apagar este motorista, as suas contagens de pacotes também serão removidas. Confirmar?")) {
        window.drivers = window.drivers.filter(d => d.id !== id);
        window.assignments = window.assignments.filter(a => a.driverId !== id); 
        sincronizarPersistencia();
        
        const listaMotoristas = document.getElementById('lista-motoristas');
        if (listaMotoristas) {
            renderDrivers(window.drivers, window.sectors, listaMotoristas, window.deleteDriver, window.editDriver);
        }
        
        renderizarSetoresUI(); // Devolve o setor dele à lista de setores disponíveis
        atualizarSummaryUI();
    }
};

window.deleteSector = (id) => {
    if (confirm("Deseja apagar este Setor? As localidades associadas ficarão novamente livres e os motoristas associados a ele perderão essa atribuição.")) {
        window.sectors = window.sectors.filter(s => s.id !== id);
        
        // Remove o setor apagado da lista de setores de cada motorista afetado
        window.drivers.forEach(drv => {
            if (Array.isArray(drv.sectorIds)) {
                drv.sectorIds = drv.sectorIds.filter(sid => sid !== id);
            }
        });

        sincronizarPersistencia();
        renderizarSetoresUI();
        
        const listaMotoristas = document.getElementById('lista-motoristas');
        if (listaMotoristas) {
            renderDrivers(window.drivers, window.sectors, listaMotoristas, window.deleteDriver, window.editDriver);
        }
    }
};

function sanitizeDigits(str) { return str.replace(/\D/g, ''); }