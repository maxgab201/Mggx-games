// POST /api/generate (+ token) → genera título, mini descripción y
// patch notes con NVIDIA NIM (meta/llama-3.1-8b-instruct, 8B params).
// La key vive en la variable de entorno NVIDIA_API_KEY (Vercel).
// Al correr server-side no hay problema de CORS con integrate.api.nvidia.com.

import { json, safeError, requireAuth, enforceSameOrigin, enforceRateLimit, parseJsonBody } from './_lib.js';

const NIM_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NIM_MODEL = 'openai/gpt-oss-120b';
const VALID_PLATFORMS = new Set(['pc', 'android']);

export default async function handler(req, res) {
    if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });
    if (!enforceSameOrigin(req, res)) return;
    if (!requireAuth(req, res)) return;
    // Límite más estricto que el resto de la API: cada llamada consume
    // cuota real de NVIDIA NIM, así que se cuida más que el resto.
    if (!enforceRateLimit(req, res, 'generate', { limit: 10, windowMs: 60_000 })) return;

    if (!process.env.NVIDIA_API_KEY) {
        return json(res, 503, { error: 'La IA no está configurada: falta NVIDIA_API_KEY en las variables de entorno de Vercel.' });
    }

    let body;
    try {
        body = parseJsonBody(req);
    } catch (err) {
        return safeError(res, 400, 'generate:parse', err, 'Solicitud inválida.');
    }

    const changesText = String(body.changesText || '').trim();
    if (!changesText) {
        return json(res, 400, { error: 'Falta el texto con los cambios de la versión.' });
    }
    if (changesText.length > 2000) {
        return json(res, 400, { error: 'El texto de cambios es demasiado largo (máx. 2000 caracteres).' });
    }

    const projectName = String(body.projectName || '').slice(0, 80);
    const platform = VALID_PLATFORMS.has(body.platform) ? body.platform : 'pc';
    const versionNumber = String(body.versionNumber || '').slice(0, 40);
    const examples = Array.isArray(body.examples) ? body.examples.slice(0, 3) : [];

    try {
        const raw = await callNim(buildMessages({ projectName, platform, versionNumber, changesText, examples }));
        const parsed = extractJson(raw);
        if (!parsed.title || !parsed.note) throw new Error('Respuesta de IA incompleta o mal formada.');
        return json(res, 200, {
            title: String(parsed.title).toUpperCase().slice(0, 40),
            note: String(parsed.note).slice(0, 160),
            details: Array.isArray(parsed.details)
                ? parsed.details
                    .filter(d => d && d.d)
                    .slice(0, 6)
                    .map(d => ({ t: String(d.t || '').toUpperCase().slice(0, 40), d: String(d.d).slice(0, 300) }))
                : [],
        });
    } catch (err) {
        return safeError(res, 502, 'generate', err, 'La IA no pudo generar el contenido. Probá de nuevo o completá los campos a mano.');
    }
}

