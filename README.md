# 🎁 Amigo Secreto (Firebase)

App de amigo secreto con **dos roles**:

- **Administrador** (`admin.html`): inicia sesión con correo y contraseña. Tiene tres pestañas:
  - **🎲 Sorteo:** arma la lista, sortea y comparte el enlace.
  - **👥 Integrantes:** lista de personas guardadas (agregar / editar / eliminar). Aparecen como **buscador predictivo** al armar un sorteo.
  - **📜 Historial:** cada sorteo queda guardado; permite **registrar un sorteo viejo hecho a mano** y verlos todos.
- **Jugador** (`index.html`): dos pestañas:
  - **🎁 Mi amigo secreto:** toca tu nombre, crea un **PIN** la primera vez y descubre a quién le regalas (verás también la lista de deseos de esa persona). Tu resultado queda protegido con tu PIN.
  - **📝 Listas de deseos:** tablero con todas las personas; toca una para ver los regalos que pidió. Cada quien edita la suya con su PIN (desde el revelado).

Funciones clave:
- **Lista de deseos:** cada persona anota los regalos que quiere; quien le regala los ve al revelar, y todos pueden consultarlas en el tablero (el sorteo sigue secreto).
- **No repetir años anteriores:** al sortear, evita que a alguien le toque la misma persona de un sorteo pasado (con relajación automática si fuera imposible).
- **Una sola cadena:** el sorteo nunca arma parejas recíprocas (A↔B) ni grupitos.
- **Yo también juego:** oculta las asignaciones al organizador para que también pueda participar y revelar lo suyo con su PIN.

Todo se guarda en **Firestore**, así que funciona entre dispositivos: el admin sortea desde su teléfono y cada persona entra desde el suyo.

No necesita compilación: son archivos estáticos que cargan el SDK de Firebase desde el CDN.

---

## Estructura

```
index.html            → vista del jugador
admin.html            → panel del organizador
css/styles.css        → estilos compartidos
js/core.js            → lógica pura (sorteo, sorteo sin repetir, PIN, validaciones)
js/firebase-config.js → configuración de tu proyecto  ← EDITAR
js/player.js          → lógica de la vista del jugador
js/admin.js           → lógica del panel
firestore.rules       → reglas de seguridad
firebase.json         → configuración de Hosting + Firestore
.firebaserc           → id de tu proyecto              ← EDITAR
```

---

## Puesta en marcha (paso a paso)

### 1. Crear el proyecto de Firebase
1. Entra a <https://console.firebase.google.com> y crea un proyecto.
2. En **Compilación → Firestore Database**, crea la base de datos (modo *producción*).
3. En **Compilación → Authentication → Sign-in method**, habilita:
   - **Correo electrónico/contraseña** (para el administrador).
   - **Anónimo** (para que los jugadores puedan reclamar su nombre).
4. En **Authentication → Users**, agrega tu cuenta de administrador (correo + contraseña). Esa cuenta será la única que administra.

### 2. Conectar la app a tu proyecto
1. En **⚙️ Configuración del proyecto → Tus apps**, crea una app **Web** y copia el objeto `firebaseConfig`.
2. Pégalo en `js/firebase-config.js` (reemplaza los valores `TU_...`).
3. Pon el id de tu proyecto en `.firebaserc` (campo `default`).

### 3. Publicar las reglas y el sitio
Con la [CLI de Firebase](https://firebase.google.com/docs/cli) instalada (`npm i -g firebase-tools`):

```bash
firebase login
firebase deploy --only firestore:rules,hosting
```

Esto sube las reglas de seguridad y publica el sitio. Verás una URL tipo
`https://TU_PROYECTO.web.app`.

> ⚠️ Si administras las reglas **a mano desde la consola** (Firestore → Reglas),
> recuerda **volver a publicar** el contenido de `firestore.rules` cada vez que
> cambie. Esta versión agrega permisos para la lista de integrantes
> (`admins/{uid}/people`) y para que cada jugador edite su **lista de deseos**
> (campo `wishlist`): sin republicar, los integrantes y las listas no se guardan.

> ¿Solo quieres probar local? `firebase serve` o cualquier servidor estático
> (`python3 -m http.server`). **No** abras los archivos con `file://`: los
> módulos no cargan así.

### 4. Usar
1. Abre `…/admin.html`, inicia sesión, crea el sorteo, agrega nombres y pulsa **Sortear**.
2. Copia el enlace que aparece (incluye el **código del juego**) y compártelo.
3. Cada persona abre el enlace, toca su nombre, crea su PIN y ve su amigo secreto.

---

## Sobre la privacidad

- Dentro de la app, una persona **no puede** abrir el nombre de otra: cada nombre queda bloqueado con el PIN de quien lo reclama primero. Si alguien reclama por error el nombre de otra persona, el admin puede **restablecer su PIN** (botón ↺) para que el dueño real vuelva a entrar.
- Las asignaciones se guardan en Firestore y son legibles por el cliente (gated por PIN en la interfaz). Alguien con conocimientos técnicos podría inspeccionar la base de datos directamente. Si necesitas privacidad **total** (que ni la base de datos revele los pares), la vía es un código/enlace privado por persona o Cloud Functions; pídelo y lo añadimos.

## Seguridad de las reglas

- Solo el correo registrado como admin puede crear/editar juegos y ver/escribir asignaciones (atado a su `uid`).
- Los jugadores entran de forma anónima y solo pueden fijar su PIN **una vez** y marcarse como “visto”; no pueden cambiar nombres ni asignaciones.
