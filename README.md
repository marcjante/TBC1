# Seguiment TBC / ITL

Xat de triatge i seguiment per a pacients en tractament de tuberculosi activa (TBC) o infecció tuberculosa latent (ITL). Versión estática, lista para GitHub Pages.

## Qué hace

- **Xat pacient**: el paciente escribe un mensaje; un motor de reglas por palabras clave lo clasifica (urgente / moderado / leve / informativo) y responde con la instrucción correspondiente.
- **Panell professional**: lista de pacientes ordenada por urgencia, con las visitas de control ya calculadas según el protocolo (TBC: 15/30/60/120/180 días desde el inicio; ITL: 30/60/90/180 días) y botones para avisar o recordar por WhatsApp (abre `wa.me` con el mensaje ya escrito — el envío final requiere un toque manual, WhatsApp no permite enviar en segundo plano desde una web).

## Desplegar en GitHub Pages

1. Crea un repositorio nuevo (o usa uno existente) y sube estos archivos a la raíz (o a una carpeta `docs/` si prefieres).
2. En **Settings → Pages**, elige la rama y la carpeta donde están los archivos.
3. GitHub te da una URL del tipo `https://tuusuario.github.io/turepo/`. Tarda 1–2 minutos en publicarse tras cada cambio.
4. No hace falta build ni backend: son archivos estáticos.

```
tbc-chatbox/
├── index.html
├── style.css
├── script.js
├── manifest.json
├── sw.js
├── icon-192.png
├── icon-512.png
└── README.md
```

## Modos de funcionamiento

La app detecta sola qué modo usar:

- **Modo local (por defecto, sin configurar nada)**: guarda los datos en `localStorage` del navegador. Solo esa persona, en ese navegador, ve esos datos. Sirve para probar la app o para que una sola persona la use manualmente.
- **Modo compartido (Firebase Firestore)**: en cuanto rellenas `firebase-config.js` con los datos de un proyecto Firebase, todos los dispositivos que abran la web ven y actualizan **los mismos datos, en tiempo real**, sin recargar la página. Esto es lo que hace falta para que un paciente escriba desde su móvil y tú lo veas al momento en tu ordenador.

## Activar el modo compartido (Firebase)

Firebase es gratuito para este volumen de uso (capa "Spark"). Son unos 10 minutos, sin escribir código de servidor.

1. Ve a **https://console.firebase.google.com** y crea un proyecto nuevo (nombre libre, ej. "tbc-seguiment").
2. En el menú lateral, entra en **Compilación → Firestore Database** → **Crear base de datos**. Elige una región cercana (ej. `eur3 (europe-west)`) y, para empezar rápido, modo **prueba** (test mode) — esto da acceso abierto durante 30 días; antes de usarlo con pacientes reales, ajusta las reglas (punto 5).
3. En el icono de engranaje (arriba a la izquierda) → **Configuración del proyecto** → pestaña **General** → baja hasta "Tus apps" → icono **`</>`** (Web) → dale un nombre y crea la app. Firebase te muestra un bloque `firebaseConfig = {...}`.
4. Copia esos valores dentro de `firebase-config.js`, reemplazando las comillas vacías:
   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "AIza...",
     authDomain: "tbc-seguiment.firebaseapp.com",
     projectId: "tbc-seguiment",
     storageBucket: "tbc-seguiment.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abc123"
   };
   ```
5. **Antes de usarlo con datos reales de pacientes**, ve a Firestore → pestaña **Reglas** y sustituye el modo prueba por algo más restrictivo. Como mínimo, limita por fecha y considera añadir autenticación (Firebase Auth) para el profesional. Ejemplo simple (solo mientras hay un plazo controlado; para producción real, añade Firebase Authentication y comprueba `request.auth != null`):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /tbc_store/{doc} {
         allow read, write: if request.time < timestamp.date(2026, 12, 31);
       }
     }
   }
   ```
6. Sube los cambios a GitHub (incluido `firebase-config.js` con tus valores reales — si el repo es público, cualquiera con la URL de Firestore podría leer/escribir mientras las reglas sean abiertas; considera repo privado o reglas con autenticación antes de usar datos reales).
7. Abre la web: en la consola del navegador (F12) debería aparecer "Firestore activo: los datos se comparten entre dispositivos." Prueba a crear un paciente desde el móvil y comprobar que aparece también en el ordenador.

## Qué pasa si no configuras Firebase

Nada se rompe: la app sigue funcionando en modo local con `localStorage`, tal como en la versión anterior. Puedes probarla así primero y activar Firebase cuando quieras pasar a un uso compartido real.

## Personalizar

- **Palabras clave de triaje**: función `triage()` en `script.js`. Son expresiones regulares sobre texto normalizado (sin acentos, minúsculas) — añade o ajusta los patrones según el vocabulario real de tus pacientes.
- **Intervalos de visitas**: función `computeVisits()` en `script.js`, objeto `plans`.
- **Textos de respuesta del bot**: función `botReply()`.
- **Colores y tipografía**: variables `:root` al principio de `style.css`.

## PWA

`manifest.json` y `sw.js` permiten "instalar" la web como app (Android/desktop) y cachear los archivos para que cargue offline. Los iconos incluidos son un placeholder simple — sustitúyelos por el logo real cuando lo tengas.

## Aviso

Este es un prototipo de trabajo, no un dispositivo médico certificado. El motor de triaje es un conjunto de reglas fijas, no un sistema clínico validado: cualquier caso real requiere supervisión de un profesional sanitario en todo momento.

Si activas Firestore y vas a introducir datos identificables de pacientes reales (nombre, teléfono, síntomas), ten en cuenta que son datos de salud especialmente protegidos (RGPD / LOPDGDD). Antes de usarlo fuera de una prueba interna: revisa las reglas de seguridad de Firestore, valora activar Firebase Authentication, y consulta con la unidad de protección de datos o el CEIC de tu centro si el uso pasa de prototipo a herramienta real de seguimiento.

