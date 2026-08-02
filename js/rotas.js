/**
 * js/rotas.js
 * Faz: Liga o ecrã de rotas ao seu servidor seguro local (porta 3000) ou servidor remoto no Render para processar os índices de ordenação ótimos.
 *      Inclui pré-geolocalização inteligente para limitar sugestões a um raio de 1km em redor do Código Postal introduzido,
 *      atribui o Brick correspondente à localidade do pacote e apresenta etiquetas visuais de arrumação física.
 *      Caso o servidor na nuvem esteja offline ou a dormir (timeouts do Render), calcula instantaneamente uma rota síncrona ótima local no próprio dispositivo para que o motorista nunca pare.
 *      Implementa proteção de ligação física única no Autocomplete do Google para evitar sobreposição de instâncias de escrita concorrentes.
 *      NOVO: Sincroniza bidirecionalmente em tempo real todo o planeamento de rotas e atualizações de entregas na nuvem do Firestore.
 *      NOVO: Implementa alerta de re-otimização e inserção inteligente direta de pacotes em rotas ativas com indicação visual pulsante (por confirmar).
 *      MELHORADO: Adapta a resolução de Bricks para centenas e suporta re-atribuição dinâmica inteligente de concelho (Sintra/Mafra).
 * NÃO faz: Não executa cálculos de linha reta locais quando o servidor responde em OK (delegado à API remota da Google).
 * Depende de: ./storage.js, ./voz.js, ./maps.js, ./geografia-data.js, ./firebase-init.js (para aceder ao db)
 */

import { saveData } from './storage.js';
import { criarReconhecimentoVoz } from './voz.js';
import { GEOGRAPHY } from './geografia-data.js';
import { 
    obterEnderecoPorGPSGoogle, 
    calcularDistanciaHaversine, 
    desenharMapaGoogle, 
    limparMapaVisual 
} from './maps.js';

// Importa a instância ativa do Firestore
import { db } from './firebase-init.js';

let itemSendoEditado = null; 
let autocompleteInstancia = null; // Guarda a instância ativa do Google Places Autocomplete

// Variáveis de estado temporárias do modal de edição
let embalagemSelecionada = "";
let origemSelecionada = "";

// =========================================================================
// DETETOR INTELIGENTE DE AMBIENTE (LOCAL VS PRODUÇÃO)
// =========================================================================
const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://classificapack-backend.onrender.com'; // Link do seu Render ativo

