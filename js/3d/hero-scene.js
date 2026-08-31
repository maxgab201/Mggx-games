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

    // La cantidad y el tamaño de partícula se calibraron mirando un
    // monitor de escritorio. En un celular la pantalla física es mucho
    // más chica pero el conteo/tamaño en world-units no cambiaba con
    // nada — el resultado era una nube tan densa y "gorda" como en
    // desktop apretada en una fracción de la superficie, mucho más
    // saturada de lo que se ve bien en una pantalla chica. Bajarla ~45%
    // y achicar el punto ~25% en dispositivos de puntero grueso
    // (celular/tablet) sin tocar nada en desktop.
    const COUNT = REDUCE_MOTION ? Math.min(particleCount, 200) : Math.round(particleCount * (IS_COARSE_POINTER ? 0.55 : 1));
    const PARTICLE_SIZE = IS_COARSE_POINTER ? 0.034 : 0.045;
    const positions = new Float32Array(COUNT * 3);
    const origPositions = new Float32Array(COUNT * 3);
    const velocities = new Float32Array(COUNT * 3);

    const scene3d = createScene(canvas, {
        cameraFov: 60,
        far: 60,
        setup(ctx) {
            ctx.camera.position.set(0, 0, BASE_CAMERA_Z);

            for (let i = 0; i < COUNT; i++) {
                const x = (Math.random() - 0.5) * 16;
                const y = (Math.random() - 0.5) * 9;
                const z = (Math.random() - 0.5) * 5 - 1;
                positions[i * 3] = origPositions[i * 3] = x;
                positions[i * 3 + 1] = origPositions[i * 3 + 1] = y;
                positions[i * 3 + 2] = origPositions[i * 3 + 2] = z;
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            const mat = new THREE.PointsMaterial({
                color, size: PARTICLE_SIZE, transparent: true, opacity: 0.7, sizeAttenuation: true,
            });
            ctx.points = new THREE.Points(geo, mat);
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
                icon.position.set(baseX, baseY, baseZ);
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
                const REPEL_RADIUS = 1.7, REPEL_STRENGTH = 0.2, SPRING = 0.02, DAMPING = 0.88;
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
                icon.position.x = baseX + ctx.pointer.x * 0.35;

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
