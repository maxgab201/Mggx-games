// ============================================================
//  MGGX GAMES — Runtime de escenas Three.js compartido
//  Centraliza todo lo que NO es específico de cada escena:
//  renderer, resize, límite de devicePixelRatio, pausa cuando el
//  canvas sale de pantalla (IntersectionObserver) o la pestaña
//  pierde foco (Page Visibility API), respeto de
//  prefers-reduced-motion (congela en el primer frame), un
//  helper de parallax por puntero/scroll reutilizable, un factor
//  de escala responsive para que la composición 3D no dependa del
//  aspect ratio con el que se calibró, y utilidades táctiles
//  compartidas (mouse y touch resuelven al mismo NDC).
// ============================================================

import * as THREE from '../../vendor/three/three.module.min.js';
import { EffectComposer } from '../../vendor/three/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/three/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../../vendor/three/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../../vendor/three/postprocessing/OutputPass.js';
import { RoomEnvironment } from '../../vendor/three/environments/RoomEnvironment.js';

const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Un solo PMREMGenerator + RoomEnvironment compartido por TODAS las
 * escenas de la página: generar el environment map es la parte cara
 * (un render offscreen a un cubemap), así que hacerlo una vez por
 * página en vez de una vez por escena evita pagar ese costo N veces
 * cuando varias escenas 3D conviven (no pasa hoy, pero por si acaso).
 * Se crea perezosamente recién cuando la primera escena la pide,
 * usando SU renderer (cualquiera sirve, es solo para compilar el PMREM).
 */
let sharedEnvTexture = null;
function getSharedEnvironment(renderer) {
    if (sharedEnvTexture) return sharedEnvTexture;
    const pmrem = new THREE.PMREMGenerator(renderer);
    sharedEnvTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return sharedEnvTexture;
}

/** true en dispositivos cuyo puntero primario es táctil (sin hover fino). */
export const IS_COARSE_POINTER = window.matchMedia('(pointer: coarse)').matches;

/**
 * Convierte un punto en coordenadas de pantalla (clientX/clientY, de un
 * MouseEvent o de un Touch) a coordenadas NDC (-1..1) relativas al canvas.
 * Se usa igual para mouse y para touch: ambos terminan resolviendo al
 * mismo sistema de coordenadas, así el raycasting de clicks/taps es
 * idéntico sin importar el tipo de puntero.
 */
export function pointToNDC(canvas, clientX, clientY, out = new THREE.Vector2()) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) { out.set(9999, 9999); return out; }
    out.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    out.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    return out;
}

/**
 * Crea renderer + scene + cámara sobre un <canvas> existente y
 * devuelve controles de ciclo de vida. `setup(ctx)` arma la
 * escena una sola vez; `onFrame(ctx, dt, elapsed)` corre cada
 * frame salvo que el motion esté reducido o el canvas no sea
 * visible.
 *
 * `baseAspect` (ancho/alto) es el aspect ratio con el que se
 * calibró a mano la composición de la escena (posición de cámara,
 * offsets de íconos, etc — normalmente en un monitor de escritorio,
 * ~1440x900 ≈ 1.6). En viewports más angostos que eso (celulares en
 * vertical, aspect ratio ~0.5) `ctx.responsiveScale` crece por
 * encima de 1: cada escena lo usa para alejar la cámara del punto
 * de interés en la misma proporción, lo que encoge Y recentra TODA
 * la composición de forma uniforme — sin esto, un objeto calibrado
 * para pantallas anchas termina gigante (llena la pantalla) o
 * directamente fuera de cuadro en un celular, que es exactamente lo
 * que pasaba antes de este ajuste.
 */