// ==========================================
// CENTRALIZAÇÃO DA PERSISTÊNCIA DAS ROTAS (SINC DE CLOUD REAL-TIME!)
// ==========================================
function sincronizarPersistencia() {
    // Grava de cache síncrona no LocalStorage local
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

    localStorage.setItem('cp_routing_method', window.routingMethodUsed || 'Cloud');
    localStorage.setItem('cp_trip_started', JSON.stringify(window.tripStarted));
    localStorage.setItem('cp_trip_completed', JSON.stringify(window.tripCompleted));
    localStorage.setItem('cp_odometer_start', JSON.stringify(window.odometerStart));
    localStorage.setItem('cp_odometer_start_hour', JSON.stringify(window.odometerStartHour));
    localStorage.setItem('cp_odometer_end', JSON.stringify(window.odometerEnd));
    localStorage.setItem('cp_odometer_end_hour', JSON.stringify(window.odometerEndHour));
    localStorage.setItem('cp_last_odometer', JSON.stringify(window.lastOdometer));

    // NOVO: Se houver um utilizador autenticado, sincroniza reativamente com o seu documento correspondente em 'routes'!
    if (window.currentUserUid) {
        db.collection('routes').doc(window.currentUserUid).set({
            partidaLocalizacao: window.partidaLocalizacao || null,
            moradasEntregas: window.moradasEntregas || [],
            rotaOtimizada: window.rotaOtimizada || [],
            dataRotaSelecionada: window.dataRotaSelecionada || "",
            rotaIniciada: window.rotaIniciada || false,
            routingMethodUsed: window.routingMethodUsed || 'Cloud',

            // Sincroniza dados do Odómetro para a nuvem
            tripStarted: window.tripStarted || false,
            tripCompleted: window.tripCompleted || false,
            odometerStart: window.odometerStart || 0,
            odometerStartHour: window.odometerStartHour || "",
            odometerEnd: window.odometerEnd || 0,
            odometerEndHour: window.odometerEndHour || "",
            lastOdometer: window.lastOdometer || 0,

            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            console.log("[FIREBASE] Rota do utilizador sincronizada no Firestore.");
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
    const buscaMoradaInput = document.getElementById('rota-morada-completa'); // Aponta agora para a morada opcional
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

// Auxiliar para detetar se uma localidade é a capital genérica (catch-all) de uma freguesia
function isCatchAllLocality(freguesia, localidade) {
    const cleanFreg = freguesia.replace(/\s+MFR$/i, "").toLowerCase();
    
    // Remove os parênteses de centenas (ex: "Sintra (000-099)" passa a "sintra") para fins de comparação
    const cleanLoc = localidade.replace(/\s*\(\d{3}-\d{3}\)$/, "").toLowerCase();
    
    if (cleanLoc === cleanFreg) return true;
    if (cleanFreg === "são miguel de alcainça" && cleanLoc === "alcainça") return true;
    return false;
}

// Auxiliar para detetar o concelho correspondente ao código postal fornecido
function obterConcelhoPorCodigoPostal(zip) {
    if (!zip) return "MAFRA";
    const cleanPrefix = zip.replace(/\D/g, '').substring(0, 4);
    if (cleanPrefix === "2705" || cleanPrefix === "2710" || cleanPrefix === "2715" || cleanPrefix === "2725") {
        return "SINTRA";
    }
    return "MAFRA";
}

// ==========================================
// RESOLVEDOR DE BRICK COMPATÍVEL INTERNO (ROTAS COM DUPLA PASSAGEM)
// ==========================================
function resolveBrickForZip(zip, drivers) {
    if (!zip || !drivers) return { brickId: null, brickName: null };
    const regexZip = /\d{4}-\d{3}/;
    const match = zip.match(regexZip);
    const normalizedZip = match ? match[0] : zip.trim();

    // Deteta reativamente o concelho com base no código postal
    const concelho = obterConcelhoPorCodigoPostal(normalizedZip);

    let matchedFreguesia = null;
    let matchedLocalidade = null;

    if (!GEOGRAPHY[concelho]) {
        return { brickId: null, brickName: null };
    }

    // PASSAGEM 1: Mira laser - Procura apenas nas localidades específicas
    for (const [freguesia, localidades] of Object.entries(GEOGRAPHY[concelho])) {
        for (const [localidade, cpList] of Object.entries(localidades)) {
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

    // PASSAGEM 2: Fallback - Se não encontrou, procura nas genéricas (catch-all)
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
        return { brickId: null, brickName: null };
    }

    return { 
        brickId: `${matchedFreguesia}|${matchedLocalidade}`, 
        brickName: matchedLocalidade 
    };
}

// ==========================================
// ALGORITMO SÍNCRONO LOCAL DE CONTINGÊNCIA (VIZINHO MAIS PRÓXIMO)
// ==========================================
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
// TRATAMENTO DE ENVIO DE CÓDIGO POSTAL + MORADA (GEOCODIFICAÇÃO LOCAL/PROD)
// =========================================================================
export async function processarAdicaoPorPostal() {
    const inputPostal = document.getElementById('rota-codigo-postal');
    const inputMorada = document.getElementById('rota-morada-completa');
    const btnAdicionar = document.getElementById('btn-adicionar-postal-rota');
    const statusPartida = document.getElementById('status-partida');

    if (!inputPostal || !btnAdicionar) return;

    const postalCodeVal = inputPostal.value.trim();
    const moradaVal = inputMorada ? inputMorada.value.trim() : "";

    // 1. Limpa e valida se o Código Postal tem 7 dígitos numéricos
    const cleanZip = postalCodeVal.replace(/\D/g, '');
    if (cleanZip.length !== 7) {
        alert("Por favor, introduza um Código Postal válido com 7 dígitos (ex: 2655-319).");
        inputPostal.focus();
        return;
    }

    const formattedZip = `${cleanZip.substring(0, 4)}-${cleanZip.substring(4, 7)}`;

    // 2. Coloca o botão em estado de carregamento de segurança
    btnAdicionar.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> <span>A geolocalizar...</span>';
    btnAdicionar.disabled = true;

    try {
        // 3. Consulta o endpoint dinâmico (Local ou Render)
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

        // Resolve e associa estante física (Brick) na criação da paragem
        const { brickId, brickName } = resolveBrickForZip(formattedZip, window.drivers);

        // 4. Constrói o objeto de morada mapeada vinda da Google
        const novaMorada = {
            id: 'm_' + Date.now() + Math.random().toString(36).substr(2, 5),
            lat: data.lat,
            lng: data.lng,
            address: data.address, // Endereço oficial mapeado pela Google
            status: "Pendente",
            observation: "",
            priority: false,
            brickId: brickId,
            brickName: brickName // Gravação física da estante (Brick) correspondente à localidade
        };

        // 5. Verifica se o clique anterior foi para definir o Ponto de Partida
        if (window.definindoPartidaPorMorada) {
            window.partidaLocalizacao = novaMorada;
            if (statusPartida) statusPartida.innerHTML = `<strong>Partida:</strong> ${novaMorada.address}`;
            window.definindoPartidaPorMorada = false;
            sincronizarPersistencia();
            alert("Ponto de Partida configurado com sucesso!");
        } else {
            // Caso contrário, adiciona como paragem de entrega à lista base de moradas
            window.moradasEntregas.push(novaMorada);

            // NOVO: Verificação de Rota Ativa/Otimizada para Inserção Inteligente Sem Perda de Ordem
            if (window.rotaOtimizada && window.rotaOtimizada.length > 0) {
                // Calcula de forma síncrona a distância Haversine a partir do último ponto atual da rota otimizada
                const ultimaParagem = window.rotaOtimizada[window.rotaOtimizada.length - 1];
                novaMorada.distanciaDoAnterior = calcularDistanciaHaversine(
                    ultimaParagem.lat,
                    ultimaParagem.lng,
                    novaMorada.lat,
                    novaMorada.lng
                );

                // NOVO: Define esta paragem como um Pacote Novo por Confirmar
                novaMorada.isNewUnconfirmed = true;

                // Anexa o novo pacote diretamente ao final da rota otimizada atual
                window.rotaOtimizada.push(novaMorada);

                // Grava e desenha imediatamente as atualizações no ecrã e no mapa
                sincronizarPersistencia();
                renderMoradasAdicionadas();
                renderizarItinerarioOtimizado();
                desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);

                // Abre de forma automática o seletor de sequência para o novo pacote
                const novoIndex = window.rotaOtimizada.length - 1;
                setTimeout(() => {
                    if (typeof window.abrirModalAlterarSequencia === 'function') {
                        window.abrirModalAlterarSequencia(novoIndex, novaMorada);
                    }
                }, 400);

            } else {
                // Lógica de fallback original se a rota ainda não estiver otimizada
                renderMoradasAdicionadas();
                sincronizarPersistencia();
                abrirModalEdicaoParagem(novaMorada, false);
            }
        }

        // Limpa os campos de destino após adicionar com sucesso
        inputPostal.value = "";
        if (inputMorada) inputMorada.value = "";

    } catch (err) {
        console.error("Erro na geocodificação:", err);
        alert(`Erro: ${err.message}`);
    } finally {
        // Devolve o botão ao estado padrão
        btnAdicionar.innerHTML = '<i class="fa-solid fa-plus"></i> <span>Adicionar Pacote</span>';
        btnAdicionar.disabled = false;
    }
}

// ==========================================
// DESENHAR MORADAS ADICIONADAS (PLANEAMENTO)
// ==========================================
export function renderMoradasAdicionadas() {
    const listaMoradasAdicionadas = document.getElementById('lista-moradas-adicionadas');
    if (!listaMoradasAdicionadas) return;

    listaMoradasAdicionadas.innerHTML = "";
    if (window.moradasEntregas.length === 0) {
        listaMoradasAdicionadas.innerHTML = `<p class="text-xs text-gray-400 italic text-center py-2">Nenhuma morada adicionada.</p>`;
        return;
    }
    window.moradasEntregas.forEach((morada, index) => {
        const item = document.createElement('div');
        
        if (morada.priority) {
            item.className = "flex items-center justify-between p-2 bg-orange-50 border border-orange-200 rounded-lg text-xs animate-fade-in space-x-2";
        } else {
            item.className = "flex items-center justify-between p-2 bg-gray-50 rounded border text-xs animate-fade-in space-x-2";
        }

        item.innerHTML = `
            <div class="flex-1 truncate">
                <strong class="text-gray-500">#${index + 1}</strong> 
                <span>${morada.address}</span>
                ${morada.priority ? `<span class="bg-orange-500 text-white text-[8px] font-bold uppercase px-1 py-0.5 rounded ml-1.5"><i class="fa-solid fa-circle-exclamation mr-0.5"></i> Prioritária</span>` : ''}
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
            window.rotaOtimizada = window.rotaOtimizada.filter(m => m.id !== morada.id); 
            
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

// =========================================================================
// OTIMIZAÇÃO: CONEXÃO À GOOGLE ROUTE OPTIMIZATION API (CÁLCULO REAL POR ESTRADA)
// =========================================================================
export async function otimizarItinerarioComVizinhoMaisProximo() {
    if (!window.partidaLocalizacao) return alert("Por favor, defina um ponto de Partida primeiro.");
    if (window.moradasEntregas.length === 0) return alert("Adicione pelo menos uma morada de entrega.");

    const btnOtimizar = document.getElementById('btn-otimizar-rota');

    // NOVO: Alerta preventivo contra perda acidental de sequenciação manual personalizada
    if (window.rotaOtimizada && window.rotaOtimizada.length > 0) {
        const confirmarRecalculo = confirm("Atenção: Já possui uma rota ativa com ordenação personalizada. Se otimizar de novo, o sistema recalculará todo o percurso e perderá as suas alterações manuais. Deseja continuar?");
        if (!confirmarRecalculo) {
            return; // Aborta e preserva as alterações manuais intactas
        }
    }

    if (btnOtimizar) {
        btnOtimizar.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> <span>A calcular rota ótima...</span>';
        btnOtimizar.disabled = true;
    }

    try {
        // Envia as coordenadas para o endpoint dinâmico (Local ou Render)
        const response = await fetch(`${API_BASE_URL}/api/optimize-route`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pontoPartida: window.partidaLocalizacao,
                paragens: window.moradasEntregas
            })
        });

        if (!response.ok) {
            // Deteta reativamente o código e erro HTTP real do Render para diagnosticar timeout ou chaves
            let errorDetails = `Erro ${response.status} (${response.statusText})`;
            try {
                const errJson = await response.json();
                if (errJson.error) errorDetails += ` - ${errJson.error}`;
            } catch(e) {}
            throw new Error(errorDetails);
        }

        const data = await response.json();
        
        if (data.optimizedIndices) {
            const indices = data.optimizedIndices; // Array de índices ordenados da Google (ex: [2, 0, 1])
            window.rotaOtimizada = [];

            // Reorganiza a rota local na ordem correta devolvida pela Google
            indices.forEach((indexOriginal) => {
                const paragemOriginal = window.moradasEntregas[indexOriginal];
                
                // Atribui uma distância teórica de condução (estimativa local)
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
            // Se a API não deu erro mas não ordenou, mantém a original
            window.rotaOtimizada = [...window.moradasEntregas];
            window.rotaOtimizada.forEach(p => p.distanciaDoAnterior = 0);
            window.routingMethodUsed = 'Local';
            localStorage.setItem('cp_routing_method', 'Local');
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

        alternarModoRota('conducao');

    } catch (err) {
        // Resolvedor de Contingência Local Ativo se o Render falhar, der timeout ou estiver a dormir
        console.warn("[PWA] Falha ao otimizar via nuvem Google Cloud. Ativando resolvedor síncrono local...", err);
        
        calcularRotaVizinhoMaisProximoLocal();
        
        window.routingMethodUsed = 'Local';
        localStorage.setItem('cp_routing_method', 'Local');
        
        alert(`O servidor em nuvem falhou ou está temporariamente a dormir (${err.message}).\n\nContingência Ativada: Calculámos com sucesso uma rota aproximada localmente no próprio dispositivo para que possa trabalhar!`);
        
        const containerMapa = document.getElementById('container-mapa');
        const containerRotaOrdenada = document.getElementById('container-rota-ordenada');
        if (containerMapa) containerMapa.classList.remove('hidden');
        if (containerRotaOrdenada) containerRotaOrdenada.classList.remove('hidden');

        renderizarItinerarioOtimizado();
        sincronizarPersistencia();
        
        setTimeout(() => {
            desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);
        }, 300);

        alternarModoRota('conducao');
    } finally {
        if (btnOtimizar) {
            btnOtimizar.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> <span>Otimizar Sequência de Rota</span>';
            btnOtimizar.disabled = false;
        }
    }
}

// =========================================================================
// DESENHAR LISTA DE ENTREGAS OTIMIZADA COM SISTEMA DE SCROLL INTELIGENTE
// =========================================================================
export function renderizarItinerarioOtimizado() {
    const listaRotaFinal = document.getElementById('lista-rota-final');
    if (!listaRotaFinal) return;

    listaRotaFinal.innerHTML = "";
    
    const lastNavigatedId = localStorage.getItem('cp_last_navigated_id');

    window.rotaOtimizada.forEach((paragem, index) => {
        const item = document.createElement('div');
        item.id = `paragem-${paragem.id}`; 
        
        let statusColor = "bg-blue-600";
        if (paragem.status === "Entregue") statusColor = "bg-green-500";
        if (paragem.status === "Falhou") statusColor = "bg-red-500";

        const isLastNavigated = paragem.id === lastNavigatedId;
        const isPriority = !!paragem.priority;
        const isNewUnconfirmed = !!paragem.isNewUnconfirmed; // NOVO: Estado de pendência do novo pacote

        if (isNewUnconfirmed) {
            // NOVO: Card Amarelo Vivo Pulsante para Chamar a Atenção Visual do Motorista
            item.className = "p-3 rounded-xl flex flex-col space-y-2 border-2 border-yellow-500 bg-yellow-50/70 shadow-md animate-pulse ring-4 ring-yellow-200";
        } else if (isLastNavigated) {
            if (isPriority) {
                item.className = "p-3 rounded-xl flex flex-col space-y-2 animate-fade-in border-2 border-orange-500 bg-orange-50/70 shadow-md ring-4 ring-orange-200";
            } else {
                item.className = "p-3 rounded-xl flex flex-col space-y-2 animate-fade-in border-2 border-blue-500 bg-blue-50/70 shadow-md ring-4 ring-blue-100";
            }
        } else {
            if (isPriority) {
                item.className = "bg-orange-50/30 p-3 rounded-xl border-2 border-orange-200 shadow-sm flex flex-col space-y-2 animate-fade-in";
            } else {
                item.className = "bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex flex-col space-y-2 animate-fade-in";
            }
        }

        const linkGoogleMaps = `https://www.google.com/maps/dir/?api=1&destination=${paragem.lat},${paragem.lng}&travelmode=driving`;
        const primeiraLinhaObs = paragem.observation ? paragem.observation.split('\n')[0] : "";

        item.innerHTML = `
            <div class="flex items-center justify-between space-x-2">
                <div class="flex-1 truncate">
                    <div class="flex items-center space-x-2 flex-wrap gap-1">
                        <span class="w-5 h-5 rounded-full ${isNewUnconfirmed ? 'bg-yellow-500 text-black' : statusColor + ' text-white'} font-bold text-[10px] flex items-center justify-center flex-shrink-0 transition-colors">
                            ${index + 1}
                        </span>
                        <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                            A cerca de ${paragem.distanciaDoAnterior.toFixed(2)} km
                        </span>
                        ${isNewUnconfirmed ? `<span class="bg-yellow-500 text-black text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide animate-pulse"><i class="fa-solid fa-circle-exclamation mr-0.5"></i> Novo (Por Confirmar)</span>` : ''}
                        ${isLastNavigated && !isNewUnconfirmed ? `<span class="bg-blue-600 text-white text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide animate-pulse">A navegar</span>` : ''}
                        ${isPriority ? `<span class="bg-orange-500 text-white text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide animate-pulse"><i class="fa-solid fa-circle-exclamation mr-0.5"></i> Prioritária</span>` : ''}
                        
                        <!-- INDICADOR VISUAL: Etiqueta de Estante (Brick) de arrumação na lista de rotas de condução -->
                        ${paragem.brickName ? `<span class="bg-blue-50 text-blue-700 border border-blue-200 text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide flex items-center space-x-1" title="${paragem.brickId ? paragem.brickId.split('|')[0] : ''} - ${paragem.brickName}"><i class="fa-solid fa-boxes-stacked text-blue-500"></i> <span>Estante: ${paragem.brickName}</span></span>` : ''}
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

        // INTERCEÇÃO TÁTIL DA PRIMEIRA MORADA DE NAVEGAÇÃO PARA REGISTO DO ODÓMETRO
        item.querySelector('.btn-navegar').onclick = () => {
            if (index === 0 && (!window.tripStarted || !window.odometerStart || window.odometerStart === 0)) {
                abrirModalOdometroSaida(() => {
                    localStorage.setItem('cp_last_navigated_id', paragem.id);
                    renderizarItinerarioOtimizado(); 
                    window.open(linkGoogleMaps, '_blank');
                });
            } else {
                localStorage.setItem('cp_last_navigated_id', paragem.id);
                renderizarItinerarioOtimizado(); 
                window.open(linkGoogleMaps, '_blank');
            }
        };

        item.querySelector('.btn-edit-otimizada').onclick = () => abrirModalEdicaoParagem(paragem, true);

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
}

// ==========================================
// PAINEL DE ESTATÍSTICAS DA ROTA ATIVA (ESTIMATIVAS E SISTEMA EM USO)
// ==========================================
export function renderEstatisticasRota() {
    const htmlEl = document.getElementById('estatisticas-rota');
    const statTotal = document.getElementById('stat-total');
    const statEntregues = document.getElementById('stat-entregues');
    const statFalhas = document.getElementById('stat-falhas'); 
    const statPendentes = document.getElementById('stat-pendentes');

    // Elementos visuais para distância, tempo e motor de roteamento
    const statDistancia = document.getElementById('stat-distancia');
    const statTempo = document.getElementById('stat-tempo');
    const statSistema = document.getElementById('stat-sistema');

    // Elementos dinâmicos do Diário de Bordo e do Fecho de Turno
    const btnFinalizarTurno = document.getElementById('btn-finalizar-turno');
    const painelOdometroResumo = document.getElementById('painel-odometro-resumo');

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

    // Calcular distância total acumulada (km)
    let totalDist = 0;
    window.rotaOtimizada.forEach(p => {
        totalDist += p.distanciaDoAnterior || 0;
    });

    if (statDistancia) {
        statDistancia.textContent = `${totalDist.toFixed(2)} km`;
    }

    // Estimar tempo com velocidade média de condução de 40 km/h (urban/rural mix em Mafra)
    if (statTempo) {
        if (totalDist === 0) {
            statTempo.textContent = "0 min";
        } else {
            const tempoTotalMinutos = Math.round((totalDist / 40) * 60);
            if (tempoTotalMinutos < 60) {
                statTempo.textContent = `${tempoTotalMinutos} min`;
            } else {
                const horas = Math.floor(tempoTotalMinutos / 60);
                const mins = tempoTotalMinutos % 60;
                statTempo.textContent = `${horas}h ${mins}min`;
            }
        }
    }

    // Mostrar qual o motor de roteamento utilizado de forma visual e reativa
    if (statSistema) {
        const metodo = window.routingMethodUsed || localStorage.getItem('cp_routing_method') || 'Cloud';
        if (metodo === 'Cloud') {
            statSistema.className = "inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide border bg-emerald-50 text-emerald-700 border-emerald-200 animate-none";
            statSistema.innerHTML = `<i class="fa-solid fa-cloud"></i> <span>Google Cloud API (Real por Estrada)</span>`;
        } else {
            statSistema.className = "inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide border bg-amber-50 text-amber-700 border-amber-200 animate-pulse";
            statSistema.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>Contingência Local (Linha Reta)</span>`;
        }
    }

    // GESTÃO REATIVA DE VISIBILIDADE DO BOTÃO "FINALIZAR TURNO"
    if (btnFinalizarTurno) {
        if (window.tripStarted && !window.tripCompleted) {
            btnFinalizarTurno.classList.remove('hidden');
        } else {
            btnFinalizarTurno.classList.add('hidden');
        }
    }

    // GESTÃO REATIVA E COMPLEMENTO VISUAL DO DIÁRIO DE BORDO
    if (painelOdometroResumo) {
        if (window.tripStarted) {
            painelOdometroResumo.classList.remove('hidden');
            
            const startKmEl = document.getElementById('odometro-resumo-saida-km');
            const startHourEl = document.getElementById('odometro-resumo-saida-hora');
            const endKmEl = document.getElementById('odometro-resumo-chegada-km');
            const endHourEl = document.getElementById('odometro-resumo-chegada-hora');
            const totalKmEl = document.getElementById('odometro-resumo-total-viagem');

            if (startKmEl) startKmEl.textContent = `${window.odometerStart} KM`;
            if (startHourEl) startHourEl.textContent = `Hora: ${window.odometerStartHour}`;

            if (window.tripCompleted) {
                if (endKmEl) endKmEl.textContent = `${window.odometerEnd} KM`;
                if (endHourEl) endHourEl.textContent = `Hora: ${window.odometerEndHour}`;
                if (totalKmEl) {
                    const diff = window.odometerEnd - window.odometerStart;
                    totalKmEl.textContent = `Total percorrido na rota: ${diff.toFixed(1)} km`;
                }
            } else {
                if (endKmEl) endKmEl.textContent = `-- KM`;
                if (endHourEl) endHourEl.textContent = `Hora: Em trânsito`;
                if (totalKmEl) totalKmEl.textContent = `Total percorrido na rota: Em trânsito...`;
            }
        } else {
            painelOdometroResumo.classList.add('hidden');
        }
    }
}

// ==========================================
// FUNÇÕES DE ABERTURA E VALIDAÇÃO DOS MODAIS DO ODÓMETRO
// ==========================================
function abrirModalOdometroSaida(callback) {
    const modal = document.getElementById('modal-odometro-saida');
    if (!modal) return;

    // Obtém o horário do dispositivo em formato síncrono para preenchimento
    const agora = new Date();
    const horaStr = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    
    const inputHora = document.getElementById('odometro-saida-hora');
    const inputKm = document.getElementById('odometro-saida-km');
    const txtMinimo = document.getElementById('odometro-saida-minimo');

    if (inputHora) inputHora.value = horaStr;
    if (inputKm) inputKm.value = window.lastOdometer || "";
    if (txtMinimo) txtMinimo.textContent = `Mínimo exigido: ${window.lastOdometer || 0} KM`;

    modal.classList.remove('hidden');

    const btnConfirmar = document.getElementById('btn-confirmar-saida-km');
    const btnCancelar = document.getElementById('btn-cancelar-saida-km');

    btnConfirmar.onclick = () => {
        const kmVal = parseFloat(inputKm.value);
        const horaVal = inputHora.value.trim();

        // Validação defensiva absoluta contra quilometragens inferiores de início
        if (isNaN(kmVal) || kmVal < (window.lastOdometer || 0)) {
            alert(`Erro de validação: O valor de quilometragem de partida não pode ser menor do que o último registo final (${window.lastOdometer || 0} KM).`);
            return;
        }
        if (!horaVal) {
            alert("Por favor, introduza um horário de partida válido.");
            return;
        }

        window.tripStarted = true;
        window.tripCompleted = false;
        window.odometerStart = kmVal;
        window.odometerStartHour = horaVal;
        window.lastOdometer = kmVal; // Define o novo limiar benchmark mínimo

        sincronizarPersistencia();
        modal.classList.add('hidden');
        callback();
    };

    btnCancelar.onclick = () => {
        modal.classList.add('hidden');
    };
}

function abrirModalOdometroChegada() {
    const modal = document.getElementById('modal-odometro-chegada');
    if (!modal) return;

    const agora = new Date();
    const horaStr = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    
    const inputHora = document.getElementById('odometro-chegada-hora');
    const inputKm = document.getElementById('odometro-chegada-km');
    const txtMinimo = document.getElementById('odometro-chegada-minimo');

    if (inputHora) inputHora.value = horaStr;
    if (inputKm) inputKm.value = ""; // Fica em branco para introdução tátil do condutor
    if (txtMinimo) txtMinimo.textContent = `Mínimo de partida: ${window.odometerStart || 0} KM`;

    modal.classList.remove('hidden');

    const btnConfirmar = document.getElementById('btn-confirmar-chegada-km');
    const btnCancelar = document.getElementById('btn-cancelar-chegada-km');

    btnConfirmar.onclick = () => {
        const kmVal = parseFloat(inputKm.value);
        const horaVal = inputHora.value.trim();

        // Validação defensiva absoluta contra quilometragens inferiores ao ponto de partida
        if (isNaN(kmVal) || kmVal < window.odometerStart) {
            alert(`Erro de validação: O valor de quilometragem final de regresso não pode ser inferior ao valor de saída (${window.odometerStart} KM).`);
            return;
        }
        if (!horaVal) {
            alert("Por favor, introduza um horário de regresso válido.");
            return;
        }

        // Exibe resumo final de viagem antes de arquivar o dia
        alert(`Turno Encerrado com Sucesso!\n\nPartida: ${window.odometerStart} KM às ${window.odometerStartHour}\nChegada: ${kmVal} KM às ${horaVal}\nTotal Percorrido: ${(kmVal - window.odometerStart).toFixed(1)} km`);

        // GRAVAÇÃO E ARQUIVO COMPLETO DO TURNO (Finalizar Turno é o único encerramento possível de rota)
        window.tripCompleted = true;
        window.odometerEnd = kmVal;
        window.odometerEndHour = horaVal;
        window.lastOdometer = kmVal; // Define o novo mínimo incontornável para inícios futuros

        // Limpa a rota e paragens ativas do ecrã de entregas, preparando para o turno seguinte
        window.partidaLocalizacao = null;
        window.moradasEntregas = [];
        window.rotaOtimizada = [];
        window.dataRotaSelecionada = "";
        window.rotaIniciada = false;

        // Reseta estados temporários de viagem
        window.tripStarted = false;
        window.tripCompleted = false;
        window.odometerStart = 0;
        window.odometerStartHour = "";
        window.odometerEnd = 0;
        window.odometerEndHour = "";

        localStorage.removeItem('cp_last_navigated_id');
        limparMapaVisual();

        sincronizarPersistencia();
        modal.classList.add('hidden');
        
        // Recarrega a interface para o ecrã de setup inicial de data
        sincronizarInterfaceRota();
    };

    btnCancelar.onclick = () => {
        modal.classList.add('hidden');
    };
}

// ==========================================
// FUNÇÃO GLOBAL DE RE-SEQUENCIAÇÃO DE ENTREGA (ACIONADA PELO CLIQUE NO MAPA OU ADIÇÃO DIRETA)
// ==========================================
window.abrirModalAlterarSequencia = (indexAtual, paragem) => {
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

        // NOVO: Remove o estado pendente "não confirmado", visto que o motorista confirmou a posição
        paragem.isNewUnconfirmed = false;

        // Garante a limpeza do estado correspondente na lista de moradas de planeamento
        const originalPre = window.moradasEntregas.find(m => m.id === paragem.id);
        if (originalPre) {
            originalPre.isNewUnconfirmed = false;
        }

        if (indexAtual !== novoIndex) {
            // Re-ordena o array de entregas de forma reativa e sequencial
            const item = window.rotaOtimizada.splice(indexAtual, 1)[0];
            window.rotaOtimizada.splice(novoIndex, 0, item);

            // Recalcula as distâncias acumuladas entre as paragens sucessivas
            window.rotaOtimizada.forEach((p, idx) => {
                p.distanciaDoAnterior = calcularDistanciaHaversine(
                    idx === 0 ? window.partidaLocalizacao.lat : window.rotaOtimizada[idx - 1].lat,
                    idx === 0 ? window.partidaLocalizacao.lng : window.rotaOtimizada[idx - 1].lng,
                    p.lat,
                    p.lng
                );
            });

            // Sincroniza a ordenação manual com a lista base de planeamento
            window.moradasEntregas = [...window.rotaOtimizada];
        }

        // Grava, redesenha as contagens no ecrã e desativa o bounce do mapa Google de imediato
        sincronizarPersistencia();
        renderizarItinerarioOtimizado();
        desenharMapaGoogle(document.getElementById('map'), window.partidaLocalizacao, window.rotaOtimizada);

        modal.classList.add('hidden');
    };

    btnCancelar.onclick = () => {
        modal.classList.add('hidden');
    };
};

// ==========================================
// AUXILIARES DO PREFIXO RÁPIDO E DA FORMATAÇÃO DO CÓDIGO POSTAL
// ==========================================
function aplicarPrefixoNoCampo(prefixo) {
    const inputCP = document.getElementById('rota-codigo-postal');
    if (!inputCP) return;

    inputCP.value = `${prefixo}-`;
    
    // Foca o campo de Código Postal para abrir o teclado imediatamente
    inputCP.focus();

    // Garante que o cursor de escrita fica colocado logo após o hífen
    const comprimentoTexto = inputCP.value.length;
    inputCP.setSelectionRange(comprimentoTexto, comprimentoTexto);
}

function configurarEventosPrefixoRapido() {
    const btnManual = document.getElementById('btn-inserir-prefixo');
    const inputPrefixoManual = document.getElementById('prefixo-manual');

    if (btnManual && inputPrefixoManual) {
        btnManual.addEventListener('click', (e) => {
            e.preventDefault();
            const prefixoVal = inputPrefixoManual.value.replace(/\D/g, '');
            if (prefixoVal.length !== 4) {
                alert("Por favor, introduza um prefixo de Código Postal com exatamente 4 números.");
                inputPrefixoManual.focus();
                return;
            }
            aplicarPrefixoNoCampo(prefixoVal);
        });
    }
}

function configurarFormatacaoCodigoPostal() {
    const inputCP = document.getElementById('rota-codigo-postal');
    if (!inputCP) return;

    inputCP.addEventListener('input', () => {
        let valor = inputCP.value;
        // Permite apenas números e hífens
        valor = valor.replace(/[^0-9-]/g, '');

        const numerosApenas = valor.replace(/\D/g, '');

        if (numerosApenas.length <= 4) {
            valor = numerosApenas;
        } else {
            // Insere o hífen automaticamente a seguir ao quarto dígito
            valor = `${numerosApenas.substring(0, 4)}-${numerosApenas.substring(4, 7)}`;
        }

        inputCP.value = valor.toUpperCase();
    });
}

// ==========================================
// ESCUTA INTELIGENTE DE CÓDIGO POSTAL - AUTO-COMPLEMENTO DE LOCALIDADE E MAFRA (SEM RESTRIÇÃO DE KM)
// ==========================================
function configurarEscutaCodigoPostalParaLimites() {
    const inputCP = document.getElementById('rota-codigo-postal');
    const inputMorada = document.getElementById('rota-morada-completa');
    if (!inputCP) return;

    inputCP.addEventListener('input', async () => {
        const valor = inputCP.value.trim();
        const padraoCP = /^\d{4}-\d{3}$/;

        // Se o campo de Código Postal for limpo pelo utilizador
        if (valor.length === 0 && autocompleteInstancia) {
            // Repõe o limite geográfico padrão alargado de 15km de Mafra (Foco Suave)
            const centroMafra = { lat: 38.9369, lng: -9.3282 };
            const circuloMafra = new google.maps.Circle({ center: centroMafra, radius: 15000 });
            autocompleteInstancia.setBounds(circuloMafra.getBounds());
            autocompleteInstancia.setOptions({ strictBounds: false }); // Desativa a parede estrita
            console.log("[PWA] Autocomplete reposto para o limite geral de Mafra (15km).");
            return;
        }

        // Se detetar que o utilizador digitou um Código Postal de 7 dígitos completo (ex: 2640-601)
        if (padraoCP.test(valor)) {
            console.log(`[PWA] Detetado CP de 7 dígitos completo: ${valor}. A determinar localidade...`);

            // Procura a localidade (brick) associada localmente sem precisar de fazer pedidos ao servidor
            const { brickName } = resolveBrickForZip(valor, window.drivers);
            
            if (inputMorada) {
                // Monta a string enviando o CP, a localidade real correspondente e a palavra Mafra/Sintra
                const concelhoDetectado = obterConcelhoPorCodigoPostal(valor);
                const nomeConcelhoFormatado = concelhoDetectado.charAt(0) + concelhoDetectado.slice(1).toLowerCase();

                const textoPreenchido = brickName 
                    ? `${valor} ${brickName}, ${nomeConcelhoFormatado}, `
                    : `${valor} ${nomeConcelhoFormatado}, `;

                inputMorada.value = textoPreenchido;
                inputMorada.focus();
                
                // Coloca o cursor de escrita exatamente no fim, pronto a receber a rua, travessa, beco ou POI
                const comprimento = inputMorada.value.length;
                inputMorada.setSelectionRange(comprimento, comprimento);
            }

            // Remove a restrição física de 1km e garante priorização suave e abrangente no concelho
            if (autocompleteInstancia) {
                const concelhoDetectado = obterConcelhoPorCodigoPostal(valor);
                const centroConcelho = concelhoDetectado === "SINTRA" ? { lat: 38.8000, lng: -9.3800 } : { lat: 38.9369, lng: -9.3282 };
                const circuloConcelho = new google.maps.Circle({ center: centroConcelho, radius: 15000 });
                autocompleteInstancia.setBounds(circuloConcelho.getBounds());
                autocompleteInstancia.setOptions({ strictBounds: false }); // Desativa restrição e prioriza por texto
                console.log("[PWA] Restrição de 1km desativada. Autocomplete reorientado por texto livre.");
            }
        }
    });
}

// =========================================================================
// INICIALIZAÇÃO INTELIGENTE DO GOOGLE MAPS AUTOCOMPLETE NO CAMPO DE MORADA
// =========================================================================
function inicializarAutocompleteMorada() {
    const inputMorada = document.getElementById('rota-morada-completa');
    if (!inputMorada) return;

    // Evita a criação duplicada de instâncias no mesmo elemento do DOM! (Previne que o código postal anterior regresse)
    if (inputMorada.dataset.autocompleteBound === "true") {
        return;
    }

    // Se o SDK do Google Maps ainda não terminou de carregar, tenta novamente brevemente
    if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
        setTimeout(inicializarAutocompleteMorada, 500);
        return;
    }

    try {
        // Coordenadas centrais de Mafra, Portugal para limitar a pesquisa automática localmente (Padrão)
        const centroMafra = { lat: 38.9369, lng: -9.3282 };
        const circuloMafra = new google.maps.Circle({ center: centroMafra, radius: 15000 }); // Raio de 15km em redor do centro de Mafra
        const limitesMafra = circuloMafra.getBounds();

        // Cria a instância de autocomplete restrita a Portugal, priorizando o concelho de Mafra
        autocompleteInstancia = new google.maps.places.Autocomplete(inputMorada, {
            componentRestrictions: { country: 'pt' },
            fields: ['address_components', 'geometry', 'formatted_address'],
            bounds: limitesMafra,
            strictBounds: false // false prioriza geograficamente Mafra mas permite resultados próximos em caso de fronteira
        });

        // Marca o elemento para evitar duplicações de instâncias concorrentes
        inputMorada.dataset.autocompleteBound = "true";

        // Evento disparado quando o utilizador toca numa morada ou estabelecimento sugerido pela Google
        autocompleteInstancia.addListener('place_changed', () => {
            const localSelecionado = autocompleteInstancia.getPlace();
            if (!localSelecionado || !localSelecionado.address_components) return;

            // Extração automática inteligente do Código Postal (se presente no registo do Google)
            const componenteCP = localSelecionado.address_components.find(c => c.types.includes('postal_code'));
            if (componenteCP) {
                const inputCP = document.getElementById('rota-codigo-postal');
                if (inputCP) {
                    const cpLimpo = componenteCP.long_name.replace(/\D/g, '');
                    if (cpLimpo.length === 7) {
                        inputCP.value = `${cpLimpo.substring(0, 4)}-${cpLimpo.substring(4, 7)}`;
                    } else if (cpLimpo.length === 4) {
                        inputCP.value = `${cpLimpo}-`;
                        inputCP.focus();
                    }
                }
            }
        });
    } catch (err) {
        console.warn("Não foi possível iniciar o Autocomplete do Google Places neste ecrã:", err);
    }
}

// ==========================================
// SISTEMA DE BOTÕES TÁTEIS RÁPIDOS PARA O MODAL
// ==========================================

/**
 * text para a caixa de observações com base das tags selecionadas.
 */
function textObservacoesAutomatico() {
    const textareaObs = document.getElementById('edit-morada-obs');
    if (!textareaObs) return;

    const partes = [];
    if (embalagemSelecionada) partes.push(embalagemSelecionada);
    if (origemSelecionada) partes.push(origemSelecionada);

    // Junta as partes com um espaço (ex: "Envelope Amazon")
    textareaObs.value = partes.join(" ");
}

/**
 * Altera visualmente a cor dos botões (de cinzento para azul) consoante a seleção activa.
 */
function atualizarEstilosBotoesModal() {
    const botoesEmbalagem = document.querySelectorAll('.btn-tipo-embalagem');
    const botoesOrigem = document.querySelectorAll('.btn-origem-pacote');

    // 1. Pintar botões de Embalagem
    botoesEmbalagem.forEach(btn => {
        const tipo = btn.getAttribute('data-tipo');
        if (embalagemSelecionada === tipo) {
            btn.className = "btn-tipo-embalagem px-3 py-2.5 bg-blue-600 text-white font-bold text-xs rounded-xl border border-blue-600 transition-all text-center";
        } else {
            btn.className = "btn-tipo-embalagem px-3 py-2.5 bg-gray-50 text-gray-700 font-bold text-xs rounded-xl border border-gray-200 active:bg-blue-50 transition-all text-center";
        }
    });

    // 2. Pintar botões de Origem / Fornecedores
    botoesOrigem.forEach(btn => {
        const origem = btn.getAttribute('data-origem');
        if (origemSelecionada === origem) {
            btn.className = "btn-origem-pacote px-3 py-2.5 bg-blue-600 text-white font-bold text-xs rounded-xl border border-blue-600 transition-all text-center";
        } else {
            // Estilo padrão específico para o botão de Fraldas (com o coração vermelho)
            if (origem === 'Fraldas') {
                btn.className = "btn-origem-pacote px-3 py-2.5 bg-blue-50 text-blue-700 font-extrabold text-xs rounded-xl border border-blue-200 active:bg-blue-100 transition-all text-center flex items-center justify-center space-x-1";
            } else {
                btn.className = "btn-origem-pacote px-3 py-2.5 bg-gray-50 text-gray-700 font-bold text-xs rounded-xl border border-gray-200 active:bg-blue-50 transition-all text-center";
            }
        }
    });
}

/**
 * Analisa as observações já existentes de um pacote e pré-seleciona os botões do modal de forma inteligente.
 */
function preencherSelecoesPorTexto(observacao) {
    embalagemSelecionada = "";
    origemSelecionada = "";

    if (!observacao) return;

    const obsUpper = observacao.toUpperCase();

    // Detetar Embalagem no texto
    if (obsUpper.includes("ENVELOPE")) {
        embalagemSelecionada = "Envelope";
    } else if (obsUpper.includes("CAIXA PEQUENA")) {
        embalagemSelecionada = "Caixa Pequena";
    } else if (obsUpper.includes("CAIXA GRANDE")) {
        embalagemSelecionada = "Caixa Grande";
    } else if (obsUpper.includes("PACOTE")) {
        embalagemSelecionada = "Pacote";
    }

    // Detetar Fornecedor no texto
    if (obsUpper.includes("AMAZON")) {
        origemSelecionada = "Amazon";
    } else if (obsUpper.includes("ZARA")) {
        origemSelecionada = "Zara";
    } else if (obsUpper.includes("CHINA") || obsUpper.includes("TEMU") || obsUpper.includes("SHEIN")) {
        origemSelecionada = "China (Temu/Shein)";
    } else if (obsUpper.includes("FRALDAS")) {
        origemSelecionada = "Fraldas";
    }
}

/**
 * Atribui os escutadores de cliques em todos os botões rápidos do modal de edição.
 */
function configurarBotoesRapidosModal() {
    const botoesEmbalagem = document.querySelectorAll('.btn-tipo-embalagem');
    const botoesOrigem = document.querySelectorAll('.btn-origem-pacote');

    botoesEmbalagem.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const tipo = btn.getAttribute('data-tipo');
            
            // Alterna a seleção: se clicar de novo no mesmo, desseleciona
            if (embalagemSelecionada === tipo) {
                embalagemSelecionada = "";
            } else {
                embalagemSelecionada = tipo;
            }
            
            atualizarStylesBotoesModal();
            textObservacoesAutomatico();
        });
    });

    botoesOrigem.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const origem = btn.getAttribute('data-origem');
            
            if (origemSelecionada === origem) {
                origemSelecionada = "";
            } else {
                origemSelecionada = origem;
            }
            
            atualizarStylesBotoesModal();
            textObservacoesAutomatico();
        });
    });
}

