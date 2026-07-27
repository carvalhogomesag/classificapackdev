/**
 * js/firebase-init.js
 * Faz: Centraliza as credenciais de segurança e inicializa o motor do Google Firebase (Auth e Firestore) na nossa aplicação.
 *      Lê as credenciais seguras a partir do ficheiro global 'config.js' que está protegido no .gitignore.
 * NÃO faz: Não processa lógicas de triagem ou navegação direta.
 * Depende de: Bibliotecas Firebase App Compat carregadas no index.html e do objeto FIREBASE_CONFIG do config.js.
 */

// Verifica de forma defensiva se as chaves foram devidamente carregadas do config.js
if (typeof FIREBASE_CONFIG === 'undefined' || !FIREBASE_CONFIG.apiKey) {
    console.error("[FIREBASE] ERRO CRÍTICO: As credenciais do Firebase não foram encontradas no config.js!");
}

// Inicializa a Aplicação Firebase de forma segura e síncrona
if (!firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
}

// Declaração de instâncias globais exportáveis para uso partilhado em toda a aplicação
export const auth = firebase.auth();
export const db = firebase.firestore();

// Sincroniza a persistência local offline no Firestore de forma defensiva
db.enablePersistence().catch((err) => {
    if (err.code === 'failed-precondition') {
        console.warn("[FIREBASE] A persistência offline falhou: Múltiplas abas abertas.");
    } else if (err.code === 'unimplemented') {
        console.warn("[FIREBASE] O navegador atual não suporta persistência offline.");
    }
});

console.log("[FIREBASE] Sistema em Nuvem inicializado com sucesso via config.js.");