// ============================================================
//  MGGX GAMES — Constructores de geometría procedural
//  Alternativa 100% en código a modelar en Blender: cada función
//  arma un THREE.Group combinando primitivas (cajas, cilindros,
//  toros, tubos con curvas) en vez de cargar un .glb binario.
//  Ventajas: sin assets binarios que versionar, totalmente
//  editable por parámetros, tamaño mínimo (no hay descarga de
//  malla), y cero dependencia de herramientas externas de 3D.
// ============================================================

import * as THREE from '../../vendor/three/three.module.min.js';

const MAT_CACHE = new Map();

/** Material estándar cacheado por color+propiedades para no duplicar instancias. */
function stdMat(color, { roughness = 0.55, metalness = 0.35, emissive = null, emissiveIntensity = 1 } = {}) {
    const key = `${color}|${roughness}|${metalness}|${emissive}|${emissiveIntensity}`;
    if (MAT_CACHE.has(key)) return MAT_CACHE.get(key);
    const mat = new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness,
        emissive: emissive ?? 0x000000,
        emissiveIntensity,
    });
    MAT_CACHE.set(key, mat);
    return mat;
}

function mesh(geo, mat, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, castShadow = true, receiveShadow = true } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = castShadow;
    m.receiveShadow = receiveShadow;
    return m;
}

// ------------------------------------------------------------
// SURTIDOR DE NAFTA (gas pump) — cuerpo, pantalla, manguera curva,
// pistola/nozzle animable por separado (se devuelve como referencia).
// ------------------------------------------------------------
export function buildGasPump({ accent = 0xffa500 } = {}) {
    const group = new THREE.Group();
    group.name = 'gas-pump';

    const bodyMat = stdMat(0x2e2e2e, { roughness: 0.32, metalness: 0.55 });
    const accentMat = stdMat(accent, { roughness: 0.28, metalness: 0.2, emissive: accent, emissiveIntensity: 0.5 });
    const screenMat = stdMat(0x0a0a0a, { roughness: 0.2, metalness: 0.1, emissive: accent, emissiveIntensity: 1.1 });
    const metalMat = stdMat(0x9a9a9a, { roughness: 0.22, metalness: 0.85 });

    // Base
    const base = mesh(new THREE.BoxGeometry(1.3, 0.15, 0.8), stdMat(0x3a3a3a, { roughness: 0.55 }), { y: 0.075 });
    group.add(base);

    // Cuerpo principal
    const body = mesh(new THREE.BoxGeometry(1.0, 1.9, 0.6), bodyMat, { y: 1.1 });
    group.add(body);

    // Franja de acento vertical
    const stripe = mesh(new THREE.BoxGeometry(1.02, 1.9, 0.08), accentMat, { y: 1.1, z: 0.27 });
    group.add(stripe);

    // Pantalla digital (precio)
    const screen = mesh(new THREE.BoxGeometry(0.7, 0.42, 0.05), screenMat, { y: 1.75, z: 0.33 });
    group.add(screen);

    // Techo/cornisa
    const roof = mesh(new THREE.BoxGeometry(1.25, 0.1, 0.75), metalMat, { y: 2.15 });
    group.add(roof);

    // Panel de botones
    const panel = mesh(new THREE.BoxGeometry(0.55, 0.5, 0.06), stdMat(0x333333, { roughness: 0.5 }), { y: 1.05, z: 0.33 });
    group.add(panel);
    for (let i = 0; i < 4; i++) {
        const btn = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 12), accentMat, {
            x: -0.18 + (i % 2) * 0.36,
            y: 1.18 - Math.floor(i / 2) * 0.24,
            z: 0.37,
            rx: Math.PI / 2,
        });
        group.add(btn);
    }

    // Soporte lateral de manguera
    const hook = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 10), metalMat, { x: 0.55, y: 1.5, z: 0, rz: Math.PI / 2 });
    group.add(hook);

    // Manguera: curva tipo Catmull-Rom extruida en tubo
    const hoseCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.62, 1.5, 0),
        new THREE.Vector3(0.9, 1.2, 0.15),
        new THREE.Vector3(0.75, 0.7, 0.35),
        new THREE.Vector3(0.55, 0.35, 0.55),
        new THREE.Vector3(0.4, 0.15, 0.7),
    ]);
    const hoseGeo = new THREE.TubeGeometry(hoseCurve, 32, 0.035, 8, false);
    const hose = mesh(hoseGeo, stdMat(0x111111, { roughness: 0.8, metalness: 0.1 }));
    group.add(hose);

    // Pistola/nozzle (grupo aparte para poder animarlo con un "squeeze")
    const nozzle = new THREE.Group();
    nozzle.name = 'nozzle';
    nozzle.position.set(0.4, 0.15, 0.7);
    const nozzleBody = mesh(new THREE.BoxGeometry(0.22, 0.09, 0.09), metalMat, { x: 0.08 });
    const nozzleGrip = mesh(new THREE.BoxGeometry(0.08, 0.16, 0.08), stdMat(0x1a1a1a, { roughness: 0.7 }), { x: -0.02, y: -0.09 });
    const nozzleTip = mesh(new THREE.ConeGeometry(0.035, 0.12, 10), metalMat, { x: 0.22, rz: -Math.PI / 2 });
    const nozzleTrigger = mesh(new THREE.BoxGeometry(0.03, 0.07, 0.06), accentMat, { x: 0.0, y: -0.02 });
    nozzleTrigger.name = 'nozzle-trigger';
    nozzle.add(nozzleBody, nozzleGrip, nozzleTip, nozzleTrigger);
    group.add(nozzle);

    group.userData.nozzle = nozzle;
    group.userData.screen = screen;
    group.userData.stripe = stripe;
    return group;
}

