// player.js — Vista del jugador: amigo secreto (PIN + revelado) y listas de deseos.
import { isConfigured, loadFirebase } from "./firebase-config.js";
import {
    initials, colorFor, randomPhrase, isValidPin,
    hashPin, verifyPin, randomSaltHex, normalizeName, SUSPENSE_MESSAGES
} from "./core.js";

const $ = (id) => document.getElementById(id);

function showScreen(id) {
    document.querySelectorAll(".screen").forEach((el) => el.classList.remove("is-active"));
    if (id) $(id).classList.add("is-active");
}
function showPublic(id) {
    $("tabs").hidden = true;
    $("viewReveal").hidden = true;
    $("viewWishlists").hidden = true;
    showScreen(id);
}

// --- URL ---
function getGameCode() {
    const code = new URLSearchParams(location.search).get("game");
    return code ? code.trim().toUpperCase() : "";
}
function goToGame(code) {
    location.href = location.pathname + "?game=" + encodeURIComponent(code.trim().toUpperCase());
}

// --- Estado ---
let fb = null;
let gameCode = "";
let players = [];
let currentView = "reveal";
const MAX_NOTES = 20;
// Identidad recordada solo en memoria (para esta visita): quién ya demostró
// su PIN, así no hay que volver a pedirlo para marcar "comprado".
let myIdentity = null;
function setIdentity(id, name) {
    myIdentity = id ? { id, name } : null;
    const bar = $("identityBar");
    if (myIdentity) { $("identityName").textContent = name; bar.hidden = false; }
    else { bar.hidden = true; }
}

async function start() {
    if (!isConfigured()) { showPublic("stateConfig"); return; }
    gameCode = getGameCode();
    if (!gameCode) { setupCodeForm(); showPublic("stateCode"); return; }
    try {
        fb = await loadFirebase();
        await fb.authMod.signInAnonymously(fb.auth);
    } catch (err) { console.error(err); showPublic("stateConfig"); return; }
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
    let snap;
    try { snap = await fsMod.getDoc(fsMod.doc(db, "games", gameCode)); }
    catch (err) { console.error(err); showPublic("stateNotFound"); return; }
    if (!snap.exists()) { showPublic("stateNotFound"); return; }

    const game = snap.data();
    $("gameTitle").textContent = game.title || "Amigo Secreto";
    if (game.status !== "drawn") { showPublic("stateWaiting"); return; }

    const q = fsMod.query(fsMod.collection(db, "games", gameCode, "players"), fsMod.orderBy("order"));
    fsMod.onSnapshot(q, (qs) => {
        players = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
        $("tabs").hidden = false;
        $("viewReveal").hidden = currentView !== "reveal";
        $("viewWishlists").hidden = currentView !== "wishlists";
        if (currentView === "reveal") renderReveal(); else renderWishlists();
    }, (err) => { console.error(err); showPublic("stateNotFound"); });
}

// --- Navegación ---
$("tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (tab) setView(tab.dataset.view);
});
function setView(name) {
    currentView = name;
    $("viewReveal").hidden = name !== "reveal";
    $("viewWishlists").hidden = name !== "wishlists";
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === name));
    if (name === "reveal") renderReveal(); else renderWishlists();
}

function playerById(id) { return players.find((p) => p.id === id); }

// --- Vista: mi amigo secreto ---
function renderReveal() {
    const total = players.length;
    const done = players.filter((p) => p.revealed).length;
    if (total > 0 && done === total) showScreen("revealDone"); else showScreen("statePick");
    renderNames();
}
function renderNames() {
    const grid = $("nameGrid");
    grid.textContent = "";
    if (players.length === 0) { grid.appendChild(emptyBoardMsg()); return; }
    players.forEach((p) => {
        const card = nameCard(p, p.revealed ? "✓ visto" : "");
        card.addEventListener("click", () => onPickName(p));
        grid.appendChild(card);
    });
}

function emptyBoardMsg() {
    const div = document.createElement("div");
    div.className = "deseos__empty";
    div.style.gridColumn = "1 / -1";
    div.innerHTML = "Este sorteo todavía no tiene participantes. El organizador debe agregarlos y sortear desde el <a href=\"admin.html\">panel</a>.";
    return div;
}

