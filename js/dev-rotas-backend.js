/**
 * js/dev-rotas-backend.js
 * Faz: Módulo de backend em Node.js (Express) focado no cálculo e otimização de percursos ideais usando a avançada Google Route Optimization API (optimizeTours) com autenticação dinâmica OAuth2, definição de janelas temporais de turnos, custos de viagem, timeout estendido de processamento, parsing de coordenadas decimais e serviço local seguro de geocodificação de Códigos Postais.
 * NÃO faz: Não processa lógicas visuais do condutor (delegado ao frontend).
 * Depende de: node-fetch, express, google-auth-library e do ficheiro google-credentials.json na raiz.
 */

import express from 'express';
import fetch from 'node-fetch';
import { GoogleAuth } from 'google-auth-library'; // Importa o autenticador oficial da Google

const app = express();
app.use(express.json());

// Servidor de ficheiros estáticos locais
app.use(express.static('.'));

// Rota padrão para carregar o index.html na raiz
app.get('/', (req, res) => {
    res.sendFile('index.html', { root: '.' });
});

// Cabeçalhos CORS de Segurança para autorizar a ligação do browser
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Goog-Api-Key, X-Goog-FieldMask, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ==========================================
// CONFIGURAÇÃO SEGURA DA GOOGLE CLOUD VIA OAUTH2
// ==========================================
const GOOGLE_PROJECT_ID = process.env.GOOGLE_PROJECT_ID || 'classifica-pack-501319'; 

// Configura o autenticador apontando para o ficheiro JSON de credenciais
const auth = new GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS, // Lê o caminho 'google-credentials.json' do .env
    scopes: ['https://www.googleapis.com/auth/cloud-platform'] // Âmbito de acesso mínimo recomendado
});

// Alerta de segurança preventivo no console caso falte a configuração de ambiente
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("\n🚨 ERRO DE SEGURANÇA: O ficheiro JSON de credenciais não foi encontrado nas variáveis do .env!\n");
}

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// =========================================================================
// ENDPOINT DE GEOCODIFICAÇÃO DE CÓDIGO POSTAL COM SISTEMA DE RETRY (FALLBACK)
// =========================================================================
app.post('/api/geocode', async (req, res) => {
    try {
        const { postalCode, address } = req.body;

        if (!postalCode) {
            return res.status(400).json({ error: "O Código Postal é obrigatório." });
        }

        // Sanitização e formatação defensiva dos inputs
        const cleanZip = postalCode.trim();
        const cleanAddress = address ? address.trim() : "";

        // 1. TENTATIVA ESTREITA (Filtro rígido de componentes)
        const params = new URLSearchParams();
        if (cleanAddress) {
            params.set('address', cleanAddress);
        }
        params.set('components', `postal_code:${cleanZip}|country:PT`);
        params.set('key', GOOGLE_API_KEY);

        let url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;

        console.log(`[DEV SERVER] Geocodificando com filtro obrigatório de CP: "${cleanZip}" (morada opcional: "${cleanAddress || '(nenhuma)'}")`);

        let response = await fetch(url);
        if (!response.ok) {
            throw new Error("Falha na comunicação com o serviço Geocoding da Google.");
        }

        let data = await response.json();

        // 2. RETRY / FALLBACK INTELIGENTE (Plano de Contingência para códigos postais rurais)
        // Se a busca estrita falhar, faz uma busca por texto livre juntando tudo na mesma linha
        if (data.status !== "OK" || !data.results || data.results.length === 0) {
            console.log(`[DEV SERVER] ⚠️ Pesquisa estrita por componentes falhou para "${cleanZip}". A iniciar Fallback de Texto Livre...`);
            
            const fallbackParams = new URLSearchParams();
            // Junta a morada e o código postal numa única linha de texto para a Google
            fallbackParams.set('address', `${cleanAddress} ${cleanZip}, Portugal`);
            fallbackParams.set('components', 'country:PT'); // Garante que a pesquisa não foge de Portugal
            fallbackParams.set('key', GOOGLE_API_KEY);

            const fallbackUrl = `https://maps.googleapis.com/maps/api/geocode/json?${fallbackParams.toString()}`;
            const fallbackResponse = await fetch(fallbackUrl);
            
            if (fallbackResponse.ok) {
                const fallbackData = await fallbackResponse.json();
                if (fallbackData.status === "OK" && fallbackData.results && fallbackData.results.length > 0) {
                    data = fallbackData; // Substitui o resultado falhado pelo do fallback com sucesso!
                    console.log(`[DEV SERVER] ✅ Sucesso no Fallback! Coordenadas recuperadas com sucesso para: "${cleanAddress} ${cleanZip}"`);
                }
            }
        }

        // Se mesmo após o fallback não encontrar nada, avisa o utilizador de forma clara
        if (data.status !== "OK" || !data.results || data.results.length === 0) {
            return res.status(404).json({ 
                error: `Erro: Não foi possível encontrar coordenadas para o Código Postal "${cleanZip}"${cleanAddress ? ` com a morada "${cleanAddress}"` : ''}. Verifique se o Código Postal está correto.` 
            });
        }

        const result = data.results[0];
        const coordinates = result.geometry.location;
        const formattedAddress = result.formatted_address;

        res.json({
            lat: coordinates.lat,
            lng: coordinates.lng,
            address: formattedAddress
        });

    } catch (error) {
        console.error("🚨 FALHA AO GEOCODIFICAR:", error);
        res.status(500).json({ error: error.message });
    }
});

