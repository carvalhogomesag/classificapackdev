/**
 * voz.js
 * Faz: Centraliza o motor de reconhecimento de voz (Web Speech API) da aplicação num wrapper genérico, eliminando código duplicado.
 * NÃO faz: Não efetua geocodificação de moradas (maps.js) nem gere o preenchimento direto dos inputs (triagem.js / rotas.js).
 * Depende de: Nenhuns módulos (independente, usa Web Speech API nativa do navegador).
 */

/**
 * Configura e inicializa uma instância única de reconhecimento de voz para um botão específico.
 * 
 * @param {Object} config - Configurações do elemento de voz
 * @param {HTMLElement} config.btnElement - O botão principal que inicia a gravação
 * @param {HTMLElement} [config.micAtivoElement] - O ícone do microfone a pulsar (vermelho)
 * @param {HTMLElement} [config.micInativoElement] - O ícone do microfone estático (cinzento/azul)
 * @param {Array<string>} [config.activeClasses] - Classes CSS a adicionar ao botão durante a gravação
 * @param {Array<string>} [config.inactiveClasses] - Classes CSS a remover do botão durante a gravação
 * @param {Function} config.onResult - Função callback que recebe o texto transcrevido
 */
export function criarReconhecimentoVoz({
    btnElement,
    micAtivoElement,
    micInativoElement,
    onResult,
    activeClasses = ['bg-red-500', 'text-white', 'border-red-600'],
    inactiveClasses = ['bg-blue-50', 'text-blue-700', 'border-blue-200']
}) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    // Se o telemóvel ou navegador não suportar reconhecimento de voz por hardware, oculta o botão
    if (!SpeechRecognition) {
        if (btnElement) {
            btnElement.classList.add('hidden');
        }
        return null;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-PT'; // Focado em Português de Portugal
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    // Aciona a gravação com um toque no botão
    btnElement.addEventListener('click', () => {
        try {
            recognition.start();
        } catch (err) {
            console.warn("Reconhecimento de voz já está em execução:", err);
        }
    });

    recognition.onstart = () => {
        if (micAtivoElement) micAtivoElement.classList.remove('hidden');
        if (micInativoElement) micInativoElement.classList.add('hidden');
        
        // Aplica o visual vermelho de gravação ativa
        if (activeClasses && activeClasses.length) {
            btnElement.classList.add(...activeClasses);
        }
        if (inactiveClasses && inactiveClasses.length) {
            btnElement.classList.remove(...inactiveClasses);
        }
    };

    recognition.onend = () => {
        if (micAtivoElement) micAtivoElement.classList.add('hidden');
        if (micInativoElement) micInativoElement.classList.remove('hidden');

        // Devolve o visual azul/cinzento padrão
        if (activeClasses && activeClasses.length) {
            btnElement.classList.remove(...activeClasses);
        }
        if (inactiveClasses && inactiveClasses.length) {
            btnElement.classList.add(...inactiveClasses);
        }
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (onResult) {
            onResult(transcript);
        }
    };

    recognition.onerror = (event) => {
        console.error("Erro no hardware de reconhecimento de voz:", event.error);
    };

    return recognition;
}