// --- Vista: listas de deseos (tablero) ---
function renderWishlists() {
    const grid = $("wishGrid");
    grid.textContent = "";
    if (players.length === 0) { grid.appendChild(emptyBoardMsg()); return; }
    players.forEach((p) => {
        const n = (p.wishlist || []).length;
        const card = nameCard(p, n ? ("🎁 " + n) : "ver");
        card.addEventListener("click", () => openWishView(p));
        grid.appendChild(card);
    });
}

function nameCard(p, badgeText) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "name-card" + (p.revealed ? " is-revealed" : "");
    const avatar = document.createElement("span");
    avatar.className = "name-card__avatar";
    avatar.style.backgroundColor = colorFor(p.name);
    avatar.textContent = initials(p.name);
    avatar.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "name-card__name";
    name.textContent = p.name;
    card.append(avatar, name);
    if (badgeText) {
        const badge = document.createElement("span");
        badge.className = "name-card__badge";
        badge.textContent = badgeText;
        card.appendChild(badge);
    }
    return card;
}

// --- Verificación de identidad con PIN (crear la primera vez o ingresar) ---
async function verifyPlayer(player, note) {
    const claimed = Boolean(player.pinHash);
    if (!claimed) {
        const pin = await openPinModal({
            title: "Hola, " + player.name,
            note: note || "Crea un PIN de 4 dígitos. Lo necesitarás para volver a entrar y evita que otra persona toque tu nombre.",
            mode: "create",
            validate: async (p1, p2) => {
                if (!isValidPin(p1)) return "El PIN debe tener 4 dígitos.";
                if (p1 !== p2) return "Los PIN no coinciden.";
                return null;
            }
        });
        if (pin === null) return false;
        const salt = randomSaltHex();
        const pinHash = await hashPin(pin, salt);
        try {
            await fb.fsMod.updateDoc(fb.fsMod.doc(fb.db, "games", gameCode, "players", player.id),
                { pinHash, pinSalt: salt, revealed: true });
        } catch (err) { console.error(err); alert("No se pudo guardar tu PIN. Inténtalo otra vez."); return false; }
        setIdentity(player.id, player.name);
        return true;
    }
    const pin = await openPinModal({
        title: player.name,
        note: note || "Ingresa tu PIN.",
        mode: "enter",
        validate: async (p1) => {
            if (!isValidPin(p1)) return "El PIN debe tener 4 dígitos.";
            return (await verifyPin(p1, player.pinSalt, player.pinHash)) ? null : "PIN incorrecto.";
        }
    });
    if (pin === null) return false;
    myIdentity = { id: player.id, name: player.name };
    return true;
}

async function onPickName(player) {
    if (await verifyPlayer(player, "Ingresa tu PIN para ver tu amigo secreto.")) await reveal(player.id);
}

let revealedId = null;
async function reveal(playerId) {
    revealedId = playerId;
    await runSuspense();
    const me = playerById(playerId);
    const receiver = playerById(me.receiverId);
    $("giverLabel").textContent = me.name;
    $("secretName").textContent = me.receiver || (receiver && receiver.name) || "—";
    $("funnyPhrase").textContent = randomPhrase();
    // Blindaje: si algún dato (lista/notas) llegara corrupto, no debe impedir
    // que la persona vea a su amigo secreto.
    try { renderRevealWishlist(receiver); } catch (err) { console.error(err); $("revealWishlist").textContent = ""; }
    try { renderNotesForMe(me); } catch (err) { console.error(err); $("notesForMeBox").textContent = ""; }
    $("noteReceiverName").textContent = (receiver && receiver.name) || me.receiver || "tu amigo";
    $("noteInput").value = "";
    $("noteFeedback").textContent = "";
    openOverlay("revealOverlay");
    $("closeRevealBtn").focus();
    launchConfetti();
}
function renderRevealWishlist(receiver) {
    const box = $("revealWishlist");
    box.textContent = "";
    const title = document.createElement("div");
    title.className = "wishbox__title";
    title.textContent = "🎁 La lista de deseos de " + (receiver ? receiver.name : "tu amigo") + ":";
    box.appendChild(title);
    box.appendChild(deseosList(receiver && receiver.wishlist, "Aún no agregó nada a su lista.",
        receiver && receiver.id, () => renderRevealWishlist(receiver)));
}

