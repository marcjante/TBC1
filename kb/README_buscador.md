## Cercador estático TB/ITL (sin backend, sin IA, sin coste)

Busca por palabras clave dentro de los 21 PDF ya procesados. Sin llamadas a Claude, sin Firebase Functions, sin tarjeta. Todo corre en el navegador del usuario.

### Qué contiene esta carpeta

- `buscador.html` — página de búsqueda, lista para usar.
- `buscador.js` — lógica de búsqueda (carga `chunks.json`, indexa, busca, resalta coincidencias).

### Pasos para publicarlo en TBC1

1. En tu Mac, crea una carpeta `kb` dentro de tu copia de `TB_full`... en realidad más simple: copia el `chunks.json` que ya generaste (el de `~/Desktop/chunks.json`, 11 MB, 7523 fragmentos) a una carpeta nueva llamada `kb` junto a estos dos archivos:

```
kb/
└── chunks.json
buscador.html
buscador.js
```

2. Sube estos tres elementos (`buscador.html`, `buscador.js`, y la carpeta `kb` con `chunks.json` dentro) a la raíz del repo **TBC1** en GitHub (Add file → Upload files, arrastrando los tres).

3. Espera 1-2 minutos a que GitHub Pages redespliegue, y entra en:
```
https://marcjante.github.io/TBC1/buscador.html
```

4. Prueba escribiendo algo como "tractament ITL isoniazida" y pulsa Cercar.

### Notas

- El archivo `chunks.json` pesa 11 MB. La primera vez que alguien abre la página tarda unos segundos en cargar (después el navegador lo cachea). Es aceptable para una web de consulta clínica, pero si algún día quieres que cargue más rápido, se puede reducir el tamaño de los fragmentos en `scripts/build_index.py` (bájalo de 220 a 120 palabras, por ejemplo) y regenerar el índice.
- Este buscador no "entiende" preguntas, solo encuentra fragmentos que contienen las palabras que escribes — es más parecido a un buscador de biblioteca que a un chat. Si más adelante cambias de opinión sobre pagar Firebase Blaze o quieres probar Cloudflare Workers (gratis, sin tarjeta) para tener respuestas redactadas por Claude, dímelo y retomamos esa vía; el resto del trabajo (chunks.json, prompt, lógica) ya está hecho y se reaprovecha.
- Puedes enlazar `buscador.html` desde tu `index.html` principal (un botón o enlace tipo "Consultar base de coneixement TB") para que quede integrado en la app en vez de ser una página suelta.
