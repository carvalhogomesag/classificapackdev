/**
 * js/rotas.js
 * Versão v71.1 - Com Componentes de Geografia, Odómetro, Modais, Inputs e UI Isolados
 * Faz: Gestão principal da aba de rotas, integrando os componentes 'rotas-geografia.js',
 *      'rotas-odometro.js', 'rotas-modais.js', 'rotas-inputs.js' e 'rotas-ui.js'.
 * Alteração v71.1: Abertura automática do modal de observações/detalhes ao adicionar morada.
 */

import { saveData } from './storage.js';
import { criarReconhecimentoVoz } from './voz.js';
import { GEOGRAPHY, obterEnderecoHigienizado } from './geografia-data.js';
import { 
    obterEnderecoPorGPSGoogle, 
    calcularDistanciaHaversine, 
    desenharMapaGoogle, 
    limparMapaVisual 
} from './maps.js';

// Importa o módulo de navegação (Google Maps vs Waze)
import { abrirNavegacao } from './navigation.js';

// Importa a instância ativa do Firestore
import { db } from './firebase-init.js';

// COMPONENTE 1: Importa utilitários de resolução geográfica isolados
import { isCatchAllLocality, obterConcelhoPorCodigoPostal, resolveBrickForZip } from './rotas-geografia.js';

// COMPONENTE 2: Importa modais de odómetro isolados
import { abrirModalOdometroSaida, abrirModalOdometroChegada } from './rotas-odometro.js';

// COMPONENTE 3: Importa modais de edição e alteração de sequência isolados
import { 
    setupModaisEdicao, 
    abrirModalEdicaoParagem, 
    abrirModalAlterarSequencia, 
    confirmarPosicaoParagem 
} from './rotas-modais.js';
export { setupModaisEdicao, abrirModalEdicaoParagem, abrirModalAlterarSequencia, confirmarPosicaoParagem };

// COMPONENTE 4: Importa formatação de inputs e autocomplete isolados
import { 
    aplicarPrefixoNoCampo, 
    configurarEventosPrefixoRapido, 
    configurarFormatacaoCodigoPostal, 
    configurarEscutaCodigoPostalParaLimites, 
    inicializarAutocompleteMorada 
} from './rotas-inputs.js';

// COMPONENTE 5: Importa renderizadores visuais e estatísticas isolados
import { 
    renderMoradasAdicionadas, 
    renderizarItinerarioOtimizado, 
    renderEstatisticasRota 
} from './rotas-ui.js';
export { renderMoradasAdicionadas, renderizarItinerarioOtimizado, renderEstatisticasRota };

// =========================================================================
// DETETOR INTELIGENTE DE AMBIENTE (LOCAL VS PRODUÇÃO)
// =========================================================================
const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://classificapack-backend.onrender.com';

// ==========================================
// PERSISTÊNCIA DAS ROTAS (LOCALSTORAGE + FIRESTORE)
// ==========================================
export function sincronizarPersistencia() {
    saveData(
        window.drivers, 
        [], 
        window.assignments,
        window.partidaLocalizacao,
        window.moradasEntregas,
        window.rotaOtimizada,
        window.dataRotaSelecionada, 
        window.rotaIniciada
    );

    localStorage.setItem('cp_is_route_optimized', JSON.stringify(window.isRouteOptimized || false));
    localStorage.setItem('cp_routing_method', window.routingMethodUsed || 'Cloud');
    localStorage.setItem('cp_trip_started', JSON.stringify(window.tripStarted));
    localStorage.setItem('cp_trip_completed', JSON.stringify(window.tripCompleted));
    localStorage.setItem('cp_odometer_start', JSON.stringify(window.odometerStart));
    localStorage.setItem('cp_odometer_start_hour', JSON.stringify(window.odometerStartHour));
    localStorage.setItem('cp_odometer_end', JSON.stringify(window.odometerEnd));
    localStorage.setItem('cp_odometer_end_hour', JSON.stringify(window.odometerEndHour));
    localStorage.setItem('cp_last_odometer', JSON.stringify(window.lastOdometer));

    if (window.currentUserUid) {
        db.collection('routes').doc(window.currentUserUid).set({
            partidaLocalizacao: window.partidaLocalizacao || null,
            moradasEntregas: window.moradasEntregas || [],
            rotaOtimizada: window.rotaOtimizada || [],
            dataRotaSelecionada: window.dataRotaSelecionada || "",
            rotaIniciada: window.rotaIniciada || false,
            isRouteOptimized: window.isRouteOptimized || false,
            routingMethodUsed: window.routingMethodUsed || 'Cloud',

            tripStarted: window.tripStarted || false,
            tripCompleted: window.tripCompleted || false,
            odometerStart: window.odometerStart || 0,
            odometerStartHour: window.odometerStartHour || "",
            odometerEnd: window.odometerEnd || 0,
            odometerEndHour: window.odometerEndHour || "",
            lastOdometer: window.lastOdometer || 0,

            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            console.log("[FIREBASE] Rota sincronizada no Firestore com sucesso.");
        }).catch((err) => {
            console.error("[FIREBASE] Erro ao sincronizar rota no Firestore:", err);
        });
    }
}

