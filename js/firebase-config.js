// ============================================================================
//  CONFIGURACIÓN DE FIREBASE
//  Pega aquí los datos de TU proyecto:
//  Consola de Firebase → ⚙️ Configuración del proyecto → "Tus apps" → SDK setup.
//  (Estos valores NO son secretos: son identificadores públicos del proyecto.
//   La seguridad real la dan las reglas de Firestore — ver firestore.rules.)
// ============================================================================

export const firebaseConfig = {
    apiKey: "TU_API_KEY",
    authDomain: "TU_PROYECTO.firebaseapp.com",
    projectId: "TU_PROYECTO",
    storageBucket: "TU_PROYECTO.appspot.com",
    messagingSenderId: "TU_SENDER_ID",
    appId: "TU_APP_ID"
};

// Versión del SDK modular de Firebase servido desde el CDN de Google.
export const FIREBASE_VERSION = "10.14.1";

// ¿Ya reemplazaste los valores de ejemplo?
export function isConfigured() {
    return Boolean(firebaseConfig.apiKey) && !firebaseConfig.apiKey.startsWith("TU_");
}

// Carga perezosa del SDK y de los servicios. Se importa solo cuando hace falta,
// así la página puede mostrar el mensaje de "configura tu proyecto" sin red.
let _bundle = null;
export async function loadFirebase() {
    if (_bundle) return _bundle;
    const v = FIREBASE_VERSION;
    const base = "https://www.gstatic.com/firebasejs/" + v + "/";
    const [appMod, authMod, fsMod] = await Promise.all([
        import(base + "firebase-app.js"),
        import(base + "firebase-auth.js"),
        import(base + "firebase-firestore.js")
    ]);
    const app = appMod.initializeApp(firebaseConfig);
    const auth = authMod.getAuth(app);
    const db = fsMod.getFirestore(app);
    _bundle = { app, auth, db, authMod, fsMod };
    return _bundle;
}
