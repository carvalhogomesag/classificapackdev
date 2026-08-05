/**
 * js/navigation.js
 * Faz: Gere a preferência de navegação do motorista (Google Maps ou Waze) 
 *      e abre o link correspondente para a geolocalização da paragem.
 * Depende de: localStorage do browser.
 */

// Retorna o navegador preferido ("google" ou "waze"). Padrão: "google"
export function obterNavegadorPreferido() {
    return localStorage.getItem('cp_preferred_navigator') || 'google';
}

// Guarda a preferência de navegação
export function definirNavegadorPreferido(nav) {
    if (nav === 'google' || nav === 'waze') {
        localStorage.setItem('cp_preferred_navigator', nav);
        console.log(`[NAVIGATION] Navegador padrão alterado para: ${nav}`);
    }
}

/**
 * Abre a navegação externa para uma determinada paragem com base na preferência do utilizador.
 * @param {Object} paragem - Objeto contendo lat, lng e address
 */
export function abrirNavegacao(paragem) {
    if (!paragem || typeof paragem.lat === 'undefined' || typeof paragem.lng === 'undefined') {
        alert("Erro: Coordenadas de navegação inválidas para esta paragem.");
        return;
    }

    const navPreferido = obterNavegadorPreferido();
    let url = "";

    if (navPreferido === 'waze') {
        // Formato oficial do Waze para coordenadas
        url = `https://www.waze.com/ul?ll=${paragem.lat},${paragem.lng}&navigate=yes`;
        console.log("[NAVIGATION] A abrir via Waze:", url);
    } else {
        // Formato oficial do Google Maps por omissão
        url = `https://www.www.google.com/maps/dir/?api=1&destination=${paragem.lat},${paragem.lng}&travelmode=driving`;
        // Fallback limpo caso o url anterior tenha duplicado o www
        url = `https://www.google.com/maps/dir/?api=1&destination=${paragem.lat},${paragem.lng}&travelmode=driving`;
        console.log("[NAVIGATION] A abrir via Google Maps:", url);
    }

    window.open(url, '_blank');
}