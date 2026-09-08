// Render dinámico de versiones: lista completa de descargas en el
// modal (última destacada + historial plegable), patch notes en la
// sección VERSIONES y tagline del hero con la última release.
// Externo por la CSP de producción (sin 'unsafe-inline').
// iniciarDescarga es global, definida por page.js (script clásico
// que ya corrió para cuando este módulo diferido se ejecuta).
// Único proyecto solo-Android del catálogo: renderDownloadList ya
// avisa (ver js/render-versions.js) si quien entra está en una PC.
import { renderDownloadList, renderPatchHistory, renderLatestTagline } from '../../js/render-versions.js';

renderDownloadList('download-list', 'laberinto', 'android', { onDownload: url => iniciarDescarga(url) });
renderPatchHistory('patch-history', 'laberinto');
renderLatestTagline('hero-tagline', 'laberinto', (pc, android) => android
    ? `Laberintos 3D en primera persona · v${android.version} — ${android.title}`
    : 'Laberintos 3D en primera persona · Android');
