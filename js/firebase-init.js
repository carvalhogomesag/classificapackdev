/**
 * js/firebase-init.js
 * Versão v76.2 - Inicializador Seguro do Firebase com Sincronização Multi-Abas
 * Faz: Centraliza as credenciais de segurança e inicializa o motor do Google Firebase (Auth e Firestore)
 *      com suporte a persistência offline multi-abas (synchronizeTabs: true) para evitar bloqueios de rede.
 * Depende de: Bibliotecas Firebase App Compat carregadas no index.html e do config.js.
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

// Sincroniza a persistência local offline no Firestore com suporte a múltiplas abas
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    if (err.code === 'failed-precondition') {
        console.warn("[FIREBASE] Persistência offline em modo de aba única.");
    } else if (err.code === 'unimplemented') {
        console.warn("[FIREBASE] O navegador atual não suporta persistência offline.");
    }
});

console.log("[FIREBASE] Motor do Firebase inicializado com sucesso e sincronização multi-abas ativa.");