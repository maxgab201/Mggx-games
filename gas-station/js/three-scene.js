// ============================================================
//  MGGX GAMES — Escena 3D del hero de Gas Station Sim 3D
//
//  Reemplaza la carga de DamagedHelmet.glb (modelo de muestra de
//  Khronos sin relación temática con el juego, cargado por error
//  en una versión anterior) por un surtidor de nafta construido
//  100% por geometría procedural en código — ver
//  js/3d/geo-builders.js — más autos animados cruzando el fondo y
//  una interacción real: click/tap en la pistola dispara la
//  animación de "carga" y una ráfaga de partículas de dinero, igual
//  que la mecánica económica descripta en el propio juego. La
//  cámara se recalibra sola según el aspect ratio del viewport
//  (ver responsiveScale en scene-runtime.js) para que el surtidor
//  se vea igual de proporcionado en un monitor ancho que en un
//  celular en vertical.
// ============================================================

import { THREE, createScene, REDUCE_MOTION, IS_COARSE_POINTER, pointToNDC } from '../../js/3d/scene-runtime.js';
import { buildGasPump, buildCar, buildFloatingParticles } from '../../js/3d/geo-builders.js';

const ACCENT = 0xffa500;
const CAMERA_TARGET = { x: 0, y: 1, z: 0 };

function buildGround() {
    const geo = new THREE.PlaneGeometry(60, 60, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.85, metalness: 0.1 });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    return ground;
}

function buildLaneMarkings() {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.6 });
    for (let i = -6; i <= 6; i++) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.08), mat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(i * 1.4, 0.01, -3.4);
        group.add(dash);
    }
    return group;
}

function spawnMoneyBurst(scene, origin, count = 22) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        positions[i * 3] = origin.x;
        positions[i * 3 + 1] = origin.y;
        positions[i * 3 + 2] = origin.z;
        const theta = Math.random() * Math.PI * 2;
        const speed = 0.8 + Math.random() * 1.4;
        velocities[i * 3] = Math.cos(theta) * speed * 0.5;
        velocities[i * 3 + 1] = 1.4 + Math.random() * 1.2;
        velocities[i * 3 + 2] = Math.sin(theta) * speed * 0.5;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
        color: 0x9fe870, size: 0.09, transparent: true, opacity: 1, sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    scene.add(points);
    return { points, velocities, positions, life: 0, maxLife: 1.3 };
}