// ==========================================
// CENTRAL DE MODOS: PLANEAMENTO VS CONDUÇÃO
// ==========================================
export function alternarModoRota(modo) {
    const btnPlaneamento = document.getElementById('btn-modo-planeamento');
    const btnConducao = document.getElementById('btn-modo-conducao');
    const planningControls = document.getElementById('planning-controls');

    if (!btnPlaneamento || !btnConducao || !planningControls) return;

    if (modo === 'conducao') {
        planningControls.classList.add('hidden');
        btnConducao.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-white text-blue-600 shadow transition-all";
        btnPlaneamento.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 transition-all";
        localStorage.setItem('cp_modo_rota', 'conducao');
    } else {
        planningControls.classList.remove('hidden');
        btnPlaneamento.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-white text-blue-600 shadow transition-all";
        btnConducao.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 transition-all";
        localStorage.setItem('cp_modo_rota', 'planeamento');
    }
}

// ==========================================
// RECONHECIMENTO DE VOZ (ABA ROTAS)
// ==========================================
export function setupVozLogic() {
    const btnVoz = document.getElementById('btn-voz');
    const buscaMoradaInput = document.getElementById('rota-morada-completa');
    const micAtivo = document.getElementById('microfone-ativo');
    const micInativo = document.getElementById('microfone-inativo');

    if (!btnVoz || !buscaMoradaInput) return;

    criarReconhecimentoVoz({
        btnElement: btnVoz,
        micAtivoElement: micAtivo,
        micInativoElement: micInativo,
        activeClasses: ['bg-red-500', 'text-white'],
        inactiveClasses: ['bg-blue-50', 'text-blue-700'],
        onResult: (transcript) => {
            buscaMoradaInput.value = transcript;
            buscaMoradaInput.dispatchEvent(new Event('input', { bubbles: true }));
            buscaMoradaInput.focus();
        }
    });
}

function calcularRotaVizinhoMaisProximoLocal() {
    if (!window.partidaLocalizacao || window.moradasEntregas.length === 0) return;

    const unvisited = [...window.moradasEntregas];
    const optimized = [];
    let currentCoords = { lat: window.partidaLocalizacao.lat, lng: window.partidaLocalizacao.lng };

    while (unvisited.length > 0) {
        let nearestIndex = 0;
        let minDistance = Infinity;

        for (let i = 0; i < unvisited.length; i++) {
            const dist = calcularDistanciaHaversine(
                currentCoords.lat,
                currentCoords.lng,
                unvisited[i].lat,
                unvisited[i].lng
            );
            if (dist < minDistance) {
                minDistance = dist;
                nearestIndex = i;
            }
        }

        const nextStop = unvisited.splice(nearestIndex, 1)[0];
        nextStop.distanciaDoAnterior = minDistance;
        optimized.push(nextStop);
        currentCoords = { lat: nextStop.lat, lng: nextStop.lng };
    }

    window.rotaOtimizada = optimized;
}

