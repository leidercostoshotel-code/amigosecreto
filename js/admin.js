// admin.js — Panel del organizador: login, lista, sorteo y resultados.
import { isConfigured, loadFirebase } from "./firebase-config.js";
import {
    initials, colorFor, validateName, buildAssignments, makeGameCode
} from "./core.js";

const $ = (id) => document.getElementById(id);
const steps = {
    loading: $("stateLoading"),
    config: $("stateConfig"),
    login: $("stateLogin"),
    create: $("stateCreate"),
    setup: $("stateSetup"),
    drawn: $("stateDrawn")
};
function showStep(name) {
    Object.values(steps).forEach((el) => el.classList.remove("is-active"));
    steps[name].classList.add("is-active");
    $("logoutBtn").hidden = !["create", "setup", "drawn"].includes(name);
}
function flash(el, msg, ok = false) {
    el.textContent = msg;
    el.classList.toggle("feedback--ok", ok);
    if (msg && !ok) { clearTimeout(el._t); el._t = setTimeout(() => { el.textContent = ""; }, 4000); }
}

let fb = null;
let uid = null;
let gameId = null;
let game = null;          // datos del juego actual
let unsubGame = null;
let unsubPlayers = null;

// ============================ Arranque ============================
async function start() {
    if (!isConfigured()) { showStep("config"); return; }
    try {
        fb = await loadFirebase();
    } catch (err) { console.error(err); showStep("config"); return; }

    fb.authMod.onAuthStateChanged(fb.auth, async (user) => {
        if (!user) { teardown(); showStep("login"); return; }
        uid = user.uid;
        await loadAdminGame();
    });
}

function teardown() {
    if (unsubGame) { unsubGame(); unsubGame = null; }
    if (unsubPlayers) { unsubPlayers(); unsubPlayers = null; }
    gameId = null; game = null;
}

// ============================ Login ============================
$("loginBtn").addEventListener("click", login);
$("password").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
async function login() {
    const email = $("email").value.trim();
    const password = $("password").value;
    if (!email || !password) { flash($("loginFeedback"), "Escribe tu correo y contraseña."); return; }
    showStep("loading");
    try {
        await fb.authMod.signInWithEmailAndPassword(fb.auth, email, password);
        // onAuthStateChanged continúa el flujo.
    } catch (err) {
        showStep("login");
        const map = {
            "auth/invalid-credential": "Correo o contraseña incorrectos.",
            "auth/invalid-email": "El correo no es válido.",
            "auth/user-not-found": "No existe esa cuenta.",
            "auth/wrong-password": "Contraseña incorrecta.",
            "auth/too-many-requests": "Demasiados intentos. Espera un momento."
        };
        flash($("loginFeedback"), map[err.code] || "No se pudo iniciar sesión.");
    }
}
$("logoutBtn").addEventListener("click", () => fb.authMod.signOut(fb.auth));

// ============================ Cargar / crear juego ============================
async function loadAdminGame() {
    showStep("loading");
    const { fsMod, db } = fb;
    let games = [];
    try {
        const qs = await fsMod.getDocs(
            fsMod.query(fsMod.collection(db, "games"), fsMod.where("adminUid", "==", uid))
        );
        games = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) { console.error(err); flash($("loginFeedback"), "No se pudo cargar."); showStep("login"); return; }

    if (games.length === 0) { showStep("create"); return; }
    games.sort((a, b) => (millis(b.createdAt) - millis(a.createdAt)));
    setGame(games[0].id);
}
function millis(ts) { return ts && typeof ts.toMillis === "function" ? ts.toMillis() : 0; }

$("createBtn").addEventListener("click", createGame);
$("gameTitleInput").addEventListener("keydown", (e) => { if (e.key === "Enter") createGame(); });
async function createGame() {
    const title = $("gameTitleInput").value.trim() || "Amigo Secreto";
    const { fsMod, db } = fb;
    const code = makeGameCode();
    try {
        await fsMod.setDoc(fsMod.doc(db, "games", code), {
            adminUid: uid, title, status: "setup", participants: [],
            createdAt: fsMod.serverTimestamp(), updatedAt: fsMod.serverTimestamp()
        });
        $("gameTitleInput").value = "";
        setGame(code);
    } catch (err) { console.error(err); flash($("createFeedback"), "No se pudo crear el sorteo."); }
}