export function initGasStationScene(containerId = 'three-container') {
    const container = document.getElementById(containerId);
    if (!container) return null;

    let canvas = container.querySelector('canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        container.appendChild(canvas);
    }

    let pump, nozzleHit, car1, car2;
    let bursts = [];
    const raycaster = new THREE.Raycaster();
    let hoveringNozzle = false;

    const scene3d = createScene(canvas, {
        cameraFov: 45,
        far: 80,
        setup(ctx) {
            ctx.scene.fog = new THREE.FogExp2(0x000000, 0.026);
            ctx.camera.position.set(2.6, 1.7, 4.4);
            ctx.camera.lookAt(CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z);

            ctx.scene.add(buildGround());
            ctx.scene.add(buildLaneMarkings());

            pump = buildGasPump({ accent: ACCENT });
            ctx.scene.add(pump);

            // Radio de impacto de la pistola más generoso que su tamaño
            // visual real: en touch el dedo cubre un área mucho más ancha
            // que la punta de un cursor de mouse, así que el blanco táctil
            // tiene que ser más grande para sentirse "tocable" de verdad.
            nozzleHit = new THREE.Mesh(
                new THREE.SphereGeometry(0.5, 8, 8),
                new THREE.MeshBasicMaterial({ visible: false }),
            );
            const nozzleWorldPos = new THREE.Vector3();
            pump.userData.nozzle.getWorldPosition(nozzleWorldPos);
            nozzleHit.position.copy(nozzleWorldPos);
            ctx.scene.add(nozzleHit);

            car1 = buildCar({ color: 0xd94f4f });
            car2 = buildCar({ color: 0x4f7dd9 });
            car1.position.set(-14, 0, -3.4);
            car2.position.set(20, 0, -3.4);
            car2.rotation.y = Math.PI;
            ctx.scene.add(car1, car2);
            ctx.cars = [
                { mesh: car1, speed: 2.1, dir: 1, resetX: -14, endX: 14 },
                { mesh: car2, speed: 1.6, dir: -1, resetX: 14, endX: -14 },
            ];

            // En celular la nube se ve tan densa/gorda como en desktop
            // apretada en una pantalla mucho más chica — igual que las
            // partículas del hero compartido (ver hero-scene.js), se
            // reduce cantidad y tamaño en dispositivos de puntero grueso.
            const particles = buildFloatingParticles({
                count: REDUCE_MOTION ? 20 : (IS_COARSE_POINTER ? 55 : 90),
                radius: 9, color: ACCENT, size: IS_COARSE_POINTER ? 0.022 : 0.03,
            });
            particles.position.y = 2;
            ctx.scene.add(particles);
            ctx.ambientParticles = particles;

            // Estos valores bajaron respecto de la iteración anterior: ese
            // ajuste se calibró SIN environment map ni tone mapping ACES
            // (ver scene-runtime.js), y ambos ya aportan bastante luz/reflejo
            // por su cuenta — sumados a las mismas intensidades de antes,
            // el surtidor se lavaba a un blanco-amarillo sin detalle.
            ctx.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
            ctx.scene.add(new THREE.HemisphereLight(0x8899bb, 0x221a10, 0.4));
            const key = new THREE.DirectionalLight(0xfff2df, 1.7);
            key.position.set(4, 9, 7);
            ctx.scene.add(key);
            const fill = new THREE.PointLight(ACCENT, 2.8, 14);
            fill.position.set(-2.5, 2.8, 3);
            ctx.scene.add(fill);
            const rim = new THREE.PointLight(0x4488ff, 1.3, 16);
            rim.position.set(3.5, 3.5, -4);
            ctx.scene.add(rim);
            const front = new THREE.PointLight(0xffffff, 1.5, 11);
            front.position.set(2.2, 1.8, 3.8);
            ctx.scene.add(front);

            canvas.style.pointerEvents = 'auto';
            canvas.style.cursor = 'default';
            // Deja que el navegador siga scrolleando verticalmente con el
            // dedo aunque arranque sobre el canvas; solo interceptamos el
            // toque puntual (touchend) para la interacción de la pistola.
            canvas.style.touchAction = 'pan-y';

            const ndc = new THREE.Vector2();
            function hitTestNozzle(clientX, clientY) {
                pointToNDC(canvas, clientX, clientY, ndc);
                raycaster.setFromCamera(ndc, ctx.camera);
                return raycaster.intersectObject(nozzleHit).length > 0;
            }

            function triggerSqueeze() {
                ctx.squeezeT = 1;
                const worldPos = new THREE.Vector3();
                pump.userData.nozzle.getWorldPosition(worldPos);
                bursts.push(spawnMoneyBurst(ctx.scene, worldPos));
            }

            canvas.addEventListener('click', e => {
                if (hitTestNozzle(e.clientX, e.clientY)) triggerSqueeze();
            });

            canvas.addEventListener('mousemove', e => {
                hoveringNozzle = hitTestNozzle(e.clientX, e.clientY);
                canvas.style.cursor = hoveringNozzle ? 'pointer' : 'default';
            });

            // Equivalente táctil: el brillo de "hover" se activa mientras
            // el dedo está apoyado sobre la pistola (touchstart/touchmove),
            // y el toque cuenta como interacción recién al levantar el
            // dedo (touchend) — así arrastrar el dedo para scrollear la
            // página no dispara la animación por accidente, igual que en
            // mouse un click solo cuenta si soltás el botón sobre el
            // elemento.
            let touchDidMove = false;
            let touchStartXY = null;
            canvas.addEventListener('touchstart', e => {
                const t = e.touches[0];
                if (!t) return;
                touchDidMove = false;
                touchStartXY = { x: t.clientX, y: t.clientY };
                hoveringNozzle = hitTestNozzle(t.clientX, t.clientY);
            }, { passive: true });

            canvas.addEventListener('touchmove', e => {
                const t = e.touches[0];
                if (!t) return;
                if (touchStartXY) {
                    const dx = t.clientX - touchStartXY.x, dy = t.clientY - touchStartXY.y;
                    if (Math.hypot(dx, dy) > 10) touchDidMove = true; // gesto de scroll, no un tap
                }
                hoveringNozzle = hitTestNozzle(t.clientX, t.clientY);
            }, { passive: true });

            canvas.addEventListener('touchend', e => {
                const t = e.changedTouches[0];
                if (t && !touchDidMove && hitTestNozzle(t.clientX, t.clientY)) triggerSqueeze();
                hoveringNozzle = false;
                touchStartXY = null;
            }, { passive: true });

            canvas.addEventListener('touchcancel', () => {
                hoveringNozzle = false;
                touchStartXY = null;
            }, { passive: true });

            let scrollFrac = 0;
            function onScroll() {
                const h = container.parentElement?.offsetHeight || window.innerHeight;
                scrollFrac = Math.min(1, Math.max(0, window.scrollY / h));
                ctx.scrollT = scrollFrac;
            }
            window.addEventListener('scroll', onScroll, { passive: true });
            onScroll();

            ctx.squeezeT = 0;
        },
        onFrame(ctx, dt, elapsed) {
            if (pump?.userData.screen) {
                const flicker = 0.85 + Math.sin(elapsed * 6) * 0.08 + (Math.random() - 0.5) * 0.03;
                pump.userData.screen.material.emissiveIntensity = Math.max(0.4, flicker);
            }
            if (pump?.userData.stripe) {
                pump.userData.stripe.material.emissiveIntensity = hoveringNozzle
                    ? 0.55 + Math.sin(elapsed * 10) * 0.15
                    : 0.35;
            }

            const nozzle = pump?.userData.nozzle;
            if (nozzle) {
                nozzle.rotation.z = Math.sin(elapsed * 1.2) * 0.03;
                if (ctx.squeezeT > 0) {
                    ctx.squeezeT = Math.max(0, ctx.squeezeT - dt * 2.5);
                    const trigger = nozzle.children.find(c => c.name === 'nozzle-trigger');
                    if (trigger) trigger.position.x = -Math.sin(ctx.squeezeT * Math.PI) * 0.03;
                }
            }

            for (const c of ctx.cars || []) {
                c.mesh.position.x += dt * c.speed * c.dir;
                // Euler 'XYZ': Ry se aplica antes que el rx:π/2 del semieje y es
                // la única componente que deja el eje del cilindro invariante —
                // girar rotation.y hace RODAR la rueda sobre su semieje;
                // rotation.x la hacía girar de costado (alrededor del avance) y
                // rotation.z movería el propio eje (bamboleo), no la rodadura.
                c.mesh.children.forEach((child, i) => { if (i >= 2 && i <= 5) child.rotation.y += dt * c.speed * 2.2 * c.dir; });
                if ((c.dir > 0 && c.mesh.position.x > c.endX) || (c.dir < 0 && c.mesh.position.x < c.endX)) {
                    c.mesh.position.x = c.resetX;
                }
            }

            if (ctx.ambientParticles) {
                ctx.ambientParticles.rotation.y = elapsed * 0.02;
            }

            bursts = bursts.filter(b => {
                b.life += dt;
                const pos = b.points.geometry.attributes.position.array;
                for (let i = 0; i < b.velocities.length / 3; i++) {
                    const ix = i * 3, iy = ix + 1, iz = ix + 2;
                    b.velocities[iy] -= dt * 3.2; // gravedad
                    pos[ix] += b.velocities[ix] * dt;
                    pos[iy] += b.velocities[iy] * dt;
                    pos[iz] += b.velocities[iz] * dt;
                }
                b.points.geometry.attributes.position.needsUpdate = true;
                b.points.material.opacity = Math.max(0, 1 - b.life / b.maxLife);
                if (b.life >= b.maxLife) {
                    ctx.scene.remove(b.points);
                    b.points.geometry.dispose();
                    b.points.material.dispose();
                    return false;
                }
                return true;
            });

            // Offset "crudo" de la cámara respecto del punto que mira,
            // calibrado a mano mirando un monitor ancho. Se multiplica por
            // responsiveScale (>1 en celulares en vertical) para alejar la
            // cámara en la misma proporción en los tres ejes — encoge y
            // recentra el surtidor completo sin tocar ni una posición del
            // modelo. Sin esto, en un celular angosto la cámara quedaba
            // demasiado cerca para el frustum tan estrecho y el surtidor
            // terminaba llenando toda la pantalla, tapando el título.
            const scale = ctx.responsiveScale;
            const rawOffsetX = 2.6 - ctx.pointer.x * 0.7 - ctx.scrollT * 1.4;
            const rawOffsetY = (1.7 + ctx.pointer.y * 0.35 + ctx.scrollT * 0.6) - CAMERA_TARGET.y;
            const rawOffsetZ = 4.4;
            const targetX = CAMERA_TARGET.x + rawOffsetX * scale;
            const targetY = CAMERA_TARGET.y + rawOffsetY * scale;
            const targetZ = CAMERA_TARGET.z + rawOffsetZ * scale;
            ctx.camera.position.x += (targetX - ctx.camera.position.x) * 0.05;
            ctx.camera.position.y += (targetY - ctx.camera.position.y) * 0.05;
            ctx.camera.position.z += (targetZ - ctx.camera.position.z) * 0.05;
            ctx.camera.lookAt(CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z);
        },
    });

    return scene3d;
}

initGasStationScene();