// =========================================================================
// ADICIONAR NOVA AÇÃO (ENTREGA OU RECOLHA)
// =========================================================================
export async function processarAdicaoPorPostal() {
    const inputPostal = document.getElementById('rota-codigo-postal');
    const inputMorada = document.getElementById('rota-morada-completa');
    const btnAdicionar = document.getElementById('btn-adicionar-postal-rota');
    const statusPartida = document.getElementById('status-partida');

    if (!inputPostal || !btnAdicionar) return;

    const postalCodeVal = inputPostal.value.trim();
    const moradaVal = inputMorada ? inputMorada.value.trim() : "";

    const cleanZip = postalCodeVal.replace(/\D/g, '');
    if (cleanZip.length !== 7) {
        alert("Por favor, introduza um Código Postal válido com 7 dígitos (ex: 2655-319).");
        inputPostal.focus();
        return;
    }

    const formattedZip = `${cleanZip.substring(0, 4)}-${cleanZip.substring(4, 7)}`;

    btnAdicionar.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> <span>A geolocalizar...</span>';
    btnAdicionar.disabled = true;

    try {
        const response = await fetch(`${API_BASE_URL}/api/geocode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                postalCode: formattedZip,
                address: moradaVal
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Ocorreu uma falha ao geolocalizar.");
        }

        const { brickId, brickName } = resolveBrickForZip(formattedZip, window.drivers);
        const tipoOperacaoVal = document.getElementById('rota-tipo-operacao')?.value || "Entrega";

        // Apenas fica marcado como não-confirmado se a rota JÁ TIVER SIDO OTIMIZADA previamente
        const rotaJaOtimizada = window.isRouteOptimized === true;

        const novaMorada = {
            id: 'm_' + Date.now() + Math.random().toString(36).substr(2, 5),
            lat: data.lat,
            lng: data.lng,
            address: data.address,
            status: "Pendente",
            observation: "",
            priority: false,
            brickId: brickId,
            brickName: brickName,
            tipoOperacao: tipoOperacaoVal,
            isNewUnconfirmed: rotaJaOtimizada
        };

        if (window.definindoPartidaPorMorada) {
            novaMorada.isNewUnconfirmed = false;
            window.partidaLocalizacao = novaMorada;
            if (statusPartida) statusPartida.innerHTML = `<strong>Partida:</strong> ${novaMorada.address}`;
            window.definindoPartidaPorMorada = false;
            sincronizarPersistencia();
            alert("Ponto de Partida configurado com sucesso!");
        } else {
            // Adiciona sempre a morada à lista de planeamento (Moradas Mapeadas)
            window.moradasEntregas.push(novaMorada);
            const novoIndexPlaneamento = window.moradasEntregas.length - 1;

            if (rotaJaOtimizada) {
                // SE A ROTA JÁ FOI OTIMIZADA ANTERIORMENTE:
                let pontoAnterior = window.rotaOtimizada[window.rotaOtimizada.length - 1];

                novaMorada.distanciaDoAnterior = pontoAnterior ? calcularDistanciaHaversine(
                    pontoAnterior.lat,
                    pontoAnterior.lng,
                    novaMorada.lat,
                    novaMorada.lng
                ) : 0;

                window.rotaOtimizada.push(novaMorada);
                const novoIndexConducao = window.rotaOtimizada.length - 1;

                sincronizarPersistencia();
                renderMoradasAdicionadas();

                document.getElementById('container-mapa')?.classList.remove('hidden');
                document.getElementById('container-rota-ordenada')?.classList.remove('hidden');

                renderizarItinerarioOtimizado();
                
                setTimeout(() => {
                    if (window.googleMapInstance) {
                        google.maps.event.trigger(window.googleMapInstance, 'resize');
                    }
                    desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
                }, 200);

                alternarModoRota('conducao');

                // ABRIR AUTOMATICAMENTE O MODAL DE EDIÇÃO/OBSERVAÇÕES (Modo Condução)
                setTimeout(() => {
                    abrirModalEdicaoParagem(novoIndexConducao, 'conducao');
                }, 150);
            } else {
                // FASE INICIAL DE PLANEAMENTO (SEM OTIMIZAÇÃO AINDA):
                sincronizarPersistencia();
                renderMoradasAdicionadas();
                alternarModoRota('planeamento');

                // ABRIR AUTOMATICAMENTE O MODAL DE EDIÇÃO/OBSERVAÇÕES (Modo Planeamento)
                setTimeout(() => {
                    abrirModalEdicaoParagem(novoIndexPlaneamento, 'planeamento');
                }, 150);
            }
        }

        inputPostal.value = "";
        if (inputMorada) inputMorada.value = "";
        
        const btnTipoEntrega = document.getElementById('btn-tipo-entrega');
        const btnTipoRecolha = document.getElementById('btn-tipo-recolha');
        const inputTipoOperacao = document.getElementById('rota-tipo-operacao');
        if (btnTipoEntrega && btnTipoRecolha && inputTipoOperacao) {
            inputTipoOperacao.value = "Entrega";
            btnTipoEntrega.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-blue-600 text-white shadow transition-all cursor-pointer flex items-center justify-center space-x-1.5 focus:outline-none";
            btnTipoRecolha.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 hover:text-gray-700 transition-all cursor-pointer flex items-center justify-center space-x-1.5 focus:outline-none";
        }

    } catch (err) {
        console.error("Erro na geocodificação:", err);
        alert(`Erro: ${err.message}`);
    } finally {
        btnAdicionar.innerHTML = '<i class="fa-solid fa-plus"></i> <span>Adicionar Pacote</span>';
        btnAdicionar.disabled = false;
    }
}

// =========================================================================
// OTIMIZAÇÃO GLOBAL DA ROTA VIA GOOGLE ROUTE OPTIMIZATION API
// =========================================================================
export async function otimizarItinerarioComVizinhoMaisProximo() {
    if (!window.partidaLocalizacao) return alert("Por favor, defina um ponto de Partida primeiro.");
    if (window.moradasEntregas.length === 0) return alert("Adicione pelo menos uma morada de entrega.");

    const btnOtimizar = document.getElementById('btn-otimizar-rota');

    if (window.rotaOtimizada && window.rotaOtimizada.length > 0) {
        const confirmarRecalculo = confirm("Atenção: Já possui uma rota ativa. Se otimizar de novo, o sistema recalculará todo o percurso e confirmará todas as posições. Deseja continuar?");
        if (!confirmarRecalculo) return;
    }

    if (btnOtimizar) {
        btnOtimizar.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> <span>A calcular rota ótima...</span>';
        btnOtimizar.disabled = true;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/optimize-route`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pontoPartida: window.partidaLocalizacao,
                paragens: window.moradasEntregas
            })
        });

        if (!response.ok) {
            let errorDetails = `Erro ${response.status} (${response.statusText})`;
            try {
                const errJson = await response.json();
                if (errJson.error) errorDetails += ` - ${errJson.error}`;
            } catch(e) {}
            throw new Error(errorDetails);
        }

        const data = await response.json();
        
        window.isRouteOptimized = true;

        if (data.optimizedIndices) {
            const indices = data.optimizedIndices;
            window.rotaOtimizada = [];

            indices.forEach((indexOriginal) => {
                const paragemOriginal = window.moradasEntregas[indexOriginal];
                paragemOriginal.isNewUnconfirmed = false;
                paragemOriginal.distanciaDoAnterior = calcularDistanciaHaversine(
                    window.rotaOtimizada.length === 0 ? window.partidaLocalizacao.lat : window.rotaOtimizada[window.rotaOtimizada.length - 1].lat,
                    window.rotaOtimizada.length === 0 ? window.partidaLocalizacao.lng : window.rotaOtimizada[window.rotaOtimizada.length - 1].lng,
                    paragemOriginal.lat,
                    paragemOriginal.lng
                );
                window.rotaOtimizada.push(paragemOriginal);
            });

            window.routingMethodUsed = 'Cloud';
            localStorage.setItem('cp_routing_method', 'Cloud');
        } else {
            window.rotaOtimizada = [...window.moradasEntregas];
            window.rotaOtimizada.forEach(p => {
                p.isNewUnconfirmed = false;
                p.distanciaDoAnterior = 0;
            });
            window.routingMethodUsed = 'Local';
            localStorage.setItem('cp_routing_method', 'Local');
        }

        document.getElementById('container-mapa')?.classList.remove('hidden');
        document.getElementById('container-rota-ordenada')?.classList.remove('hidden');

        renderizarItinerarioOtimizado();
        sincronizarPersistencia();
        
        setTimeout(() => {
            if (window.googleMapInstance) {
                google.maps.event.trigger(window.googleMapInstance, 'resize');
            }
            desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
        }, 200);

        alternarModoRota('conducao');

    } catch (err) {
        console.warn("[PWA] Falha ao otimizar via nuvem Google Cloud. Ativando resolvedor síncrono local...", err);
        
        window.isRouteOptimized = true;
        calcularRotaVizinhoMaisProximoLocal();
        window.rotaOtimizada.forEach(p => p.isNewUnconfirmed = false);
        window.routingMethodUsed = 'Local';
        localStorage.setItem('cp_routing_method', 'Local');
        
        alert(`O servidor em nuvem falhou ou está temporariamente a dormir (${err.message}).\n\nContingência Ativada: Calculámos com sucesso uma rota aproximada localmente no próprio dispositivo!`);
        
        document.getElementById('container-mapa')?.classList.remove('hidden');
        document.getElementById('container-rota-ordenada')?.classList.remove('hidden');

        renderizarItinerarioOtimizado();
        sincronizarPersistencia();
        
        setTimeout(() => {
            if (window.googleMapInstance) {
                google.maps.event.trigger(window.googleMapInstance, 'resize');
            }
            desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
        }, 200);

        alternarModoRota('conducao');
    } finally {
        if (btnOtimizar) {
            btnOtimizar.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> <span>Otimizar Sequência de Rota</span>';
            btnOtimizar.disabled = false;
        }
    }
}

