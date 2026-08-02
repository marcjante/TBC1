/* ---------------- storage layer ---------------- */
/* Two modes, chosen automatically:
   - FIRESTORE (shared, real-time): used when window.FIREBASE_CONFIG in
     firebase-config.js has real values. Patients, professionals, and any
     device viewing the page see the same data, live.
   - LOCALSTORAGE (local only, fallback): used when Firebase isn't configured.
     Data stays in that one browser only. Good for trying the app before
     setting up Firebase. See README.md for setup steps. */
let db = null;
let useFirestore = false;
try{
  if(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey && typeof firebase !== 'undefined'){
    firebase.initializeApp(window.FIREBASE_CONFIG);
    db = firebase.firestore();
    useFirestore = true;
    console.log('Firestore activo: los datos se comparten entre dispositivos.');
  } else {
    console.log('Firebase no configurado: modo local (localStorage), datos solo en este navegador.');
  }
}catch(e){
  console.error('No se pudo inicializar Firebase, usando localStorage:', e);
  useFirestore = false;
}

function reflectMode(){
  const badge = document.getElementById('modeBadge');
  const foot = document.getElementById('modeFootnote');
  if(!badge || !foot) return;
  if(useFirestore){
    badge.textContent = '🟢 Compartit (Firebase)';
    badge.className = 'shared';
    foot.textContent = 'Dades compartides en temps real entre tots els dispositius connectats a aquest projecte.';
  } else {
    badge.textContent = '🔒 Local (aquest navegador)';
    badge.className = 'local';
    foot.textContent = "Dades desades només en aquest navegador (localStorage). Configura firebase-config.js per compartir-les entre dispositius — vegeu README.md.";
  }
}

