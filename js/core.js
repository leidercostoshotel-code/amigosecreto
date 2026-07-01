// core.js — Lógica pura del Amigo Secreto, sin dependencias de Firebase ni del DOM.
// Se puede importar tanto en el navegador como en Node (para pruebas).

export const MAX_NAME_LENGTH = 40;
export const PIN_LENGTH = 4;

export const AVATAR_COLORS = [
    "#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#8b5cf6",
    "#0ea5e9", "#ef4444", "#10b981", "#f97316", "#3b82f6"
];
export const CONFETTI_COLORS = ["#6366f1", "#f59e0b", "#ec4899", "#14b8a6", "#8b5cf6", "#ef4444"];

export const SUSPENSE_MESSAGES = [
    "Mezclando los nombres…",
    "Guardando bien el secreto…",
    "Eligiendo a tu persona especial…",
    "¡Casi listo!"
];

export const FUNNY_PHRASES = [
    "¡Prepárate para ser el Santa más sigiloso del año! 🎅",
    "Un buen regalo dice más que mil palabras… ¡o casi! 💝",
    "Lo que pasa en el amigo secreto, se queda en el amigo secreto 🤫",
    "Misión aceptada: hacer sonreír a alguien especial 😊",
    "Pon tu creatividad en modo legendario 🌟",
    "Que comience la operación regalo perfecto 🎯",
    "Ahora eres oficialmente un agente secreto del regalo 🕵️",
    "La magia está en el detalle, no en el precio ✨"
];

// --- Aleatoriedad segura ---
export function secureRandomInt(max) {
    if (max <= 0) return 0;
    const cryptoObj = globalThis.crypto;
    if (cryptoObj && cryptoObj.getRandomValues) {
        const limit = Math.floor(0x100000000 / max) * max;
        const buf = new Uint32Array(1);
        let x;
        do { cryptoObj.getRandomValues(buf); x = buf[0]; } while (x >= limit);
        return x % max;
    }
    return Math.floor(Math.random() * max);
}

export function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = secureRandomInt(i + 1);
        const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
}

// Derangement de un solo ciclo: nadie se asigna a sí mismo, en una sola pasada.
// Recibe una lista de objetos { id, name } y devuelve [{ giverId, giver, receiverId, receiver }].
export function buildAssignments(players) {
    const order = shuffle(players);
    const out = [];
    for (let i = 0; i < order.length; i++) {
        const giver = order[i];
        const receiver = order[(i + 1) % order.length];
        out.push({
            giverId: giver.id,
            giver: giver.name,
            receiverId: receiver.id,
            receiver: receiver.name
        });
    }
    return out;
}

// Derangement con EXCLUSIONES (p. ej. no repetir el regalo del año pasado).
// participants: [{ id, name }]
// forbidden: { giverId: [receiverId, ...] }  (no incluye al propio; se agrega aquí)
// Devuelve [{ giverId, giver, receiverId, receiver }] o null si es imposible.
export function assignWithExclusions(participants, forbidden) {
    const n = participants.length;
    if (n < 2) return null;
    const nameById = {};
    const forb = {};
    participants.forEach((p) => {
        nameById[p.id] = p.name;
        forb[p.id] = new Set(forbidden && forbidden[p.id] ? forbidden[p.id] : []);
        forb[p.id].add(p.id); // nadie se regala a sí mismo
    });
    const allIds = participants.map((p) => p.id);

    // Varios intentos con orden aleatorio para repartir variedad; el backtracking
    // garantiza que, si existe solución, la encuentre (o devuelva null si no).
    for (let attempt = 0; attempt < 60; attempt++) {
        const giverOrder = shuffle(participants).map((p) => p.id);
        const used = new Set();
        const result = {};

        const solve = (i) => {
            if (i === giverOrder.length) return true;
            const giver = giverOrder[i];
            const candidates = shuffle(allIds).filter((r) => !used.has(r) && !forb[giver].has(r));
            for (const r of candidates) {
                result[giver] = r;
                used.add(r);
                if (solve(i + 1)) return true;
                used.delete(r);
                delete result[giver];
            }
            return false;
        };

        if (solve(0)) {
            return participants.map((p) => ({
                giverId: p.id,
                giver: p.name,
                receiverId: result[p.id],
                receiver: nameById[result[p.id]]
            }));
        }
    }
    return null;
}