export function createScene(canvas, { setup, onFrame, onResize, cameraFov = 50, near = 0.1, far = 100, alpha = true, background = null, baseAspect = 1440 / 900, bloom = true, environment = true } = {}) {
    if (!canvas) return null;

    // WebGLRenderer tira una excepción (no devuelve null) si el navegador
    // no puede darle un contexto WebGL — GPU deshabilitada, sandbox de un
    // servicio de testing remoto, política corporativa, etc. Sin este
    // try/catch esa excepción quedaba sin capturar en el módulo, así que
    // TODO lo que venía después (partículas, ícono, pistola) nunca se
    // ejecutaba y el canvas quedaba completamente vacío y en silencio —
    // ni un error visible para quien no tuviera la consola abierta, ni
    // ninguna forma de saber que el problema era el WebGL del navegador y
    // no el código de la escena.
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, powerPreference: 'low-power' });
    } catch (err) {
        console.warn('[3D] WebGL no disponible en este navegador, se omite la escena:', err);
        return null;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = false; // sombras dinámicas desactivadas: prioriza 60fps en gama baja
    // ACESFilmic comprime altas luces de forma natural (hombro suave en vez
    // de recortar a blanco) — sin esto, sumar un environment map real más
    // bloom sobre escenas ya calibradas para verse brillantes (el ajuste de
    // iluminación de gas-station) las quema a un borrón sin detalle.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    const scene = new THREE.Scene();
    if (background !== null) scene.background = background;
    // Environment map generado (RoomEnvironment vía PMREM, sin textura
    // externa que descargar): sin esto, los materiales metalness>0
    // (surtidor, ganchos, autos) no tienen nada que reflejar y se ven
    // como plástico gris plano bajo solo 2-3 luces puntuales.
    if (environment) scene.environment = getSharedEnvironment(renderer);

    const camera = new THREE.PerspectiveCamera(cameraFov, 1, near, far);

    const ctx = {
        renderer, scene, camera, canvas,
        pointer: { x: 0, y: 0, targetX: 0, targetY: 0 },
        scrollT: 0,
        responsiveScale: 1,
        isTouch: false,
    };

    setup?.(ctx);

    // Bloom sobre los materiales emissive (pantallas, franjas de acento,
    // faros, la cruz de ModMedic): son la parte del look que más se
    // beneficia de un post-proceso barato, porque ya existen — solo
    // faltaba hacerlos "brillar" en vez de quedar como un color plano.
    // strength/radius/threshold moderados a propósito: mucho bloom en
    // una escena chica (un hero, no una pantalla completa) se ve lavado.
    let composer = null;
    let bloomPass = null;
    if (bloom) {
        composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, camera));
        bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.35, 0.88);
        composer.addPass(bloomPass);
        composer.addPass(new OutputPass());
    }

    function resize() {
        const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 1;
        const h = canvas.clientHeight || canvas.parentElement?.clientHeight || 1;
        renderer.setSize(w, h, false);
        composer?.setSize(w, h);
        bloomPass?.resolution.set(w, h);
        const aspect = w / (h || 1);
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        // Solo "aleja" la cámara cuando el viewport es MÁS angosto que el
        // de referencia (móvil); en pantallas iguales o más anchas que la
        // base (desktop normal o ultra-wide) el factor queda en 1 y la
        // composición calibrada a mano se ve exactamente como se diseñó.
        ctx.responsiveScale = Math.max(1, baseAspect / aspect);
        ctx.aspect = aspect;
        // Hook para lo que NO se puede resolver solo alejando la cámara:
        // una nube de partículas, por ejemplo, ocupa un volumen fijo en
        // coordenadas de mundo y hay que re-dimensionarla al aspect real
        // del viewport (ver hero-scene.js). Se llama también en el primer
        // resize, así que la escena queda bien desde el frame 1.
        onResize?.(ctx, w, h);
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    window.addEventListener('resize', resize);
    // La orientación del celular (portrait/landscape) no siempre dispara
    // 'resize' de forma inmediata en todos los navegadores móviles.
    window.addEventListener('orientationchange', () => setTimeout(resize, 60));

    const ndcScratch = { x: 0, y: 0 };
    function trackPointer(clientX, clientY) {
        pointToNDC(canvas, clientX, clientY, ndcScratch);
        ctx.pointer.targetX = ndcScratch.x;
        ctx.pointer.targetY = ndcScratch.y;
    }
    const onMouseMove = e => { ctx.isTouch = false; trackPointer(e.clientX, e.clientY); };
    const onTouchMove = e => {
        if (!e.touches[0]) return;
        ctx.isTouch = true;
        trackPointer(e.touches[0].clientX, e.touches[0].clientY);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchstart', onTouchMove, { passive: true });

    // Pausa el render loop cuando el canvas no está visible (scroll fuera de
    // vista) o la pestaña pasa a segundo plano — ahorra batería/CPU sin
    // cortar la animación de golpe (se retoma exactamente donde quedó, con
    // delta-time acotado). rootMargin da un colchón de 150px: sin esto, en
    // celular la barra de direcciones se muestra/oculta al scrollear y
    // cambia la altura visible del viewport a mitad de gesto, lo que podía
    // hacer que el canvas cruzara el 0%/1% de intersección varias veces en
    // un segundo (falso "sale de pantalla") y el render loop tartamudeara
    // exactamente cuando el usuario estaba scrolleando el hero.
    let isVisible = true;
    const io = new IntersectionObserver(entries => {
        for (const entry of entries) isVisible = entry.isIntersecting;
    }, { threshold: 0, rootMargin: '150px 0px 150px 0px' });
    io.observe(canvas);

    let running = true;
    const clock = new THREE.Clock();
    let rafId = null;
    let frozenFrameDone = false;

    function renderFrame() {
        const dt = Math.min(clock.getDelta(), 0.1); // cap para evitar saltos tras un tab en pausa
        const elapsed = clock.getElapsedTime();

        ctx.pointer.x += (ctx.pointer.targetX - ctx.pointer.x) * 0.06;
        ctx.pointer.y += (ctx.pointer.targetY - ctx.pointer.y) * 0.06;

        onFrame?.(ctx, dt, elapsed);
        if (composer) composer.render();
        else renderer.render(scene, camera);
    }

    function loop() {
        if (!running) return;
        rafId = requestAnimationFrame(loop);
        if (REDUCE_MOTION) {
            // Un único frame estático: respeta la preferencia de accesibilidad
            // sin dejar el canvas completamente en blanco.
            if (!frozenFrameDone) { renderFrame(); frozenFrameDone = true; }
            return;
        }
        if (!isVisible || document.hidden) return;
        renderFrame();
    }
    loop();

    return {
        ctx,
        dispose() {
            running = false;
            if (rafId) cancelAnimationFrame(rafId);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchstart', onTouchMove);
            window.removeEventListener('resize', resize);
            resizeObserver.disconnect();
            io.disconnect();
            composer?.dispose();
            renderer.dispose();
        },
    };
}

export { REDUCE_MOTION };
export { THREE };