// Para manter retrocompatibilidade com nomes chamados internamente no DOM
function atualizarStylesBotoesModal() {
    atualizarEstilosBotoesModal();
}

// ==========================================
// CONFIGURAÇÃO DO MENU E CONTROLOS DE TURNOS
// ==========================================
export function setupRotasLogic() {
    const btnIniciarRota = document.getElementById('btn-iniciar-rota');
    const dataRotaInput = document.getElementById('data-rota');
    const btnGpsPartida = document.getElementById('btn-gps-partida');
    const btnBuscarPartida = document.getElementById('btn-buscar-partida');
    const btnLimparEnderecos = document.getElementById('btn-limpar-enderecos');
    const btnOtimizarRota = document.getElementById('btn-otimizar-rota');
    const statusPartida = document.getElementById('status-partida');

    // Novos elementos do formulário de Código Postal
    const btnAdicionarPostal = document.getElementById('btn-adicionar-postal-rota');

    const btnPlaneamento = document.getElementById('btn-modo-planeamento');
    const btnConducao = document.getElementById('btn-modo-conducao');

    // Novo botão para finalização do turno
    const btnFinalizarTurno = document.getElementById('btn-finalizar-turno');

    // Inicialização da nova lógica de assistência ao teclado para o Código Postal
    configurarEventosPrefixoRapido();
    configurarFormatacaoPostal();
    inicializarAutocompleteMorada();
    
    // Liga a escuta dinâmica do Código Postal para mudar o raio de sugestões (Foco local em Mafra)
    configurarEscutaCodigoPostalParaLimites();

    if (btnPlaneamento && btnConducao) {
        btnPlaneamento.addEventListener('click', () => {
            alternarModoRota('planeamento');
        });
        btnConducao.addEventListener('click', () => {
            alternarModoRota('conducao');
        });
    }

    // Escuta de clique do novo botão de Adicionar Pacote por Código Postal
    if (btnAdicionarPostal) {
        btnAdicionarPostal.addEventListener('click', () => {
            processarAdicaoPorPostal();
        });
    }

    if (btnIniciarRota && dataRotaInput) {
        btnIniciarRota.addEventListener('click', () => {
            const dataSelecionada = dataRotaInput.value;
            if (!dataSelecionada) {
                alert("Por favor, select uma data para continuar.");
                return;
            }
            const d = new Date(dataSelecionada);
            const dataFormatada = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
            
            // RESET DO DIÁRIO DE BORDO COMPLETO PARA O NOVO TURNO INICIADO
            window.tripStarted = false;
            window.tripCompleted = false;
            window.odometerStart = 0;
            window.odometerStartHour = "";
            window.odometerEnd = 0;
            window.odometerEndHour = "";

            window.dataRotaSelecionada = dataFormatada;
            window.rotaIniciada = true;
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

    // O botão de buscar partida agora instrui o utilizador a usar os mesmos inputs de Código Postal
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
                localStorage.removeItem('cp_last_navigated_id');
                document.getElementById('container-mapa').classList.add('hidden');
                document.getElementById('container-rota-ordenada').classList.add('hidden');
                document.getElementById('estatisticas-rota').classList.add('hidden');
                limparMapaVisual();
                renderMoradasAdicionadas();
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

    // Escuta ativa do botão tátil de encerramento do Diário de Bordo
    if (btnFinalizarTurno) {
        btnFinalizarTurno.addEventListener('click', () => {
            abrirModalOdometroChegada();
        });
    }
}

// Wrapper local para conformidade com a assinatura original
function configurarFormatacaoPostal() {
    configurarFormatacaoCodigoPostal();
}

// ==========================================
// SINCRONIZAÇÃO DA INTERFACE DE CONFIGURAÇÃO DE TURNO
// ==========================================
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

        // Reinicia o autocomplete caso a caixa de moradas mude de estado visual
        setTimeout(inicializarAutocompleteMorada, 100);

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

// ==========================================
// CONFIGURAÇÃO DO POP-UP (MODAL) DE EDIÇÃO DE PARAGENS
// ==========================================
export function setupModaisEdicao() {
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
        const editMoradaPrioridade = document.getElementById('edit-morada-prioridade');
        if (!editMoradaTexto || !editMoradaObs) return;

        const novaMorada = editMoradaTexto.value.trim();
        const novaObs = editMoradaObs.value.trim();
        const novaPrioridade = editMoradaPrioridade ? editMoradaPrioridade.checked : false;

        if (!novaMorada) {
            alert("A morada de entrega não pode ficar em branco.");
            return;
        }

        let itemIndexPre = window.moradasEntregas.findIndex(m => m.id === itemSendoEditado.id);
        let itemIndexPos = window.rotaOtimizada.findIndex(m => m.id === itemSendoEditado.id);

        if (itemIndexPre !== -1) {
            window.moradasEntregas[itemIndexPre].address = novaMorada;
            window.moradasEntregas[itemIndexPre].observation = novaObs;
            window.moradasEntregas[itemIndexPre].priority = novaPrioridade;
        }

        if (itemIndexPos !== -1) {
            window.rotaOtimizada[itemIndexPos].address = novaMorada;
            window.rotaOtimizada[itemIndexPos].observation = novaObs;
            window.rotaOtimizada[itemIndexPos].priority = novaPrioridade;
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

    // Liga os escutadores de cliques para os botões do modal de edição
    configurarBotoesRapidosModal();
}

export function abrirModalEdicaoParagem(paragem, estaNaRotaOtimizada) {
    const modalEditarParagem = document.getElementById('modal-editar-paragem');
    const editMoradaTexto = document.getElementById('edit-morada-texto');
    const editMoradaObs = document.getElementById('edit-morada-obs');
    const editMoradaPrioridade = document.getElementById('edit-morada-prioridade');

    if (!modalEditarParagem || !editMoradaTexto || !editMoradaObs) return;

    itemSendoEditado = paragem;
    editMoradaTexto.value = paragem.address;
    editMoradaObs.value = paragem.observation || "";
    if (editMoradaPrioridade) {
        editMoradaPrioridade.checked = !!paragem.priority;
    }

    // Analisa as observações salvas no texto para acender os botões certos ao abrir o modal
    preencherSelecoesPorTexto(paragem.observation || "");
    atualizarStylesBotoesModal();

    modalEditarParagem.classList.remove('hidden');

    setTimeout(() => {
        editMoradaObs.focus();
        editMoradaObs.select();
    }, 150);
}