export function setupRotasLogic() {
    const btnIniciarRota = document.getElementById('btn-iniciar-rota');
    const dataRotaInput = document.getElementById('data-rota');
    const btnGpsPartida = document.getElementById('btn-gps-partida');
    const btnBuscarPartida = document.getElementById('btn-buscar-partida');
    const btnLimparEnderecos = document.getElementById('btn-limpar-enderecos');
    const btnOtimizarRota = document.getElementById('btn-otimizar-rota');
    const statusPartida = document.getElementById('status-partida');

    const btnAdicionarPostal = document.getElementById('btn-adicionar-postal-rota');
    const btnPlaneamento = document.getElementById('btn-modo-planeamento');
    const btnConducao = document.getElementById('btn-modo-conducao');

    const btnIniciarSaidaKm = document.getElementById('btn-iniciar-saida-km');
    const btnFinalizarTurno = document.getElementById('btn-finalizar-turno');

    const btnTipoEntrega = document.getElementById('btn-tipo-entrega');
    const btnTipoRecolha = document.getElementById('btn-tipo-recolha');
    const inputTipoOperacao = document.getElementById('rota-tipo-operacao');

    configurarEventosPrefixoRapido();
    configurarFormatacaoCodigoPostal();
    inicializarAutocompleteMorada();
    configurarEscutaCodigoPostalParaLimites();
    setupModaisEdicao();

    if (btnPlaneamento && btnConducao) {
        btnPlaneamento.addEventListener('click', () => alternarModoRota('planeamento'));
        btnConducao.addEventListener('click', () => alternarModoRota('conducao'));
    }

    if (btnTipoEntrega && btnTipoRecolha && inputTipoOperacao) {
        btnTipoEntrega.addEventListener('click', () => {
            inputTipoOperacao.value = "Entrega";
            btnTipoEntrega.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-blue-600 text-white shadow transition-all cursor-pointer flex items-center justify-center space-x-1.5 focus:outline-none";
            btnTipoRecolha.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 hover:text-gray-700 transition-all cursor-pointer flex items-center justify-center space-x-1.5 focus:outline-none";
        });

        btnTipoRecolha.addEventListener('click', () => {
            inputTipoOperacao.value = "Recolha";
            btnTipoRecolha.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center bg-purple-600 text-white shadow transition-all cursor-pointer flex items-center justify-center space-x-1.5 focus:outline-none";
            btnTipoEntrega.className = "flex-1 py-2 text-xs font-bold rounded-lg text-center text-gray-500 hover:text-gray-700 transition-all cursor-pointer flex items-center justify-center space-x-1.5 focus:outline-none";
        });
    }

    if (btnAdicionarPostal) {
        btnAdicionarPostal.addEventListener('click', () => processarAdicaoPorPostal());
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
            
            window.tripStarted = false;
            window.tripCompleted = false;
            window.odometerStart = 0;
            window.odometerStartHour = "";
            window.odometerEnd = 0;
            window.odometerEndHour = "";

            window.dataRotaSelecionada = dataFormatada;
            window.rotaIniciada = true;
            window.isRouteOptimized = false;
            window.rotaOtimizada = [];

            localStorage.setItem('cp_modo_rota', 'planeamento');
            sincronizarPersistencia();
            sincronizarInterfaceRota();
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

    if (btnBuscarPartida) {
        btnBuscarPartida.addEventListener('click', () => {
            window.definindoPartidaPorMorada = true;
            alert("Introduza o Código Postal e a rua de PARTIDA pretendida nos campos abaixo e clique em 'Adicionar Pacote' para marcar o início!");
            const inputPostal = document.getElementById('rota-codigo-postal');
            if (inputPostal) inputPostal.focus();
        });
    }

    if (btnLimparEnderecos) {
        btnLimparEnderecos.addEventListener('click', () => {
            if (confirm("Tem a certeza de que deseja eliminar todas as moradas e recomeçar a rota do zero?")) {
                window.moradasEntregas = [];
                window.rotaOtimizada = [];
                window.isRouteOptimized = false;
                localStorage.removeItem('cp_last_navigated_id');
                document.getElementById('container-mapa')?.classList.add('hidden');
                document.getElementById('container-rota-ordenada')?.classList.add('hidden');
                document.getElementById('estatisticas-rota')?.classList.add('hidden');
                limparMapaVisual();
                renderMoradasAdicionadas();
                alternarModoRota('planeamento');
                sincronizarPersistencia();
            }
        });
    }

    if (btnOtimizarRota) {
        btnOtimizarRota.addEventListener('click', () => {
            if (!window.partidaLocalizacao) return alert("Por favor, defina um ponto de Partida primeiro.");
            if (window.moradasEntregas.length === 0) return alert("Adicione pelo menos uma morada de entrega.");
            otimizarItinerarioComVizinhoMaisProximo();
        });
    }

    if (btnIniciarSaidaKm) {
        btnIniciarSaidaKm.addEventListener('click', () => abrirModalOdometroSaida(() => {
            sincronizarInterfaceRota();
        }));
    }

    if (btnFinalizarTurno) {
        btnFinalizarTurno.addEventListener('click', () => abrirModalOdometroChegada());
    }
}

export function sincronizarInterfaceRota() {
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
        setTimeout(inicializarAutocompleteMorada, 100);

        const modoSalvo = localStorage.getItem('cp_modo_rota') || 'planeamento';
        alternarModoRota(modoSalvo);

        if (window.isRouteOptimized && window.rotaOtimizada && window.rotaOtimizada.length > 0) {
            document.getElementById('container-mapa')?.classList.remove('hidden');
            document.getElementById('container-rota-ordenada')?.classList.remove('hidden');
            
            renderizarItinerarioOtimizado();
            
            setTimeout(() => {
                if (window.googleMapInstance) {
                    google.maps.event.trigger(window.googleMapInstance, 'resize');
                }
                desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
            }, 300);
        } else {
            document.getElementById('container-mapa')?.classList.add('hidden');
            document.getElementById('container-rota-ordenada')?.classList.add('hidden');
            document.getElementById('estatisticas-rota')?.classList.add('hidden');
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