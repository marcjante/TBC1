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
  // "Necesito medicación" és una petició/necessitat, no una pregunta informativa:
  // buscar-la als documents dona respostes fora de context (redactades per a
  // personal sanitari, no per a pacients). Té una resposta directa pròpia.
  if(/necesito medicacion|necesito la medicacion|necessito medicacio|necessito la medicacio|me quede sin medicacion|me he quedado sin (medicacion|pastillas)|se me acabo la medicacion|se me han acabado las pastillas|no tengo pastillas|no tinc pastilles|em falta la medicacio|m.he quedat sense medicacio/.test(t)){
    return {level:'mild', label:'Necessitat de medicació'};
  }
  if(/cansanci|fatiga|\bdol\w*\b|mal de cap|em fa mal|me duele|duele|cefalea/.test(t)){
    return {level:'mild', label:'Símptoma lleu'};
  }
  // Una salutació sola (no acompanyada de cap altre text) no ha de rebre
  // l'avís genèric de seguretat, que espanta sense motiu: rep una benvinguda
  // que convida el pacient a explicar què necessita.
  if(/^(hola|hey|ei|buenas|buenos dias|buenos dias|buenas tardes|buenas noches|bon dia|bona tarda|bon vespre|bona nit|que tal|hi|hello)[\s!?.,¡¿]*$/.test(t)){
    return {level:'info', label:'Salutació'};
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
    mildMedicationNeeded: "Si t'has quedat sense medicació o la necessites, contacta com abans millor amb la teva infermera o farmàcia de referència perquè te la puguin facilitar. No canviïs la dosi ni deixis de prendre-la pel teu compte mentrestant.",
    mildGeneric: "Anota el símptoma i comenta'l a la propera visita. Contacta abans si empitjora o n'apareixen d'altres.",
    greeting: "Hola! Sóc aquí per ajudar-te durant el tractament. Explica'm què necessites (un símptoma que has notat, un dubte sobre la medicació, els efectes secundaris, etc.) i mirem de trobar-te una resposta.",
    infoDefault: "Gràcies pel missatge. Un professional el revisarà. Contacta de seguida si tens sang a l'esput, febre alta, dificultat per respirar o color groguenc a pell o ulls.",
    ack: ["D'acord. ", "Entès. ", "Gràcies per explicar-ho. ", "Perfecte, seguim. ", "Molt bé. "],
    kbIntro: "📚 Amb tot el que m'has explicat, això és el que diuen els documents de referència: ",
    translationUnavailable: " (no s'ha pogut traduir ara mateix, text original en anglès: ",
    sourceLabel: " (Font: ",
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
      },
      diagnosis_tests: {
        opener: "D'acord, parlem de les proves diagnòstiques. ",
        questions: [
          "Quina prova et preocupa: la de la pell (Mantoux), l'anàlisi de sang, la radiografia o el cultiu?",
          "És per entendre com funciona la prova, o perquè ja t'han donat un resultat?"
        ]
      },
      ltbi_vs_active: {
        opener: "Bona pregunta, és un dubte molt habitual. ",
        questions: [
          "El que et confon és la diferència entre tenir la bactèria adormida (ITL) i tenir la malaltia activa (TBC)?"
        ]
      },
      duration_completion: {
        opener: "T'entenc, és normal preguntar-s'ho. ",
        questions: [
          "Estàs pensant a deixar-ho abans d'hora, o només vols saber per què cal completar tot el tractament?"
        ]
      },
      missed_dose_repeated: {
        opener: "Cap problema, ho parlem. ",
        questions: [
          "Quantes vegades aproximadament se t'ha oblidat en l'última setmana?"
        ]
      },
      drug_resistance: {
        opener: "Entenc la preocupació. ",
        questions: [
          "T'han dit que el teu cas és resistent, o preguntes en general sobre la resistència als fàrmacs?"
        ]
      },
      follow_up_visits: {
        opener: "D'acord, mirem el seguiment. ",
        questions: [
          "Vols saber quan és la propera visita, o què t'hi faran?"
        ]
      },
      isolation_precautions: {
        opener: "Molt bé, aclarim les precaucions. ",
        questions: [
          "El dubte és sobre quant de temps has d'estar aïllat, o sobre com fer-ho a casa (mascareta, ventilació)?"
        ]
      },
      work_school: {
        opener: "Ho entenc, és una pregunta molt pràctica. ",
        questions: [
          "Preguntes per tornar a la feina o per l'escola?"
        ]
      },
      children_pediatric: {
        opener: "D'acord, parlem del tractament en nens. ",
        questions: [
          "Quina edat té el nen o la nena?"
        ]
      },
      pregnancy_breastfeeding: {
        opener: "Gràcies per dir-ho, és important tenir-ho en compte. ",
        questions: [
          "El dubte és sobre l'embaràs o sobre la lactància?"
        ]
      },
      hiv_comorbidity: {
        opener: "D'acord, ho tenim en compte. ",
        questions: [
          "El dubte és sobre com interactuen els dos tractaments, o sobre alguna cosa concreta que has notat?"
        ]
      },
      diabetes_comorbidity: {
        opener: "D'acord, la diabetis és important tenir-la controlada durant el tractament. ",
        questions: [
          "Tens la diabetis ben controlada actualment?"
        ]
      },
      alcohol_liver: {
        opener: "Bona pregunta, té a veure amb el fetge. ",
        questions: [
          "Vols saber si pots beure alcohol, o et preocupa algun símptoma relacionat amb el fetge?"
        ]
      },
      vaccination_bcg: {
        opener: "D'acord, parlem de la vacuna BCG. ",
        questions: [
          "El dubte és sobre si t'has de vacunar ara, o sobre si la vacuna que et van posar de petit encara et protegeix?"
        ]
      },
      diet_nutrition: {
        opener: "D'acord, parlem de l'alimentació. ",
        questions: [
          "Vols saber si hi ha aliments a evitar, o si necessites algun suplement?"
        ]
      },
      travel: {
        opener: "D'acord, mirem el tema dels viatges. ",
        questions: [
          "El viatge és a prop o és un vol llarg, i saps si encara podries ser contagiós?"
        ]
      },
      cost_access: {
        opener: "D'acord, t'ho aclareixo. ",
        questions: [
          "El dubte és sobre el cost de la medicació o sobre les visites de seguiment?"
        ]
      },
      stigma_disclosure: {
        opener: "Entenc la preocupació, és un dubte molt comú. ",
        questions: [
          "El dubte és sobre si ho has de dir a la feina, a l'escola, o a la família?"
        ]
      },
      elderly: {
        opener: "D'acord, ho tenim en compte. ",
        questions: [
          "Preguntes per tu mateix o per una altra persona gran?"
        ]
      },
      relapse_cure: {
        opener: "Bona pregunta. ",
        questions: [
          "Ja has acabat el tractament, o encara l'estàs fent?"
        ]
      }
    }
  },
  es: {
    urgent: "Este síntoma requiere valoración hoy mismo. Contacta ahora con tu equipo de TBC; si empeora o tienes fiebre alta o dificultad para respirar, acude a urgencias. No te tomes la próxima dosis hasta hablar con el profesional.",
    moderate: "Puede tratarse de un efecto relacionado con el tratamiento. Contacta con tu equipo de referencia en las próximas 24–48h. No suspendas la medicación por tu cuenta.",
    mildForgot: "Si hace pocas horas del horario habitual, toma la dosis olvidada. Si ya está cerca de la siguiente toma, no dupliques dosis: continúa la pauta normal.",
    mildMedicationNeeded: "Si te has quedado sin medicación o la necesitas, contacta cuanto antes con tu enfermera o farmacia de referencia para que te la puedan facilitar. No cambies la dosis ni dejes de tomarla por tu cuenta mientras tanto.",
    mildGeneric: "Anota el síntoma y coméntalo en la próxima visita. Contacta antes si empeora o aparecen otros.",
    greeting: "¡Hola! Estoy aquí para ayudarte durante el tratamiento. Cuéntame qué necesitas (un síntoma que hayas notado, una duda sobre la medicación, los efectos secundarios, etc.) y buscamos la respuesta.",
    infoDefault: "Gracias por el mensaje. Un profesional lo revisará. Contacta enseguida si tienes sangre en el esputo, fiebre alta, dificultad para respirar o color amarillento en piel u ojos.",
    ack: ["De acuerdo. ", "Entendido. ", "Gracias por explicarlo. ", "Perfecto, seguimos. ", "Muy bien. "],
    kbIntro: "📚 Con todo lo que me has explicado, esto es lo que dicen los documentos de referencia: ",
    translationUnavailable: " (no se ha podido traducir ahora mismo, texto original en inglés: ",
    sourceLabel: " (Fuente: ",
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
      },
      diagnosis_tests: {
        opener: "De acuerdo, hablamos de las pruebas diagnósticas. ",
        questions: [
          "¿Qué prueba te preocupa: la de la piel (Mantoux), el análisis de sangre, la radiografía o el cultivo?",
          "¿Es para entender cómo funciona la prueba, o porque ya te han dado un resultado?"
        ]
      },
      ltbi_vs_active: {
        opener: "Buena pregunta, es una duda muy habitual. ",
        questions: [
          "¿Lo que te confunde es la diferencia entre tener la bacteria dormida (ITL) y tener la enfermedad activa (TBC)?"
        ]
      },
      duration_completion: {
        opener: "Te entiendo, es normal preguntárselo. ",
        questions: [
          "¿Estás pensando en dejarlo antes de tiempo, o solo quieres saber por qué hay que completar todo el tratamiento?"
        ]
      },
      missed_dose_repeated: {
        opener: "Sin problema, lo hablamos. ",
        questions: [
          "¿Cuántas veces aproximadamente se te ha olvidado en la última semana?"
        ]
      },
      drug_resistance: {
        opener: "Entiendo la preocupación. ",
        questions: [
          "¿Te han dicho que tu caso es resistente, o preguntas en general sobre la resistencia a los fármacos?"
        ]
      },
      follow_up_visits: {
        opener: "De acuerdo, miramos el seguimiento. ",
        questions: [
          "¿Quieres saber cuándo es la próxima visita, o qué te harán en ella?"
        ]
      },
      isolation_precautions: {
        opener: "Muy bien, aclaramos las precauciones. ",
        questions: [
          "¿La duda es sobre cuánto tiempo tienes que estar aislado, o sobre cómo hacerlo en casa (mascarilla, ventilación)?"
        ]
      },
      work_school: {
        opener: "Lo entiendo, es una pregunta muy práctica. ",
        questions: [
          "¿Preguntas por volver al trabajo o por el colegio?"
        ]
      },
      children_pediatric: {
        opener: "De acuerdo, hablamos del tratamiento en niños. ",
        questions: [
          "¿Qué edad tiene el niño o la niña?"
        ]
      },
      pregnancy_breastfeeding: {
        opener: "Gracias por decirlo, es importante tenerlo en cuenta. ",
        questions: [
          "¿La duda es sobre el embarazo o sobre la lactancia?"
        ]
      },
      hiv_comorbidity: {
        opener: "De acuerdo, lo tenemos en cuenta. ",
        questions: [
          "¿La duda es sobre cómo interactúan los dos tratamientos, o sobre algo concreto que has notado?"
        ]
      },
      diabetes_comorbidity: {
        opener: "De acuerdo, la diabetes es importante tenerla controlada durante el tratamiento. ",
        questions: [
          "¿Tienes la diabetes bien controlada actualmente?"
        ]
      },
      alcohol_liver: {
        opener: "Buena pregunta, tiene que ver con el hígado. ",
        questions: [
          "¿Quieres saber si puedes beber alcohol, o te preocupa algún síntoma relacionado con el hígado?"
        ]
      },
      vaccination_bcg: {
        opener: "De acuerdo, hablamos de la vacuna BCG. ",
        questions: [
          "¿La duda es sobre si tienes que vacunarte ahora, o sobre si la vacuna que te pusieron de pequeño todavía te protege?"
        ]
      },
      diet_nutrition: {
        opener: "De acuerdo, hablamos de la alimentación. ",
        questions: [
          "¿Quieres saber si hay alimentos a evitar, o si necesitas algún suplemento?"
        ]
      },
      travel: {
        opener: "De acuerdo, miramos el tema de los viajes. ",
        questions: [
          "¿El viaje es cerca o es un vuelo largo, y sabes si todavía podrías ser contagioso?"
        ]
      },
      cost_access: {
        opener: "De acuerdo, te lo aclaro. ",
        questions: [
          "¿La duda es sobre el coste de la medicación o sobre las visitas de seguimiento?"
        ]
      },
      stigma_disclosure: {
        opener: "Entiendo la preocupación, es una duda muy común. ",
        questions: [
          "¿La duda es sobre si tienes que decirlo en el trabajo, en el colegio, o en la familia?"
        ]
      },
      elderly: {
        opener: "De acuerdo, lo tenemos en cuenta. ",
        questions: [
          "¿Preguntas por ti mismo o por otra persona mayor?"
        ]
      },
      relapse_cure: {
        opener: "Buena pregunta. ",
        questions: [
          "¿Ya has terminado el tratamiento, o todavía lo estás haciendo?"
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
      if(triageResult.label==='Necessitat de medicació') return s.mildMedicationNeeded;
      return s.mildGeneric;
    default:
      if(triageResult.label==='Salutació') return s.greeting;
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
/* Cada tema té una llista àmplia de paraules/frases (castellà i català, sense
   accents perquè es compara amb el text ja normalitzat) perquè el bot pugui
   reconèixer moltes formulacions diferents de la mateixa pregunta habitual.
   Els temes estan agrupats seguint els blocs de la bibliografia consultada
   (OMS, CDC, ECDC, Ministeri de Sanitat): transmissió, diagnòstic, tractament
   de la malaltia activa i de la ITL, efectes adversos, comorbiditats i grups
   especials, seguiment i aspectes pràctics del dia a dia del pacient. */
const KB_TOPIC_MATCHERS = {
  symptoms: /tos|fiebre|febre|cansanci|fatiga|sudor|sintoma|malestar|molest|no.*trob.*be|no me encuentro bien|no estic be|perdida de peso|perdua de pes|falta de aire|ofego|\bdol\w*\b|duele|em fa mal|me duele|cefalea/,
  treatment: /tractament|medicament|pastilla|dosi|isoniazid|rifampicin|rifapentin|pirazinamid|etambutol|durada|cuanto dura|quant.*dura|quan.*acaba|cuando termino|horario|horari|en ayunas|en deju|con comida|amb menjar/,
  side_effects: /efecte|efectos|secundari|reaccio|nausea|vomit|picor|erupci|em fa mal|em sento malament|me siento mal|orina naranja|orina taronja|lentillas|lentes de contacto|anticonceptiv/,
  contagion: /contagi|transmis|contacte|infectar|puc.*contagiar|puedo contagiar|risc.*altres|mascarilla|mascareta|besar|petons|compartir plat/,
  diagnosis_tests: /mantoux|tuberculina|ppd|quantiferon|igra|radiografia|rayos x|analisis de sangre|analisi de sang|cultivo|cultiu|prueba|prova|resultado|resultat/,
  ltbi_vs_active: /diferencia.*latent|diferencia.*activ|infeccion latente|infeccio latent|estoy enfermo|estic malalt|tengo la bacteria|tinc.*bacteri/,
  duration_completion: /dejar el tratamiento|deixar el tractament|parar.*tractament|parar.*tratamiento|completar.*tractament|completar.*tratamiento|abandonar/,
  missed_dose_repeated: /me olvido a menudo|se m.oblida sovint|olvido varios dias|oblit.*diversos dies|recordar.*medicacion|recordar.*medicament/,
  drug_resistance: /resistente|resistent|multirresistent|multidrogorresistent|mdr|no.*funciona.*tractament|no.*funciona.*tratamiento/,
  follow_up_visits: /proxima visita|propera visita|control|revision|revisio|que pruebas|quines proves/,
  isolation_precautions: /aislad|aillad|aillat|cuarentena|quarantena|ventilar|habitacion.*sol|habitacio.*sol/,
  work_school: /trabajar|treballar|colegio|escola|feina|volver al trabajo|tornar a la feina|baja laboral/,
  children_pediatric: /mi hijo|mi hija|el meu fill|la meva filla|nino|nina|pediatric/,
  pregnancy_breastfeeding: /embaraz|embarass|lactancia|alletament/,
  hiv_comorbidity: /\bvih\b|\bsida\b|\bhiv\b/,
  diabetes_comorbidity: /diabet/,
  alcohol_liver: /alcohol|beber|beure|higado|fetge/,
  vaccination_bcg: /vacuna|vacunacio|\bbcg\b/,
  diet_nutrition: /dieta|alimentacion|alimentacio|que puedo comer|que puc menjar/,
  travel: /viajar|viatjar|avion|avio|vacaciones|vacances/,
  cost_access: /gratis|gratuit|pagar|coste|cuesta|\bcost\b|preu|precio|seguro medico|assegurança/,
  stigma_disclosure: /\bjefe\b|cap de feina|confidencial|se va a enterar|s.assabentara|verguenza|vergonya/,
  elderly: /mayor|ancia|gran edat|persona gran/,
  relapse_cure: /curad|curat|recaida|recaiguda|volver a tener|tornar a tenir/
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

/* Tradueix un fragment curt (anglès -> lang) fent servir MyMemory, una API
   pública i gratuïta de traducció (sense clau, sense backend propi). Si la
   traducció falla o no hi ha connexió, retorna null i qui crida decideix
   com mostrar-ho (per exemple, deixant el text original en anglès). */
async function translateSnippet(text, lang){
  if(lang !== 'ca' && lang !== 'es') return null;
  try{
    const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=en|' + lang;
    const res = await fetch(url);
    if(!res.ok) return null;
    const data = await res.json();
    if(data.quotaFinished) return null;
    const translated = data.responseData && data.responseData.translatedText;
    if(!translated || /INVALID|MYMEMORY WARNING/i.test(translated)) return null;
    return translated;
  }catch(e){
    console.warn('Traducció automàtica no disponible', e);
    return null;
  }
}

/* Tradueix un text del pacient (lang -> anglès) per poder-lo comparar amb
   els documents (que estan en anglès) fent servir el model d'embeddings.
   Mateixa API gratuïta que translateSnippet, en la direcció contrària. */
async function translateToEnglish(text, lang){
  if(lang !== 'ca' && lang !== 'es') return null;
  try{
    const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + lang + '|en';
    const res = await fetch(url);
    if(!res.ok) return null;
    const data = await res.json();
    if(data.quotaFinished) return null;
    const translated = data.responseData && data.responseData.translatedText;
    if(!translated || /INVALID|MYMEMORY WARNING/i.test(translated)) return null;
    return translated;
  }catch(e){
    console.warn('Traducció a l\'anglès no disponible', e);
    return null;
  }
}

/* Paraules clau clíniques en anglès per a cada tema, per "ancorar" la cerca
   al concepte correcte encara que el text del pacient sigui vague, en
   castellà/català, o barrejat amb paraules que no aporten res a la cerca
   (com "no ho sé" o "una mica"). Sense això, la cerca per paraules clau
   podia agafar fragments poc relacionats amb la pregunta real. */
const TOPIC_SEARCH_SEED = {
  symptoms: "tuberculosis symptoms cough fever weight loss night sweats",
  treatment: "tuberculosis drug treatment regimen dose duration",
  side_effects: "adverse effects side effects tuberculosis treatment",
  contagion: "tuberculosis transmission infectious contagious",
  diagnosis_tests: "tuberculosis diagnosis tuberculin skin test IGRA chest X-ray sputum culture",
  ltbi_vs_active: "latent tuberculosis infection versus active TB disease difference",
  duration_completion: "treatment completion adherence stopping treatment early",
  missed_dose_repeated: "missed doses adherence tuberculosis treatment",
  drug_resistance: "drug-resistant multidrug-resistant MDR tuberculosis",
  follow_up_visits: "follow-up monitoring visits during tuberculosis treatment",
  isolation_precautions: "infection control isolation precautions tuberculosis",
  work_school: "return to work school infectious period tuberculosis",
  children_pediatric: "pediatric children tuberculosis treatment",
  pregnancy_breastfeeding: "pregnancy breastfeeding tuberculosis treatment",
  hiv_comorbidity: "HIV tuberculosis co-infection treatment",
  diabetes_comorbidity: "diabetes tuberculosis comorbidity",
  alcohol_liver: "hepatotoxicity liver alcohol tuberculosis treatment",
  vaccination_bcg: "BCG vaccine vaccination tuberculosis",
  diet_nutrition: "nutrition diet tuberculosis treatment",
  travel: "travel infectious period tuberculosis",
  cost_access: "access to treatment cost tuberculosis care",
  stigma_disclosure: "stigma confidentiality disclosure tuberculosis",
  elderly: "elderly older adults tuberculosis treatment",
  relapse_cure: "cure relapse tuberculosis treatment outcome"
};

/* Alguns documents de la bibliografia són informes estadístics/de vigilància
   (recomptes de casos, taules per país i any) i no contenen consells per a
   pacients, però repeteixen molt paraules del domini ("tractament", "casos",
   "mesos"...) i per pur recompte de paraules poden guanyar la cerca encara
   que no responguin la pregunta. Els evitem quan hi ha alternativa millor. */
const LOW_VALUE_TITLE_PATTERN = /surveillance|epidemiolog|global tuberculosis report|annual report|evaluaci[oó]n|vigilancia|informe de vigil/i;

async function buildKbAnswer(queryText, lang, topicId){
  if(!window.TB_KB) return null;
  try{
    await window.TB_KB.loadIndex();
  }catch(e){
    console.warn('Base de coneixement TB no disponible', e);
    return null;
  }
  try{
    // Si sabem el tema, ancorem la cerca amb paraules clau clíniques en anglès
    // (repetides per pesar més) perquè el resultat vagi al gra correcte encara
    // que el text del pacient no coincideixi literalment amb el document.
    const seed = topicId && TOPIC_SEARCH_SEED[topicId];
    const effectiveQuery = seed ? (seed + ' ' + seed + ' ' + queryText) : queryText;
    // Demanem uns quants candidats per paraules clau i descartem els que
    // vinguin d'informes estadístics (encara que hagin puntuat més alt).
    const candidates = window.TB_KB.search(effectiveQuery, 8);
    if(!candidates.length) return null;
    const filtered = candidates.filter(r => !LOW_VALUE_TITLE_PATTERN.test(r.title || ''));
    const pool = filtered.length ? filtered : candidates;

    // Pas addicional (IA real, gratuïta): si el model d'embeddings s'ha pogut
    // carregar al navegador, reordenem `pool` per significat real, no només
    // per paraules coincidents. Traduïm primer la pregunta a l'anglès perquè
    // es pugui comparar amb els documents. Si qualsevol part d'això falla,
    // seguim amb l'ordre de search() sense trencar la resposta.
    let best = pool[0];
    if(window.TB_KB.semanticRerank){
      const englishQuery = ((seed || '') + '. ' + (await translateToEnglish(queryText, lang) || queryText)).trim();
      const reranked = await window.TB_KB.semanticRerank(englishQuery, pool);
      if(reranked && reranked.length) best = reranked[0];
    }

    // Filtre de confiança: si el model semàntic ha pogut comparar el
    // significat i la millor coincidència encara és fluixa, és més honest
    // no mostrar cap fragment (deixem que el missatge genèric de seguretat
    // ho reculli) que ensenyar un text que sona a resposta "d'una altra
    // conversa". Sense aquest pas, preguntes com "necesito medicación" (una
    // petició, no una pregunta informativa) acabaven mostrant criteris de
    // diagnòstic escrits per a personal sanitari, no per a pacients.
    if(typeof best.semScore === 'number' && best.semScore < 0.32){
      return null;
    }

    const s = REPLY_STRINGS[lang] || REPLY_STRINGS.es;
    const plain = best.snippet.replace(/<[^>]+>/g,'').trim();
    const short = plain.length > 220 ? plain.slice(0,220)+'…' : plain;

    // Pas addicional (IA generativa, gratuïta): reformulem el fragment en
    // llenguatge planer ABANS de traduir. El model només reescriu el text ja
    // trobat, no en pot afegir de nou (veure comprovacions a buscador.js).
    // Si no es pot carregar o el resultat no sembla fiable, es fa servir el
    // fragment original sense cap canvi.
    let textToTranslate = short;
    if(window.TB_KB.simplifyEnglishText){
      const simplified = await window.TB_KB.simplifyEnglishText(short);
      if(simplified) textToTranslate = simplified;
    }

    const translated = await translateSnippet(textToTranslate, lang);
    const body = translated || (textToTranslate + s.translationUnavailable + ')');
    // Font del document: només títol + enllaç (no l'apartat exacte, això
    // requeriria una IA que "entengués" l'estructura del document). Es posa
    // al final, en una frase apart, per no barrejar-la amb l'explicació.
    const sourceText = best.source_url && best.title
      ? (s.sourceLabel + best.title + (best.year ? ', ' + best.year : '') + ': ' + best.source_url + ')')
      : '';
    return s.kbIntro + body + sourceText;
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
// Etiquetes de triatge 'mild' que ja tenen una resposta directa i accionable
// pròpia (botReply). No té sentit barrejar-les amb una conversa de temes
// oberta: si el pacient diu "necesito medicación" enmig d'una conversa sobre
// la tos, la resposta ha de ser sobre la medicació, no continuar preguntant
// sobre la tos ni buscar als documents amb un text que ja no ve al cas.
const MILD_LABELS_WITH_OWN_ANSWER = new Set(['Oblit de dosi', 'Necessitat de medicació']);

async function advanceKbConversation(p, text, triageResult){
  if(triageResult.level === 'urgent' || triageResult.level === 'moderate'){
    delete p.kbFlow; // la seguretat sempre té prioritat: cancel·la qualsevol flux obert
    return null;
  }
  if(triageResult.level === 'mild' && MILD_LABELS_WITH_OWN_ANSWER.has(triageResult.label)){
    delete p.kbFlow; // ja té resposta pròpia (botReply); no cal ni s'ha de barrejar amb cap tema obert
    return null;
  }
  if(triageResult.label === 'Salutació'){
    delete p.kbFlow; // una salutació sola no ha de buscar als documents ni continuar cap flux obert
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
    const finishedTopicId = p.kbFlow.topicId;
    delete p.kbFlow;
    const answer = await buildKbAnswer(combined, lang, finishedTopicId);
    return answer;
  }

  const topicId = detectKbTopicId(text);
  if(topicId){
    const lang = detectLang(text);
    const strings = REPLY_STRINGS[lang].topics[topicId];
    p.kbFlow = { topicId, lang, step: 0, originalText: text, answers: [] };
    return strings.opener + strings.questions[0];
  }

  // Tema no reconegut: mantenim el comportament directe d'abans (sense preguntes,
  // sense tema per ancorar la cerca, així que és menys precisa per naturalesa).
  return await buildKbAnswer(text, detectLang(text), null);
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