$("editMyWishBtn").addEventListener("click", () => {
    if (revealedId) openWishEdit(playerById(revealedId));
});

// --- Mensajes anónimos entre amigo secreto y su amigo ---
function renderNotesForMe(me) {
    const box = $("notesForMeBox");
    box.textContent = "";
    const title = document.createElement("div");
    title.className = "wishbox__title";
    title.textContent = "📬 Mensajes que te dejó tu amigo secreto:";
    box.appendChild(title);
    const list = document.createElement("ul");
    list.className = "notas";
    const notes = asArray(me.notesForMe).filter((x) => typeof x === "string");
    if (notes.length === 0) {
        const empty = document.createElement("li");
        empty.className = "deseos__empty";
        empty.textContent = "Todavía no te han dejado mensajes.";
        list.appendChild(empty);
    } else {
        notes.forEach((text) => {
            const li = document.createElement("li");
            li.className = "nota";
            const icon = document.createElement("span");
            icon.className = "nota__icon"; icon.textContent = "💌"; icon.setAttribute("aria-hidden", "true");
            const t = document.createElement("span");
            t.className = "nota__text"; t.textContent = text;
            li.append(icon, t);
            list.appendChild(li);
        });
    }
    box.appendChild(list);
}

$("noteSendBtn").addEventListener("click", sendAnonymousNote);
$("noteInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendAnonymousNote(); } });
async function sendAnonymousNote() {
    if (!revealedId) return;
    const me = playerById(revealedId);
    const receiver = playerById(me.receiverId);
    if (!receiver) { $("noteFeedback").textContent = "No se pudo identificar a tu amigo secreto."; return; }
    const text = normalizeName($("noteInput").value);
    if (!text) { $("noteFeedback").textContent = "Escribe un mensaje."; return; }
    const current = asArray(receiver.notesForMe);
    if (current.length >= MAX_NOTES) {
        $("noteFeedback").textContent = "Tu amigo ya tiene muchos mensajes esperando. Espera a que los lea.";
        return;
    }
    try {
        await fb.fsMod.updateDoc(fb.fsMod.doc(fb.db, "games", gameCode, "players", receiver.id),
            { notesForMe: current.concat([text]) });
        $("noteInput").value = "";
        $("noteFeedback").textContent = "✓ Mensaje enviado (anónimo)";
        $("noteFeedback").classList.add("feedback--ok");
        setTimeout(() => { $("noteFeedback").textContent = ""; $("noteFeedback").classList.remove("feedback--ok"); }, 3000);
    } catch (err) { console.error(err); $("noteFeedback").textContent = "No se pudo enviar. Revisa tu conexión."; }
}

// --- Marcar regalos como "comprados" (anotación privada de quien mira) ---
function asArray(v) { return Array.isArray(v) ? v : []; }
function getMyBoughtSet(targetId) {
    if (!myIdentity || !targetId) return new Set();
    const me = playerById(myIdentity.id);
    const marks = (me && me.boughtMarks && typeof me.boughtMarks === "object") ? me.boughtMarks : {};
    // Blindaje: aunque un dato corrupto en Firestore trajera un valor no-lista,
    // asArray evita el TypeError de new Set(no-iterable).
    return new Set(asArray(marks[targetId]));
}
async function toggleBought(targetId, text) {
    if (!myIdentity) {
        alert("Primero identifícate: entra a «🎁 Mi amigo secreto», toca tu nombre y verifica tu PIN.");
        return;
    }
    const me = playerById(myIdentity.id);
    const marks = JSON.parse(JSON.stringify((me && me.boughtMarks) || {}));
    const set = new Set(marks[targetId] || []);
    if (set.has(text)) set.delete(text); else set.add(text);
    marks[targetId] = Array.from(set);
    try {
        await fb.fsMod.updateDoc(fb.fsMod.doc(fb.db, "games", gameCode, "players", myIdentity.id),
            { boughtMarks: marks });
    } catch (err) { console.error(err); alert("No se pudo guardar. Revisa tu conexión."); }
}

// --- Ver lista de deseos (solo lectura, con toggle de "comprado") ---
let viewedId = null;
function openWishView(player) {
    viewedId = player.id;
    $("wishViewTitle").textContent = "Lista de " + player.name;
    const av = $("wishViewAvatar");
    av.textContent = initials(player.name);
    av.style.backgroundColor = colorFor(player.name);
    renderWishViewContents();
    openOverlay("wishViewModal");
    $("wishViewClose").focus();
}
function renderWishViewContents() {
    const player = playerById(viewedId);
    if (!player) return;
    const list = $("wishViewList");
    list.textContent = "";
    list.appendChild(deseosList(player.wishlist, "Esta persona aún no agregó su lista de deseos.",
        player.id, renderWishViewContents));
}
$("wishViewClose").addEventListener("click", () => closeOverlay("wishViewModal"));

// "Es mi lista, editar": pide el PIN del dueño y abre el editor.
$("wishEditFromView").addEventListener("click", async () => {
    const player = playerById(viewedId);
    if (!player) return;
    closeOverlay("wishViewModal");
    if (await verifyPlayer(player, "Ingresa tu PIN para editar tu lista.")) {
        openWishEdit(playerById(player.id) || player);
    }
});

// targetId + refresh son opcionales: cuando están presentes, cada ítem
// muestra un botón para marcar/desmarcar "comprado" (anotación privada de
// quien mira, no visible para nadie más).
function deseosList(items, emptyMsg, targetId, refresh) {
    const frag = document.createDocumentFragment();
    const arr = asArray(items).filter((x) => typeof x === "string");
    if (arr.length === 0) {
        const empty = document.createElement("li");
        empty.className = "deseos__empty";
        empty.textContent = emptyMsg;
        frag.appendChild(empty);
        return frag;
    }
    const boughtSet = targetId ? getMyBoughtSet(targetId) : new Set();
    arr.forEach((text) => {
        const bought = boughtSet.has(text);
        const li = document.createElement("li");
        li.className = "deseo" + (bought ? " is-bought" : "");
        const icon = document.createElement("span");
        icon.className = "deseo__icon"; icon.textContent = "🎁"; icon.setAttribute("aria-hidden", "true");
        const t = document.createElement("span");
        t.className = "deseo__text"; t.textContent = text;
        li.append(icon, t);
        if (targetId) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "deseo__bought";
            btn.textContent = bought ? "✅" : "🛒";
            btn.title = bought ? "Marcado como comprado (toca para desmarcar)" : "Marcar como comprado (solo tú lo ves)";
            btn.setAttribute("aria-label", btn.title);
            btn.addEventListener("click", async () => { await toggleBought(targetId, text); if (refresh) refresh(); });
            li.appendChild(btn);
        }
        frag.appendChild(li);
    });
    return frag;
}