async function sGet(key){
  if(useFirestore){
    try{
      const doc = await db.collection('tbc_store').doc(key).get();
      return doc.exists ? JSON.parse(doc.data().value) : null;
    }catch(e){ console.error('sGet(Firestore) failed for', key, e); return null; }
  }
  try{
    const v = localStorage.getItem(key);
    return v===null ? null : JSON.parse(v);
  }catch(e){
    console.error('sGet(localStorage) failed for', key, e);
    return null;
  }
}
async function sSet(key, val){
  if(useFirestore){
    try{
      await db.collection('tbc_store').doc(key).set({
        value: JSON.stringify(val),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return;
    }catch(e){ console.error('sSet(Firestore) failed for', key, e); return; }
  }
  try{ localStorage.setItem(key, JSON.stringify(val)); }
  catch(e){ console.error('sSet(localStorage) failed for', key, e); }
}
async function sDelete(key){
  if(useFirestore){
    try{ await db.collection('tbc_store').doc(key).delete(); return; }
    catch(e){ console.error('sDelete(Firestore) failed for', key, e); return; }
  }
  try{ localStorage.removeItem(key); }
  catch(e){ console.error('sDelete(localStorage) failed for', key, e); }
}

/* Live sync: when Firestore is active, every device watching the page
   re-renders automatically as soon as any other device writes data. */
function startRealtimeSync(){
  if(!useFirestore) return;
  db.collection('tbc_store').onSnapshot((snapshot)=>{
    snapshot.docChanges().forEach((change)=>{
      const key = change.doc.id;
      if(change.type==='removed'){
        if(key.startsWith('patient:')) delete patients[key.slice('patient:'.length)];
        return;
      }
      const raw = change.doc.data().value;
      if(raw===undefined) return;
      const val = JSON.parse(raw);
      if(key==='settings'){ settings = val; }
      else if(key.startsWith('patient:')){ patients[val.id] = val; }
    });
    const panelHidden = document.getElementById('viewPanel').style.display === 'none';
    try{ panelHidden ? renderChatView() : renderPanelView(); }
    catch(e){ console.error('Render tras sincronització en temps real ha fallat', e); }
  }, (err)=> console.error('Realtime sync error', err));
}

/* ---------------- protocol: visit scheduling ---------------- */
function computeVisits(type, startDateStr){
  const start = new Date(startDateStr+'T00:00:00');
  const plans = {
    TBC: [
      {days:15, label:'Control a 2 setmanes (tolerància, adherència)'},
      {days:30, label:'Control a 1 mes (analítica hepàtica, clínica)'},
      {days:60, label:'Control a 2 mesos (fi fase intensiva)'},
      {days:120, label:'Control a 4 mesos'},
      {days:180, label:'Control a 6 mesos (fi tractament)'}
    ],
    ITL: [
      {days:30, label:'Control a 1 mes (tolerància)'},
      {days:60, label:'Control a 2 mesos'},
      {days:90, label:'Control a 3 mesos'},
      {days:180, label:'Control final (fi pauta 6 mesos)'}
    ]
  };
  return plans[type].map(v=>{
    const d = new Date(start); d.setDate(d.getDate()+v.days);
    return {date: d.toISOString().slice(0,10), label: v.label, done:false};
  });
}

/* ---------------- triage bot ---------------- */
function norm(s){
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
}
function triage(text){
  const t = norm(text);
  const urgentPatterns = [
    [/sangre|hemoptisis|esput.*sangre/,'Hemoptisi (sang a l\'esput)'],
    [/ictericia|amarill|orina oscura|ulls groc/,'Possible hepatotoxicitat'],
    [/vomit/,'Vòmits'],
    [/dolor abdominal/,'Dolor abdominal intens'],
    [/fiebre alta|febre alta|39|40/,'Febre alta'],
    [/ahog|dificultad.*respirar|falta d.aire|disnea/,'Dificultat respiratòria']
  ];
  const moderatePatterns = [
    [/erupcion|erupció|picor|manchas|taques.*pell|urticaria/,'Reacció cutània'],
    [/hormigueo|formigueig|entumecimiento/,'Possible neuropatia perifèrica'],
    [/mareo|marejo/,'Mareig'],
    [/apetito|gana/,'Pèrdua de gana']
  ];
  for(const [re,label] of urgentPatterns){ if(re.test(t)) return {level:'urgent', label}; }
  for(const [re,label] of moderatePatterns){ if(re.test(t)) return {level:'moderate', label}; }
  if(/olvide|olvido|se me paso|no he pres|no he tomado/.test(t)){
    return {level:'mild', label:'Oblit de dosi'};
  }
  if(/cansanci|fatiga|dolor de cabeza|mal de cap/.test(t)){
    return {level:'mild', label:'Símptoma lleu'};
  }
  return {level:'info', label:'Consulta general'};
}
/* Detecta si el pacient escriu en català o castellà, a partir de paraules
   distintives (no és perfecte, però és suficient per triar l'idioma de les
   respostes del bot). Per defecte assumim castellà, ja que és l'idioma més
   habitual entre els pacients que fan servir l'app. */
const CATALAN_MARKERS = /\b(tinc|vull|aixo|aquest|aquesta|tambe|quant|gracies|voldria|estic|molt|puc|dic|es troba|em trobo)\b/;
function detectLang(text){
  return CATALAN_MARKERS.test(norm(text)) ? 'ca' : 'es';
}

const REPLY_STRINGS = {
  ca: {
    urgent: "Aquest símptoma requereix valoració avui mateix. Contacta ara amb el teu equip de TBC; si empitjora o tens febre alta o dificultat per respirar, acut a urgències. No et prenguis la propera dosi fins parlar amb el professional.",
    moderate: "Pot tractar-se d'un efecte relacionat amb el tractament. Contacta amb el teu equip de referència en les properes 24–48h. No suspenguis la medicació pel teu compte.",
    mildForgot: "Si fa poques hores de l'horari habitual, pren la dosi oblidada. Si ja és a prop de la següent presa, no dupliquis dosi: continua la pauta normal.",
    mildGeneric: "Anota el símptoma i comenta'l a la propera visita. Contacta abans si empitjora o n'apareixen d'altres.",
    infoDefault: "Gràcies pel missatge. Un professional el revisarà. Contacta de seguida si tens sang a l'esput, febre alta, dificultat per respirar o color groguenc a pell o ulls.",
    ack: ["D'acord. ", "Entès. ", "Gràcies per explicar-ho. ", "Perfecte, seguim. ", "Molt bé. "],
    kbIntro: "📚 Amb tot el que m'has explicat, això és el que diuen els documents de referència (en anglès): ",
    topics: {
      symptoms: {
        opener: "Sento que no et trobis del tot bé. ",
        questions: [
          "Per entendre-ho millor: des de quan tens aquest símptoma?",
          "Ha anat a més, es manté igual o ha millorat des que va començar?"
        ]
      },
      treatment: {
        opener: "Cap problema, mirem-nos junts el dubte sobre el tractament. ",
        questions: [
          "Quin medicament del tractament et genera el dubte?",
          "El dubte és sobre la dosi, la durada del tractament, o com prendre'l?"
        ]
      },
      side_effects: {
        opener: "Gràcies per avisar-ho, ho mirem junts. ",
        questions: [
          "Quin efecte concret has notat?",
          "Des de quan el notes, i ha anat a més des que va aparèixer?"
        ]
      },
      contagion: {
        opener: "Bona pregunta, aclarim-ho. ",
        questions: [
          "El dubte és sobre si tu pots contagiar algú altre, o sobre com et vas poder contagiar tu?"
        ]
      }
    }
  },
  es: {
    urgent: "Este síntoma requiere valoración hoy mismo. Contacta ahora con tu equipo de TBC; si empeora o tienes fiebre alta o dificultad para respirar, acude a urgencias. No te tomes la próxima dosis hasta hablar con el profesional.",
    moderate: "Puede tratarse de un efecto relacionado con el tratamiento. Contacta con tu equipo de referencia en las próximas 24–48h. No suspendas la medicación por tu cuenta.",
    mildForgot: "Si hace pocas horas del horario habitual, toma la dosis olvidada. Si ya está cerca de la siguiente toma, no dupliques dosis: continúa la pauta normal.",
    mildGeneric: "Anota el síntoma y coméntalo en la próxima visita. Contacta antes si empeora o aparecen otros.",
    infoDefault: "Gracias por el mensaje. Un profesional lo revisará. Contacta enseguida si tienes sangre en el esputo, fiebre alta, dificultad para respirar o color amarillento en piel u ojos.",
    ack: ["De acuerdo. ", "Entendido. ", "Gracias por explicarlo. ", "Perfecto, seguimos. ", "Muy bien. "],
    kbIntro: "📚 Con todo lo que me has explicado, esto es lo que dicen los documentos de referencia (en inglés): ",
    topics: {
      symptoms: {
        opener: "Siento que no te encuentres del todo bien. ",
        questions: [
          "Para entenderlo mejor: ¿desde cuándo tienes este síntoma?",
          "¿Ha ido a más, se mantiene igual o ha mejorado desde que empezó?"
        ]
      },
      treatment: {
        opener: "Sin problema, miramos juntos la duda sobre el tratamiento. ",
        questions: [
          "¿Qué medicamento del tratamiento te genera la duda?",
          "¿La duda es sobre la dosis, la duración del tratamiento, o cómo tomarlo?"
        ]
      },
      side_effects: {
        opener: "Gracias por avisar, lo miramos juntos. ",
        questions: [
          "¿Qué efecto concreto has notado?",
          "¿Desde cuándo lo notas, y ha ido a más desde que apareció?"
        ]
      },
      contagion: {
        opener: "Buena pregunta, lo aclaramos. ",
        questions: [
          "¿La duda es sobre si tú puedes contagiar a otra persona, o sobre cómo te pudiste contagiar tú?"
        ]
      }
    }
  }
};

function botReply(triageResult, lang){
  const s = REPLY_STRINGS[lang] || REPLY_STRINGS.es;
  switch(triageResult.level){
    case 'urgent': return s.urgent;
    case 'moderate': return s.moderate;
    case 'mild':
      if(triageResult.label==='Oblit de dosi') return s.mildForgot;
      return s.mildGeneric;
    default:
      return s.infoDefault;
  }
}

/* ---------------- consulta conversacional a la base de coneixement (kb/buscador.js) ----------------
   Complementa la resposta de triatge amb informació dels documents de referència
   (OMS/CDC/ECDC) NOMÉS quan el missatge no és una alerta urgent/moderada, per no
   diluir mai un avís de seguretat amb informació documental.

   No usa IA: és un petit arbre de preguntes per regles. Si el missatge coincideix
   amb un tema conegut, el bot fa 1-2 preguntes de seguiment (guardades a
   p.kbFlow) abans de donar la resposta final basada en els documents. Si no
   reconeix cap tema, manté el comportament anterior (resposta directa si troba
   res rellevant). Un símptoma urgent/moderat sempre cancel·la el flux en curs.

   Les preguntes del bot es responen en l'idioma detectat al primer missatge
   del tema (guardat a p.kbFlow.lang). El text del document en si segueix en
   anglès perquè els PDF originals estan en anglès (no hi ha traducció automàtica). */
const KB_TOPIC_MATCHERS = {
  symptoms: /tos|fiebre|febre|cansanci|fatiga|sudor|sintoma|malestar|molest|no.*trob.*be|no me encuentro bien|no estic be/,
  treatment: /tractament|medicament|pastilla|dosi|isoniazid|rifampicin|rifapentin|pirazinamid|etambutol|durada|cuanto dura|quant.*dura|quan.*acaba|cuando termino/,
  side_effects: /efecte|efectos|secundari|reaccio|nausea|vomit|picor|erupci|em fa mal|em sento malament|me siento mal/,
  contagion: /contagi|transmis|contacte|infectar|puc.*contagiar|puedo contagiar|risc.*altres/
};

function pickAck(lang){
  const list = (REPLY_STRINGS[lang] || REPLY_STRINGS.es).ack;
  return list[Math.floor(Math.random()*list.length)];
}

function detectKbTopicId(text){
  const t = norm(text);
  const id = Object.keys(KB_TOPIC_MATCHERS).find(key => KB_TOPIC_MATCHERS[key].test(t));
  return id || null;
}

async function buildKbAnswer(queryText, lang){
  if(!window.TB_KB) return null;
  try{
    await window.TB_KB.loadIndex();
  }catch(e){
    console.warn('Base de coneixement TB no disponible', e);
    return null;
  }
  try{
    const results = window.TB_KB.search(queryText, 2);
    if(!results.length) return null;
    const parts = results.map(r=>{
      const plain = r.snippet.replace(/<[^>]+>/g,'').trim();
      return plain.length > 220 ? plain.slice(0,220)+'…' : plain;
    });
    const s = REPLY_STRINGS[lang] || REPLY_STRINGS.es;
    return s.kbIntro + parts.join(' · ');
  }catch(e){
    console.warn('Cerca a la base de coneixement ha fallat', e);
    return null;
  }
}

/* Gestiona el flux de conversa amb la base de coneixement per a un pacient.
   Retorna el text que el bot ha de dir a continuació, o null si no hi ha res
   a afegir. Modifica p.kbFlow directament (s'ha de cridar savePatient després).
   Permet canviar de tema a mig flux (si el pacient escriu sobre un tema diferent
   i clarament reconegut, es reinicia el flux amb el tema nou) per sonar més
   fluid i menys com un formulari rígid. */
async function advanceKbConversation(p, text, triageResult){
  if(triageResult.level === 'urgent' || triageResult.level === 'moderate'){
    delete p.kbFlow; // la seguretat sempre té prioritat: cancel·la qualsevol flux obert
    return null;
  }

  if(p.kbFlow){
    const lang = p.kbFlow.lang || detectLang(text);
    const currentStrings = (REPLY_STRINGS[lang] || REPLY_STRINGS.es).topics[p.kbFlow.topicId];
    const maybeNewTopicId = detectKbTopicId(text);
    if(!currentStrings){ delete p.kbFlow; return null; }

    if(maybeNewTopicId && maybeNewTopicId !== p.kbFlow.topicId){
      // El pacient ha canviat de tema enmig de la conversa: seguim el nou fil.
      const newLang = detectLang(text);
      const newStrings = REPLY_STRINGS[newLang].topics[maybeNewTopicId];
      p.kbFlow = { topicId: maybeNewTopicId, lang: newLang, step: 0, originalText: text, answers: [] };
      return newStrings.opener + newStrings.questions[0];
    }

    p.kbFlow.answers.push(text);
    const nextStep = p.kbFlow.step + 1;
    if(nextStep < currentStrings.questions.length){
      p.kbFlow.step = nextStep;
      return pickAck(lang) + currentStrings.questions[nextStep];
    }
    // Ja tenim prou informació: componem la resposta final i tanquem el flux.
    const combined = [p.kbFlow.originalText, ...p.kbFlow.answers].join(' ');
    delete p.kbFlow;
    const answer = await buildKbAnswer(combined, lang);
    return answer;
  }

  const topicId = detectKbTopicId(text);
  if(topicId){
    const lang = detectLang(text);
    const strings = REPLY_STRINGS[lang].topics[topicId];
    p.kbFlow = { topicId, lang, step: 0, originalText: text, answers: [] };
    return strings.opener + strings.questions[0];
  }

  // Tema no reconegut: mantenim el comportament directe d'abans (sense preguntes).
  return await buildKbAnswer(text, detectLang(text));
}

/* ---------------- state ---------------- */
let patients = {}; // id -> patient object
let settings = {professionalPhone:'', professionalName:''};
let currentPatientId = null;

async function loadAll(){
  if(useFirestore) return; // realtime listener (startRealtimeSync) populates patients/settings instead
  const idx = await sGet('patients-index');
  const ids = idx? idx.ids : [];
  for(const id of ids){
    const p = await sGet('patient:'+id);
    if(p) patients[id] = p;
  }
  settings = (await sGet('settings')) || settings;
}
async function savePatient(p){
  patients[p.id] = p;
  await sSet('patient:'+p.id, p);
  if(useFirestore) return;
  const idx = await sGet('patients-index') || {ids:[]};
  if(!idx.ids.includes(p.id)){ idx.ids.push(p.id); await sSet('patients-index', idx); }
}
async function saveSettings(){ await sSet('settings', settings); }

function waLink(phone, text){
  const clean = (phone||'').replace(/[^0-9+]/g,'');
  return 'https://wa.me/'+clean.replace('+','')+'?text='+encodeURIComponent(text);
}
function fmtDate(d){
  return new Date(d+'T00:00:00').toLocaleDateString('ca-ES',{day:'2-digit',month:'short',year:'numeric'});
}
function daysUntil(d){
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(d+'T00:00:00');
  return Math.round((target-today)/86400000);
}

/* ---------------- render: chat view ---------------- */
function renderChatView(){
  const el = document.getElementById('viewChat');
  const ids = Object.keys(patients);
  let optionsHtml = ids.map(id=>`<option value="${id}" ${id===currentPatientId?'selected':''}>${patients[id].name} (${patients[id].type})</option>`).join('');

  el.innerHTML = `
    <div class="card">
      <label>Pacient actiu</label>
      <select id="patientSelect">
        <option value="">— Selecciona o crea un pacient —</option>
        ${optionsHtml}
      </select>
      <button class="ghost" id="newPatientBtn" style="width:100%;">+ Nou pacient</button>
      ${ids.length===0 ? `<button class="ghost" id="demoSeedBtn" style="width:100%;margin-top:8px;">Carregar dades de demostració</button>` : `<button class="ghost" id="demoClearBtn" style="width:100%;margin-top:8px;">Esborrar totes les dades</button>`}
    </div>
    <div id="newPatientForm"></div>
    <div id="chatArea"></div>
  `;

  document.getElementById('patientSelect').onchange = (e)=>{
    currentPatientId = e.target.value || null;
    renderChatView();
  };
  document.getElementById('newPatientBtn').onclick = ()=>{
    document.getElementById('newPatientForm').innerHTML = newPatientFormHtml();
    bindNewPatientForm();
  };
  const demoSeedBtn = document.getElementById('demoSeedBtn');
  if(demoSeedBtn) demoSeedBtn.onclick = async ()=>{ await seedDemo(); renderChatView(); };
  const demoClearBtn = document.getElementById('demoClearBtn');
  if(demoClearBtn) demoClearBtn.onclick = async ()=>{
    if(!confirm('Esborrar tots els pacients i la configuració? Aquesta acció no es pot desfer.')) return;
    await clearAllData(); renderChatView();
  };

  const chatArea = document.getElementById('chatArea');
  if(!currentPatientId || !patients[currentPatientId]){
    chatArea.innerHTML = `<div class="empty">Selecciona un pacient o crea'n un de nou per començar el xat.</div>`;
    return;
  }
  const p = patients[currentPatientId];
  const pending = pendingAlerts(p);
  chatArea.innerHTML = `
    <div class="card">
      <div class="chatbox" id="chatbox">
        ${p.messages.map(m=>`
          <div class="msg ${m.from} ${m.level==='urgent'?'urgent':m.level==='moderate'?'moderate':''}">
            ${escapeHtml(m.text)}
            <time>${new Date(m.time).toLocaleString('ca-ES',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'})}</time>
          </div>`).join('') || '<div class="empty">Encara no hi ha missatges.</div>'}
      </div>
      <div class="composer">
        <input type="text" id="msgInput" placeholder="Escriu com a pacient…">
        <button id="sendBtn">Enviar</button>
      </div>
      ${pending.length ? `
        <button class="wa ${pending.some(a=>a.level==='urgent')?'urgent':''}" id="waAlertBtn" style="margin-top:10px;">
          Avisar equip per WhatsApp${pending.length>1? ' — '+pending.length+' avisos pendents' : ' — '+pending[0].label}
        </button>` : ''}
    </div>
  `;
  const box = document.getElementById('chatbox');
  box.scrollTop = box.scrollHeight;

  document.getElementById('sendBtn').onclick = sendMessage;
  document.getElementById('msgInput').addEventListener('keydown', e=>{ if(e.key==='Enter') sendMessage(); });

  const waBtn = document.getElementById('waAlertBtn');
  if(waBtn){
    waBtn.onclick = ()=>{
      if(!settings.professionalPhone){
        alert('Configura primer el telèfon del professional al Panell professional.');
        return;
      }
      const summary = pending.map(a=>`${a.label}: "${a.text}"`).join(' | ');
      const text = `Alerta ${p.type} — ${p.name}: ${summary}`;
      window.open(waLink(settings.professionalPhone, text), '_blank');
    };
  }
}

function newPatientFormHtml(){
  const today = new Date().toISOString().slice(0,10);
  return `
    <div class="card">
      <label>Nom del pacient</label>
      <input type="text" id="npName" placeholder="Nom i cognoms">
      <label>Telèfon (per WhatsApp)</label>
      <input type="tel" id="npPhone" placeholder="+34 6xx xxx xxx">
      <div class="row2">
        <div>
          <label>Tipus</label>
          <select id="npType">
            <option value="TBC">TBC activa</option>
            <option value="ITL">ITL (infecció latent)</option>
          </select>
        </div>
        <div>
          <label>Inici tractament</label>
          <input type="date" id="npStart" value="${today}">
        </div>
      </div>
      <button class="primary" id="npSave">Crear pacient</button>
    </div>
  `;
}
function bindNewPatientForm(){
  document.getElementById('npSave').onclick = async ()=>{
    const name = document.getElementById('npName').value.trim();
    const phone = document.getElementById('npPhone').value.trim();
    const type = document.getElementById('npType').value;
    const start = document.getElementById('npStart').value;
    if(!name || !start){ alert('Falta el nom o la data d\'inici.'); return; }
    const id = 'p_'+Date.now();
    const p = {
      id, name, phone, type, treatmentStart:start,
      messages:[], visits: computeVisits(type, start),
      alerts:[], createdAt:new Date().toISOString()
    };
    await savePatient(p);
    currentPatientId = id;
    document.getElementById('newPatientForm').innerHTML = '';
    renderChatView();
  };
}

async function sendMessage(){
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if(!text) return;
  const p = patients[currentPatientId];
  p.messages.push({from:'patient', text, time:new Date().toISOString()});
  const tr = triage(text);
  const lang = detectLang(text);

  if(tr.level==='urgent' || tr.level==='moderate'){
    // Seguretat sempre primer i sense excepcions: la resposta de triatge es
    // mostra sempre, íntegra, i mai es barreja amb la conversa de la base
    // de coneixement (advanceKbConversation ja cancel·la qualsevol flux obert).
    const reply = botReply(tr, lang);
    p.messages.push({from:'bot', text:reply, time:new Date().toISOString(), level: tr.level});
    if(!p.alerts) p.alerts = [];
    p.alerts.push({level:tr.level, label:tr.label, text, acknowledged:false, time:new Date().toISOString()});
    await savePatient(p);
    input.value='';
    renderChatView();
    return;
  }

  if(tr.level==='mild'){
    // Consell específic (oblit de dosi, símptoma lleu): sempre útil, es manté.
    const reply = botReply(tr, lang);
    p.messages.push({from:'bot', text:reply, time:new Date().toISOString(), level: tr.level});
  }

  // Conversa amb la base de coneixement: pregunta de seguiment o resposta final.
  const kbText = await advanceKbConversation(p, text, tr);
  if(kbText){
    p.messages.push({from:'bot', text:kbText, time:new Date().toISOString(), level:'info'});
  } else if(tr.level==='info'){
    // Només mostrem l'avís genèric quan no hi ha cap resposta conversacional
    // més concreta a oferir, per no repetir sempre el mateix text llarg.
    const reply = botReply(tr, lang);
    p.messages.push({from:'bot', text:reply, time:new Date().toISOString(), level: tr.level});
  }
  await savePatient(p);
  input.value='';
  renderChatView();
}
function escapeHtml(s){
  return s.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function pendingAlerts(p){ return (p.alerts||[]).filter(a=>!a.acknowledged); }

/* ---------------- demo data ---------------- */
async function seedDemo(){
  const today = new Date();
  const iso = (d)=> d.toISOString().slice(0,10);
  const d1start = new Date(today); d1start.setDate(d1start.getDate()-20);
  const d2start = new Date(today); d2start.setDate(d2start.getDate()-40);

  const p1 = {
    id:'demo_tbc_1', name:'Marta Vidal (demo)', phone:'+34600000001',
    type:'TBC', treatmentStart: iso(d1start),
    messages:[
      {from:'patient', text:'Hola, tinc tos des de fa uns dies', time:new Date(Date.now()-3600e3*30).toISOString()},
      {from:'bot', level:'info', text: botReply({level:'info'}), time:new Date(Date.now()-3600e3*30).toISOString()},
      {from:'patient', text:'Ara m\'he notat sang a l\'esput quan he tossit', time:new Date(Date.now()-3600e3*2).toISOString()},
      {from:'bot', level:'urgent', text: botReply({level:'urgent'}), time:new Date(Date.now()-3600e3*2).toISOString()}
    ],
    visits: computeVisits('TBC', iso(d1start)),
    alerts:[{level:'urgent', label:"Hemoptisi (sang a l'esput)", text:'Ara m\'he notat sang a l\'esput quan he tossit', acknowledged:false, time:new Date(Date.now()-3600e3*2).toISOString()}],
    createdAt:new Date().toISOString()
  };
  const p2 = {
    id:'demo_itl_1', name:'Robert Puig (demo)', phone:'+34600000002',
    type:'ITL', treatmentStart: iso(d2start),
    messages:[
      {from:'patient', text:'Tot bé, prenc la pastilla cada dia sense problemes', time:new Date(Date.now()-3600e3*80).toISOString()},
      {from:'bot', level:'info', text: botReply({level:'info'}), time:new Date(Date.now()-3600e3*80).toISOString()}
    ],
    visits: computeVisits('ITL', iso(d2start)),
    alerts:[],
    createdAt:new Date().toISOString()
  };
  await savePatient(p1);
  await savePatient(p2);
  currentPatientId = p1.id;
}
async function clearAllData(){
  const ids = Object.keys(patients);
  for(const id of ids){ await sDelete('patient:'+id); }
  await sDelete('patients-index');
  await sDelete('settings');
  patients = {}; settings = {professionalPhone:'', professionalName:''}; currentPatientId = null;
}

/* ---------------- render: professional panel ---------------- */
function renderPanelView(){
  const el = document.getElementById('viewPanel');
  const list = Object.values(patients);

  function status(p){
    const pend = pendingAlerts(p);
    if(pend.some(a=>a.level==='urgent')) return 3;
    if(pend.length) return 2;
    const next = p.visits.find(v=>!v.done);
    if(next && daysUntil(next.date)<=3) return 1;
    return 0;
  }
  list.sort((a,b)=> status(b)-status(a) || (a.visits.find(v=>!v.done)?.date||'').localeCompare(b.visits.find(v=>!v.done)?.date||''));

  el.innerHTML = `
    <div class="card">
      <label>Telèfon professional (per rebre avisos)</label>
      <input type="tel" id="profPhone" value="${settings.professionalPhone||''}" placeholder="+34 6xx xxx xxx">
      <label>Nom professional (opcional)</label>
      <input type="text" id="profName" value="${settings.professionalName||''}" placeholder="Infermera / referent TBC">
      <button class="primary" id="saveSettingsBtn">Desar configuració</button>
    </div>
    <div class="section-title">Pacients (${list.length})</div>
    <div id="patientList">
      ${list.length? '' : '<div class="empty">Encara no hi ha pacients registrats.</div>'}
    </div>
  `;
  document.getElementById('saveSettingsBtn').onclick = async ()=>{
    settings.professionalPhone = document.getElementById('profPhone').value.trim();
    settings.professionalName = document.getElementById('profName').value.trim();
    await saveSettings();
    alert('Configuració desada.');
  };

  const listEl = document.getElementById('patientList');
  list.forEach(p=>{
    const next = p.visits.find(v=>!v.done);
    const dLeft = next? daysUntil(next.date) : null;
    const pending = pendingAlerts(p);
    let alertHtml = '';
    if(pending.length){
      const labels = pending.map(a=>a.label).join(', ');
      const cls = pending.some(a=>a.level==='urgent') ? 'urgentline' : 'due';
      alertHtml = `<div class="alertline ${cls}">⚠ ${labels}${pending.length>1? ' ('+pending.length+' avisos)':''} — sense confirmar</div>`;
    } else if(next && dLeft<=3){
      alertHtml = `<div class="alertline due">Visita "${next.label}" ${dLeft<0?'endarrerida':'en '+dLeft+' dies'} (${fmtDate(next.date)})</div>`;
    } else if(next){
      alertHtml = `<div class="alertline ok">Al dia. Propera visita: ${fmtDate(next.date)}</div>`;
    } else {
      alertHtml = `<div class="alertline ok">Seguiment completat.</div>`;
    }

    const card = document.createElement('div');
    card.className = 'patient-card';
    card.innerHTML = `
      <div class="tab ${p.type}"></div>
      <div class="patient-body">
        <div class="patient-head">
          <h3>${escapeHtml(p.name)}</h3>
          <span class="badge ${p.type}">${p.type}</span>
        </div>
        <div class="meta">Inici tractament: ${fmtDate(p.treatmentStart)}${p.phone? ' · '+p.phone:''}</div>
        ${alertHtml}
        <div class="actions">
          <button class="ghost" data-open="${p.id}">Veure xat</button>
          ${p.phone? `<button class="wa" data-remind="${p.id}">Recordatori WhatsApp</button>`:''}
          ${pending.length? `<button class="ghost" data-ack="${p.id}">Marcar vist</button>`:''}
        </div>
        <div class="visitlist">
          ${p.visits.map((v,i)=>`
            <div class="visitrow ${v.done?'done':''} ${!v.done && v===next?'next':''}">
              <span><span class="dot"></span>${fmtDate(v.date)} — ${v.label}</span>
              ${!v.done? `<button data-done="${p.id}|${i}">Fet</button>`:''}
            </div>`).join('')}
        </div>
      </div>
    `;
    listEl.appendChild(card);
  });

  listEl.querySelectorAll('[data-open]').forEach(b=> b.onclick = ()=>{
    currentPatientId = b.dataset.open;
    switchTab('chat');
  });
  listEl.querySelectorAll('[data-remind]').forEach(b=> b.onclick = ()=>{
    const p = patients[b.dataset.remind];
    const next = p.visits.find(v=>!v.done);
    const text = `Hola ${p.name}, et recordem la propera visita de seguiment (${next? next.label+' — '+fmtDate(next.date) : 'control'}). Respon aquest missatge si tens dubtes o símptomes nous.`;
    window.open(waLink(p.phone, text), '_blank');
  });
  listEl.querySelectorAll('[data-ack]').forEach(b=> b.onclick = async ()=>{
    const p = patients[b.dataset.ack];
    (p.alerts||[]).forEach(a=>{ a.acknowledged = true; });
    await savePatient(p);
    renderPanelView();
  });
  listEl.querySelectorAll('[data-done]').forEach(b=> b.onclick = async ()=>{
    const [pid, idx] = b.dataset.done.split('|');
    const p = patients[pid];
    p.visits[+idx].done = true;
    await savePatient(p);
    renderPanelView();
  });
}

/* ---------------- tabs ---------------- */
function switchTab(which){
  const chatBtn = document.getElementById('tabChatBtn');
  const panelBtn = document.getElementById('tabPanelBtn');
  const viewChat = document.getElementById('viewChat');
  const viewPanel = document.getElementById('viewPanel');
  if(which==='chat'){
    chatBtn.classList.add('active'); panelBtn.classList.remove('active');
    viewChat.style.display='block'; viewPanel.style.display='none';
    renderChatView();
  } else {
    panelBtn.classList.add('active'); chatBtn.classList.remove('active');
    viewChat.style.display='none'; viewPanel.style.display='block';
    renderPanelView();
  }
}
document.getElementById('tabChatBtn').onclick = ()=>switchTab('chat');
document.getElementById('tabPanelBtn').onclick = ()=>switchTab('panel');

/* ---------------- PWA: service worker registration ---------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
  });
}

/* ---------------- init ---------------- */
reflectMode();
try{ renderChatView(); }
catch(e){ console.error('Render inicial ha fallat:', e); }

if(useFirestore){
  startRealtimeSync();
} else {
  loadAll().then(()=>{
    try{ renderChatView(); }
    catch(e){ console.error('Render post-carga ha fallat:', e); }
  }).catch(e=>{
    console.error('loadAll ha fallat:', e);
  });
}

/* Precarrega la base de coneixement TB (kb/buscador.js) en segon pla,
   perquè estigui llesta quan el pacient escrigui el primer missatge. */
if(window.TB_KB){
  window.TB_KB.loadIndex().catch(e=> console.warn('Base de coneixement TB no disponible:', e));
}
