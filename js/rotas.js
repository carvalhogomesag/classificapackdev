/**
 * js/rotas.js
 * Faz: Liga o ecrã de rotas ao seu servidor seguro local (porta 3000) ou servidor remoto no Render para processar os índices de ordenação ótimos.
 *      Inclui pré-geolocalização inteligente para limitar sugestões a um raio de 1km em redor do Código Postal introduzido.
 * NÃO faz: Não executa cálculos de linha reta locais (delegado à API remota da Google).
 * Depende de: ./storage.js, ./voz.js, ./maps.js
 */

import { saveData } from './storage.js';
import { criarReconhecimentoVoz } from './voz.js';
import { 
    obterEnderecoPorGPSGoogle, 
    calcularDistanciaHaversine, 
    desenharMapaGoogle, 
    limparMapaVisual 
} from './maps.js';

let itemSendoEditado = null; 
let autocompleteInstancia = null; // Guarda a instância ativa do Google Places Autocomplete

// Variáveis de estado temporárias do modal de edição (Passo 4)
let embalagemSelecionada = "";
let origemSelecionada = "";

// =========================================================================
// DETETOR INTELIGENTE DE AMBIENTE (LOCAL VS PRODUÇÃO)
// =========================================================================
const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://classificapack-backend.onrender.com'; // Link do seu Render ativo

