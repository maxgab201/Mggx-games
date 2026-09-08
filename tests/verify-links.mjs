// ============================================================
//  Prueba automatizada de navegación: hace click REAL en cada
//  link de navegación de las páginas de producto (Volver al
//  inicio/estudio, Términos y Condiciones) en desktop y mobile,
//  y verifica la URL de destino. Detecta regresiones del tipo
//  "un overlay/canvas invisible intercepta los clicks", que no
//  se ven ni en el diff ni en un linter.
//
//  Requiere: npm i -D playwright (no está vendorizado en el repo).
//  Uso:  1) servidor local en :8903 (o ajustar BASE)
//        2) node tests/verify-links.mjs
// ============================================================

import { chromium, devices } from 'playwright';
const BASE = 'http://localhost:8903';
let failures = 0;
const ok = m => console.log('✓', m);
const fail = m => { failures++; console.log('✗', m); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function clickAndExpect(page, selector, expectedPath, label) {
    const el = page.locator(selector).first();
    if (await el.count() === 0) { fail(`${label}: no existe ${selector}`); return; }
    await el.scrollIntoViewIfNeeded();
    await el.click({ timeout: 5000 }).catch(e => fail(`${label}: click falló — ${e.message.split('\n')[0]}`));
    await page.waitForTimeout(600);
    const path = new URL(page.url()).pathname;
    path === expectedPath ? ok(`${label}: navegó a ${path}`) : fail(`${label}: esperaba ${expectedPath}, quedó en ${path}`);
}

for (const [ctxLabel, ctxOpts] of [
    ['desktop', { viewport: { width: 1440, height: 900 } }],
    ['mobile', { ...devices['iPhone 13'], hasTouch: true }],
]) {
    const context = await browser.newContext(ctxOpts);
    await context.route('**pagead2.googlesyndication.com/**', r => r.abort());
    await context.route('**fonts.g**', r => r.abort());

    let page = await context.newPage();
    await page.goto(BASE + '/autoclicker/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await clickAndExpect(page, '.terms-link', '/terminos/', `${ctxLabel} autoclicker Términos y Condiciones`);
    await page.close();

    for (const proj of ['autoclicker', 'gas-station', 'wtsapp', 'craft-book', 'modmedic', 'laberinto']) {
        page = await context.newPage();
        await page.goto(`${BASE}/${proj}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        await clickAndExpect(page, '.back-btn', '/', `${ctxLabel} ${proj} VOLVER AL INICIO`);
        await page.close();
    }
    await context.close();
}
console.log(failures === 0 ? '\n=== LINKS OK ===' : `\n=== ${failures} FALLA(S) ===`);
await browser.close();
process.exit(failures ? 1 : 0);
