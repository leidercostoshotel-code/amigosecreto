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
    let h = 0;
    const s = String(name);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
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