// --- Editar mi lista de deseos ---
let editPlayerId = null;
let editItems = [];
function openWishEdit(player) {
    editPlayerId = player.id;
    editItems = (player.wishlist || []).slice();
    $("wishEditTitle").textContent = "Tu lista de deseos, " + player.name;
    $("wishInput").value = "";
    $("wishFeedback").textContent = "";
    renderEditItems();
    openOverlay("wishEditModal");
    setTimeout(() => $("wishInput").focus(), 50);
}
function renderEditItems() {
    const list = $("wishEditList");
    list.textContent = "";
    if (editItems.length === 0) {
        const empty = document.createElement("li");
        empty.className = "deseos__empty";
        empty.textContent = "Aún no agregaste nada. Escribe un regalo y pulsa Agregar.";
        list.appendChild(empty);
        return;
    }
    editItems.forEach((text, i) => {
        const li = document.createElement("li");
        li.className = "deseo";
        const icon = document.createElement("span");
        icon.className = "deseo__icon"; icon.textContent = "🎁"; icon.setAttribute("aria-hidden", "true");
        const t = document.createElement("span");
        t.className = "deseo__text"; t.textContent = text;
        const rm = document.createElement("button");
        rm.className = "deseo__remove"; rm.type = "button"; rm.textContent = "✕";
        rm.setAttribute("aria-label", "Quitar");
        rm.addEventListener("click", () => { editItems.splice(i, 1); renderEditItems(); });
        li.append(icon, t, rm);
        list.appendChild(li);
    });
}
function addWishItem() {
    const text = normalizeName($("wishInput").value);
    if (!text) { $("wishFeedback").textContent = "Escribe un regalo."; return; }
    if (editItems.length >= 20) { $("wishFeedback").textContent = "Máximo 20 deseos."; return; }
    // Sin duplicados exactos: el estado "comprado" se indexa por texto, así que
    // dos ítems idénticos compartirían la marca.
    if (editItems.some((x) => x.toLowerCase() === text.toLowerCase())) {
        $("wishFeedback").textContent = "Ese deseo ya está en tu lista.";
        return;
    }
    editItems.push(text);
    $("wishInput").value = "";
    $("wishFeedback").textContent = "";
    renderEditItems();
    $("wishInput").focus();
}
$("wishAddBtn").addEventListener("click", addWishItem);
$("wishInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addWishItem(); } });
$("wishSaveBtn").addEventListener("click", async () => {
    if (!editPlayerId) return;
    try {
        await fb.fsMod.updateDoc(fb.fsMod.doc(fb.db, "games", gameCode, "players", editPlayerId),
            { wishlist: editItems });
        closeOverlay("wishEditModal");
    } catch (err) { console.error(err); $("wishFeedback").textContent = "No se pudo guardar. Revisa tu conexión."; }
});
$("wishEditClose").addEventListener("click", () => closeOverlay("wishEditModal"));

// --- Overlays / suspenso / confetti / PIN (reutilizados) ---
function openOverlay(id) { const el = $(id); el.classList.add("is-open"); el.setAttribute("aria-hidden", "false"); }
function closeOverlay(id) { const el = $(id); el.classList.remove("is-open"); el.setAttribute("aria-hidden", "true"); }

$("closeRevealBtn").addEventListener("click", () => {
    closeOverlay("revealOverlay");
    document.querySelectorAll(".confetti-piece").forEach((el) => el.remove());
});
$("tryAnotherBtn").addEventListener("click", () => goToGame(""));
$("reloadBtn").addEventListener("click", () => location.reload());
$("changeCodeLink").addEventListener("click", (e) => { e.preventDefault(); goToGame(""); });
// "No soy yo / cambiar": olvida la identidad en memoria (para pasar el
// dispositivo a otra persona) sin recargar. La próxima acción pedirá el PIN.
$("identityChange").addEventListener("click", (e) => {
    e.preventDefault();
    setIdentity(null);
    if ($("wishViewModal").classList.contains("is-open")) renderWishViewContents();
    if (currentView === "reveal") renderReveal(); else renderWishlists();
});

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

let pinResolver = null;
function openPinModal(opts) {
    return new Promise((resolve) => {
        pinResolver = resolve;
        $("pinTitle").textContent = opts.title;
        $("pinNote").textContent = opts.note;
        $("pin2Field").hidden = opts.mode !== "create";
        $("pin1Label").textContent = opts.mode === "create" ? "PIN (4 dígitos)" : "Tu PIN";
        $("pin1").value = ""; $("pin2").value = "";
        $("pinFeedback").textContent = "";
        openOverlay("pinModal");
        setTimeout(() => $("pin1").focus(), 50);

        const confirm = async () => {
            const error = await opts.validate($("pin1").value.trim(), $("pin2").value.trim());
            if (error) { $("pinFeedback").textContent = error; return; }
            cleanup(); resolve($("pin1").value.trim());
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

const CONFETTI_COLORS = ["#0ea5e9", "#f59e0b", "#38bdf8", "#22d3ee", "#fbbf24", "#0284c7"];
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

// Cerrar modales con clic en el fondo / Escape
["revealOverlay", "wishViewModal", "wishEditModal"].forEach((id) => {
    $(id).addEventListener("click", (e) => { if (e.target === $(id)) closeOverlay(id); });
});
document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    ["wishEditModal", "wishViewModal", "revealOverlay"].forEach((id) => {
        if ($(id).classList.contains("is-open")) closeOverlay(id);
    });
});

start();
