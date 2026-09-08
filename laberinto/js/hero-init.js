// Externo por la CSP de producción: script-src 'self' sin 'unsafe-inline'.
import { initHeroScene } from '../../js/3d/hero-scene.js';
import { buildMaze } from '../../js/3d/geo-builders.js';

initHeroScene('hero-canvas', {
    color: 0xffa24b,
    particleCount: 1200,
    iconBuilder: buildMaze,
    // La placa del laberinto es más ancha que los íconos de los otros
    // productos, así que se corre a la derecha respecto del -5.6 que usan
    // ellos: en -5.6 la vuelta exterior del espiral se salía por el borde.
    iconScale: 1.05,
    iconOffset: { x: -4.85, y: 2.55, z: -1 },
});