// ------------------------------------------------------------
// AUTO estilizado low-poly (para animación de tráfico ambiente)
// ------------------------------------------------------------
export function buildCar({ color = 0xcccccc } = {}) {
    const group = new THREE.Group();
    group.name = 'car';

    const bodyMat = stdMat(color, { roughness: 0.35, metalness: 0.55 });
    const glassMat = stdMat(0x111820, { roughness: 0.1, metalness: 0.8 });
    const wheelMat = stdMat(0x0c0c0c, { roughness: 0.9, metalness: 0.1 });
    const lightMat = stdMat(0xffe9a8, { roughness: 0.2, metalness: 0.1, emissive: 0xffcc55, emissiveIntensity: 1.2 });

    const chassis = mesh(new THREE.BoxGeometry(1.9, 0.35, 0.85), bodyMat, { y: 0.35 });
    const cabin = mesh(new THREE.BoxGeometry(1.0, 0.34, 0.78), glassMat, { x: -0.1, y: 0.68 });
    group.add(chassis, cabin);

    const wheelGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.2, 16);
    const wheelPositions = [
        [0.65, 0.22, 0.45], [0.65, 0.22, -0.45],
        [-0.65, 0.22, 0.45], [-0.65, 0.22, -0.45],
    ];
    for (const [x, y, z] of wheelPositions) {
        group.add(mesh(wheelGeo, wheelMat, { x, y, z, rx: Math.PI / 2 }));
    }

    group.add(mesh(new THREE.BoxGeometry(0.08, 0.12, 0.7), lightMat, { x: 0.93, y: 0.4 }));
    group.userData.wheels = wheelPositions.length;
    return group;
}

// ------------------------------------------------------------
// LOGO 3D — extrusión low-poly de un icosaedro deformado, usado
// como pieza central flotante en la home.
// ------------------------------------------------------------
export function buildOrb({ color = 0xffa500, detail = 1 } = {}) {
    const geo = new THREE.IcosahedronGeometry(1, detail);
    const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.25,
        metalness: 0.65,
        emissive: color,
        emissiveIntensity: 0.15,
        flatShading: true,
    });
    const wireMat = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.18 });
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geo, mat));
    group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, detail), wireMat));
    return group;
}

// ------------------------------------------------------------
// Iconos flotantes por producto — geometría simple y reconocible.
// ------------------------------------------------------------
export function buildChatBubble({ color = 0x3ddc84 } = {}) {
    const group = new THREE.Group();
    const bodyMat = stdMat(color, { roughness: 0.3, metalness: 0.25, emissive: color, emissiveIntensity: 0.25 });
    group.add(mesh(new THREE.SphereGeometry(0.55, 24, 16), bodyMat));
    const tail = mesh(new THREE.ConeGeometry(0.18, 0.35, 4), bodyMat, { x: -0.35, y: -0.5, rz: Math.PI + 0.5 });
    group.add(tail);
    const dotMat = stdMat(0x0a0a0a, { roughness: 0.4 });
    for (let i = -1; i <= 1; i++) group.add(mesh(new THREE.SphereGeometry(0.07, 10, 10), dotMat, { x: i * 0.22, z: 0.5 }));
    return group;
}

