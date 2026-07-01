// admin.js — Panel del organizador: integrantes, sorteo (con historial y sin repetir) e historial.
import { isConfigured, loadFirebase } from "./firebase-config.js";
import {
    avatarSvg, validateName, normalizeName,
    assignWithExclusions, buildCycleExcluding, makeGameCode
} from "./core.js";
import qrcodeGen from "./qrcode-gen.js";

const $ = (id) => document.getElementById(id);

// Pinta el avatar de una persona: su foto (si dejó enlace) o un avatar
// ilustrado según su género (o el neutro). El nombre solo alimenta el hash.
function paintAvatar(el, person) {
    el.textContent = "";
    el.style.backgroundColor = "";
    const photo = person && typeof person.photo === "string" ? person.photo.trim() : "";
    if (/^https?:\/\//i.test(photo)) {
        const img = document.createElement("img");
        img.alt = ""; img.decoding = "async"; img.loading = "lazy";
        img.addEventListener("error", () => { el.innerHTML = avatarSvg(person.name, person.gender); });
        img.src = photo;
        el.appendChild(img);
    } else {
        el.innerHTML = avatarSvg(person ? person.name : "", person ? person.gender : "");
    }
}
function normalizePhoto(raw) {
    const s = String(raw == null ? "" : raw).trim();
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) return null; // enlace inválido
    return s.slice(0, 500);
}

// --- Control segmentado de género (♀ / ♂ / sin especificar) ---
function segValue(container) {
    const active = container.querySelector(".seg__opt.is-active");
    return active ? (active.dataset.g || "") : "";
}
function segSet(container, g) {
    const want = g || "";
    container.querySelectorAll(".seg__opt").forEach((b) =>
        b.classList.toggle("is-active", (b.dataset.g || "") === want));
}
function wireSeg(container, onChange) {
    container.addEventListener("click", (e) => {
        const opt = e.target.closest(".seg__opt");
        if (!opt) return;
        segSet(container, opt.dataset.g || "");
        if (onChange) onChange(segValue(container));
    });
}
function openOverlay(id) { $(id).classList.add("is-open"); $(id).setAttribute("aria-hidden", "false"); }
function closeOverlay(id) { $(id).classList.remove("is-open"); $(id).setAttribute("aria-hidden", "true"); }

function showScreen(id) {
    document.querySelectorAll(".screen").forEach((el) => el.classList.remove("is-active"));
    if (id) $(id).classList.add("is-active");
}
function showPublic(id) {
    $("tabs").hidden = true;
    $("viewDraw").hidden = $("viewPeople").hidden = $("viewHistory").hidden = true;
    showScreen(id);
}
function flash(el, msg, ok = false) {
    el.textContent = msg;
    el.classList.toggle("feedback--ok", ok);
    if (msg && !ok) { clearTimeout(el._t); el._t = setTimeout(() => { el.textContent = ""; }, 4000); }
}
function millis(ts) { return ts && typeof ts.toMillis === "function" ? ts.toMillis() : 0; }
function fmtDate(ts) {
    if (!ts || typeof ts.toMillis !== "function") return "";
    try { return new Date(ts.toMillis()).toLocaleDateString("es-ES", { year: "numeric", month: "short", day: "numeric" }); }
    catch { return ""; }
}

// --- Estado ---
let fb = null, uid = null;
let people = [];          // roster: [{ id, name }]
let games = [];           // todos los juegos del admin
let currentGameId = null; // sorteo "actual" (no manual)
let game = null;          // datos del sorteo actual
let lastPlayers = [];     // jugadores del sorteo actual
let peek = false;
let forceCreate = false;
let currentView = "draw";
let unsubPeople = null, unsubGames = null, unsubPlayers = null, playersSubId = null;

// ============================ Arranque ============================
async function start() {
    if (!isConfigured()) { showPublic("stateConfig"); return; }
    try { fb = await loadFirebase(); }
    catch (err) { console.error(err); showPublic("stateConfig"); return; }

    fb.authMod.onAuthStateChanged(fb.auth, (user) => {
        if (!user) { teardown(); showPublic("stateLogin"); return; }
        uid = user.uid;
        initAfterLogin();
    });
}
function teardown() {
    [unsubPeople, unsubGames, unsubPlayers].forEach((u) => u && u());
    unsubPeople = unsubGames = unsubPlayers = playersSubId = null;
    people = []; games = []; currentGameId = null; game = null; lastPlayers = []; peek = false;
}

function initAfterLogin() {
    $("tabs").hidden = false;
    setView("draw");
    const { fsMod, db } = fb;
    unsubPeople = fsMod.onSnapshot(
        fsMod.query(fsMod.collection(db, "admins", uid, "people"), fsMod.orderBy("nameLower")),
        (qs) => { people = qs.docs.map((d) => ({ id: d.id, ...d.data() })); onPeopleUpdate(); },
        (err) => console.error(err)
    );
    unsubGames = fsMod.onSnapshot(
        fsMod.query(fsMod.collection(db, "games"), fsMod.where("adminUid", "==", uid)),
        (qs) => { games = qs.docs.map((d) => ({ id: d.id, ...d.data() })); onGamesUpdate(); },
        (err) => console.error(err)
    );
}

