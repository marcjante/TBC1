/**
 * Buscador estático sobre la base de conocimiento TB (chunks.json).
 * No usa IA generativa ni backend: todo corre en el navegador del usuario.
 *
 * Requiere que kb/chunks.json esté publicado en el mismo repo (ver README_buscador.md).
 */

const CHUNKS_URL = "kb/chunks.json"; // ajusta la ruta si lo colocas en otro sitio

const STOPWORDS = new Set([
  "de", "la", "que", "el", "en", "y", "a", "los", "del", "se", "las", "por",
  "un", "para", "con", "no", "una", "su", "al", "es", "lo", "como", "más",
  "o", "pero", "sus", "le", "ha", "me", "si", "sin", "sobre", "también",
  "de", "la", "el", "que", "i", "a", "els", "les", "en", "un", "una", "per",
  "amb", "no", "es", "del", "al", "com", "però", "són", "més", "seu", "seva",
  "the", "of", "and", "to", "in", "a", "is", "for", "on", "with",
]);

let chunks = [];
let chunkTokens = [];
let docFreq = new Map();
let ready = false;

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g) || [];
}

async function loadIndex(onProgress) {
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
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
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

function search(query, topK = 12) {
  const queryTerms = [...new Set(tokenize(query).filter((t) => t.length > 2 && !STOPWORDS.has(t)))];
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

// --- Interfaz -------------------------------------------------------------

function renderResults(results, container) {
  if (results.length === 0) {
    container.innerHTML = '<p class="tb-empty">No s\'ha trobat cap resultat. Prova amb altres paraules.</p>';
    return;
  }
  container.innerHTML = results
    .map(
      (r) => `
      <article class="tb-result">
        <div class="tb-result-meta">${r.category} · ${r.year} · pàg. ${r.page}</div>
        <h3 class="tb-result-title">${r.title}</h3>
        <p class="tb-result-snippet">${r.snippet}</p>
        <a class="tb-result-link" href="${r.source_url}" target="_blank" rel="noopener">Veure document original</a>
      </article>`
    )
    .join("");
}

function initBuscadorTB({ inputId, buttonId, resultsId, statusId }) {
  const input = document.getElementById(inputId);
  const button = document.getElementById(buttonId);
  const results = document.getElementById(resultsId);
  const status = statusId ? document.getElementById(statusId) : null;

  if (status) status.textContent = "Carregant base de coneixement…";

  loadIndex((n) => {
    if (status) status.textContent = `Llest (${n} fragments indexats).`;
  }).catch((e) => {
    if (status) status.textContent = "Error carregant la base de coneixement.";
    console.error(e);
  });

  function doSearch() {
    if (!ready) return;
    const q = input.value.trim();
    if (!q) {
      results.innerHTML = "";
      return;
    }
    const r = search(q);
    renderResults(r, results);
  }

  button.addEventListener("click", doSearch);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });
}

window.initBuscadorTB = initBuscadorTB;