export function buildBook({ color = 0xffa500 } = {}) {
    const group = new THREE.Group();
    const coverMat = stdMat(color, { roughness: 0.4, metalness: 0.15, emissive: color, emissiveIntensity: 0.2 });
    const pagesMat = stdMat(0xf2ead8, { roughness: 0.9, metalness: 0 });
    group.add(mesh(new THREE.BoxGeometry(0.9, 1.2, 0.15), coverMat));
    group.add(mesh(new THREE.BoxGeometry(0.78, 1.06, 0.12), pagesMat, { z: 0.01 }));
    for (let i = -2; i <= 2; i++) {
        group.add(mesh(new THREE.BoxGeometry(0.78, 0.02, 0.13), stdMat(0xd8cba8, { roughness: 0.9 }), { y: i * 0.2, z: 0.015 }));
    }
    return group;
}

export function buildMousePointer({ color = 0xffa500 } = {}) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0, -1.62);
    shape.lineTo(0.40, -1.28);
    shape.lineTo(0.70, -2.02);
    shape.lineTo(1.00, -1.90);
    shape.lineTo(0.70, -1.16);
    shape.lineTo(1.16, -1.16);
    shape.closePath();

    const group = new THREE.Group();

    const bodyGeo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.26,
        bevelEnabled: true,
        bevelThickness: 0.04,
        bevelSize: 0.04,
        bevelSegments: 3,
    });
    bodyGeo.center();
    const bodyMat = stdMat(color, { roughness: 0.22, metalness: 0.45, emissive: color, emissiveIntensity: 0.45 });
    group.add(mesh(bodyGeo, bodyMat));

    // Sin malla de contorno: la versión anterior extruía una segunda
    // silueta negra un 14% más grande detrás del cuerpo, incrustada en
    // su mitad trasera (z-fighting) y que además, al rotar el ícono
    // 180°, tapaba por completo al cuerpo — el puntero se veía negro de
    // atrás y naranja de frente, o sea el "parpadeo" reportado. El bisel
    // y el emisivo del propio cuerpo ya dan la definición necesaria
    // sobre el fondo oscuro, desde cualquier ángulo de rotación.

    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide });
    const ring = mesh(new THREE.RingGeometry(0.5, 0.56, 40), ringMat, { x: -0.58, y: 0.95, z: 0.3 });
    group.add(ring);
    const ring2 = mesh(new THREE.RingGeometry(0.72, 0.76, 40), ringMat, { x: -0.58, y: 0.95, z: 0.3 });
    group.add(ring2);

    return group;
}

export function buildMedicCross({ color = 0x7ac74f } = {}) {
    const group = new THREE.Group();

    const cubeMat = stdMat(0x6b4a2b, { roughness: 0.75, metalness: 0.05 });
    const grassMat = stdMat(color, { roughness: 0.55, metalness: 0.1, emissive: color, emissiveIntensity: 0.18 });
    group.add(mesh(new THREE.BoxGeometry(0.95, 0.75, 0.95), cubeMat, { y: -0.12 }));
    group.add(mesh(new THREE.BoxGeometry(0.97, 0.22, 0.97), grassMat, { y: 0.36 }));

    const arm = 0.62, thick = 0.24;
    const shape = new THREE.Shape();
    shape.moveTo(-thick / 2, arm / 2);
    shape.lineTo(thick / 2, arm / 2);
    shape.lineTo(thick / 2, thick / 2);
    shape.lineTo(arm / 2, thick / 2);
    shape.lineTo(arm / 2, -thick / 2);
    shape.lineTo(thick / 2, -thick / 2);
    shape.lineTo(thick / 2, -arm / 2);
    shape.lineTo(-thick / 2, -arm / 2);
    shape.lineTo(-thick / 2, -thick / 2);
    shape.lineTo(-arm / 2, -thick / 2);
    shape.lineTo(-arm / 2, thick / 2);
    shape.lineTo(-thick / 2, thick / 2);
    shape.closePath();
    const crossGeo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.18,
        bevelEnabled: true,
        bevelThickness: 0.03,
        bevelSize: 0.03,
        bevelSegments: 2,
    });
    crossGeo.center();
    const crossMat = stdMat(0xe53935, { roughness: 0.25, metalness: 0.2, emissive: 0xe53935, emissiveIntensity: 0.55 });
    group.add(mesh(crossGeo, crossMat, { y: 0.95 }));

    return group;
}