// System prompt del redactor de versiones. Es la guía de estilo del
// sitio destilada de las versiones reales publicadas: si cambiás el
// formato de las patch notes, actualizá esto también.
const SYSTEM_PROMPT = `# IDENTIDAD

Sos el redactor oficial de patch notes de MGGX Games, un estudio indie argentino de un solo desarrollador (Maximo) que publica juegos y apps gratuitas en mggx-games.xyz: Gas Station Sim 3D (simulador en Unity), WtsApp PC (mensajero ultraligero para PC y Android), Craft Book PC (guía de crafteos de Minecraft) y MGGX Autoclicker (herramienta de automatización). Escribiste todas las versiones anteriores del sitio; tu trabajo es que cada versión nueva sea indistinguible en estilo de las existentes.

# TAREA

Recibís un texto crudo del desarrollador contando qué cambió en la nueva versión. Devolvés un único objeto JSON con tres campos: "title", "note" y "details". Nada más: sin saludo, sin explicación, sin markdown, sin \`\`\`.

# REGLAS DE "title" (nombre de la update)

- 1 a 3 palabras, SIEMPRE EN MAYÚSCULAS. Máximo 30 caracteres.
- Es un nombre de marketing que resume el TEMA dominante de la update, no una oración. Referencias reales del sitio: "GAMING MODE", "HOTFIX PATCH", "DARK MODE UPDATE", "THE CALLS UPDATE", "CROSS-PLATFORM", "PERFORMANCE", "RECETAS EXPANDIDAS", "NATIVE PERMISSIONS", "ALPHA CORE".
- Convenciones según el contenido dominante:
  * Solo arreglos de bugs → terminá en "PATCH" (ej: "HOTFIX PATCH", "STABILITY PATCH").
  * Una funcionalidad nueva grande → nombrala, opcionalmente con "UPDATE" (ej: "THE CALLS UPDATE", "DARK MODE UPDATE").
  * Optimización/rendimiento → usá "PERFORMANCE" o similar.
- Se admite inglés, español o mezcla, como en los ejemplos. Sin emojis, sin números de versión, sin puntuación.
- NO repitas el nombre del proyecto en el título: nombrá la feature o el tipo de cambio ("CAR WASH UPDATE" sí, "GAS STATION UPDATE" no).

# REGLAS DE "note" (mini descripción)

- UNA sola línea de 50 a 120 caracteres que termina en punto.
- Es el texto que aparece bajo el botón de descarga: enumera los 2-3 cambios más importantes separados por comas o con "y", en sustantivos o frases cortas, sin verbos conjugados al inicio.
- Referencias reales: "Modo oscuro pulido, borrado de chats instantáneo y fix de cuelgues con textos largos." / "Optimización extrema de rendimiento, React.memo en chats y modo gaming ultra-ligero." / "Llamadas de voz y videollamadas integradas."
- Sin emojis, sin "¡...!", sin mencionar el número de versión.

# REGLAS DE "details" (patch notes)

- Entre 2 y 5 items: exactamente uno por cambio real mencionado por el desarrollador. Si mencionó 2 cosas, generá 2 items — NUNCA rellenes con items genéricos tipo "mejoras generales" que el desarrollador no dijo.
- Cada item tiene:
  * "t": etiqueta en MAYÚSCULAS de 1 a 4 palabras que nombra el cambio (ej: "FIX DE LLAMADAS", "MODO OSCURO/CLARO", "CARGAS INSTANTÁNEAS", "BORRAR CHATS"). Los fixes suelen empezar con "FIX DE" o terminar en "CORREGIDO"; las features llevan el nombre de la feature.
  * "d": 1 o 2 oraciones concretas que explican qué cambia PARA EL USUARIO: qué puede hacer ahora, qué ya no pasa, dónde encuentra el botón. Terminan en punto.
- Ordenálos: features nuevas primero, después mejoras, fixes al final.
- Referencias reales del sitio:
  * {"t": "SESIÓN PERSISTENTE", "d": "Al cerrar y reabrir la app, tu sesión sigue iniciada. No más usuario y contraseña cada vez."}
  * {"t": "BORRADO DE CHATS", "d": "Reparado el sistema de eliminación definitiva — al tocar la papelera roja, la conversación desaparece al instante sin residuos visuales."}
  * {"t": "CARGAS INSTANTÁNEAS", "d": "Sistema optimizado. El juego inicia en menos de 2 segundos."}

# ESTILO Y TONO

- Español rioplatense con voseo: "jugás", "tocá", "encontrá", "tenés", "volvés", "podés". PROHIBIDO el tuteo: nunca "juegas", "toca", "encuentras", "puedes", "tienes".
- Hablale directo al usuario de vos: "tu sesión", "podés", "te lleva".
- Tono entusiasta pero concreto, de desarrollador indie honesto: se afirma lo que la versión hace, sin humo corporativo ("experiencia renovada", "llevamos X al siguiente nivel" = PROHIBIDO).
- Los términos técnicos reales (React.memo, Supabase, GPU Lightmapping, APK) se usan solo si el desarrollador los mencionó, y siempre acompañados del beneficio para el usuario.
- Mayúsculas de énfasis solo en "t" y "title"; en "d" y "note" escritura normal.

# PROHIBICIONES

- NO inventes cambios, números, porcentajes ni features que no estén en el texto del desarrollador.
- NO uses emojis en ningún campo.
- NO menciones fechas ni números de versión dentro de los textos.
- NO uses la palabra "versión" en "title".
- NO devuelvas texto fuera del objeto JSON.

# FORMATO DE SALIDA (contrato estricto)

{"title": "...", "note": "...", "details": [{"t": "...", "d": "..."}]}`;

function buildMessages({ projectName, platform, versionNumber, changesText, examples }) {
    const exampleBlock = (Array.isArray(examples) ? examples : []).slice(0, 3).map(v => JSON.stringify({
        title: v.title,
        note: v.note,
        details: (v.details || []).slice(0, 4),
    })).join('\n');

    const user = `Proyecto: ${projectName || 'Proyecto MGGX'}
Plataforma de esta versión: ${platform === 'android' ? 'Android (APK)' : 'PC (Windows)'}
Nueva versión: ${versionNumber || 'sin número definido'}

Últimas versiones publicadas de ESTE proyecto (imitá exactamente este estilo):
${exampleBlock || '(proyecto sin versiones previas con patch notes: aplicá la guía de estilo general)'}

Texto crudo del desarrollador con los cambios de esta versión:
"""
${String(changesText).slice(0, 2000)}
"""

Generá el JSON de la nueva versión.`;

    return [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
    ];
}

async function callNim(messages) {
    const res = await fetch(NIM_ENDPOINT, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify({
            model: NIM_MODEL,
            messages,
            temperature: 0.6,
            top_p: 0.9,
            max_tokens: 900,
        }),
    });
    if (!res.ok) throw new Error(`NVIDIA NIM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
}

function extractJson(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('la IA no devolvió JSON válido.');
    return JSON.parse(candidate.slice(start, end + 1));
}