// Derangement de UN SOLO CICLO con exclusiones (una sola cadena:
// p0 → p1 → … → p_{n-1} → p0). Al ser un único ciclo NO hay parejas
// recíprocas (A↔B) ni grupitos cerrados, y respeta las exclusiones del
// historial. Devuelve [{giverId,giver,receiverId,receiver}] o null si no
// existe esa cadena con las restricciones dadas.
export function buildCycleExcluding(participants, forbidden) {
    const n = participants.length;
    if (n < 2) return null;
    const ids = participants.map((p) => p.id);
    const nameById = {};
    const forb = {};
    participants.forEach((p) => {
        nameById[p.id] = p.name;
        forb[p.id] = new Set(forbidden && forbidden[p.id] ? forbidden[p.id] : []);
        forb[p.id].add(p.id);
    });

    for (let attempt = 0; attempt < 200; attempt++) {
        const start = ids[secureRandomInt(n)];
        const path = [start];
        const used = new Set([start]);

        const extend = () => {
            if (path.length === n) {
                // Cerrar la cadena: el último debe poder regalar al primero.
                return !forb[path[n - 1]].has(start);
            }
            const cur = path[path.length - 1];
            const candidates = shuffle(ids).filter((x) => !used.has(x) && !forb[cur].has(x));
            for (const x of candidates) {
                path.push(x);
                used.add(x);
                if (extend()) return true;
                path.pop();
                used.delete(x);
            }
            return false;
        };

        if (extend()) {
            const out = [];
            for (let i = 0; i < n; i++) {
                const g = path[i];
                const r = path[(i + 1) % n];
                out.push({ giverId: g, giver: nameById[g], receiverId: r, receiver: nameById[r] });
            }
            return out;
        }
    }
    return null;
}

// --- Validación de nombres ---
export function normalizeName(raw) {
    return String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
}

// Devuelve { ok, error } validando contra una lista existente de nombres.
export function validateName(raw, existingNames) {
    const name = normalizeName(raw);
    if (!name) return { ok: false, error: "Escribe un nombre." };
    if (name.length > MAX_NAME_LENGTH) return { ok: false, error: "Ese nombre es demasiado largo." };
    const exists = (existingNames || []).some((p) => p.toLowerCase() === name.toLowerCase());
    if (exists) return { ok: false, error: "Ese nombre ya está en la lista." };
    return { ok: true, name };
}

export function isValidPin(pin) {
    return typeof pin === "string" && new RegExp("^\\d{" + PIN_LENGTH + "}$").test(pin);
}

// --- PIN: hash con sal (SHA-256). No se guarda el PIN en claro. ---
function bytesToHex(buffer) {
    const bytes = new Uint8Array(buffer);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return hex;
}

export function randomSaltHex(byteLength = 16) {
    const buf = new Uint8Array(byteLength);
    globalThis.crypto.getRandomValues(buf);
    return bytesToHex(buf.buffer);
}

export async function hashPin(pin, saltHex) {
    const data = new TextEncoder().encode(saltHex + ":" + pin);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
    return bytesToHex(digest);
}

export async function verifyPin(pin, saltHex, expectedHash) {
    if (!saltHex || !expectedHash) return false;
    const got = await hashPin(pin, saltHex);
    return got === expectedHash;
}

// --- Helpers de presentación ---
export function initials(name) {
    const parts = normalizeName(name).split(" ");
    const a = parts[0] ? parts[0][0] : "";
    const b = parts[1] ? parts[1][0] : "";
    return (a + b).toUpperCase();
}

export function colorFor(name) {
    return AVATAR_COLORS[hashInt(name) % AVATAR_COLORS.length];
}

