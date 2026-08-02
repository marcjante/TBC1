/**
 * Integración genérica del chat RAG en el frontend (TBC1).
 *
 * No tengo el contenido actual de tu script.js (no pude leerlo desde aquí),
 * así que esto es una función independiente que puedes llamar desde donde
 * ya gestionas el envío de mensajes del chat. Sustituye FUNCTION_URL por la
 * URL que te da `firebase deploy` (ver Guia_RAG_TBC1.md).
 */

const RAG_FUNCTION_URL = "https://REGION-TU_PROYECTO.cloudfunctions.net/ragChat";
// Ejemplo real: "https://us-central1-tbc1-xxxxx.cloudfunctions.net/ragChat"

async function preguntarAlAsistenteTB(pregunta) {
  const res = await fetch(RAG_FUNCTION_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: pregunta }),
  });

  if (!res.ok) {
    throw new Error(`Error del servidor RAG: ${res.status}`);
  }

  const data = await res.json();
  return data; // { answer: "...", sources: [{title, category, year, page, url}, ...] }
}

// Ejemplo de uso dentro del chat (adapta los nombres a tu código real):
//
// async function enviarMensajeChat(textoUsuario) {
//   mostrarMensajeEnPantalla("usuario", textoUsuario);
//   mostrarIndicadorEscribiendo(true);
//   try {
//     const { answer, sources } = await preguntarAlAsistenteTB(textoUsuario);
//     mostrarMensajeEnPantalla("asistente", answer);
//     if (sources.length) {
//       const citas = sources.map(s => `${s.category} ${s.year}: ${s.title}`).join("\n");
//       mostrarFuentes(citas);
//     }
//   } catch (e) {
//     mostrarMensajeEnPantalla("asistente", "No he pogut consultar la base de coneixement ara mateix.");
//     console.error(e);
//   } finally {
//     mostrarIndicadorEscribiendo(false);
//   }
// }