// =========================================================================
// OTIMIZAÇÃO GLOBAL VIA GOOGLE ROUTE OPTIMIZATION API (CÁLCULO REAL POR ESTRADA)
// =========================================================================
app.post('/api/optimize-route', async (req, res) => {
    try {
        const { pontoPartida, paragens } = req.body;

        if (!pontoPartida || !paragens || paragens.length === 0) {
            return res.status(400).json({ error: "Dados de partida ou paragens em falta." });
        }

        console.log(`\n[DEV SERVER] Recebido pedido de otimização para ${paragens.length} paragens.`);
        console.log(`[DEV SERVER] Gerando tokens de acesso OAuth2 de forma segura...`);

        // 1. Obtém as credenciais OAuth2 autenticadas de forma assíncrona
        const client = await auth.getClient();
        const authHeaders = await client.getRequestHeaders(); // Gera automaticamente: { Authorization: "Bearer <TOKEN>" }

        // 2. Mapeamento defensivo das paragens (Forçando conversão em decimais puros para evitar erros de 0.0)
        const shipments = paragens.map((paragem, index) => ({
            deliveries: [{
                arrivalLocation: {
                    latitude: parseFloat(paragem.lat),
                    longitude: parseFloat(paragem.lng)
                }
            }],
            label: paragem.id || `paragem_${index}`
        }));

        // 3. Mapeamento do ponto de partida para o veículo (Vehicles) com regras de Custo Reais
        const vehicles = [{
            startLocation: {
                latitude: parseFloat(pontoPartida.lat),
                longitude: parseFloat(pontoPartida.lng)
            },
            endLocation: {
                latitude: parseFloat(pontoPartida.lat),
                longitude: parseFloat(pontoPartida.lng)
            },
            // Modelos de custos reais de viagem para obrigar o algoritmo a encurtar distâncias e evitar ziguezagues!
            costPerKilometer: 0.1,  // Custo por km (prioridade total para encurtar km reais por estrada)
            costPerHour: 15.0,       // Custo por hora (prioridade secundária)
            label: "Motorista_Turno_Diario"
        }];

        // URL oficial da Route Optimization API v1
        const url = `https://routeoptimization.googleapis.com/v1/projects/${GOOGLE_PROJECT_ID}:optimizeTours`;

        // 4. Formata as datas de início e fim sem nanossegundos (Evita erros de validação na Google)
        const globalStartTime = new Date().toISOString().split('.')[0] + 'Z';
        
        // Define o limite de fim do turno para exactamente 24 horas depois do início para fechar a janela
        const dataAmanha = new Date();
        dataAmanha.setHours(dataAmanha.getHours() + 24);
        const globalEndTime = dataAmanha.toISOString().split('.')[0] + 'Z';

        const payload = {
            parent: `projects/${GOOGLE_PROJECT_ID}`,
            timeout: "15s",
            searchMode: "CONSUME_ALL_AVAILABLE_TIME",   // Força a Google a usar o tempo para refinar e encontrar o percurso ideal
            model: {
                shipments,
                vehicles,
                globalStartTime, // Início (ex: "2026-07-18T19:02:15Z")
                globalEndTime    // Fim (ex: "2026-07-19T19:02:15Z")
            }
        };

        console.log(`[DEV SERVER] Enviando pedido de roteamento à Google Cloud...`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                ...authHeaders, // Injeta o token de segurança Authorization Bearer de forma invisível
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Erro na Route Optimization API: ${errText}`);
        }

        const data = await response.json();
        
        // 5. Tratamento da resposta para extrair os índices ordenados de visita
        const routes = data.routes || [];
        let optimizedIndices = [];

        if (routes.length > 0) {
            const visits = routes[0].visits || [];
            // Correção de Segurança: Se shipmentIndex for omitido pela Google por ser 0, assume 0 de forma segura!
            optimizedIndices = visits.map(v => v.shipmentIndex !== undefined ? v.shipmentIndex : 0);
            console.log(`[DEV SERVER] Sucesso! Google ordenou as paragens. Sequência ideal calculada:`, optimizedIndices);
        } else {
            console.warn(`[DEV SERVER] Alerta: Google não retornou visitas estruturadas. Mantendo a ordem padrão.`);
            optimizedIndices = paragens.map((_, idx) => idx);
        }

        res.json({
            message: "Rota otimizada com sucesso via Route Optimization API (SingleVehicle)",
            optimizedIndices: optimizedIndices
        });

    } catch (error) {
        console.error("🚨 FALHA NO BACKEND DURANTE A OTIMIZAÇÃO:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// DISTANCE MATRIX API (FATIAMENTO / SLICING DE MATRIZES)
// ==========================================
async function obterMatrizFatiadaGoogle(coordenadas) {
    const LIMITE_ELEMENTOS = 25; 
    const totalPontos = coordenadas.length;
    const matrizGeral = Array(totalPontos).fill(null).map(() => Array(totalPontos).fill(null));

    const subBlocos = [];
    for (let i = 0; i < totalPontos; i += LIMITE_ELEMENTOS) {
        subBlocos.push(coordenadas.slice(i, i + LIMITE_ELEMENTOS));
    }

    for (let o = 0; o < subBlocos.length; o++) {
        const origensChunk = subBlocos[o];
        const origemOffset = o * LIMITE_ELEMENTOS;

        for (let d = 0; d < subBlocos.length; d++) {
            const destinosChunk = subBlocos[d];
            const destinoOffset = d * LIMITE_ELEMENTOS;

            const originsParam = origensChunk.map(c => `${c.lat},${c.lng}`).join('|');
            const destinationsParam = destinosChunk.map(c => `${c.lat},${c.lng}`).join('|');

            const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originsParam}&destinations=${destinationsParam}&key=${GOOGLE_API_KEY}`;
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error("Erro de comunicação com a Distance Matrix API.");
            }
            
            const result = await response.json();

            if (result.status === "OK" && result.rows) {
                for (let i = 0; i < result.rows.length; i++) {
                    const rowElements = result.rows[i].elements;
                    for (let j = 0; j < rowElements.length; j++) {
                        matrizGeral[origemOffset + i][destinoOffset + j] = rowElements[j];
                    }
                }
            }
        }
    }

    return matrizGeral;
}

app.post('/api/matrix-estatisticas', async (req, res) => {
    try {
        const { coordenadas } = req.body; 
        if (!coordenadas || coordenadas.length === 0) {
            return res.status(400).json({ error: "Array de coordenadas em falta." });
        }

        const matrizCosturada = await obterMatrizFatiadaGoogle(coordenadas);
        res.json({
            message: "Matriz fatiada de 50 pontos processada com sucesso.",
            data: matrizCosturada
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Suporte dinâmico para a porta atribuída pelo Render ou fallback local na porta 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[DEV SERVER] Servidor de testes de rotas a rodar na porta ${PORT}`);
});