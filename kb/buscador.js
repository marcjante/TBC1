/**
 * Buscador estático sobre la base de conocimiento TB (chunks.json).
 * No usa IA generativa ni backend: todo corre en el navegador del usuario.
 *
 * Requiere que kb/chunks.json esté publicado en el mismo repo.
 *
 * Este archivo se usa desde DOS sitios:
 *   1. kb/buscador.html -> llama a initBuscadorTB() (página de búsqueda sola)
 *   2. index.html (app principal) -> usa window.TB_KB.search() dentro del
 *      xat de pacient (script.js) para complementar la respuesta de triatge.
 * La ruta de chunks.json se calcula de forma relativa a ESTE script
 * (document.currentScript), así que funciona sea cual sea la página que lo cargue.
 */

const CHUNKS_URL = new URL("chunks.json", document.currentScript.src).href;

function stripAccents(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Les paraules es guarden ja sense accents (mateixa normalització que
// tokenize()) perquè la comparació funcioni sempre. Abans "más"/"més"/"però"
// mai coincidien amb els tokens normalitzats ("mas"/"mes"/"pero"), i paraules
// curtes molt freqüents colaven com a termes de cerca "rars" i distorsionaven
// els resultats (p. ex. "mas" acabava dominant la puntuació d'un fragment
// no relacionat només perquè apareixia molt en un document concret).
const STOPWORDS = new Set([
  "de", "la", "que", "el", "en", "y", "a", "los", "del", "se", "las", "por",
  "un", "para", "con", "no", "una", "su", "al", "es", "lo", "como", "más",
  "o", "pero", "sus", "le", "ha", "me", "si", "sin", "sobre", "también",
  "de", "la", "el", "que", "i", "a", "els", "les", "en", "un", "una", "per",
  "amb", "no", "es", "del", "al", "com", "però", "són", "més", "seu", "seva",
  "the", "of", "and", "to", "in", "a", "is", "for", "on", "with",
  // Formes curtes addicionals que solen aparèixer en respostes de xat breus
  "yo", "tu", "el", "ella", "esto", "eso", "aixo", "aquest", "aquesta",
  "molt", "poco", "mucho", "algo", "nada", "bien", "mal", "igual",
].map(stripAccents));

// Diccionario español/catalán -> inglés para términos frecuentes de TB/ITL.
// Los documentos originales están en inglés; esto permite buscar en español
// expandiendo cada palabra reconocida con su equivalente en inglés.
const DICT = {
  tuberculosis: ["tuberculosis"], tb: ["tb", "tuberculosis"],
  itl: ["ltbi", "latent"], latente: ["latent"], infeccion: ["infection"],
  infeccioso: ["infectious"], contagio: ["transmission", "contagious"],
  transmision: ["transmission"], contagioso: ["infectious", "contagious"],
  tratamiento: ["treatment"], tractament: ["treatment"], duracion: ["duration"],
  durada: ["duration"], dosis: ["dose", "dosage"], meses: ["months"],
  semanas: ["weeks"], dias: ["days"], farmaco: ["drug"], farmacos: ["drugs"],
  medicamento: ["drug", "medication"], medicamentos: ["drugs", "medications"],
  isoniazida: ["isoniazid"], rifampicina: ["rifampicin", "rifampin"],
  rifapentina: ["rifapentine"], pirazinamida: ["pyrazinamide"],
  etambutol: ["ethambutol"], resistencia: ["resistance"],
  resistente: ["resistant"], multirresistente: ["mdr", "multidrug-resistant"],
  farmacorresistente: ["drug-resistant"],
  sintoma: ["symptom"], sintomas: ["symptoms"], fiebre: ["fever"],
  tos: ["cough"], sudores: ["sweats"], nocturnos: ["night"],
  perdida: ["loss"], peso: ["weight"], hemoptisis: ["hemoptysis"],
  cansancio: ["fatigue"], fatiga: ["fatigue"], dolor: ["pain"],
  torax: ["chest"], toracico: ["thoracic", "chest"],
  pulmonar: ["pulmonary"], pulmon: ["lung"], pulmones: ["lungs"],
  diagnostico: ["diagnosis"], prueba: ["test"], pruebas: ["tests"],
  cutanea: ["skin"], radiografia: ["x-ray", "radiography"],
  esputo: ["sputum"], cultivo: ["culture"], baciloscopia: ["smear"],
  sensibilidad: ["sensitivity"], especificidad: ["specificity"],
  vacuna: ["vaccine", "vaccination"], vacunacion: ["vaccination"],
  bcg: ["bcg"], prevencion: ["prevention"], profilaxis: ["prophylaxis"],
  quimioprofilaxis: ["preventive", "prophylaxis"],
  cribado: ["screening"], deteccion: ["detection", "screening"],
  vigilancia: ["surveillance"], notificacion: ["notification", "reporting"],
  epidemiologia: ["epidemiology"], incidencia: ["incidence"],
  prevalencia: ["prevalence"], mortalidad: ["mortality"],
  casos: ["cases"], caso: ["case"], brote: ["outbreak"],
  contacto: ["contact"], contactos: ["contacts"], exposicion: ["exposure"],
  aislamiento: ["isolation"], cuarentena: ["quarantine"],
  recaida: ["relapse"], curacion: ["cure"], curado: ["cured"],
  fracaso: ["failure"], abandono: ["default", "dropout"],
  adherencia: ["adherence"], efectos: ["effects"], secundarios: ["side"],
  reacciones: ["reactions"], adversos: ["adverse"],
  niños: ["children"], niño: ["child"], pediatrico: ["pediatric"],
  adultos: ["adults"], adulto: ["adult"], ancianos: ["elderly"],
  embarazo: ["pregnancy"], embarazada: ["pregnant"], lactancia: ["breastfeeding"],
  vih: ["hiv"], sida: ["aids"], diabetes: ["diabetes"],
  inmunodeprimido: ["immunocompromised"], inmunosupresion: ["immunosuppression"],
  comorbilidad: ["comorbidity"], riesgo: ["risk"], poblacion: ["population"],
  migrantes: ["migrants"], prision: ["prison"], carcel: ["prison"],
  personal: ["staff", "personnel", "workers"], sanitario: ["health"],
  hospital: ["hospital"], enfermeria: ["nursing"], paciente: ["patient"],
  pacientes: ["patients"], salud: ["health"], publica: ["public"],
  guia: ["guideline"], guias: ["guidelines"], recomendacion: ["recommendation"],
  recomendaciones: ["recommendations"], modulo: ["module"], informe: ["report"],
  global: ["global"], mundial: ["global", "world"], europa: ["europe"],
  españa: ["spain"], plan: ["plan"], estrategia: ["strategy"],
  control: ["control"], eliminacion: ["elimination"], erradicacion: ["eradication"],
};

let chunks = [];
let chunkTokens = [];
let docFreq = new Map();
let ready = false;
let loadingPromise = null;

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g) || [];
}

