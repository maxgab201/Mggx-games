import { renderDownloadList, renderPatchHistory, renderLatestTagline } from '../../js/render-versions.js';

renderDownloadList('download-list', 'tanteo', 'android', { onDownload: url => iniciarDescarga(url) });
renderPatchHistory('patch-history', 'tanteo', { includeInactive: true });
renderLatestTagline('hero-tagline', 'tanteo', (_, android) => android
    ? `Juegos de mesa · Android · v${android.version}`
    : 'Juegos de mesa · Android');
