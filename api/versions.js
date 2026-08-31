// GET  /api/versions            → catálogo completo (público, sin caché)
// POST /api/versions (+ token)  → { action: 'add'|'edit'|'delete', ... }
//     add:    { projectId, platform, version: {...} }
//     edit:   { projectId, versionId, patch: {...} }
//     delete: { projectId, versionId }
// Cada mutación se commitea a data/versions.json en el repo de GitHub.
//
// Validación: todo identificador (projectId, versionId, platform,
// action) se valida contra un allowlist estricto ANTES de tocar el
// catálogo o de armar la URL de la API de GitHub — así un valor
// malicioso nunca llega a formar parte de un path, de un mensaje de
// commit, ni del JSON persistido sin pasar por sanitizeVersion().

import { json, safeError, requireAuth, enforceSameOrigin, enforceRateLimit, parseJsonBody, readCatalog, writeCatalog } from './_lib.js';

const EDITABLE_FIELDS = ['version', 'title', 'note', 'url', 'date', 'active', 'experimental', 'details', 'platform'];
const VALID_ACTIONS = new Set(['add', 'edit', 'delete']);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export default async function handler(req, res) {
    if (req.method === 'GET') {
        if (!enforceRateLimit(req, res, 'versions-read', { limit: 120, windowMs: 60_000 })) return;
        try {
            const { catalog, storage } = await readCatalog();
            return json(res, 200, { projects: catalog.projects, storage });
        } catch (err) {
            return safeError(res, 502, 'versions:get', err, 'No se pudo leer el catálogo de versiones.');
        }
    }

    if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });
    if (!enforceSameOrigin(req, res)) return;
    if (!requireAuth(req, res)) return;
    if (!enforceRateLimit(req, res, 'versions-write', { limit: 30, windowMs: 60_000 })) return;

    let body;
    try {
        body = parseJsonBody(req);
    } catch (err) {
        return safeError(res, 400, 'versions:parse', err, 'Solicitud inválida.');
    }

    const { action, projectId, versionId } = body;
    if (!VALID_ACTIONS.has(action)) {
        return json(res, 400, { error: `Acción desconocida: ${String(action).slice(0, 40)}` });
    }
    if (typeof projectId !== 'string' || !ID_PATTERN.test(projectId)) {
        return json(res, 400, { error: 'Identificador de proyecto inválido.' });
    }
    if ((action === 'edit' || action === 'delete') && (typeof versionId !== 'string' || !ID_PATTERN.test(versionId))) {
        return json(res, 400, { error: 'Identificador de versión inválido.' });
    }

    try {
        // Reintenta una vez si el sha quedó viejo (commit concurrente).
        for (let attempt = 0; attempt < 2; attempt++) {
            const { catalog, sha } = await readCatalog();
            const project = catalog.projects.find(p => p.id === projectId);
            if (!project) return json(res, 400, { error: 'Proyecto desconocido.' });

            let message;
            if (action === 'add') {
                const v = sanitizeVersion(body.version, project);
                if (v.error) return json(res, 400, { error: v.error });
                project.versions.push(v.version);
                message = `Admin: agrega ${project.name} v${v.version.version}`;
            } else if (action === 'edit') {
                const target = project.versions.find(x => x.id === versionId);
                if (!target) return json(res, 404, { error: 'Versión no encontrada.' });
                const patch = pick(body.patch || {}, EDITABLE_FIELDS);
                const merged = sanitizeVersion({ ...target, ...patch }, project, target.id);
                if (merged.error) return json(res, 400, { error: merged.error });
                Object.assign(target, merged.version);
                message = `Admin: edita ${project.name} v${target.version}`;
            } else {
                const idx = project.versions.findIndex(x => x.id === versionId);
                if (idx === -1) return json(res, 404, { error: 'Versión no encontrada.' });
                const [removed] = project.versions.splice(idx, 1);
                message = `Admin: elimina ${project.name} v${removed.version}`;
            }

            try {
                const { storage } = await writeCatalog(catalog, sha, message);
                return json(res, 200, { ok: true, projects: catalog.projects, storage });
            } catch (err) {
                // 409 = sha desactualizado → releer y reintentar una vez
                if (err.status === 409 && attempt === 0) continue;
                throw err;
            }
        }
    } catch (err) {
        return safeError(res, 502, 'versions:write', err, 'No se pudo guardar el cambio. Intentá de nuevo en un momento.');
    }
}

function pick(obj, keys) {
    const out = {};
    for (const k of keys) if (k in obj) out[k] = obj[k];
    return out;
}

function sanitizeVersion(raw, project, keepId = null) {
    if (!raw || typeof raw !== 'object') return { error: 'Datos de versión inválidos.' };
    const platform = project.platforms.includes(raw.platform) ? raw.platform : null;
    if (!platform) return { error: 'Plataforma inválida para este proyecto.' };
    // Se acepta "v2.0.1" como input (convención común al tipear a mano)
    // pero se guarda sin el prefijo: el resto del sitio ya antepone la "v"
    // al mostrar la versión (ver `v${version}` en admin.js/versions-init.js),
    // así que guardarla con "v" incluida termina mostrando "vv2.0.1" — y
    // además rompe el orden numérico en compareVersions (js/version-store.js),
    // que no reconoce una letra al principio del número de versión.
    const version = String(raw.version || '').trim().replace(/^v/i, '').slice(0, 40);
    const title = String(raw.title || '').trim().toUpperCase().slice(0, 60);
    const note = String(raw.note || '').trim().slice(0, 200);
    const url = String(raw.url || '').trim().slice(0, 500);
    if (!version || !title || !note || !url) {
        return { error: 'Faltan campos obligatorios: versión, título, mini descripción y link.' };
    }
    if (!/^[a-z0-9][a-z0-9.\-]{0,39}$/i.test(version)) {
        return { error: 'El número de versión solo puede tener letras, números, puntos y guiones.' };
    }
    if (!isSafeDownloadUrl(url)) {
        return { error: 'El link a la release debe ser una URL https:// válida.' };
    }
    const details = Array.isArray(raw.details)
        ? raw.details
            .filter(d => d && typeof d.d === 'string' && d.d.trim())
            .slice(0, 10)
            .map(d => ({ t: String(d.t || '').toUpperCase().slice(0, 60), d: String(d.d).slice(0, 400) }))
        : [];
    return {
        version: {
            id: keepId || `${project.id}-${platform}-${version}-${Date.now().toString(36)}`,
            platform,
            version,
            title,
            note,
            url,
            date: String(raw.date || defaultDate()).slice(0, 40),
            active: !!raw.active,
            experimental: !!raw.experimental,
            details,
        },
    };
}

/** Solo https:// con un host bien formado — descarta javascript:, data:, etc. */
function isSafeDownloadUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' && parsed.hostname.length > 0;
    } catch {
        return false;
    }
}

function defaultDate() {
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const now = new Date();
    return `${meses[now.getMonth()]} ${now.getFullYear()}`;
}
