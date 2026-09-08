// ============================================================
//  MGGX GAMES — Escena "hero" reutilizable (partículas + icono
//  procedural flotante). Reemplaza js/particles.js y
//  js/hero-particles.js: mismo comportamiento de partículas con
//  física de repulsión por mouse/dedo que ya tenía el sitio, ahora
//  sobre el runtime compartido (pausa en background, reduced
//  motion, resize por ResizeObserver, escala responsive por aspect
//  ratio) más un mesh 3D flotante con identidad visual propia por
//  producto e interacción de click/tap equivalente en mouse y
//  touch.
// ============================================================

import { THREE, createScene, REDUCE_MOTION, IS_COARSE_POINTER, pointToNDC } from './scene-runtime.js';

/**
 * @param {string} canvasId
 * @param {object} opts
 * @param {number} opts.color               color primario (0xRRGGBB)
 * @param {number} [opts.particleCount=1500]
 * @param {(color:number)=>THREE.Object3D} [opts.iconBuilder] constructor del icono 3D flotante (opcional)
 * @param {number} [opts.iconScale=1]
 * @param {{x?:number,y?:number,z?:number}} [opts.iconOffset] posición base del icono — en layouts de
 *   dos columnas (foto a la izquierda + texto a la derecha) hay que sacarlo del centro para que no
 *   quede tapando el párrafo; el default (0,0.1,1.2) sirve para heros de una sola columna centrada.
 *   Esta posición se calibró mirando un monitor de escritorio (~1440x900); en un celular en vertical
 *   el runtime aleja la cámara automáticamente (ver responsiveScale en scene-runtime.js) para que la
 *   composición se vea igual de proporcionada sin importar el ancho real de la pantalla.
 */
