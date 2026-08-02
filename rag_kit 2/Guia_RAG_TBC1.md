## Guía: montar el chatbot RAG (Claude + Firebase) en TBC1

Este kit (`rag_kit/`) contiene todo lo necesario. Resumen de la arquitectura:

```
Pregunta del chat (frontend, GitHub Pages)
        │  fetch()
        ▼
Cloud Function "ragChat" (Firebase, backend)
        │  1. busca fragmentos relevantes en chunks.json
        │  2. arma el prompt con esos fragmentos como contexto
        │  3. llama a la API de Claude (Anthropic) con la clave secreta
        ▼
Respuesta + fuentes citadas → de vuelta al chat
```

No usa base de datos vectorial: con ~23 documentos, una búsqueda por palabras clave (TF-IDF) sobre los fragmentos es suficiente y evita depender de una API de embeddings adicional. Si en el futuro tienes cientos de documentos, se puede mejorar a búsqueda semántica.

### Requisitos previos

- Los 23 PDF ya descargados dentro de `TB_full/` (con `python3 scripts/download_all.py`, ver la guía anterior).
- Una clave de API de Anthropic: créala en https://console.anthropic.com → API Keys.
- Node.js instalado en tu ordenador (para usar `firebase-tools`).
- Tu proyecto Firebase (el mismo de `firebase-config.js`) pasado al **plan Blaze** (pago por uso). Es obligatorio para que las Cloud Functions puedan hacer peticiones salientes a internet (llamar a la API de Claude). Tiene una capa gratuita amplia; con el volumen de un chat de consulta no debería generar coste relevante, pero revisa los precios en https://firebase.google.com/pricing.

### Paso 1 — Generar el índice de fragmentos

```bash
cd TB_full/..              # carpeta que contiene TB_full/
python3 rag_kit/scripts/build_index.py
```

Esto crea `chunks.json` (varios miles de fragmentos con texto + metadata). Cópialo a:

```
rag_kit/functions/data/chunks.json
```

reemplazando el placeholder vacío que ya hay ahí.

### Paso 2 — Instalar Firebase CLI y vincular el proyecto

```bash
npm install -g firebase-tools
firebase login
cd rag_kit
firebase init functions
```

Cuando pregunte, elige "Use an existing project" y selecciona tu proyecto Firebase actual (el de `firebase-config.js`). Si ya te crea una carpeta `functions/` distinta, sustituye su `index.js` y `package.json` por los de este kit (o copia `data/chunks.json` dentro).

### Paso 3 — Guardar la clave de Anthropic como secreto

Nunca la pongas directamente en el código ni en el repo. Usa Firebase Secret Manager:

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
```

Te pedirá que pegues la clave (empieza por `sk-ant-...`). Queda cifrada, no en el código fuente.

### Paso 4 — Instalar dependencias y desplegar

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

Al terminar te dará una URL como:

```
https://us-central1-TU_PROYECTO.cloudfunctions.net/ragChat
```

Guárdala.

### Paso 5 — Conectar el frontend

Abre `rag_kit/frontend_snippet.js`, pon esa URL en `RAG_FUNCTION_URL`, y añade la función `preguntarAlAsistenteTB()` a tu `script.js` en el repo TBC1 (o dime cómo está estructurado tu chat actual y te doy el cambio exacto para pegar).

Sube los cambios de `script.js` al repo igual que antes (Add file → Upload files, o editando el archivo directamente en GitHub).

### Paso 6 — Probar

Desde terminal, antes incluso de tocar el frontend:

```bash
curl -X POST https://us-central1-TU_PROYECTO.cloudfunctions.net/ragChat \
  -H "content-type: application/json" \
  -d '{"question":"Quant dura el tractament de la ITL amb isoniazida?"}'
```

Deberías recibir un JSON con `answer` y `sources`. Si da error, revisa los logs:

```bash
firebase functions:log
```

### Costes a tener en cuenta

- **Anthropic API**: se paga por token. Claude Sonnet 5 (el modelo usado en `index.js`) tiene buena calidad para contenido clínico; si el volumen de preguntas es alto y quieres abaratar, cambia `"model": "claude-sonnet-5"` por un modelo más económico como `"claude-haiku-4-5-20251001"` en `functions/index.js`.
- **Firebase Blaze**: capa gratuita generosa (2M invocaciones/mes de Cloud Functions); con un chat de consulta clínica normal no debería salir de esa capa.

### Límites de este diseño (versión 1)

- La búsqueda es por coincidencia de palabras, no semántica: si el paciente pregunta con sinónimos muy distintos a los del PDF, puede no encontrar el fragmento correcto. Es suficiente para empezar; se puede mejorar luego con embeddings.
- No guarda historial de conversación entre preguntas (cada pregunta es independiente). Si quieres contexto multi-turno, se añade fácilmente pasando el historial en el array `messages`.
- No hay límite de uso por usuario todavía — antes de publicarlo a pacientes reales conviene añadir algún control de tasa (rate limiting) para evitar abuso de la API.