async function loadIndex(onProgress) {
  if (ready) { if (onProgress) onProgress(chunks.length); return; }
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const res = await fetch(CHUNKS_URL);
    if (!res.ok) throw new Error("No se pudo cargar " + CHUNKS_URL);
    chunks = await res.json();

    docFreq = new Map();
    chunkTokens = chunks.map((c) => {
      const toks = tokenize(c.text).filter((t) => t.length > 2 && !STOPWORDS.has(t));
      const uniq = new Set(toks);
      uniq.forEach((t) => docFreq.set(t, (docFreq.get(t) || 0) + 1));
      return toks;
    });
    ready = true;
    if (onProgress) onProgress(chunks.length);
  })();

  return loadingPromise;
}

function idf(term) {
  const N = chunks.length || 1;
  const df = docFreq.get(term) || 0;
  return Math.log((N + 1) / (df + 1)) + 1;
}

function scoreChunk(queryTerms, toks) {
  if (toks.length === 0) return 0;
  const tf = new Map();
  toks.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
  let score = 0;
  queryTerms.forEach((t) => {
    if (tf.has(t)) score += (tf.get(t) / toks.length) * idf(t);
  });
  return score;
}

function snippetAround(text, terms, radius = 160) {
  const lower = text.toLowerCase();
  let idx = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  if (idx === -1) return text.slice(0, radius * 2) + (text.length > radius * 2 ? "…" : "");
  let start = Math.max(0, idx - radius);
  let end = Math.min(text.length, idx + radius);

  // Intentem ajustar als límits de frase (punt seguit d'espai) més propers,
  // perquè el fragment es llegeixi com una frase completa i no comenci o
  // acabi a mig mot. Si no trobem un punt raonablement a prop, ens quedem
  // amb el retall per caràcters d'abans (millor un tall net que cap resposta).
  const sentenceStart = text.lastIndexOf(". ", idx);
  if (sentenceStart !== -1 && idx - sentenceStart < radius * 1.5) {
    start = sentenceStart + 2;
  }
  const sentenceEnd = text.indexOf(". ", idx);
  if (sentenceEnd !== -1 && sentenceEnd - idx < radius * 1.5) {
    end = sentenceEnd + 1;
  }

  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

function highlight(text, terms) {
  let out = text;
  terms.forEach((t) => {
    if (t.length < 3) return;
    const re = new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
    out = out.replace(re, "<mark>$1</mark>");
  });
  return out;
}

function expandWithDictionary(terms) {
  const expanded = new Set(terms);
  terms.forEach((t) => {
    if (DICT[t]) DICT[t].forEach((en) => expanded.add(en));
  });
  return [...expanded];
}

function search(query, topK = 12) {
  if (!ready) return [];
  const baseTerms = tokenize(query).filter((t) => t.length > 2 && !STOPWORDS.has(t));
  const queryTerms = expandWithDictionary([...new Set(baseTerms)]);
  if (queryTerms.length === 0) return [];

  const scored = chunks.map((c, i) => ({
    chunk: c,
    score: scoreChunk(queryTerms, chunkTokens[i]),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((s) => s.score > 0)
    .slice(0, topK)
    .map((s) => ({
      ...s.chunk,
      snippet: highlight(snippetAround(s.chunk.text, queryTerms), queryTerms),
    }));
}

// --- API pública para otras páginas/scripts (p. ej. script.js) -------------
window.TB_KB = {
  loadIndex,
  search,
  isReady: () => ready,
};

// --- Interfaz tipo chat (para kb/buscador.html) -----------------------------

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function addUserBubble(container, text) {
  const row = document.createElement("div");
  row.className = "tb-msg-row user";
  row.innerHTML = `<div class="tb-bubble user">${escapeHtml(text)}</div>`;
  container.appendChild(row);
}

function addBotBubble(container, results) {
  const row = document.createElement("div");
  row.className = "tb-msg-row bot";

  let inner;
  if (results.length === 0) {
    inner = '<p class="tb-empty">No se ha encontrado ningún resultado. Prueba con otras palabras (recuerda que los documentos están en inglés; el buscador traduce algunos términos habituales, pero no todos).</p>';
  } else {
    inner = results
      .map(
        (r) => `
        <div class="tb-result">
          <div class="tb-result-meta">${r.category} · ${r.year} · pág. ${r.page}</div>
          <h3 class="tb-result-title">${r.title}</h3>
          <p class="tb-result-snippet">${r.snippet}</p>
          <a class="tb-result-link" href="${r.source_url}" target="_blank" rel="noopener">Ver documento original</a>
        </div>`
      )
      .join("");
  }

  row.innerHTML = `<div class="tb-bubble bot">${inner}</div>`;
  container.appendChild(row);
}

function initBuscadorTB({ inputId, buttonId, resultsId, statusId }) {
  const input = document.getElementById(inputId);
  const button = document.getElementById(buttonId);
  const chat = document.getElementById(resultsId);
  const status = statusId ? document.getElementById(statusId) : null;

  if (status) status.textContent = "Cargando base de conocimiento…";

  loadIndex((n) => {
    if (status) status.textContent = `Listo (${n} fragmentos indexados). Puedes preguntar en español.`;
  }).catch((e) => {
    if (status) status.textContent = "Error al cargar la base de conocimiento.";
    console.error(e);
  });

  function scrollToBottom() {
    chat.scrollTop = chat.scrollHeight;
  }

  function doSearch() {
    if (!ready) return;
    const q = input.value.trim();
    if (!q) return;

    addUserBubble(chat, q);
    const r = search(q);
    addBotBubble(chat, r);

    input.value = "";
    scrollToBottom();
  }

  button.addEventListener("click", doSearch);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });
}

window.initBuscadorTB = initBuscadorTB;