export function initHeroScene(canvasId, opts = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    const {
        color = 0xffa500,
        particleCount = 1500,
        iconBuilder = null,
        iconScale = 1,
        iconOffset = { x: 0, y: 0.1, z: 1.2 },
    } = opts;
    const baseX = iconOffset.x ?? 0;
    const baseY = iconOffset.y ?? 0.1;
    const baseZ = iconOffset.z ?? 1.2;
    const BASE_CAMERA_Z = 7;

    let icon = null;
    let iconHit = null;
    let pulseT = 0;

    // En celular se bajó el conteo: la pantalla es mucho más chica y no
    // hace falta la misma cantidad de puntos para leer la misma textura
    // visual (y de paso rinde mejor en gama baja).
    const COUNT = REDUCE_MOTION ? Math.min(particleCount, 200) : Math.round(particleCount * (IS_COARSE_POINTER ? 0.55 : 1));
    const BASE_FOV = 60;

    // Posiciones "normalizadas" (-0.5..0.5 en X/Y): la nube se guarda una
    // sola vez con esta forma y después se ESCALA al tamaño que realmente
    // ocupa la pantalla (ver applyLayout). Sin esto, la nube se armaba con
    // una caja fija de 16x9 world-units — o sea, la proporción de un
    // monitor — y en un celular en vertical, donde la cámara se aleja y el
    // alto visible pasa a ~28 unidades, esos 9 de alto se veían como una
    // FRANJA HORIZONTAL de partículas en el medio con vacío arriba y abajo:
    // literalmente un rectángulo con forma de pantalla de PC pegado sobre
    // una pantalla vertical.
    const unitXY = new Float32Array(COUNT * 2);
    const positions = new Float32Array(COUNT * 3);
    const origPositions = new Float32Array(COUNT * 3);
    const velocities = new Float32Array(COUNT * 3);

    const BASE_PARTICLE_SIZE = 0.045;
    let particleScale = 1;
    let pointsMat = null;
    // Posición X efectiva del ícono: baseX en desktop, corrida hacia
    // adentro en viewports angostos para que no se corte (ver applyLayout).
    let layoutX = baseX;
    let iconRadius = 0.9;

    /**
     * Redimensiona la nube al área que la cámara realmente ve, para el
     * aspect ratio actual. La cámara se para a BASE_CAMERA_Z * responsiveScale
     * (el runtime la aleja en viewports angostos), así que el alto visible
     * sobre el plano z=0 es 2·tan(fov/2)·distancia y el ancho es ese alto
     * por el aspect. Los márgenes cubren lo que se sale de ese plano: el
     * parallax de cámara (±0.6 en x) y las partículas que están más lejos
     * que z=0, que caen dentro de un frustum más ancho.
     *
     * `reset` posiciona las partículas de una en el layout nuevo (arranque);
     * sin él solo se mueve el objetivo del resorte de onFrame, así que al
     * rotar el celular la nube se re-acomoda con una transición suave en
     * vez de saltar de golpe.
     */
    function applyLayout(aspect, reset = false) {
        const responsive = Math.max(1, (1440 / 900) / aspect);
        const dist = BASE_CAMERA_Z * responsive;
        const visibleH = 2 * Math.tan((BASE_FOV / 2) * Math.PI / 180) * dist;
        const spreadH = visibleH * 1.15;
        const spreadW = visibleH * aspect * 1.2;
        for (let i = 0; i < COUNT; i++) {
            origPositions[i * 3] = unitXY[i * 2] * spreadW;
            origPositions[i * 3 + 1] = unitXY[i * 2 + 1] * spreadH;
            if (reset) {
                positions[i * 3] = origPositions[i * 3];
                positions[i * 3 + 1] = origPositions[i * 3 + 1];
            }
        }
        // El punto se mide en world-units y sizeAttenuation lo encoge con la
        // distancia: si no crece junto con lo lejos que se puso la cámara,
        // en un celular queda como una mota de polvo casi invisible. Con
        // este factor el punto conserva SU TAMAÑO EN PANTALLA, y el 0.85
        // en táctil lo deja apenas más fino que en desktop a propósito.
        particleScale = responsive * (IS_COARSE_POINTER ? 0.85 : 1);

        // El ícono flotante se calibró a mano para el hero de dos columnas
        // del desktop (bien a la izquierda, en el hueco que queda arriba de
        // la portada). En un celular ese hueco no existe — el layout se
        // apila — y además el ancho visible en world-units NO crece al
        // alejar la cámara: se queda en ~13 unidades siempre. Con un offset
        // de -5.6 el ícono quedaba pisando el borde y se cortaba al medio.
        // Acá se lo empuja hacia adentro lo justo para que entre entero,
        // sin tocar nada en desktop (donde el clamp no llega a actuar).
        const iconDist = dist + Math.abs(baseZ);
        const halfVisibleAtIcon = Math.tan((BASE_FOV / 2) * Math.PI / 180) * iconDist * aspect;
        const margin = iconRadius + halfVisibleAtIcon * 0.04;
        const maxX = Math.max(0, halfVisibleAtIcon - margin);
        layoutX = Math.max(-maxX, Math.min(maxX, baseX));
    }

    const scene3d = createScene(canvas, {
        cameraFov: 60,
        far: 60,
        setup(ctx) {
            ctx.camera.position.set(0, 0, BASE_CAMERA_Z);

            for (let i = 0; i < COUNT; i++) {
                unitXY[i * 2] = Math.random() - 0.5;
                unitXY[i * 2 + 1] = Math.random() - 0.5;
                const z = (Math.random() - 0.5) * 5 - 1;
                positions[i * 3 + 2] = origPositions[i * 3 + 2] = z;
            }
            // El runtime todavía no corrió su resize (pasa justo después de
            // setup), así que el aspect inicial se lee del canvas.
            applyLayout((canvas.clientWidth || 16) / (canvas.clientHeight || 9), true);

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            pointsMat = new THREE.PointsMaterial({
                color, size: BASE_PARTICLE_SIZE * particleScale,
                transparent: true, opacity: 0.7, sizeAttenuation: true,
            });
            ctx.points = new THREE.Points(geo, pointsMat);
            ctx.scene.add(ctx.points);

            ctx.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
            const key = new THREE.DirectionalLight(0xffffff, 1.4);
            key.position.set(4, 5, 6);
            ctx.scene.add(key);
            const rim = new THREE.PointLight(color, 2.2, 14);
            rim.position.set(-3, -2, 3);
            ctx.scene.add(rim);

            if (iconBuilder) {
                icon = iconBuilder(color);
                icon.scale.setScalar(iconScale);
                // Radio real del ícono ya escalado: el clamp de applyLayout
                // necesita saber cuánto ocupa para no cortarlo. Se usa la
                // esfera que lo envuelve porque el ícono gira sobre su eje Y,
                // así que su ancho proyectado cambia frame a frame.
                const bounds = new THREE.Box3().setFromObject(icon).getBoundingSphere(new THREE.Sphere());
                iconRadius = bounds.radius;
                applyLayout(canvas.clientWidth / (canvas.clientHeight || 1));
                icon.position.set(layoutX, baseY, baseZ);
                ctx.scene.add(icon);
                // Radio de impacto más grande que el propio ícono: en un
                // celular el "dedo gordo" necesita un blanco más generoso
                // que un cursor de mouse de un solo píxel para que tocar
                // el ícono se sienta confiable.
                iconHit = new THREE.Mesh(
                    new THREE.SphereGeometry(1.35 * iconScale, 8, 8),
                    new THREE.MeshBasicMaterial({ visible: false }),
                );
                iconHit.position.copy(icon.position);
                ctx.scene.add(iconHit);
            }

            const raycaster = new THREE.Raycaster();
            const ndc = new THREE.Vector2();
            // El canvas es el fondo visual (z-index 0) detrás del texto y
            // la imagen de portada (z-index 1): el ícono flotante suele
            // renderizarse justo debajo de esos elementos a propósito
            // (para no tapar el párrafo). Eso significa que el navegador
            // jamás entrega el click/tap AL CANVAS en esa zona — el
            // elemento de texto de encima se lo queda primero. Por eso el
            // listener no va en el canvas sino en su contenedor (el
            // <div class="hero">/.intro-section del que el canvas es
            // hijo): ahí sí llegan, por bubbling, los clicks/taps que
            // caen sobre el texto o la imagen, y el hit-test contra la
            // esfera invisible del ícono sigue siendo el único filtro
            // real de si el pulso debe dispararse o no.
            // pointer-events SIEMPRE en none: los listeners de click/tap
            // viven en el contenedor padre (ver hitTarget más abajo), así
            // que el canvas no necesita recibir eventos él mismo. Con
            // 'auto', este estilo inline pisaba el pointer-events:none del
            // CSS de la página y el canvas — absoluto, cubriendo todo el
            // hero y pintado por encima del contenido estático — se
            // tragaba los clicks de cualquier elemento sin z-index
            // propio (los links "Volver al estudio" y "Términos" del
            // Autoclicker quedaban inclickeables).
            canvas.style.pointerEvents = 'none';

            function tryPulse(clientX, clientY) {
                if (!iconHit) return;
                pointToNDC(canvas, clientX, clientY, ndc);
                raycaster.setFromCamera(ndc, ctx.camera);
                if (raycaster.intersectObject(iconHit).length) pulseT = 1;
            }
            const hitTarget = canvas.parentElement || canvas;
            hitTarget.addEventListener('click', e => tryPulse(e.clientX, e.clientY));
            // touchend (no touchstart): así un dedo que arranca sobre el
            // canvas pero termina arrastrando para scrollear la página NO
            // dispara el pulso — solo un toque real, igual que un click.
            hitTarget.addEventListener('touchend', e => {
                const t = e.changedTouches[0];
                if (t) tryPulse(t.clientX, t.clientY);
            }, { passive: true });
        },
        // Rotar el celular cambia el aspect: la nube se re-dimensiona al
        // área visible nueva (y el resorte de onFrame la lleva ahí suave).
        onResize(ctx) {
            applyLayout(ctx.aspect);
            if (pointsMat) pointsMat.size = BASE_PARTICLE_SIZE * particleScale;
        },
        onFrame(ctx, dt, elapsed) {
            const raycaster = ctx._raycaster ?? (ctx._raycaster = new THREE.Raycaster());
            const mousePlane = ctx._mousePlane ?? (ctx._mousePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
            const mouseWorld = ctx._mouseWorld ?? (ctx._mouseWorld = new THREE.Vector3());
            raycaster.setFromCamera(new THREE.Vector2(ctx.pointer.x, ctx.pointer.y), ctx.camera);
            raycaster.ray.intersectPlane(mousePlane, mouseWorld);

            const points = ctx.points;
            if (points) {
                const pos = points.geometry.attributes.position.array;
                const mx = mouseWorld?.x ?? 999, my = mouseWorld?.y ?? 999, mz = mouseWorld?.z ?? 999;
                // El radio se mide en world-units, igual que la nube: si no
                // acompaña a lo que esta creció al alejarse la cámara, el
                // "hueco" que abre el dedo en celular queda ridículamente
                // chico contra la pantalla. REPEL_STRENGTH escala igual para
                // que el empujón se sienta proporcional al hueco.
                const REPEL_RADIUS = 1.7 * ctx.responsiveScale;
                const REPEL_STRENGTH = 0.2 * ctx.responsiveScale;
                const SPRING = 0.02, DAMPING = 0.88;
                for (let i = 0; i < COUNT; i++) {
                    const ix = i * 3, iy = ix + 1, iz = ix + 2;
                    velocities[ix] += (origPositions[ix] - pos[ix]) * SPRING;
                    velocities[iy] += (origPositions[iy] - pos[iy]) * SPRING;
                    velocities[iz] += (origPositions[iz] - pos[iz]) * SPRING;
                    const dx = pos[ix] - mx, dy = pos[iy] - my, dz = pos[iz] - mz;
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist < REPEL_RADIUS && dist > 0.001) {
                        const f = ((REPEL_RADIUS - dist) / REPEL_RADIUS) * REPEL_STRENGTH;
                        velocities[ix] += (dx / dist) * f;
                        velocities[iy] += (dy / dist) * f;
                        velocities[iz] += (dz / dist) * f;
                    }
                    velocities[ix] *= DAMPING; velocities[iy] *= DAMPING; velocities[iz] *= DAMPING;
                    pos[ix] += velocities[ix]; pos[iy] += velocities[iy]; pos[iz] += velocities[iz];
                }
                points.geometry.attributes.position.needsUpdate = true;
                points.rotation.y = Math.sin(elapsed * 0.05) * 0.08;
            }

            if (icon) {
                icon.rotation.y += dt * 0.35;
                icon.rotation.x = Math.sin(elapsed * 0.4) * 0.12;
                icon.position.y = baseY + Math.sin(elapsed * 0.8) * 0.12;
                icon.position.x = layoutX + ctx.pointer.x * 0.35;

                if (pulseT > 0) {
                    pulseT = Math.max(0, pulseT - dt * 2.2);
                    const s = iconScale * (1 + Math.sin(pulseT * Math.PI) * 0.28);
                    icon.scale.setScalar(s);
                } else {
                    icon.scale.setScalar(iconScale);
                }
                iconHit?.position.copy(icon.position);
            }

            const camera = ctx.camera;
            camera.position.x += (ctx.pointer.x * 0.6 - camera.position.x) * 0.04;
            camera.position.y += (ctx.pointer.y * 0.35 - camera.position.y) * 0.04;
            // La cámara se aleja en la misma proporción que responsiveScale
            // (1 en desktop, más de 1 en un celular angosto): encoge y
            // recentra TODA la composición (ícono + partículas) sin tener
            // que tocar sus posiciones — el mismo mecanismo que evita que
            // el ícono termine gigante o fuera de cuadro en mobile.
            const targetZ = BASE_CAMERA_Z * ctx.responsiveScale;
            camera.position.z += (targetZ - camera.position.z) * 0.08;
            camera.lookAt(0, 0, 0);
        },
    });

    return scene3d;
}