// ============================ Login ============================
$("loginBtn").addEventListener("click", login);
$("password").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
async function login() {
    const email = $("email").value.trim(), password = $("password").value;
    if (!email || !password) { flash($("loginFeedback"), "Escribe tu correo y contraseña."); return; }
    showPublic("stateLoading");
    try { await fb.authMod.signInWithEmailAndPassword(fb.auth, email, password); }
    catch (err) {
        showPublic("stateLogin");
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

// ============================ Navegación ============================
$("tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (tab) setView(tab.dataset.view);
});
function setView(name) {
    currentView = name;
    $("viewDraw").hidden = name !== "draw";
    $("viewPeople").hidden = name !== "people";
    $("viewHistory").hidden = name !== "history";
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === name));
    if (name === "draw") renderDrawView();
    else if (name === "people") renderPeople();
    else if (name === "history") renderHistory();
}

// ============================ Roster (integrantes) ============================
function peopleNames() { return people.map((p) => p.name); }
function personByName(name) { const l = name.toLowerCase(); return people.find((p) => p.name.toLowerCase() === l); }
function personById(id) { return people.find((p) => p.id === id); }
function peopleColl() { return fb.fsMod.collection(fb.db, "admins", uid, "people"); }
// Género/foto "frescos" de un participante: prioriza el integrante guardado
// (fuente de verdad, se actualiza en vivo) y cae al valor guardado en el sorteo.
function metaFor(part) {
    const r = personById(part.id);
    return {
        name: part.name,
        gender: (r && r.gender) || part.gender || "",
        photo: (r && r.photo) || part.photo || ""
    };
}

function onPeopleUpdate() {
    populateDatalist();
    if (currentView === "people") renderPeople();
    if (currentView === "draw" && game && game.status === "setup") renderSetup();
}
function populateDatalist() {
    const dl = $("peopleOptions");
    dl.textContent = "";
    people.forEach((p) => { const o = document.createElement("option"); o.value = p.name; dl.appendChild(o); });
}

async function createPerson(name, gender, photo) {
    const id = fb.fsMod.doc(peopleColl()).id;
    await fb.fsMod.setDoc(fb.fsMod.doc(fb.db, "admins", uid, "people", id),
        { name, nameLower: name.toLowerCase(), gender: gender || "", photo: photo || "", createdAt: fb.fsMod.serverTimestamp() });
    return { id, name, gender: gender || "", photo: photo || "" };
}

// Vista previa en vivo del avatar mientras se agrega un integrante.
function updatePersonPreview() {
    paintAvatar($("personPreview"), {
        name: $("personInput").value || "?",
        gender: segValue($("personGender")),
        photo: $("personPhoto").value
    });
}
wireSeg($("personGender"), updatePersonPreview);
$("personInput").addEventListener("input", updatePersonPreview);
$("personPhoto").addEventListener("input", updatePersonPreview);
$("personPhoto").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addPerson(); } });
updatePersonPreview();