// ==========================================
// CENTRALIZAÇÃO DA PERSISTÊNCIA DAS ROTAS
// ==========================================
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

        // 4. Constrói o objeto de morada mapeada vinda da Google
        const novaMorada = {
            id: 'm_' + Date.now() + Math.random().toString(36).substr(2, 5),
            lat: data.lat,
            lng: data.lng,
            address: data.address, // Endereço oficial mapeado pela Google
            status: "Pendente",
            observation: "",
            priority: false
        };

        // 5. Verifica se o clique anterior foi para definir o Ponto de Partida
        if (window.definindoPartidaPorMorada) {
            window.partidaLocalizacao = novaMorada;
            if (statusPartida) statusPartida.innerHTML = `<strong>Partida:</strong> ${novaMorada.address}`;
            window.definindoPartidaPorMorada = false;
            sincronizarPersistencia();
            alert("Ponto de Partida configurado com sucesso!");
        } else {
            // Caso contrário, adiciona como paragem de entrega
            window.moradasEntregas.push(novaMorada);
            renderMoradasAdicionadas();
            sincronizarPersistencia();
            abrirModalEdicaoParagem(novaMorada, false);
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
            throw new Error("O servidor local falhou ou a Google rejeitou as credenciais de teste.");
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
        } else {
            // Se a API não devolveu uma rota nova por alguma restrição, mantém a original
            window.rotaOtimizada = [...window.moradasEntregas];
            window.rotaOtimizada.forEach(p => p.distanciaDoAnterior = 0);
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
        console.error("Erro na comunicação local DEV:", err);
        alert(`Ocorreu um erro no teste: ${err.message}\n\nGaranta que iniciou o servidor no terminal escrevendo: node --env-file=.env js/dev-rotas-backend.js`);
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

        if (isLastNavigated) {
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
                        <span class="w-5 h-5 rounded-full ${statusColor} text-white font-bold text-[10px] flex items-center justify-center flex-shrink-0 transition-colors">
                            ${index + 1}
                        </span>
                        <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                            A cerca de ${paragem.distanciaDoAnterior.toFixed(2)} km
                        </span>
                        ${isLastNavigated ? `<span class="bg-blue-600 text-white text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide animate-pulse">A navegar</span>` : ''}
                        ${isPriority ? `<span class="bg-orange-500 text-white text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide animate-pulse"><i class="fa-solid fa-circle-exclamation mr-0.5"></i> Prioritária</span>` : ''}
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

        item.querySelector('.btn-navegar').onclick = () => {
            localStorage.setItem('cp_last_navigated_id', paragem.id);
            renderizarItinerarioOtimizado(); 
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
// PAINEL DE ESTATÍSTICAS DA ROTA ATIVA
// ==========================================
export function renderEstatisticasRota() {
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

// =========================================================================
// AUXILIARES DO PREFIXO RÁPIDO E DA FORMATAÇÃO DO CÓDIGO POSTAL
// =========================================================================
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

// =========================================================================
// NOVO: ESCUTA INTELIGENTE DE CÓDIGO POSTAL PARA REDUZIR AUTOCOMPLETE A 1KM
// =========================================================================
function configurarEscutaCodigoPostalParaLimites() {
    const inputCP = document.getElementById('rota-codigo-postal');
    if (!inputCP) return;

    inputCP.addEventListener('input', async () => {
        const valor = inputCP.value.trim();
        const padraoCP = /^\d{4}-\d{3}$/;

        // Se o campo de Código Postal for limpo pelo utilizador
        if (valor.length === 0 && autocompleteInstancia) {
            // Repõe o limite geográfico padrão alargado de 15km de Mafra
            const centroMafra = { lat: 38.9369, lng: -9.3282 };
            const circuloMafra = new google.maps.Circle({ center: centroMafra, radius: 15000 });
            autocompleteInstancia.setBounds(circuloMafra.getBounds());
            autocompleteInstancia.setOptions({ strictBounds: false });
            console.log("[PWA] Autocomplete reposto para o limite geral de Mafra (15km).");
            return;
        }

        // Se detetar que o utilizador digitou um Código Postal de 7 dígitos válido (ex: 2640-601)
        if (padraoCP.test(valor)) {
            console.log(`[PWA] Detetado CP de 7 dígitos completo: ${valor}. A pré-geolocalizar para mira laser...`);

            try {
                // Pergunta de forma silenciosa ao Render quais as coordenadas desse CP
                const response = await fetch(`${API_BASE_URL}/api/geocode`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ postalCode: valor })
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data && data.lat && data.lng && autocompleteInstancia) {
                        const centroCP = { lat: data.lat, lng: data.lng };
                        
                        // Define um círculo ultra-fechado de apenas 1000 metros (1 km)
                        const circuloCP = new google.maps.Circle({ center: centroCP, radius: 1000 });
                        
                        // Aplica as novas fronteiras ao autocomplete
                        autocompleteInstancia.setBounds(circuloCP.getBounds());
                        // Mantemos o strictBounds como false para tolerar pequenos desvios de divisões administrativas da Google,
                        // mas com prioridade (bias) máxima focada a 1km, tornando as sugestões locais perfeitas.
                        autocompleteInstancia.setOptions({ strictBounds: false });
                        
                        console.log(`[PWA] Autocomplete focado com raio laser de 1km em redor de: ${data.address}`);
                    }
                }
            } catch (erro) {
                console.warn("[PWA] Erro na pré-geolocalização para limites de 1km:", erro);
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

// =========================================================================
// SISTEMA DE BOTÕES TÁTEIS RÁPIDOS PARA O MODAL (PASSO 4)
// =========================================================================

/**
 * Atualiza o texto da caixa de observações com base nas tags selecionadas.
 */
function atualizarTextoObservacoesAutomatico() {
    const textareaObs = document.getElementById('edit-morada-obs');
    if (!textareaObs) return;

    const partes = [];
    if (embalagemSelecionada) partes.push(embalagemSelecionada);
    if (origemSelecionada) partes.push(origemSelecionada);

    // Junta as partes com um espaço (ex: "Envelope Amazon")
    textareaObs.value = partes.join(" ");
}

/**
 * Altera visualmente a cor dos botões (de cinzento para azul) consoante a seleção ativa.
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
            
            atualizarEstilosBotoesModal();
            atualizarTextoObservacoesAutomatico();
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
            
            atualizarEstilosBotoesModal();
            atualizarTextoObservacoesAutomatico();
        });
    });
}

// ==========================================
// CONFIGURAÇÃO DO MENU E CONTROLOS DE TURNOS
// ==========================================
export function setupRotasLogic() {
    const btnIniciarRota = document.getElementById('btn-iniciar-rota');
    const dataRotaInput = document.getElementById('data-rota');
    const btnEncerrarRota = document.getElementById('btn-encerrar-rota');
    const btnGpsPartida = document.getElementById('btn-gps-partida');
    const btnBuscarPartida = document.getElementById('btn-buscar-partida');
    const btnLimparEnderecos = document.getElementById('btn-limpar-enderecos');
    const btnOtimizarRota = document.getElementById('btn-otimizar-rota');
    const statusPartida = document.getElementById('status-partida');

    // Novos elementos do formulário de Código Postal
    const btnAdicionarPostal = document.getElementById('btn-adicionar-postal-rota');

    const btnPlaneamento = document.getElementById('btn-modo-planeamento');
    const btnConducao = document.getElementById('btn-modo-conducao');

    // Inicialização da nova lógica de assistência ao teclado para o Código Postal
    configurarEventosPrefixoRapido();
    configurarFormatacaoCodigoPostal();
    inicializarAutocompleteMorada();
    
    // NOVO: Liga a escuta dinâmica do Código Postal para mudar o raio de sugestões para 1km
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
                localStorage.removeItem('cp_last_navigated_id');
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

    // Analisa as observações salvas no texto para acender os botões certos ao abrir o modal (Passo 4)
    preencherSelecoesPorTexto(paragem.observation || "");
    atualizarEstilosBotoesModal();

    modalEditarParagem.classList.remove('hidden');

    setTimeout(() => {
        editMoradaObs.focus();
        editMoradaObs.select();
    }, 150);
}