// --- Avatares ilustrados por género (SVG generado, sin dependencias) ---
// Se dibuja una carita amable con el pelo y el tono del fondo según el género
// (femenino / masculino / sin especificar) y con el tono de piel y de pelo
// derivados del nombre (determinista, para que cada persona se vea distinta).
// El nombre NUNCA se inserta como texto en el SVG: solo alimenta el hash, así
// que no hay riesgo de inyección al usar innerHTML con el resultado.
function hashInt(s) {
    let h = 0;
    const str = String(s == null ? "" : s);
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
}

const SKIN_TONES = ["#ffd9b3", "#f3c088", "#e0a56b", "#c68642", "#8d5524"];
const HAIR_TONES = ["#2c2320", "#4a2f27", "#6b4324", "#a5673f", "#caa03f", "#9aa0a6", "#e6ded0"];

// Normaliza el género a 'F' | 'M' | 'N' (neutro / sin especificar).
export function genderBucket(g) {
    const s = String(g == null ? "" : g).trim().toUpperCase();
    if (s === "F" || s === "FEMENINO" || s === "MUJER") return "F";
    if (s === "M" || s === "MASCULINO" || s === "HOMBRE") return "M";
    return "N";
}

export function avatarSvg(name, gender) {
    const h = hashInt(name);
    const g = genderBucket(gender);
    const skin = SKIN_TONES[h % SKIN_TONES.length];
    const hair = HAIR_TONES[Math.floor(h / 7) % HAIR_TONES.length];
    const bg = g === "F" ? ["#fca5c7", "#ec4899"]
        : g === "M" ? ["#7dd3fc", "#0284c7"]
            : ["#5eead4", "#0d9488"];
    const gid = "ag" + g + h.toString(36); // id único por avatar (evita choques entre gradientes)
    const ears = g === "F" ? "" :
        '<circle cx="30" cy="49" r="4.5" fill="' + skin + '"/><circle cx="70" cy="49" r="4.5" fill="' + skin + '"/>';
    // Pelo largo (solo femenino): va detrás de la cara y baja por los lados.
    const backHair = g === "F"
        ? '<path d="M24 52 C20 30 32 17 50 17 C68 17 80 30 76 52 L76 80 C76 70 71 63 69 61 C73 41 65 31 50 31 C35 31 27 41 31 61 C29 63 24 70 24 80 Z" fill="' + hair + '"/>'
        : "";
    // Flequillo / gorro de pelo por encima de la frente.
    const topHair = g === "F"
        ? '<path d="M30 47 C29 27 71 27 70 47 C64 36 58 33 50 33 C42 33 36 36 30 47 Z" fill="' + hair + '"/>'
        : g === "M"
            ? '<path d="M28 47 C28 24 72 24 72 47 C72 41 65 34 50 34 C35 34 28 41 28 47 Z" fill="' + hair + '"/>'
            : '<path d="M29 47 C29 25 71 25 71 47 C71 40 64 35 50 35 C36 35 29 40 29 47 Z" fill="' + hair + '"/>';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" role="img">'
        + '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">'
        + '<stop offset="0" stop-color="' + bg[0] + '"/><stop offset="1" stop-color="' + bg[1] + '"/>'
        + '</linearGradient></defs>'
        + '<rect width="100" height="100" fill="url(#' + gid + ')"/>'
        + backHair
        + '<circle cx="50" cy="48" r="21" fill="' + skin + '"/>'
        + ears
        + topHair
        + '<circle cx="42" cy="49" r="2.4" fill="#3b2a1e"/><circle cx="58" cy="49" r="2.4" fill="#3b2a1e"/>'
        + '<path d="M43 57 Q50 63 57 57" stroke="#3b2a1e" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
        + '</svg>';
}

export function randomPhrase() {
    return FUNNY_PHRASES[secureRandomInt(FUNNY_PHRASES.length)];
}

// Código de juego corto y legible (sin caracteres ambiguos).
export function makeGameCode(length = 5) {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < length; i++) code += alphabet[secureRandomInt(alphabet.length)];
    return code;
}