$("personAddBtn").addEventListener("click", addPerson);
$("personInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addPerson(); } });
async function addPerson() {
    const res = validateName($("personInput").value, peopleNames());
    if (!res.ok) { flash($("personFeedback"), res.error); return; }
    const photo = normalizePhoto($("personPhoto").value);
    if (photo === null) { flash($("personFeedback"), "El enlace de la foto debe empezar con http:// o https://"); return; }
    const gender = segValue($("personGender"));
    $("personInput").value = ""; $("personPhoto").value = "";
    segSet($("personGender"), ""); updatePersonPreview(); $("personInput").focus();
    try { await createPerson(res.name, gender, photo); }
    catch (err) { console.error(err); flash($("personFeedback"), "No se pudo guardar."); }
}

function renderPeople() {
    $("peopleCount").textContent = String(people.length);
    const list = $("peopleList");
    list.textContent = "";
    if (people.length === 0) {
        const empty = document.createElement("li");
        empty.className = "participants__empty";
        empty.textContent = "Aún no tienes integrantes guardados. Agrega el primero.";
        list.appendChild(empty);
        return;
    }
    people.forEach((p) => {
        const li = document.createElement("li");
        li.className = "participant";
        const avatar = document.createElement("span");
        avatar.className = "participant__avatar";
        paintAvatar(avatar, p);
        avatar.setAttribute("aria-hidden", "true");
        const span = document.createElement("span");
        span.className = "participant__name";
        span.textContent = p.name;
        const edit = document.createElement("button");
        edit.className = "participant__remove";
        edit.type = "button";
        edit.title = "Editar " + p.name;
        edit.setAttribute("aria-label", "Editar " + p.name);
        edit.textContent = "✏️";
        edit.addEventListener("click", () => openPersonEditor(p));
        const del = document.createElement("button");
        del.className = "participant__remove";
        del.type = "button";
        del.title = "Eliminar " + p.name;
        del.setAttribute("aria-label", "Eliminar " + p.name);
        del.textContent = "✕";
        del.addEventListener("click", () => deletePerson(p));
        li.append(avatar, span, edit, del);
        list.appendChild(li);
    });
}
// --- Editor de integrante (nombre + género + foto, con vista previa) ---
let editingPersonId = null;
function openPersonEditor(p) {
    editingPersonId = p.id;
    $("peName").value = p.name;
    $("pePhoto").value = p.photo || "";
    segSet($("peGender"), p.gender || "");
    $("peFeedback").textContent = "";
    updatePeAvatar();
    openOverlay("personEditModal");
    setTimeout(() => $("peName").focus(), 50);
}
function updatePeAvatar() {
    paintAvatar($("peAvatar"), {
        name: $("peName").value || "?",
        gender: segValue($("peGender")),
        photo: $("pePhoto").value
    });
}
wireSeg($("peGender"), updatePeAvatar);
$("peName").addEventListener("input", updatePeAvatar);
$("pePhoto").addEventListener("input", updatePeAvatar);
$("peCancelBtn").addEventListener("click", () => closeOverlay("personEditModal"));
$("personEditModal").addEventListener("click", (e) => { if (e.target === $("personEditModal")) closeOverlay("personEditModal"); });
$("peSaveBtn").addEventListener("click", async () => {
    if (!editingPersonId) return;
    const name = normalizeName($("peName").value);
    if (!name) { flash($("peFeedback"), "Escribe un nombre."); return; }
    if (people.some((o) => o.id !== editingPersonId && o.name.toLowerCase() === name.toLowerCase())) {
        flash($("peFeedback"), "Ya tienes otro integrante con ese nombre."); return;
    }
    const photo = normalizePhoto($("pePhoto").value);
    if (photo === null) { flash($("peFeedback"), "El enlace de la foto debe empezar con http:// o https://"); return; }
    const gender = segValue($("peGender"));
    try {
        await fb.fsMod.updateDoc(fb.fsMod.doc(fb.db, "admins", uid, "people", editingPersonId),
            { name, nameLower: name.toLowerCase(), gender, photo });
        closeOverlay("personEditModal");
    } catch (err) { console.error(err); flash($("peFeedback"), "No se pudo guardar."); }
});
$("peDeleteBtn").addEventListener("click", async () => {
    const p = personById(editingPersonId);
    if (!p) { closeOverlay("personEditModal"); return; }
    if (!confirm("¿Eliminar a " + p.name + " de tus integrantes? (No afecta a los sorteos ya guardados.)")) return;
    try {
        await fb.fsMod.deleteDoc(fb.fsMod.doc(fb.db, "admins", uid, "people", p.id));
        closeOverlay("personEditModal");
    } catch (err) { console.error(err); }
});
async function deletePerson(p) {
    if (!confirm("¿Eliminar a " + p.name + " de tus integrantes? (No afecta a los sorteos ya guardados.)")) return;
    try { await fb.fsMod.deleteDoc(fb.fsMod.doc(fb.db, "admins", uid, "people", p.id)); }
    catch (err) { console.error(err); }
}

// ============================ Juegos: selección del actual ============================
function gameRef(id) { return fb.fsMod.doc(fb.db, "games", id || currentGameId); }
function playersColl(id) { return fb.fsMod.collection(fb.db, "games", id || currentGameId, "players"); }

// Cambia el sorteo actual; reinicia el spoiler para no mostrar asignaciones
// ocultas de otro sorteo sin que el admin lo confirme.
function setCurrent(id) { if (id !== currentGameId) { currentGameId = id; peek = false; } }

function onGamesUpdate() {
    if (!forceCreate) {
        const draws = games.filter((g) => g.kind !== "manual").sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
        if (!currentGameId || !games.some((g) => g.id === currentGameId)) {
            setCurrent(draws.length ? draws[0].id : null);
        }
    }
    game = games.find((g) => g.id === currentGameId) || null;
    if (currentView === "draw") renderDrawView();
    if (currentView === "history") renderHistory();
}

function renderDrawView() {
    if (forceCreate || !game) { ensureNoPlayersSub(); showScreen("stateCreate"); return; }
    if (game.status === "drawn") { renderDrawn(); }
    else { ensureNoPlayersSub(); renderSetup(); }
}
function ensureNoPlayersSub() { if (unsubPlayers) { unsubPlayers(); unsubPlayers = null; playersSubId = null; } }

// ============================ Crear sorteo ============================
$("createBtn").addEventListener("click", createGame);
$("gameTitleInput").addEventListener("keydown", (e) => { if (e.key === "Enter") createGame(); });
async function createGame() {
    const title = $("gameTitleInput").value.trim() || "Amigo Secreto";
    const code = makeGameCode();
    try {
        await fb.fsMod.setDoc(gameRef(code), {
            adminUid: uid, title, status: "setup", kind: "draw", participants: [],
            hideAssignments: false, createdAt: fb.fsMod.serverTimestamp(), updatedAt: fb.fsMod.serverTimestamp()
        });
        $("gameTitleInput").value = "";
        forceCreate = false;
        setCurrent(code);
        // Copia local optimista: evita renderizar con el 'game' anterior mientras
        // llega el snapshot (parpadeo de la pantalla de "sorteo hecho").
        game = { id: code, adminUid: uid, title, status: "setup", kind: "draw", participants: [], hideAssignments: false };
        lastPlayers = [];
        setView("draw");
    } catch (err) { console.error(err); flash($("createFeedback"), "No se pudo crear el sorteo."); }
}

// ============================ Fase setup ============================
function renderSetup() {
    showScreen("stateSetup");
    $("setupTitle").textContent = game.title || "Participantes";
    $("hidePlay").checked = Boolean(game.hideAssignments);
    $("avoidRepeat").checked = game.avoidRepeat !== false;
    populateDatalist();

    const parts = game.participants || [];
    const list = $("participantsList");
    list.textContent = "";
    $("countPill").textContent = String(parts.length);
    if (parts.length === 0) {
        const empty = document.createElement("li");
        empty.className = "participants__empty";
        empty.textContent = "Aún no hay participantes. Agrega al menos 2.";
        list.appendChild(empty);
    } else {
        parts.forEach((p) => {
            const li = document.createElement("li");
            li.className = "participant";
            const avatar = document.createElement("span");
            avatar.className = "participant__avatar";
            paintAvatar(avatar, metaFor(p));
            avatar.setAttribute("aria-hidden", "true");
            const span = document.createElement("span");
            span.className = "participant__name";
            span.textContent = p.name;
            const remove = document.createElement("button");
            remove.className = "participant__remove";
            remove.type = "button";
            remove.setAttribute("aria-label", "Quitar a " + p.name);
            remove.textContent = "✕";
            remove.addEventListener("click", () => removeParticipant(p.id));
            li.append(avatar, span, remove);
            list.appendChild(li);
        });
    }
    $("drawBtn").disabled = parts.length < 2;
}

$("addBtn").addEventListener("click", addParticipant);
$("nameInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addParticipant(); } });
async function addParticipant() {
    const parts = (game.participants || []).slice();
    const res = validateName($("nameInput").value, parts.map((p) => p.name));
    if (!res.ok) { flash($("nameFeedback"), res.error); return; }
    let person = personByName(res.name);
    $("nameInput").value = ""; $("nameInput").focus();
    try {
        if (!person) person = await createPerson(res.name);
        if (parts.some((p) => p.id === person.id)) return;
        parts.push({ id: person.id, name: person.name, gender: person.gender || "", photo: person.photo || "" });
        await fb.fsMod.updateDoc(gameRef(), { participants: parts, updatedAt: fb.fsMod.serverTimestamp() });
    } catch (err) { console.error(err); flash($("nameFeedback"), "No se pudo guardar."); }
}
async function removeParticipant(id) {
    const parts = (game.participants || []).filter((p) => p.id !== id);
    try { await fb.fsMod.updateDoc(gameRef(), { participants: parts, updatedAt: fb.fsMod.serverTimestamp() }); }
    catch (err) { console.error(err); }
}

// ============================ Sorteo (con exclusiones) ============================
function idByName(name) { const p = personByName(name); return p ? p.id : null; }
async function computeForbidden(excludeId) {
    const forbidden = {};
    const prior = games.filter((g) => g.id !== excludeId && g.status === "drawn");
    for (const g of prior) {
        let snap;
        try { snap = await fb.fsMod.getDocs(playersColl(g.id)); } catch (err) { console.error(err); continue; }
        snap.forEach((d) => {
            const pl = d.data();
            const giver = pl.personId || idByName(pl.name);
            const recv = pl.receiverId || idByName(pl.receiver);
            if (giver && recv) { (forbidden[giver] = forbidden[giver] || new Set()).add(recv); }
        });
    }
    return forbidden;
}

$("drawBtn").addEventListener("click", () => draw());
$("redrawBtn").addEventListener("click", () => {
    if (confirm("Se hará un nuevo sorteo con las mismas personas y se borrarán los PIN y revelados. ¿Continuar?")) draw();
});
async function draw() {
    const parts = (game.participants || []);
    if (parts.length < 2) return;

    // Al armar se usan las casillas; al re-sortear se conservan las preferencias guardadas.
    const isRedraw = game.status === "drawn";
    const useAvoid = isRedraw ? (game.avoidRepeat !== false) : $("avoidRepeat").checked;
    const hide = isRedraw ? Boolean(game.hideAssignments) : $("hidePlay").checked;

    let forbidden = {};
    if (useAvoid) {
        try { forbidden = await computeForbidden(currentGameId); }
        catch (err) { console.error(err); }
    }
    // Preferimos UNA sola cadena (ciclo único): sin parejas recíprocas (A↔B)
    // ni grupitos, respetando "no repetir". Si con las exclusiones no existe esa
    // cadena, caemos a un derangement válido (que podría tener pares recíprocos).
    let assignments = buildCycleExcluding(parts, forbidden);
    if (!assignments) assignments = assignWithExclusions(parts, forbidden);

    if (!assignments) {
        alert("No se pudo armar un sorteo sin repetir años anteriores con estas personas. Desmarca «No repetir» o agrega más integrantes.");
        return;
    }

    const { fsMod } = fb;
    try {
        const existing = await fsMod.getDocs(playersColl());
        const existingIds = new Set();
        existing.forEach((d) => existingIds.add(d.id));

        // Género/foto frescos por persona, para dibujar avatares en la vista del jugador.
        const metaById = {};
        (game.participants || []).forEach((p) => { const m = metaFor(p); metaById[p.id] = { gender: m.gender, photo: m.photo }; });

        const batch = fsMod.writeBatch(fb.db);
        const nextIds = new Set(assignments.map((a) => a.giverId));
        // Borra solo a quienes ya no participan (evita quedar huérfanos).
        existing.forEach((d) => { if (!nextIds.has(d.id)) batch.delete(d.ref); });

        assignments.forEach((a, i) => {
            const ref = fsMod.doc(fb.db, "games", currentGameId, "players", a.giverId);
            const meta = metaById[a.giverId] || {};
            const core = {
                personId: a.giverId, name: a.giver,
                receiverId: a.receiverId, receiver: a.receiver,
                order: i, pinHash: null, pinSalt: null, revealed: false,
                notesForMe: [], gender: meta.gender || "", photo: meta.photo || ""
            };
            if (existingIds.has(a.giverId)) {
                // ACTUALIZA sin tocar wishlist/boughtMarks: así se conservan
                // aunque el jugador los haya editado justo ahora (sin leer-y-pisar,
                // no hay carrera sobre esos campos).
                batch.update(ref, core);
            } else {
                batch.set(ref, Object.assign({ wishlist: [], boughtMarks: {} }, core));
            }
        });
        batch.update(gameRef(), {
            status: "drawn", hideAssignments: hide, avoidRepeat: useAvoid,
            updatedAt: fsMod.serverTimestamp()
        });
        peek = false;
        await batch.commit();
    } catch (err) { console.error(err); alert("No se pudo hacer el sorteo. Revisa tu conexión."); }
}

$("editBtn").addEventListener("click", async () => {
    try { await fb.fsMod.updateDoc(gameRef(), { status: "setup" }); }
    catch (err) { console.error(err); }
});
$("newGameBtn").addEventListener("click", () => { forceCreate = true; setView("draw"); });
$("deleteGameBtn").addEventListener("click", deleteCurrentGame);
async function deleteCurrentGame() {
    if (!confirm("Se eliminará este sorteo por completo. ¿Seguro?")) return;
    const id = currentGameId;
    try {
        await deleteGameById(id);
        forceCreate = false; setCurrent(null);
        onGamesUpdate();
    } catch (err) { console.error(err); alert("No se pudo eliminar."); }
}
async function deleteGameById(id) {
    const { fsMod } = fb;
    const existing = await fsMod.getDocs(playersColl(id));
    const batch = fsMod.writeBatch(fb.db);
    existing.forEach((d) => batch.delete(d.ref));
    batch.delete(gameRef(id));
    await batch.commit();
}

// ============================ Fase sorteo hecho ============================
function playerUrl() {
    // Enlace "limpio" sin "index.html": el hosting (GitHub Pages / Firebase)
    // sirve index.html en la raíz del directorio. Un enlace más corto se
    // reconoce mejor como enlace al escanear el QR.
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    return base + "?game=" + currentGameId;
}

// --- Código QR para unirse (generado localmente, sin servicios externos) ---
const QR_BASE_SIZE = 220;
function renderQr(url) {
    const canvas = $("qrCanvas");
    const ctx = canvas.getContext("2d");
    const qr = qrcodeGen(0, "M"); // typeNumber 0 = automático; nivel M
    qr.addData(url);
    qr.make();
    // Nitidez consistente: se parte de una base fija, no del ancho ya mutado
    // por una render anterior.
    const cellSize = Math.max(2, Math.floor(QR_BASE_SIZE / qr.getModuleCount()));
    const size = qr.getModuleCount() * cellSize;
    canvas.width = size; canvas.height = size;
    ctx.clearRect(0, 0, size, size);
    qr.renderTo2dContext(ctx, cellSize);
}
$("qrDownloadBtn").addEventListener("click", () => {
    const canvas = $("qrCanvas");
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "amigo-secreto-" + currentGameId + ".png";
    a.click();
});

// --- Cartel imprimible: QR grande (SVG vectorial, nítido) + código + pasos ---
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function printCard() {
    const url = playerUrl();
    const qr = qrcodeGen(0, "M");
    qr.addData(url);
    qr.make();
    const qrSvg = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
    const title = (game && game.title) || "Amigo Secreto";
    const html = '<!doctype html><html lang="es"><head><meta charset="utf-8">'
        + '<title>' + escapeHtml(title) + ' · Escanéame</title><style>'
        + '*{box-sizing:border-box;margin:0;padding:0}'
        + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#11202b;padding:28px}'
        + '.card{max-width:640px;margin:0 auto;text-align:center;border:3px solid #0c4a6e;border-radius:24px;padding:36px 28px;background:#fff}'
        + '.badge{display:inline-block;background:#0c4a6e;color:#fff;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:13px;padding:7px 16px;border-radius:999px}'
        + 'h1{font-size:34px;margin:16px 0 4px;color:#0c4a6e}'
        + '.tag{font-size:19px;color:#0284c7;font-weight:700;margin-bottom:18px}'
        + '.qr{width:320px;height:320px;margin:8px auto 14px}.qr svg{width:100%;height:100%}'
        + '.code{font-size:30px;font-weight:800;letter-spacing:.22em;color:#0c4a6e;margin:6px 0}'
        + '.code small{display:block;font-size:13px;font-weight:600;letter-spacing:.04em;color:#7d8b97;margin-bottom:4px}'
        + '.url{font-size:13px;color:#4a5b68;word-break:break-all;margin:8px 0 18px}'
        + 'ol{max-width:420px;margin:0 auto;text-align:left;font-size:15px;color:#11202b;line-height:1.7;padding-left:22px}'
        + '.foot{margin-top:18px;font-size:12px;color:#7d8b97}'
        + '@media print{body{padding:0}.card{border-color:#0c4a6e}}'
        + '</style></head><body><div class="card">'
        + '<span class="badge">🎁 Amigo Secreto</span>'
        + '<h1>' + escapeHtml(title) + '</h1>'
        + '<div class="tag">📷 ¡Escanéame para tu amigo secreto!</div>'
        + '<div class="qr">' + qrSvg + '</div>'
        + '<div class="code"><small>o entra con el código</small>' + escapeHtml(currentGameId) + '</div>'
        + '<div class="url">' + escapeHtml(url) + '</div>'
        + '<ol><li>Escanea el QR con la cámara de tu celular (o abre el enlace).</li>'
        + '<li>Toca <b>tu nombre</b> y crea un <b>PIN</b> de 4 dígitos.</li>'
        + '<li>Descubre a quién le regalas… ¡y no le cuentes a nadie! 🤫</li></ol>'
        + '<div class="foot">Cada persona ve solo su resultado, protegido con su PIN.</div>'
        + '</div><script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script>'
        + '</body></html>';
    const w = window.open("", "_blank");
    if (!w) { alert("Tu navegador bloqueó la ventana. Permite las ventanas emergentes e inténtalo de nuevo."); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
}
$("printCardBtn").addEventListener("click", printCard);

function renderDrawn() {
    showScreen("stateDrawn");
    $("shareCode").textContent = currentGameId;
    $("shareLink").textContent = playerUrl();
    renderQr(playerUrl());
    if (unsubPlayers && playersSubId !== currentGameId) { unsubPlayers(); unsubPlayers = null; }
    if (!unsubPlayers) {
        playersSubId = currentGameId;
        const q = fb.fsMod.query(playersColl(), fb.fsMod.orderBy("order"));
        unsubPlayers = fb.fsMod.onSnapshot(q, (qs) => {
            lastPlayers = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
            if (currentView === "draw") renderAssignments();
        }, (err) => console.error(err));
    } else {
        renderAssignments();
    }
}
function renderAssignments() {
    const players = lastPlayers;
    const total = players.length;
    const done = players.filter((p) => p.revealed).length;
    $("progressText").textContent = done + " / " + total;
    $("progressFill").style.width = total ? Math.round((done / total) * 100) + "%" : "0%";
    $("drawnCount").textContent = String(total);

    const concealed = Boolean(game.hideAssignments) && !peek;
    if (!game.hideAssignments) {
        $("assignNote").textContent = "Vista privada del organizador. No la muestres a los jugadores. 🙈";
        $("peekBtn").hidden = true;
    } else if (concealed) {
        $("assignNote").textContent = "Como tú también juegas, las asignaciones están ocultas. Revela el tuyo desde el enlace de jugador con tu PIN.";
        $("peekBtn").hidden = false;
        $("peekBtn").textContent = "👁️ Ver asignaciones de todas formas (spoiler)";
    } else {
        $("assignNote").textContent = "⚠️ Estás viendo el spoiler. Si quieres mantener tu sorpresa, vuelve a ocultarlas.";
        $("peekBtn").hidden = false;
        $("peekBtn").textContent = "🙈 Volver a ocultar";
    }

    const wrap = $("assignmentsList");
    wrap.textContent = "";
    players.forEach((p) => {
        const row = document.createElement("div");
        row.className = "assignment";
        const avatar = document.createElement("span");
        avatar.className = "assignment__avatar";
        paintAvatar(avatar, p);
        avatar.setAttribute("aria-hidden", "true");
        const from = document.createElement("span");
        from.className = "assignment__from";
        from.textContent = p.name;
        const arrow = document.createElement("span");
        arrow.className = "assignment__arrow";
        arrow.textContent = "➜"; arrow.setAttribute("aria-hidden", "true");
        const to = document.createElement("span");
        to.className = "assignment__to";
        to.textContent = concealed ? "•••" : p.receiver;
        if (concealed) to.style.color = "var(--text-muted)";
        const meta = document.createElement("span");
        meta.className = "participant__meta";
        meta.style.flex = "none";
        meta.textContent = p.revealed ? "✓ visto" : (p.pinHash ? "🔒" : "·");
        row.append(avatar, from, arrow, to, meta);
        if (p.pinHash || p.revealed) {
            const reset = document.createElement("button");
            reset.className = "participant__remove";
            reset.type = "button";
            reset.title = "Dar acceso de nuevo a " + p.name + " (borra su PIN y desbloquea su dispositivo)";
            reset.setAttribute("aria-label", "Dar acceso de nuevo a " + p.name);
            reset.textContent = "↺";
            reset.addEventListener("click", () => resetPin(p));
            row.appendChild(reset);
        }
        wrap.appendChild(row);
    });
}
$("peekBtn").addEventListener("click", () => {
    if (!peek) { if (!confirm("Vas a ver a quién le toca cada quien, incluido tú. ¿Seguro?")) return; peek = true; }
    else { peek = false; }
    renderAssignments();
});
async function resetPin(p) {
    if (!confirm("¿Dar acceso de nuevo a " + p.name + "? Se borra su PIN y se desbloquea su dispositivo; podrá volver a entrar y crear uno nuevo.")) return;
    try {
        await fb.fsMod.updateDoc(fb.fsMod.doc(fb.db, "games", currentGameId, "players", p.id),
            { pinHash: null, pinSalt: null, revealed: false });
    } catch (err) { console.error(err); }
}
$("copyLinkBtn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(playerUrl()); flash($("copyHint"), "✓ Enlace copiado", true); }
    catch { flash($("copyHint"), "Copia el enlace manualmente.", true); }
});

// ============================ Historial ============================
function renderHistory() {
    $("historyCount").textContent = String(games.length);
    const wrap = $("historyList");
    wrap.textContent = "";
    const sorted = games.slice().sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
    if (sorted.length === 0) {
        const empty = document.createElement("div");
        empty.className = "participants__empty";
        empty.textContent = "Aún no hay sorteos guardados.";
        wrap.appendChild(empty);
        return;
    }
    sorted.forEach((g) => {
        const item = document.createElement("div");
        item.className = "history-item";
        const info = document.createElement("div");
        info.className = "history-item__info";
        const title = document.createElement("div");
        title.className = "history-item__title";
        title.textContent = g.title || "Sorteo";
        const meta = document.createElement("div");
        meta.className = "history-item__meta";
        const kind = g.kind === "manual" ? "a mano" : "sorteo";
        const n = (g.participants || []).length;
        const date = fmtDate(g.createdAt);
        meta.innerHTML = "";
        const kindSpan = document.createElement("span");
        kindSpan.className = "history-item__kind";
        kindSpan.textContent = kind;
        meta.append(kindSpan, document.createTextNode(
            " · " + n + " personas" + (date ? " · " + date : "") +
            (g.status === "setup" ? " · sin sortear" : "")));
        info.append(title, meta);

        const view = document.createElement("button");
        view.className = "btn btn--ghost"; view.type = "button"; view.textContent = "Ver";
        view.addEventListener("click", () => showHistoryGame(g));
        const del = document.createElement("button");
        del.className = "participant__remove"; del.type = "button";
        del.title = "Eliminar"; del.setAttribute("aria-label", "Eliminar " + (g.title || "sorteo"));
        del.textContent = "✕";
        del.addEventListener("click", () => deleteFromHistory(g));

        item.append(info, view, del);
        wrap.appendChild(item);
    });
}
async function showHistoryGame(g) {
    $("histModalTitle").textContent = g.title || "Sorteo";
    const list = $("histModalList");
    list.textContent = "Cargando…";
    let snap;
    try { snap = await fb.fsMod.getDocs(fb.fsMod.query(playersColl(g.id), fb.fsMod.orderBy("order"))); }
    catch (err) { console.error(err); list.textContent = "No se pudo cargar."; openModal(); return; }
    list.textContent = "";
    const rows = snap.docs.map((d) => d.data());
    if (rows.length === 0) { list.textContent = "Este sorteo no tiene asignaciones (aún sin sortear)."; }
    rows.forEach((p) => {
        const row = document.createElement("div");
        row.className = "assignment";
        const from = document.createElement("span"); from.className = "assignment__from"; from.textContent = p.name;
        const arrow = document.createElement("span"); arrow.className = "assignment__arrow"; arrow.textContent = "➜"; arrow.setAttribute("aria-hidden", "true");
        const to = document.createElement("span"); to.className = "assignment__to"; to.textContent = p.receiver || "—";
        row.append(from, arrow, to);
        list.appendChild(row);
    });
    openModal();
}
function openModal() { $("histModal").classList.add("is-open"); $("histModal").setAttribute("aria-hidden", "false"); }
$("histModalClose").addEventListener("click", () => { $("histModal").classList.remove("is-open"); $("histModal").setAttribute("aria-hidden", "true"); });
$("histModal").addEventListener("click", (e) => { if (e.target === $("histModal")) $("histModalClose").click(); });

async function deleteFromHistory(g) {
    if (!confirm("¿Eliminar «" + (g.title || "sorteo") + "» del historial? Esto puede afectar la regla de no repetir.")) return;
    try {
        await deleteGameById(g.id);
        if (g.id === currentGameId) { setCurrent(null); forceCreate = false; }
        onGamesUpdate();
    } catch (err) { console.error(err); alert("No se pudo eliminar."); }
}

// ============================ Registrar sorteo anterior (a mano) ============================
let manualSelected = [];
$("registerPastBtn").addEventListener("click", () => {
    $("manualEntry").hidden = false;
    $("manualTitle").value = "";
    $("manualPairsWrap").hidden = true;
    renderManualPeople();
    $("manualEntry").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("manualCancelBtn").addEventListener("click", () => { $("manualEntry").hidden = true; });
function renderManualPeople() {
    const box = $("manualPeople");
    box.textContent = "";
    if (people.length < 2) {
        $("manualPeopleHint").textContent = "Necesitas al menos 2 integrantes guardados (pestaña Integrantes).";
        return;
    }
    $("manualPeopleHint").textContent = "Marca a quienes participaron.";
    people.forEach((p) => {
        const label = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.value = p.id;
        const span = document.createElement("span");
        span.textContent = p.name;
        label.append(cb, span);
        box.appendChild(label);
    });
}
$("manualNextBtn").addEventListener("click", () => {
    const checked = Array.from($("manualPeople").querySelectorAll("input:checked")).map((c) => c.value);
    if (checked.length < 2) { flash($("manualFeedback"), "Selecciona al menos 2 personas."); $("manualPairsWrap").hidden = true; return; }
    manualSelected = checked.map((id) => people.find((p) => p.id === id)).filter(Boolean);
    renderManualPairs();
    $("manualPairsWrap").hidden = false;
});
function renderManualPairs() {
    const wrap = $("manualPairs");
    wrap.textContent = "";
    manualSelected.forEach((giver) => {
        const row = document.createElement("div");
        row.className = "pair-row";
        const from = document.createElement("span");
        from.className = "pair-row__from"; from.textContent = giver.name;
        const arrow = document.createElement("span");
        arrow.className = "pair-row__arrow"; arrow.textContent = "➜"; arrow.setAttribute("aria-hidden", "true");
        const sel = document.createElement("select");
        sel.className = "input"; sel.dataset.giver = giver.id;
        const ph = document.createElement("option"); ph.value = ""; ph.textContent = "— ¿a quién? —"; sel.appendChild(ph);
        manualSelected.filter((r) => r.id !== giver.id).forEach((r) => {
            const o = document.createElement("option"); o.value = r.id; o.textContent = r.name; sel.appendChild(o);
        });
        row.append(from, arrow, sel);
        wrap.appendChild(row);
    });
}
$("manualSaveBtn").addEventListener("click", saveManual);
async function saveManual() {
    const selects = Array.from($("manualPairs").querySelectorAll("select"));
    const pairs = [];
    for (const s of selects) {
        if (!s.value) { flash($("manualFeedback"), "Falta indicar a quién le regaló cada persona."); return; }
        pairs.push({ giverId: s.dataset.giver, receiverId: s.value });
    }
    const nameById = Object.fromEntries(manualSelected.map((p) => [p.id, p.name]));
    const title = $("manualTitle").value.trim() || "Sorteo anterior";
    const code = makeGameCode();
    const { fsMod } = fb;
    try {
        // El juego se crea PRIMERO y por separado: la regla de seguridad de los
        // jugadores valida con get(games/{id}), que dentro de un mismo batch no
        // ve el juego recién creado. Crear el padre y confirmar evita el
        // "Missing or insufficient permissions".
        await fsMod.setDoc(gameRef(code), {
            adminUid: uid, title, status: "drawn", kind: "manual",
            participants: manualSelected.map((p) => ({ id: p.id, name: p.name })),
            hideAssignments: false, createdAt: fsMod.serverTimestamp(), updatedAt: fsMod.serverTimestamp()
        });
        const batch = fsMod.writeBatch(fb.db);
        pairs.forEach((pr, i) => {
            batch.set(fsMod.doc(fb.db, "games", code, "players", pr.giverId), {
                personId: pr.giverId, name: nameById[pr.giverId],
                receiverId: pr.receiverId, receiver: nameById[pr.receiverId],
                order: i, pinHash: null, pinSalt: null, revealed: false
            });
        });
        await batch.commit();
        $("manualEntry").hidden = true;
        setView("history");
    } catch (err) { console.error(err); flash($("manualFeedback"), "No se pudo guardar."); }
}

start();
