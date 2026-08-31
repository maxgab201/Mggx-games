// ============================================================
//  MGGX GAMES — Version Store (cliente)
//  Carga el catálogo desde /api/versions (fuente: data/versions.json
//  commiteado en GitHub). Fallback: el JSON estático del deploy.
//  Las mutaciones del panel Admin van a POST /api/versions con el
//  token de sesión y actualizan la copia en memoria al confirmar.
// ============================================================

export const PLATFORM_META = {
    pc:      { label: 'PC — Windows', icon: '🖥️', color: '#FFA500', colorRgb: '255, 165, 0' },
    android: { label: 'Android — APK', icon: '📱', color: '#3ddc84', colorRgb: '61, 220, 132' },
};

let PROJECTS = [];

async function fetchCatalog() {
    // 1) API (siempre fresco: lee directo del repo)
    try {
        const res = await fetch('/api/versions', { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.projects)) return data.projects;
        }
    } catch { /* sin API (dev estático) → fallback */ }
    // 2) JSON estático incluido en el deploy
    try {
        const res = await fetch('/data/versions.json', { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.projects)) return data.projects;
        }
    } catch { /* sin datos */ }
    return [];
}

/** Promesa que resuelve cuando el catálogo está en memoria. */
export const ready = fetchCatalog().then(projects => { PROJECTS = projects; });

// --- Orden semántico de versiones ("0.7.2a" > "0.7.1") -----
function versionKey(v) {
    // Se guarda sin prefijo "v" (ver sanitizeVersion en api/versions.js),
    // pero por las dudas de que algún dato viejo/externo la tenga, se
    // tolera acá también — sin este strip, "v2.0.1" se leía como versión
    // "0" y terminaba ordenada última en vez de primera.
    return String(v.version || '').replace(/^v/i, '')
        .split(/[.\-]/)
        .map(part => {
            const n = parseInt(part, 10);
            return Number.isNaN(n) ? 0 : n;
        });
}

export function compareVersions(a, b) {
    const ka = versionKey(a), kb = versionKey(b);
    const len = Math.max(ka.length, kb.length);
    for (let i = 0; i < len; i++) {
        const diff = (kb[i] || 0) - (ka[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

// --- Lectura (sincrónica, sobre la copia en memoria) ---------
export function getProjects() {
    return PROJECTS.map(p => ({ ...p, versions: getVersions(p.id) }));
}

export function getProject(projectId) {
    const base = PROJECTS.find(p => p.id === projectId);
    if (!base) return null;
    return { ...base, versions: getVersions(projectId) };
}

/** Todas las versiones del proyecto (incluye inactivas), ordenadas desc. */
export function getVersions(projectId, platform = null) {
    const base = PROJECTS.find(p => p.id === projectId);
    if (!base) return [];
    let list = base.versions.slice();
    if (platform) list = list.filter(v => v.platform === platform);
    return list.sort(compareVersions);
}

/** Solo versiones activas (lo que ve el público). */
export function getActiveVersions(projectId, platform = null) {
    return getVersions(projectId, platform).filter(v => v.active);
}

/** La release más nueva activa de una plataforma. */
export function getLatest(projectId, platform) {
    return getActiveVersions(projectId, platform)[0] || null;
}

/**
 * Etiquetas automáticas para una versión:
 * "ÚLTIMA RELEASE" para la más nueva activa de su plataforma,
 * "EXPERIMENTAL" si está marcada, más su título propio.
 */
export function getBadges(projectId, v) {
    const latest = getLatest(projectId, v.platform);
    const badges = [];
    if (v.title) badges.push({ text: v.title, kind: 'title' });
    if (latest && latest.id === v.id) badges.push({ text: 'ÚLTIMA RELEASE', kind: 'latest' });
    if (v.experimental) badges.push({ text: 'EXPERIMENTAL', kind: 'experimental' });
    if (!v.active) badges.push({ text: 'DESACTIVADA', kind: 'inactive' });
    return badges;
}

export function platformColor(platform) {
    return PLATFORM_META[platform]?.color || '#FFA500';
}

// --- Mutaciones (panel Admin, requieren token de sesión) ------
async function mutate(body, token) {
    let res;
    try {
        res = await fetch('/api/versions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });
    } catch {
        throw new Error('No se pudo contactar al servidor. ¿Estás offline?');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error HTTP ${res.status}`);
    if (Array.isArray(data.projects)) PROJECTS = data.projects;
    return data;
}

export function addVersion(projectId, version, token) {
    return mutate({ action: 'add', projectId, version, platform: version.platform }, token);
}

export function updateVersion(projectId, versionId, patch, token) {
    return mutate({ action: 'edit', projectId, versionId, patch }, token);
}

export function deleteVersion(projectId, versionId, token) {
    return mutate({ action: 'delete', projectId, versionId }, token);
}
