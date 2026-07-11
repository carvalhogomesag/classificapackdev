/**
 * pwa.js
 * Faz: Gere a promoção, instruções didáticas e captação do evento de instalação do PWA em aparelhos Android (nativos) e iOS (guias passo-a-passo).
 * NÃO faz: Não regista o Service Worker (sw.js) nem gere caching de ficheiros estáticos (feito na raiz pelo sw.js).
 * Depende de: Nenhuns módulos (comunicação direta com o motor nativo do navegador).
 */

// Variável para guardar o convite de instalação automática nativo (Android/Chrome)
let deferredInstallPrompt = null;

/**
 * Deteta o dispositivo do utilizador e configura a escuta de instalação para mostrar
 * o banner inteligente de conversão.
 */
export function setupPWAInstallationLogic() {
    const banner = document.getElementById('banner-pwa-instalacao');
    const btnInstalar = document.getElementById('btn-instalar-pwa');

    if (!banner || !btnInstalar) return;

    // Deteta se o PWA já se encontra aberto em modo nativo / standalone (já instalado)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    // Se já estiver instalado e a correr fora do browser, nunca exibe o banner
    if (isStandalone) {
        banner.classList.add('hidden');
        return;
    }

    // No iPhone (iOS), como não há suporte ao evento automático, mostramos o banner de ajuda manual imediatamente
    if (isIOS) {
        banner.classList.remove('hidden');
    }

    // Ouvinte nativo para navegadores compatíveis (Android, Chrome, Samsung Internet, Edge, etc.)
    window.addEventListener('beforeinstallprompt', (e) => {
        // Previne que o prompt padrão do browser salte desordenadamente
        e.preventDefault(); 
        
        // Guarda o evento na nossa variável de estado para podermos acioná-lo com o clique do utilizador
        deferredInstallPrompt = e; 
        
        // Exibe o nosso banner amigável de instalação no topo do ecrã de Triagem
        banner.classList.remove('hidden'); 
    });

    btnInstalar.addEventListener('click', () => {
        if (isIOS) {
            // Guia didático passo-a-passo específico para iPhones (Ecrã de partilha do Safari)
            alert("Como instalar o Classifica Pack no seu iPhone:\n\n1. Toque no botão 'Partilhar' (o ícone de um quadrado com uma seta para cima, na barra inferior do Safari).\n2. Deslize a lista de opções e selecione 'Adicionar ao Ecrã Principal'.\n3. Confirme clicando em 'Adicionar' no canto superior direito.");
        } else if (deferredInstallPrompt) {
            // Dispara o pop-up nativo oficial de instalação no Android/Chrome
            deferredInstallPrompt.prompt();
            deferredInstallPrompt.userChoice.then((choiceResult) => {
                if (choiceResult.outcome === 'accepted') {
                    console.log('Utilizador aceitou e instalou o PWA com sucesso.');
                    banner.classList.add('hidden');
                }
                deferredInstallPrompt = null;
            });
        } else {
            // Fallback genérico para outros navegadores não compatíveis com prompts diretos
            alert("Como instalar:\nToque no ícone de opções (três pontos) do seu navegador e escolha 'Instalar aplicação' ou 'Adicionar ao ecrã principal'.");
        }
    });
}