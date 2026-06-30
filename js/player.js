// player.js — Vista del jugador: elegir nombre, validar PIN y revelar su amigo secreto.
import { isConfigured, loadFirebase } from "./firebase-config.js";
import {
    initials, colorFor, randomPhrase, isValidPin,
    hashPin, verifyPin, randomSaltHex, SUSPENSE_MESSAGES
} from "./core.js";

const $ = (id) => document.getElementById(id);

const steps = {
    loading: $("stateLoading"),
    config: $("stateConfig"),
    code: $("stateCode"),
    notFound: $("stateNotFound"),
    waiting: $("stateWaiting"),
    pick: $("statePick")
};
function showStep(name) {
    Object.values(steps).forEach((el) => el.classList.remove("is-active"));
    steps[name].classList.add("is-active");
}

// --- Helpers de URL ---
function getGameCode() {
    const code = new URLSearchParams(location.search).get("game");
    return code ? code.trim().toUpperCase() : "";
}
function goToGame(code) {
    location.href = location.pathname + "?game=" + encodeURIComponent(code.trim().toUpperCase());
}

// --- Estado en memoria ---
let fb = null;        // bundle de Firebase
let gameCode = "";
let players = [];     // [{ id, name, receiver, revealed, pinHash, pinSalt }]

// ============================ Arranque ============================
async function start() {
    if (!isConfigured()) { showStep("config"); return; }

    gameCode = getGameCode();
    if (!gameCode) { setupCodeForm(); showStep("code"); return; }

    try {
        fb = await loadFirebase();
        await fb.authMod.signInAnonymously(fb.auth);
    } catch (err) {
        console.error(err);
        showStep("config");
        return;
    }

    await loadGame();
}

function setupCodeForm() {
    const submit = () => {
        const code = $("codeInput").value.trim().toUpperCase();
        if (!code) { $("codeFeedback").textContent = "Escribe el código."; return; }
        goToGame(code);
    };
    $("codeBtn").addEventListener("click", submit);
    $("codeInput").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
}

async function loadGame() {
    const { fsMod, db } = fb;
    const gameRef = fsMod.doc(db, "games", gameCode);
    let snap;
    try {
        snap = await fsMod.getDoc(gameRef);
    } catch (err) {
        console.error(err);
        showStep("notFound");
        return;
    }
    if (!snap.exists()) { showStep("notFound"); return; }

    const game = snap.data();
    $("gameTitle").textContent = game.title || "Amigo Secreto";

    if (game.status !== "drawn") { showStep("waiting"); return; }

    // Escuchar la lista de jugadores en tiempo real (estado "ya visto").
    const playersRef = fsMod.collection(db, "games", gameCode, "players");
    const q = fsMod.query(playersRef, fsMod.orderBy("order"));
    fsMod.onSnapshot(q, (qs) => {
        players = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderNames();
        showStep("pick");
    }, (err) => { console.error(err); showStep("notFound"); });
}

// ============================ Lista de nombres ============================
function renderNames() {
    const grid = $("nameGrid");
    grid.textContent = "";
    players.forEach((p) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "name-card" + (p.revealed ? " is-revealed" : "");
        card.dataset.id = p.id;

        const avatar = document.createElement("span");
        avatar.className = "name-card__avatar";
        avatar.style.backgroundColor = colorFor(p.name);
        avatar.textContent = initials(p.name);
        avatar.setAttribute("aria-hidden", "true");

        const name = document.createElement("span");
        name.className = "name-card__name";
        name.textContent = p.name;

        card.append(avatar, name);

        if (p.revealed) {
            const badge = document.createElement("span");
            badge.className = "name-card__badge";
            badge.textContent = "✓ visto";
            card.appendChild(badge);
        }

        card.addEventListener("click", () => onPickName(p));
        grid.appendChild(card);
    });
}