// ------------------------------------------------------------
// LABERINTO EN ESPIRAL (MGGX Laberinto) — placa de piedra oscura
// con un espiral cuadrado de barras encendidas y un "eco" flotando
// en el centro, calcado del ícono real de la app (que a su vez es
// la única pieza de arte del juego que no se genera en runtime).
// El espiral se calcula caminando en cuadrado hacia afuera, no con
// una lista de coordenadas escritas a mano: cambiando `turns` sale
// un laberinto más grande sin tocar nada más.
// ------------------------------------------------------------
export function buildMaze({ color = 0xffa24b } = {}) {
    const group = new THREE.Group();

    const STEP = 0.3;        // separación entre vueltas del espiral
    const BAR = 0.13;        // grosor de la barra
    const DEPTH = 0.2;       // alto de la barra (le da cuerpo al girar)
    const SEGMENTS = 7;      // tramos rectos: más tramos = más vueltas

    // Espiral cuadrado desde el centro hacia afuera: se avanza en una
    // dirección, se dobla 90°, y cada dos tramos el largo crece un paso.
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const pts = [[0, 0]];
    let px = 0, py = 0, segLen = 1;
    for (let i = 0; i < SEGMENTS; i++) {
        const [dx, dy] = dirs[i % 4];
        px += dx * segLen * STEP;
        py += dy * segLen * STEP;
        pts.push([px, py]);
        if (i % 2 === 1) segLen++;
    }

    // Centrado real sobre el bounding box del recorrido: el espiral
    // arranca en (0,0) pero crece hacia un lado, así que sin esto el
    // ícono giraría descentrado respecto de su propio eje.
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;

    // emissiveIntensity contenida a propósito: con el bloom del runtime
    // (ver scene-runtime.js) un valor alto satura las barras a blanco y
    // el laberinto pierde el ámbar de antorcha que lo identifica.
    const barMat = stdMat(color, { roughness: 0.35, metalness: 0.25, emissive: color, emissiveIntensity: 0.38 });
    for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        const horizontal = Math.abs(x2 - x1) > Math.abs(y2 - y1);
        // +BAR en el largo para que las esquinas cierren sin agujero.
        const len = Math.abs(horizontal ? x2 - x1 : y2 - y1) + BAR;
        const geo = horizontal
            ? new THREE.BoxGeometry(len, BAR, DEPTH)
            : new THREE.BoxGeometry(BAR, len, DEPTH);
        group.add(mesh(geo, barMat, { x: (x1 + x2) / 2 - cx, y: (y1 + y2) / 2 - cy }));
    }

    // El "eco" del centro: la moneda que se junta en el juego.
    const ecoMat = stdMat(0xffe0b0, { roughness: 0.15, metalness: 0.1, emissive: 0xffc58a, emissiveIntensity: 0.85 });
    group.add(mesh(new THREE.SphereGeometry(0.11, 16, 12), ecoMat, { x: -cx, y: -cy, z: 0.02 }));

    // Placa de piedra de fondo: la paleta de "roca de cueva" de la app.
    const w = Math.max(...xs) - Math.min(...xs) + STEP * 2;
    const h = Math.max(...ys) - Math.min(...ys) + STEP * 2;
    const slabMat = stdMat(0x16130f, { roughness: 0.9, metalness: 0.05 });
    group.add(mesh(new THREE.BoxGeometry(w, h, DEPTH * 0.7), slabMat, { z: -DEPTH * 0.75 }));

    return group;
}

/** Nube de partículas tipo "combustible flotando" — puntos con leve deriva. */
export function buildFloatingParticles({ count = 60, radius = 6, color = 0xffa500, size = 0.045 } = {}) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const r = radius * Math.cbrt(Math.random());
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.55, sizeAttenuation: true });
    return new THREE.Points(geo, mat);
}
