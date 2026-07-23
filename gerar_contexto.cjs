/**
 * gerar_contexto.cjs
 * Faz: Junta o conteúdo de todos os ficheiros do projeto "Classifica Pack" num único documento txt de contexto.
 *      Percorre dinamicamente as pastas /js/ (procurando ficheiros .js) e /partials/ (procurando ficheiros .html).
 * NÃO faz: Não expõe a chave privada Google Maps API Key do ficheiro config.js (oculta-a por segurança).
 * Depende de: Node.js (Ambiente de execução local).
 */

const fs = require('fs');
const path = require('path');

const outputFileName = 'contexto_projeto.txt';

// 1. Ficheiros estáticos obrigatórios localizados na raiz do projeto
const staticRootFiles = [
    'index.html',
    'manifest.json',
    'sw.js',
    'config.js'
];

/**
 * Função auxiliar que lê dinamicamente uma pasta e devolve o caminho relativo
 * de todos os ficheiros que coincidem com o filtro de extensão pretendido.
 */
function obterFicheirosDePastaDinamica(pastaRelativa, regexFiltro) {
    const caminhoPasta = path.join(__dirname, pastaRelativa);
    
    // Se a pasta não existir no diretório, devolve uma lista vazia de forma segura
    if (!fs.existsSync(caminhoPasta)) {
        return [];
    }

    try {
        return fs.readdirSync(caminhoPasta)
            .filter(nomeFicheiro => {
                const caminhoCompleto = path.join(caminhoPasta, nomeFicheiro);
                // Garante que é um ficheiro (e não uma subpasta) e bate certo com a extensão (ex: .js ou .html)
                return fs.statSync(caminhoCompleto).isFile() && regexFiltro.test(nomeFicheiro);
            })
            // Devolve o caminho formatado (ex: "js/main.js" ou "partials/rotas.html")
            .map(nomeFicheiro => path.join(pastaRelativa, nomeFicheiro).replace(/\\/g, '/'));
    } catch (erro) {
        console.warn(`[AVISO] Não foi possível ler a pasta dinâmica "${pastaRelativa}":`, erro.message);
        return [];
    }
}

// 2. Procura dinamicamente por todos os ficheiros .js na pasta /js/
const ficheirosJsDinamicos = obterFicheirosDePastaDinamica('js', /\.js$/i);

// 3. Procura dinamicamente por todos os ficheiros .html na pasta /partials/
const ficheirosPartialsDinamicos = obterFicheirosDePastaDinamica('partials', /\.html$/i);

// 4. Junta as listas numa única sequência lógica de processamento
const todosOsFicheiros = [
    ...staticRootFiles,
    ...ficheirosJsDinamicos,
    ...ficheirosPartialsDinamicos
];

let outputContent = `=== CLASSICA PACK - CONTEXTO INTEGRAL DO PROJETO ===\nGerado em: ${new Date().toLocaleString()}\n\n`;

todosOsFicheiros.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
        outputContent += `=========================================\n`;
        outputContent += `ARQUIVO: ${file}\n`;
        outputContent += `=========================================\n\n`;
        
        let fileContent = fs.readFileSync(filePath, 'utf8');
        
        // Se for o ficheiro config.js (ou o seu caminho relativo), oculta a chave de API por segurança
        if (file === 'config.js' || file.endsWith('config.js')) {
            // Esta Regex identifica GOOGLE_MAPS_API_KEY seguido de aspas (simples ou duplas) e oculta o valor real
            fileContent = fileContent.replace(
                /(GOOGLE_MAPS_API_KEY\s*=\s*['"])[^'"]*(['"])/g, 
                '$1[CHAVE_OCULTADA_POR_SEGURANCA]$2'
            );
        }
        
        outputContent += fileContent;
        outputContent += `\n\n`;
    } else {
        // Mantém a indicação visual caso um ficheiro estático da raiz esperado não exista
        outputContent += `=========================================\n`;
        outputContent += `ARQUIVO: ${file} (Não encontrado no diretório)\n`;
        outputContent += `=========================================\n\n`;
    }
});

// Escreve o ficheiro final consolidado pronto a colar
fs.writeFileSync(outputFileName, outputContent, 'utf8');
console.log(`Sucesso! O ficheiro "${outputFileName}" foi gerado dinamicamente com as pastas /js e /partials inclusas.`);