// ============================ Flujo de revelado ============================
async function onPickName(player) {
    const claimed = Boolean(player.pinHash);

    if (!claimed) {
        // Primera vez: crear PIN.
        const pin = await openPinModal({
            title: "Hola, " + player.name,
            note: "Crea un PIN de 4 dígitos. Lo necesitarás si vuelves a abrir tu resultado, y evita que otra persona lo vea.",
            mode: "create",
            validate: async (p1, p2) => {
                if (!isValidPin(p1)) return "El PIN debe tener 4 dígitos.";
                if (p1 !== p2) return "Los PIN no coinciden.";
                return null;
            }
        });
        if (pin === null) return;

        const salt = randomSaltHex();
        const pinHash = await hashPin(pin, salt);
        try {
            await fb.fsMod.updateDoc(
                fb.fsMod.doc(fb.db, "games", gameCode, "players", player.id),
                { pinHash, pinSalt: salt, revealed: true }
            );
        } catch (err) {
            console.error(err);
            alert("No se pudo guardar tu PIN. Revisa tu conexión e inténtalo otra vez.");
            return;
        }
        await reveal(player);
    } else {
        // Ya reclamado: pedir PIN y verificar.
        const pin = await openPinModal({
            title: player.name,
            note: "Ingresa tu PIN para ver tu amigo secreto.",
            mode: "enter",
            validate: async (p1) => {
                if (!isValidPin(p1)) return "El PIN debe tener 4 dígitos.";
                const ok = await verifyPin(p1, player.pinSalt, player.pinHash);
                return ok ? null : "PIN incorrecto.";
            }
        });
        if (pin === null) return;
        await reveal(player);
    }
}

async function reveal(player) {
    await runSuspense();
    $("giverLabel").textContent = player.name;
    $("secretName").textContent = player.receiver || "—";
    $("funnyPhrase").textContent = randomPhrase();
    openOverlay("revealOverlay");
    $("closeRevealBtn").focus();
    launchConfetti();
}

function runSuspense() {
    return new Promise((resolve) => {
        const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
        const step = reduce ? 200 : 850;
        const total = reduce ? 500 : SUSPENSE_MESSAGES.length * step;
        openOverlay("suspense");
        $("suspenseMsg").textContent = SUSPENSE_MESSAGES[0];
        SUSPENSE_MESSAGES.forEach((m, i) => setTimeout(() => { $("suspenseMsg").textContent = m; }, i * step));
        setTimeout(() => { closeOverlay("suspense"); resolve(); }, total);
    });
}

// ============================ Overlays ============================
function openOverlay(id) { const el = $(id); el.classList.add("is-open"); el.setAttribute("aria-hidden", "false"); }
function closeOverlay(id) { const el = $(id); el.classList.remove("is-open"); el.setAttribute("aria-hidden", "true"); }

$("closeRevealBtn").addEventListener("click", () => {
    closeOverlay("revealOverlay");
    document.querySelectorAll(".confetti-piece").forEach((el) => el.remove());
});
$("tryAnotherBtn").addEventListener("click", () => goToGame(""));
$("reloadBtn").addEventListener("click", () => location.reload());

// ============================ Modal de PIN (promesa) ============================
let pinResolver = null;
function openPinModal(opts) {
    return new Promise((resolve) => {
        pinResolver = resolve;
        $("pinTitle").textContent = opts.title;
        $("pinNote").textContent = opts.note;
        $("pin2Field").hidden = opts.mode !== "create";
        $("pin1Label").textContent = opts.mode === "create" ? "PIN (4 dígitos)" : "Tu PIN";
        $("pin1").value = "";
        $("pin2").value = "";
        $("pinFeedback").textContent = "";
        openOverlay("pinModal");
        setTimeout(() => $("pin1").focus(), 50);

        const confirm = async () => {
            const p1 = $("pin1").value.trim();
            const p2 = $("pin2").value.trim();
            const error = await opts.validate(p1, p2);
            if (error) { $("pinFeedback").textContent = error; return; }
            cleanup();
            resolve(p1);
        };
        const cancel = () => { cleanup(); resolve(null); };
        const onKey = (e) => { if (e.key === "Enter") confirm(); if (e.key === "Escape") cancel(); };

        function cleanup() {
            closeOverlay("pinModal");
            $("pinConfirmBtn").removeEventListener("click", confirm);
            $("pinCancelBtn").removeEventListener("click", cancel);
            $("pinModal").removeEventListener("keydown", onKey);
            pinResolver = null;
        }
        $("pinConfirmBtn").addEventListener("click", confirm);
        $("pinCancelBtn").addEventListener("click", cancel);
        $("pinModal").addEventListener("keydown", onKey);
    });
}

// ============================ Confetti ============================
const CONFETTI_COLORS = ["#6366f1", "#f59e0b", "#ec4899", "#14b8a6", "#8b5cf6", "#ef4444"];
function launchConfetti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (let i = 0; i < 70; i++) {
        const piece = document.createElement("div");
        piece.className = "confetti-piece";
        piece.style.left = Math.floor(Math.random() * 100) + "%";
        piece.style.backgroundColor = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        piece.style.animationDuration = (2.6 + Math.random() * 1.8) + "s";
        piece.style.animationDelay = (Math.random() * 0.8) + "s";
        document.body.appendChild(piece);
        setTimeout(() => piece.remove(), 6000);
    }
}

start();