function setGame(id) {
    teardown();
    gameId = id;
    const { fsMod, db } = fb;
    unsubGame = fsMod.onSnapshot(fsMod.doc(db, "games", id), (snap) => {
        if (!snap.exists()) { loadAdminGame(); return; }
        game = { id: snap.id, ...snap.data() };
        if (game.status === "drawn") renderDrawn(); else renderSetup();
    }, (err) => console.error(err));
}

// ============================ Fase setup ============================
function gameRef() { return fb.fsMod.doc(fb.db, "games", gameId); }
function playersColl() { return fb.fsMod.collection(fb.db, "games", gameId, "players"); }

function renderSetup() {
    showStep("setup");
    if (unsubPlayers) { unsubPlayers(); unsubPlayers = null; }
    $("setupTitle").textContent = game.title || "Participantes";
    const names = game.participants || [];
    const list = $("participantsList");
    list.textContent = "";
    $("countPill").textContent = String(names.length);

    if (names.length === 0) {
        const empty = document.createElement("li");
        empty.className = "participants__empty";
        empty.textContent = "Aún no hay participantes. Agrega al menos 2.";
        list.appendChild(empty);
    } else {
        names.forEach((name) => {
            const li = document.createElement("li");
            li.className = "participant";
            const avatar = document.createElement("span");
            avatar.className = "participant__avatar";
            avatar.style.backgroundColor = colorFor(name);
            avatar.textContent = initials(name);
            avatar.setAttribute("aria-hidden", "true");
            const span = document.createElement("span");
            span.className = "participant__name";
            span.textContent = name;
            const remove = document.createElement("button");
            remove.className = "participant__remove";
            remove.type = "button";
            remove.setAttribute("aria-label", "Eliminar a " + name);
            remove.textContent = "✕";
            remove.addEventListener("click", () => removeName(name));
            li.append(avatar, span, remove);
            list.appendChild(li);
        });
    }
    $("drawBtn").disabled = names.length < 2;
}

