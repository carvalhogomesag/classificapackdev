import { setupNavigation, showTab } from './ui.js';
import { renderDrivers, handleDriverSubmit } from './gestao.js';
import { inicializarGoogleAutocomplete, desenharMapaGoogle, calcularDistanciaHaversine } from './rotas.js';

// Variáveis Globais
window.drivers = JSON.parse(localStorage.getItem('cp_drivers')) || [];
window.assignments = JSON.parse(localStorage.getItem('cp_assignments')) || [];
window.selectedColor = "#2563EB";

document.addEventListener('DOMContentLoaded', () => {
    // Configurações Globais
    setupNavigation(showTab);
    
    // Motoristas
    const formMotorista = document.getElementById('form-motorista');
    if(formMotorista) {
        formMotorista.addEventListener('submit', (e) => {
            handleDriverSubmit(e, window.drivers, window.selectedColor, () => renderDrivers(window.drivers, document.getElementById('lista-motoristas'), window.deleteDriver));
        });
    }

    // Google Maps Loader
    carregarGoogleMapsScript();
});

function carregarGoogleMapsScript() {
    if (typeof google !== 'undefined') return;
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
    script.async = true;
    script.onload = () => inicializarGoogleAutocomplete((m) => { /* lógica de adicionar morada */ });
    document.head.appendChild(script);
}

// Exportar funções globais para o window (necessário para os botões onclick do HTML)
window.deleteDriver = (id) => {
    window.drivers = window.drivers.filter(d => d.id !== id);
    renderDrivers(window.drivers, document.getElementById('lista-motoristas'), window.deleteDriver);
};