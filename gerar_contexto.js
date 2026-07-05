// gerar_contexto.js
const fs = require('fs');
const path = require('path');

const outputFileName = 'contexto_projeto.txt';
const filesToInclude = [
    'index.html',
    'app.js',
    'ui.js',
    'storage.js',
    'gestao.js',
    'rotas.js',
    'manifest.json',
    'sw.js',
    'config.js'
];

let outputContent = `=== CLASSICA PACK - CONTEXTO INTEGRAL DO PROJETO ===\nGerado em: ${new Date().toLocaleString()}\n\n`;

filesToInclude.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
        outputContent += `=========================================\n`;
        outputContent += `ARQUIVO: ${file}\n`;
        outputContent += `=========================================\n\n`;
        outputContent += fs.readFileSync(filePath, 'utf8');
        outputContent += `\n\n`;
    } else {
        outputContent += `=========================================\n`;
        outputContent += `ARQUIVO: ${file} (Não encontrado no diretório)\n`;
        outputContent += `=========================================\n\n`;
    }
});

fs.writeFileSync(outputFileName, outputContent, 'utf8');
console.log(`Sucesso! O ficheiro "${outputFileName}" foi gerado com todo o código do seu PWA.`);