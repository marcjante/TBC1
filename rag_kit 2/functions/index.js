/**
 * Cloud Function RAG para "Seguiment TBC / ITL".
 *
 * Recibe una pregunta, busca los fragmentos más relevantes en chunks.json
 * (generado con scripts/build_index.py a partir de los PDF de TB_full/),
 * arma un prompt con ese contexto y llama a la API de Anthropic (Claude)
 * para generar la respuesta con citas a la fuente.
 *
 * Antes de desplegar:
 *   1. Copia chunks.json generado por build_index.py a functions/data/chunks.json
 *   2. Guarda tu clave de Anthropic como secret (ver Guia_RAG_TBC1.md):
 *        firebase functions:secrets:set ANTHROPIC_API_KEY
 *   3. firebase deploy --only functions
 */

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

// --- Carga del índice de fragmentos --------------------------------------

const chunks = require("./data/chunks.json"); // [{id, text, category, year, title, filename, source_url, page}]

const STOPWORDS = new Set([
  // castellano
  "de", "la", "que", "el", "en", "y", "a", "los", "del", "se", "las", "por",
  "un", "para", "con", "no", "una", "su", "al", "es", "lo", "como", "más",
  "o", "pero", "sus", "le", "ha", "me", "si", "sin", "sobre", "también",
  // català
  "de", "la", "el", "que", "i", "a", "els", "les", "en", "un", "una", "per",
  "amb", "no", "es", "del", "al", "com", "però", "són", "més", "seu", "seva",
  // english (por si acaso)
  "the", "of", "and", "to", "in", "a", "is", "for", "on", "with",
]);

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos
    .match(/[a-z0-9]+/g) || [];
}

// Índice invertido simple + IDF, calculado una vez al arrancar la instancia.
const docFreq = new Map();
const chunkTokens = chunks.map((c) => {
  const toks = tokenize(c.text).filter((t) => t.length > 2 && !STOPWORDS.has(t));
  const uniq = new Set(toks);
  uniq.forEach((t) => docFreq.set(t, (docFreq.get(t) || 0) + 1));
  return toks;
});
const N = chunks.length || 1;

function idf(term) {
  const df = docFreq.get(term) || 0;
  return Math.log((N + 1) / (df + 1)) + 1;
}

function scoreChunk(queryTerms, toks) {
  if (toks.length === 0) return 0;
  const tf = new Map();
  toks.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
  let score = 0;
  queryTerms.forEach((t) => {
    if (tf.has(t)) {
      score += (tf.get(t) / toks.length) * idf(t);
    }
  });
  return score;
}

function search(query, topK = 6) {
  const queryTerms = [...new Set(tokenize(query).filter((t) => t.length > 2 && !STOPWORDS.has(t)))];
  if (queryTerms.length === 0) return [];

  const scored = chunks.map((c, i) => ({
    chunk: c,
    score: scoreChunk(queryTerms, chunkTokens[i]),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, topK).map((s) => s.chunk);
}

// --- Prompt para Claude ----------------------------------------------------

function buildSystemPrompt() {
  return `Ets un assistent clínic de suport per a professionals i pacients dins una app de seguiment de tuberculosi (TB) i infecció tuberculosa latent (ITL).

Respon NOMÉS amb informació que aparegui al CONTEXT proporcionat (extractes de guies OMS, CDC, ECDC i Ministeri de Sanitat). Si el context no conté la resposta, digues-ho clarament i no inventis dades.

Normes:
- Respon sempre en el mateix idioma que la pregunta de l'usuari.
- Cita la font de cada afirmació rellevant amb aquest format: (Organisme, Any).
- No facis diagnòstics individuals ni substitueixis el criteri clínic professional; recorda-ho si la pregunta ho suggereix.
- Sigues concís i clar.`;
}

function buildUserPrompt(question, retrieved) {
  const context = retrieved
    .map(
      (c, i) =>
        `[Fragment ${i + 1}] (${c.category}, ${c.year}, "${c.title}", pàg. ${c.page})\n${c.text}`
    )
    .join("\n\n---\n\n");

  return `CONTEXT:\n${context || "(no s'ha trobat cap fragment rellevant)"}\n\nPREGUNTA: ${question}`;
}

// --- Endpoint HTTPS ----------------------------------------------------

const ALLOWED_ORIGIN = "https://marcjante.github.io";

exports.ragChat = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: [ALLOWED_ORIGIN, "http://localhost:5000", "http://127.0.0.1:5500"] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const question = (req.body && req.body.question || "").trim();
    if (!question) {
      res.status(400).json({ error: "Falta 'question' en el cuerpo de la petición" });
      return;
    }

    try {
      const retrieved = search(question, 6);

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY.value(),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 1024,
          system: buildSystemPrompt(),
          messages: [
            { role: "user", content: buildUserPrompt(question, retrieved) },
          ],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        logger.error("Error de Anthropic API", errText);
        res.status(502).json({ error: "Error llamando al modelo", detail: errText });
        return;
      }

      const data = await response.json();
      const answer = data.content && data.content[0] && data.content[0].text
        ? data.content[0].text
        : "";

      res.status(200).json({
        answer,
        sources: retrieved.map((c) => ({
          title: c.title,
          category: c.category,
          year: c.year,
          page: c.page,
          url: c.source_url,
        })),
      });
    } catch (err) {
      logger.error("Error en ragChat", err);
      res.status(500).json({ error: "Error interno", detail: String(err) });
    }
  }
);