$("addBtn").addEventListener("click", addName);
$("nameInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addName(); } });
async function addName() {
    const names = (game.participants || []).slice();
    const res = validateName($("nameInput").value, names);
    if (!res.ok) { flash($("nameFeedback"), res.error); return; }
    names.push(res.name);
    $("nameInput").value = "";
    $("nameInput").focus();
    try { await fb.fsMod.updateDoc(gameRef(), { participants: names, updatedAt: fb.fsMod.serverTimestamp() }); }
    catch (err) { console.error(err); flash($("nameFeedback"), "No se pudo guardar."); }
}
async function removeName(name) {
    const names = (game.participants || []).filter((n) => n !== name);
    try { await fb.fsMod.updateDoc(gameRef(), { participants: names, updatedAt: fb.fsMod.serverTimestamp() }); }
    catch (err) { console.error(err); }
}

// ============================ Sorteo ============================
$("drawBtn").addEventListener("click", () => draw());
$("redrawBtn").addEventListener("click", () => {
    if (confirm("Se hará un nuevo sorteo con las mismas personas y se borrarán los PIN y revelados. ¿Continuar?")) draw();
});
async function draw() {
    const names = (game.participants || []);
    if (names.length < 2) return;
    const { fsMod, db } = fb;
    const input = names.map((name) => ({ id: fsMod.doc(playersColl()).id, name }));
    const assignments = buildAssignments(input);

    try {
        const existing = await fsMod.getDocs(playersColl());
        const batch = fsMod.writeBatch(db);
        existing.forEach((d) => batch.delete(d.ref));
        assignments.forEach((a, i) => {
            batch.set(fsMod.doc(db, "games", gameId, "players", a.giverId), {
                name: a.giver, receiver: a.receiver, order: i,
                pinHash: null, pinSalt: null, revealed: false
            });
        });
        batch.update(gameRef(), { status: "drawn", updatedAt: fsMod.serverTimestamp() });
        await batch.commit();
    } catch (err) { console.error(err); alert("No se pudo hacer el sorteo. Revisa tu conexión."); }
}

$("editBtn").addEventListener("click", async () => {
    try { await fb.fsMod.updateDoc(gameRef(), { status: "setup" }); }
    catch (err) { console.error(err); }
});
$("newGameBtn").addEventListener("click", () => {
    if (confirm("Esto te llevará a crear un sorteo nuevo. El actual se conserva. ¿Continuar?")) showStep("create");
});
$("deleteGameBtn").addEventListener("click", deleteGame);
async function deleteGame() {
    if (!confirm("Se eliminará este sorteo por completo. ¿Seguro?")) return;
    const { fsMod, db } = fb;
    try {
        const existing = await fsMod.getDocs(playersColl());
        const batch = fsMod.writeBatch(db);
        existing.forEach((d) => batch.delete(d.ref));
        batch.delete(gameRef());
        await batch.commit();
        await loadAdminGame();
    } catch (err) { console.error(err); alert("No se pudo eliminar."); }
}

// ============================ Fase sorteo hecho ============================
function playerUrl() {
    const base = location.origin + location.pathname.replace(/[^/]*$/, "index.html");
    return base + "?game=" + gameId;
}
function renderDrawn() {
    showStep("drawn");
    $("shareCode").textContent = gameId;
    $("shareLink").textContent = playerUrl();

    if (unsubPlayers) unsubPlayers();
    const { fsMod, db } = fb;
    const q = fsMod.query(playersColl(), fsMod.orderBy("order"));
    unsubPlayers = fsMod.onSnapshot(q, (qs) => {
        const players = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderAssignments(players);
    }, (err) => console.error(err));
}

function renderAssignments(players) {
    const total = players.length;
    const done = players.filter((p) => p.revealed).length;
    $("progressText").textContent = done + " / " + total;
    $("progressFill").style.width = total ? Math.round((done / total) * 100) + "%" : "0%";
    $("drawnCount").textContent = String(total);

    const wrap = $("assignmentsList");
    wrap.textContent = "";
    players.forEach((p) => {
        const row = document.createElement("div");
        row.className = "assignment";

        const from = document.createElement("span");
        from.className = "assignment__from";
        from.textContent = p.name;

        const arrow = document.createElement("span");
        arrow.className = "assignment__arrow";
        arrow.textContent = "➜";
        arrow.setAttribute("aria-hidden", "true");

        const to = document.createElement("span");
        to.className = "assignment__to";
        to.textContent = p.receiver;

        const meta = document.createElement("span");
        meta.className = "participant__meta";
        meta.style.flex = "none";
        meta.textContent = p.revealed ? "✓ visto" : (p.pinHash ? "🔒" : "·");

        row.append(from, arrow, to, meta);

        if (p.pinHash || p.revealed) {
            const reset = document.createElement("button");
            reset.className = "participant__remove";
            reset.type = "button";
            reset.title = "Restablecer PIN de " + p.name;
            reset.setAttribute("aria-label", "Restablecer PIN de " + p.name);
            reset.textContent = "↺";
            reset.addEventListener("click", () => resetPin(p));
            row.appendChild(reset);
        }
        wrap.appendChild(row);
    });
}

async function resetPin(p) {
    if (!confirm("Restablecer el PIN de " + p.name + "? Podrá volver a entrar y crear uno nuevo.")) return;
    try {
        await fb.fsMod.updateDoc(
            fb.fsMod.doc(fb.db, "games", gameId, "players", p.id),
            { pinHash: null, pinSalt: null, revealed: false }
        );
    } catch (err) { console.error(err); }
}

$("copyLinkBtn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(playerUrl()); flash($("copyHint"), "✓ Enlace copiado", true); }
    catch { flash($("copyHint"), "Copia el enlace manualmente.", true); }
});

start();
