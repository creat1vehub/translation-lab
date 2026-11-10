const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "translation-lab-works-v1";
const VOCAB_KEY = "translation-lab-vocabulary-v1";
let currentReview = null;
let sourceHidden = false;
let lastGenerated = false;
let audioChunks = [];
let audioChunkIndex = 0;
let audioSourceText = "";

const langNames = { ru: "Русский", de: "Немецкий", en: "Английский" };
const getWorks = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; } };
const setWorks = (works) => localStorage.setItem(STORAGE_KEY, JSON.stringify(works));
const getVocab = () => { try { return JSON.parse(localStorage.getItem(VOCAB_KEY) || "[]"); } catch { return []; } };
const setVocab = (items) => localStorage.setItem(VOCAB_KEY, JSON.stringify(items));
const words = (s) => (s.trim().match(/\S+/g) || []).length;
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const direction = () => `${langNames[$("sourceLang").value]} → ${langNames[$("targetLang").value]}`;

const offlineTasks = {
  "ru-de":"В последние годы всё больше людей стараются осознанно распределять своё время. Они понимают, что постоянная занятость не всегда означает продуктивность. Иногда полезнее остановиться, пересмотреть приоритеты и отказаться от задач, которые не приближают к важной цели.",
  "de-ru":"Nicht jede Veränderung führt sofort zu sichtbaren Ergebnissen. Oft braucht es Zeit, bis neue Gewohnheiten entstehen und sich eine andere Arbeitsweise bewährt. Entscheidend ist deshalb nicht nur der erste Schritt, sondern auch die Bereitschaft, langfristig dranzubleiben.",
  "ru-en":"В последние годы всё больше людей стараются осознанно распределять своё время. Они понимают, что постоянная занятость не всегда означает продуктивность. Иногда полезнее остановиться, пересмотреть приоритеты и отказаться от задач, которые не приближают к важной цели.",
  "en-ru":"Not every change produces visible results straight away. It often takes time for new habits to develop and for a different way of working to prove its value. What matters, therefore, is not only taking the first step but also being willing to persevere over time.",
  "de-en":"Nicht jede Veränderung führt sofort zu sichtbaren Ergebnissen. Oft braucht es Zeit, bis neue Gewohnheiten entstehen und sich eine andere Arbeitsweise bewährt. Entscheidend ist deshalb nicht nur der erste Schritt, sondern auch die Bereitschaft, langfristig dranzubleiben.",
  "en-de":"Not every change produces visible results straight away. It often takes time for new habits to develop and for a different way of working to prove its value. What matters, therefore, is not only taking the first step but also being willing to persevere over time."
};
function isListeningMode() { return $("format").value === "аудирование"; }
function actualSource() { return isListeningMode() && audioSourceText ? audioSourceText : $("sourceText").value.trim(); }
function setTaskSource(text) {
  audioChunkIndex = 0;
  if (isListeningMode()) {
    audioSourceText = text;
    $("sourceText").value = "";
    $("sourceText").placeholder = "Исходник скрыт. Сначала прослушай запись. Если понадобится, нажми «Показать текст».";
    $("revealBtn").hidden = false;
    $("revealBtn").textContent = "◉ Показать текст";
    sourceHidden = true;
  } else {
    audioSourceText = "";
    $("sourceText").placeholder = "Сгенерируй задание или вставь сюда свой исходный текст...";
    $("sourceText").value = text;
    $("revealBtn").hidden = true;
    sourceHidden = false;
  }
  refreshCounts();
}
$("format").addEventListener("change", () => {
  const listening = isListeningMode();
  $("speedControl").hidden = !listening;
  $("audioLengthGroup").hidden = !listening;
  $("revealBtn").hidden = !listening || !audioSourceText;
  if (!listening && audioSourceText) {
    $("sourceText").value = audioSourceText;
    audioSourceText = "";
    $("sourceText").placeholder = "Сгенерируй задание или вставь сюда свой исходный текст...";
    sourceHidden = false;
  }
  refreshCounts();
});
$("speedControl").hidden = !isListeningMode();
function makeOfflineTask() {
  const pair = `${$("sourceLang").value}-${$("targetLang").value}`;
  let text = offlineTasks[pair];
  if (!text) return toast("Для этой языковой пары пока нет встроенного примера.");
  const format = $("format").value;
  if (format === "одно предложение") text = text.split(/(?<=[.!?])\s+/)[0];
  if (format === "короткий текст") text = text.split(/(?<=[.!?])\s+/).slice(0,2).join(" ");
  if (format === "аудирование") text = text.split(/(?<=[.!?])\s+/).slice(0, $("audioLength")?.value === "one" ? 1 : 3).join(" ");
  if (format === "свой текст") return toast("Вставь свой исходник в левое поле — это задание не нужно генерировать.");
  setTaskSource(text);
  $("translationText").value = "";
  $("resultWrap").hidden = true;
  currentReview = null;
  lastGenerated = false;
  refreshCounts();
  toast("Открыто тренировочное задание из встроенной подборки. Для ИИ-генерации нужен сервер.");
}



let editingVocabId = null;
function openVocabModal(term="", item=null) {
  editingVocabId = item?.id || null;
  $("vocabModalTitle").textContent = item ? "Изменить слово" : "Новое слово";
  $("vocabTerm").value = item?.term || term;
  $("vocabLang").value = item?.lang || $("sourceLang").value;
  $("vocabMeaning").value = item?.meaning || "";
  $("vocabExample").value = item?.example || "";
  $("vocabNote").value = item?.note || "";
  $("vocabStatus").value = item?.status || "learning";
  $("vocabModal").hidden = false;
  $("vocabTerm").focus();
}
function closeVocabModal() { $("vocabModal").hidden = true; editingVocabId = null; }
function renderVocabulary() {
  const all = getVocab();
  const query = ($("vocabSearch").value || "").trim().toLowerCase();
  const filter = $("vocabFilter").value;
  const filtered = all.filter(x => (filter === "all" || x.status === filter) &&
    (!query || [x.term,x.meaning,x.example,x.note].join(" ").toLowerCase().includes(query)));
  $("vocabTotal").textContent = all.length;
  $("vocabDue").textContent = all.filter(x => x.status !== "known" && (!x.nextReview || x.nextReview <= Date.now())).length;
  $("vocabCount").textContent = all.length;
  const list = $("vocabList");
  list.innerHTML = "";
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-vocab">Словарь пока пуст. Выдели слово в исходнике, своём переводе или разборе и нажми «＋ В словарь».</div>';
    return;
  }
  filtered.sort((a,b) => (a.status === "hard" ? -1 : 0) - (b.status === "hard" ? -1 : 0) || (a.nextReview||0)-(b.nextReview||0));
  filtered.forEach(item => {
    const card = document.createElement("article");
    card.className = "vocab-card";
    const main = document.createElement("div");
    const meta = document.createElement("div"); meta.className="meta"; meta.textContent = `${({de:"НЕМЕЦКИЙ",en:"АНГЛИЙСКИЙ",ru:"РУССКИЙ"})[item.lang] || item.lang} · ${item.direction || "личная запись"}`;
    const title = document.createElement("h3"); title.textContent = item.term;
    const meaning = document.createElement("div"); meaning.className="meaning"; meaning.textContent = item.meaning || "Перевод пока не указан";
    main.append(meta,title,meaning);
    const lex = item.lexicon || {};
    if (lex.lemma && lex.lemma.toLowerCase() !== item.term.toLowerCase()) {
      const lemma = document.createElement("div"); lemma.className="lex-line"; lemma.textContent="Словарная форма: "+lex.lemma; main.append(lemma);
    }
    if (lex.partOfSpeech) {
      const pos = document.createElement("div"); pos.className="lex-pos"; pos.textContent=lex.partOfSpeech; main.append(pos);
    }
    if (lex.noun) {
      const n=lex.noun; const details=document.createElement("div"); details.className="lex-details";
      details.textContent=[n.article,n.gender ? "род: "+n.gender : "",n.singular ? "ед. ч.: "+n.singular : "",n.plural ? "мн. ч.: "+n.plural : ""].filter(Boolean).join(" · "); main.append(details);
    }
    if (lex.verb) {
      const v=lex.verb; const details=document.createElement("div"); details.className="lex-details";
      details.textContent=[v.infinitive ? "Infinitiv: "+v.infinitive : "",v.present3sg ? "Präsens: "+v.present3sg : "",v.preterite ? "Präteritum / Past: "+v.preterite : "",v.participle ? "Partizip II: "+v.participle : "",v.type ? "Тип: "+v.type : ""].filter(Boolean).join(" · "); main.append(details);
    }
    if (lex.adjective) {
      const a=lex.adjective; const details=document.createElement("div"); details.className="lex-details";
      details.textContent=[a.comparative ? "Сравнительная: "+a.comparative : "",a.superlative ? "Превосходная: "+a.superlative : ""].filter(Boolean).join(" · "); main.append(details);
    }
    if (lex.usageNote) { const usage=document.createElement("div"); usage.className="lex-usage"; usage.textContent="Употребление: "+lex.usageNote; main.append(usage); }
    if (item.example) { const ex=document.createElement("div");ex.className="example";ex.textContent="Пример: "+item.example;main.append(ex); }
    if (lex.example) { const ex=document.createElement("div");ex.className="example";ex.textContent=lex.example;main.append(ex); }
    if (lex.exampleTranslation) { const ex=document.createElement("div");ex.className="example-translation";ex.textContent=lex.exampleTranslation;main.append(ex); }
    if (item.note) { const note=document.createElement("div");note.className="note";note.textContent="Заметка: "+item.note;main.append(note); }
    const status=document.createElement("span");status.className="vocab-status";status.textContent=({learning:"Изучаю",hard:"Сложное · повторять чаще",known:"Уже знаю"})[item.status]||"Изучаю";main.append(status);
    const actions=document.createElement("div");actions.className="vocab-actions";
    if (!item.meaning || !item.lexicon) {
      const lookup=document.createElement("button");lookup.textContent="Найти перевод и формы";lookup.onclick=async()=>{
        lookup.disabled=true;lookup.textContent="Ищу…";
        try{
          const response=await fetch("/api/lookup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({term:item.term,sourceLang:item.lang,targetLang:item.targetLang||"ru"})});
          const data=await response.json();if(!response.ok)throw new Error(data.error||"Не удалось найти слово.");
          item.lexicon=data.entry||{};item.meaning=item.lexicon.translation||"";item.example=item.lexicon.example||"";item.note=item.lexicon.usageNote||"";
          setVocab(getVocab());renderVocabulary();toast("Словарная статья обновлена.");
        }catch(e){lookup.disabled=false;lookup.textContent="Найти перевод и формы";toast("ИИ-словарь пока недоступен. Нужен запущенный сервер с API-ключом.");}
      };actions.append(lookup);
    }
    const edit=document.createElement("button");edit.textContent="Изменить";edit.onclick=()=>openVocabModal("",item);
    const repeat=document.createElement("button");repeat.textContent="Повторить";repeat.onclick=()=>{item.lastReviewed=Date.now();item.repetitions=(item.repetitions||0)+1;item.status=item.status==="known"?"learning":item.status;item.nextReview=Date.now()+ (item.status==="hard"?1:3)*86400000;setVocab(all);renderVocabulary();toast("Отметили повторение. Вернём слово позже.");};
    const remove=document.createElement("button");remove.textContent="Удалить";remove.onclick=()=>{if(confirm("Удалить это слово из словаря?")){setVocab(getVocab().filter(x=>x.id!==item.id));renderVocabulary();refreshCounts();}};
    actions.append(edit,repeat,remove);card.append(main,actions);list.append(card);
  });
}
function selectedWordAndLanguage() {
  // Prefer a selection in either editable text area.
  for (const [id, lang] of [["sourceText", $("sourceLang").value], ["translationText", $("targetLang").value]]) {
    const area = $(id);
    if (area && area.selectionStart !== area.selectionEnd) {
      const selected = area.value.slice(area.selectionStart, area.selectionEnd).trim();
      if (selected) return {term:selected, lang, targetLang: id === "sourceText" ? $("targetLang").value : $("sourceLang").value};
    }
  }
  // Also allow selecting a word in the AI feedback panel.
  const selection = window.getSelection?.();
  const selected = selection?.toString().trim();
  if (selected && $("resultContent").contains(selection.anchorNode)) {
    return {term:selected, lang:$("targetLang").value, targetLang:$("sourceLang").value};
  }
  return null;
}
async function addSelectedWordInstantly() {
  const picked = selectedWordAndLanguage();
  if (!picked) return toast("Сначала выдели слово или выражение в исходном тексте, своём переводе или разборе.");
  const all = getVocab();
  const existing = all.find(x => x.term.toLowerCase() === picked.term.toLowerCase() && x.lang === picked.lang);
  if (existing) return toast("Это слово уже есть в личном словаре.");
  const record = {
    id:"v"+Date.now()+Math.random().toString(16).slice(2),
    term:picked.term, lang:picked.lang, targetLang:picked.targetLang,
    meaning:"", lexicon:null, example:"", note:"",
    status:"learning", direction:direction(), createdAt:Date.now(),
    repetitions:0, nextReview:Date.now()
  };
  toast("Ищу перевод и грамматические формы…");
  try {
    const response = await fetch("/api/lookup", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({term:picked.term,sourceLang:picked.lang,targetLang:picked.targetLang})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось получить словарную статью.");
    const entry=data.entry || {};
    record.meaning=entry.translation || "";
    record.lexicon=entry;
    record.example=entry.example || "";
    record.note=entry.usageNote || "";
    all.push(record); setVocab(all); renderVocabulary(); refreshCounts();
    toast("Слово добавлено вместе с переводом и грамматической информацией.");
  } catch (error) {
    all.push(record); setVocab(all); renderVocabulary(); refreshCounts();
    toast("Слово сохранено. Для автоперевода и грамматических форм нужен запущенный ИИ-сервер.");
  }
}
$("addWordBtn").addEventListener("click", addSelectedWordInstantly);
$("quickAddSelectedBtn").addEventListener("click", addSelectedWordInstantly);
$("addVocabManual").addEventListener("click",()=>openVocabModal());
$("closeVocabModal").addEventListener("click",closeVocabModal);
$("cancelVocab").addEventListener("click",closeVocabModal);
$("vocabModal").addEventListener("click",e=>{if(e.target===$("vocabModal"))closeVocabModal();});
$("vocabSearch").addEventListener("input",renderVocabulary);
$("vocabFilter").addEventListener("change",renderVocabulary);
$("vocabForm").addEventListener("submit",e=>{
  e.preventDefault();
  const all=getVocab();
  const term=$("vocabTerm").value.trim(), lang=$("vocabLang").value;
  if(!term) return toast("Добавь слово или выражение.");
  const duplicate=all.find(x=>x.term.toLowerCase()===term.toLowerCase()&&x.lang===lang&&x.id!==editingVocabId);
  const previous=all.find(x=>x.id===editingVocabId);
  const record={id:editingVocabId||("v"+Date.now()+Math.random().toString(16).slice(2)),term,lang,meaning:$("vocabMeaning").value.trim()||previous?.meaning||"",lexicon:previous?.lexicon||null,example:$("vocabExample").value.trim()||previous?.example||"",note:$("vocabNote").value.trim()||previous?.note||"",status:$("vocabStatus").value,direction:direction(),createdAt:previous?.createdAt||Date.now(),repetitions:previous?.repetitions||0,nextReview:previous?.nextReview||Date.now()};
  if(duplicate){Object.assign(duplicate,record,{id:duplicate.id,repetitions:duplicate.repetitions||0});}
  else if(editingVocabId){const i=all.findIndex(x=>x.id===editingVocabId);if(i>=0)all[i]={...all[i],...record};}
  else all.push(record);
  setVocab(all);closeVocabModal();renderVocabulary();refreshCounts();toast(duplicate?"Обновила запись в словаре.":"Слово добавлено в личный словарь!");
});

function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 3200);
}
function refreshCounts() {
  $("sourceCount").textContent = `${words($("sourceText").value)} слов`;
  $("translationCount").textContent = `${words($("translationText").value)} слов`;
  $("archiveCount").textContent = getWorks().length;
  if ($("vocabCount")) $("vocabCount").textContent = getVocab().length;
}
function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `view-${name}`));
  document.querySelectorAll(".nav-item").forEach(v => v.classList.toggle("active", v.dataset.view === name));
  $("crumb").textContent = ({practice:"НОВАЯ ПРАКТИКА",archive:"МОИ РАБОТЫ",progress:"МОЙ ПРОГРЕСС",vocabulary:"ЛИЧНЫЙ СЛОВАРЬ"})[name];
  $("sidebar").classList.remove("open");
  if (name === "archive") renderArchive();
  if (name === "progress") renderProgress();
  if (name === "vocabulary") renderVocabulary();
}
document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
$("mobileMenu").addEventListener("click", () => $("sidebar").classList.toggle("open"));
$("swapLang").addEventListener("click", () => {
  const a = $("sourceLang"), b = $("targetLang"), tmp = a.value; a.value = b.value; b.value = tmp;
});
$("sourceText").addEventListener("input", refreshCounts);
$("translationText").addEventListener("input", refreshCounts);
$("clearBtn").addEventListener("click", () => {
  $("sourceText").value = ""; audioSourceText = ""; $("revealBtn").hidden = true; $("translationText").value = "";
  $("resultWrap").hidden = true; currentReview = null; refreshCounts();
});
$("revealBtn").addEventListener("click", () => {
  if (isListeningMode() && audioSourceText) {
    sourceHidden = !sourceHidden;
    if (sourceHidden) {
      $("sourceText").value = "";
      $("revealBtn").textContent = "◉ Показать текст";
    } else {
      $("sourceText").value = audioSourceText;
      $("revealBtn").textContent = "◉ Скрыть текст";
    }
    refreshCounts();
    return;
  }
  sourceHidden = !sourceHidden;
  $("sourceText").style.filter = sourceHidden ? "blur(8px)" : "none";
  $("revealBtn").textContent = sourceHidden ? "◉ Показать текст" : "◉ Скрыть текст";
});
function availableVoices() {
  return ("speechSynthesis" in window) ? speechSynthesis.getVoices() : [];
}
function selectedVoice(lang) {
  const all = availableVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith(lang.toLowerCase().slice(0,2)));
  const wanted = $("speechVoice")?.value || "female";
  const patterns = wanted === "female"
    ? /female|woman|zira|samantha|victoria|karen|susan|eva|anna|helena|katya|irina|milena|alisa|natasha|julia|google русский женский/i
    : /male|man|david|mark|alex|daniel|james|george|pavel|yuri|dmitri|maxim|андрей|александр|иван|google русский мужской/i;
  return all.find(v => patterns.test(v.name) || patterns.test(v.voiceURI || "")) ||
    (wanted === "female" ? all[0] : all[1] || all[0]) || null;
}
let currentSpeechText = "";
let currentSpeechWasPaused = false;
function speakText(text, preservePaused=false) {
  if (!text) return toast("Сначала добавь исходный текст.");
  if (!("speechSynthesis" in window)) return toast("Озвучивание не поддерживается этим браузером.");
  currentSpeechText = text;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const lang = ({ru:"ru-RU",de:"de-DE",en:"en-US"})[$("sourceLang").value];
  utterance.lang = lang;
  utterance.rate = Number($("speechRate")?.value || 1);
  const voice = selectedVoice(lang);
  if (voice) utterance.voice = voice;
  utterance.onend = () => { $("pauseSpeechBtn").textContent = "Ⅱ Пауза"; currentSpeechWasPaused=false; };
  utterance.onerror = () => { $("pauseSpeechBtn").textContent = "Ⅱ Пауза"; currentSpeechWasPaused=false; };
  speechSynthesis.speak(utterance);
  $("pauseSpeechBtn").textContent = "Ⅱ Пауза";
  if (preservePaused) {
    // Wait until the new utterance is queued, then pause it.
    setTimeout(() => {
      if (speechSynthesis.speaking) {
        speechSynthesis.pause();
        $("pauseSpeechBtn").textContent = "▶ Продолжить";
      }
    }, 80);
  }
}
$("speechRate").addEventListener("change", () => {
  if (!currentSpeechText || !speechSynthesis.speaking && !speechSynthesis.paused) return;
  const wasPaused = speechSynthesis.paused;
  speakText(currentSpeechText, wasPaused);
  toast("Скорость изменена. Воспроизведение начато заново.");
});
$("speechVoice").addEventListener("change", () => {
  if (!currentSpeechText || !speechSynthesis.speaking && !speechSynthesis.paused) return;
  const wasPaused = speechSynthesis.paused;
  speakText(currentSpeechText, wasPaused);
  toast("Голос изменён. Воспроизведение начато заново.");
});
if ("speechSynthesis" in window) {
  speechSynthesis.onvoiceschanged = () => { /* voice list refreshed by the browser */ };
}
$("pauseSpeechBtn").addEventListener("click", () => {
  if (!("speechSynthesis" in window)) return;
  if (speechSynthesis.speaking && !speechSynthesis.paused) {
    speechSynthesis.pause();
    $("pauseSpeechBtn").textContent = "▶ Продолжить";
  } else if (speechSynthesis.paused) {
    speechSynthesis.resume();
    $("pauseSpeechBtn").textContent = "Ⅱ Пауза";
  } else {
    toast("Сначала запусти аудирование.");
  }
});
$("audioLengthGroup").hidden = $("format").value !== "аудирование";
$("listenBtn").addEventListener("click", () => speakText(actualSource()));
$("listenChunkBtn").addEventListener("click", () => {
  const text = actualSource();
  if (!text) return toast("Сначала добавь или создай исходный текст.");
  audioChunks = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [text];
  if (!audioChunks.length) return;
  const chunk = audioChunks[audioChunkIndex % audioChunks.length].trim();
  audioChunkIndex++;
  speakText(chunk);
  toast(`Фрагмент ${audioChunkIndex} из ${audioChunks.length}`);
});
$("generateBtn").addEventListener("click", async () => {
  if ($("sourceLang").value === $("targetLang").value) return toast("Выбери разные языки.");
  const btn = $("generateBtn"); btn.disabled = true; btn.textContent = "Создаю задание…";
  try {
    const response = await fetch("/api/task", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      sourceLang:$("sourceLang").value,targetLang:$("targetLang").value,level:$("level").value,format:$("format").value,topic:$("topic").value,vocabulary:getVocab().filter(x=>x.status!=="known").slice(0,30).map(x=>({term:x.term,meaning:x.meaning,lang:x.lang,status:x.status,example:x.example}))
    })});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось создать задание.");
    setTaskSource(data.source); $("translationText").value = "";
    $("resultWrap").hidden = true; currentReview = null; lastGenerated = true; refreshCounts();
    toast("Задание готово. Переводи самостоятельно!");
  } catch (e) {
    if (location.protocol === "file:" || e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(e.message || "")) {
      makeOfflineTask();
    } else {
      toast(e.message || "Не удалось создать задание. Попробуй ещё раз.");
    }
  }
  finally { btn.disabled = false; btn.innerHTML = 'Создать задание <span>↗</span>'; }
});
$("reviewBtn").addEventListener("click", async () => {
  const source = actualSource(), translation = $("translationText").value.trim();
  if (!source || !translation) return toast("Нужны и исходный текст, и твой перевод.");
  if ($("sourceLang").value === $("targetLang").value) return toast("Выбери разные языки.");
  const btn = $("reviewBtn"); btn.disabled = true; btn.textContent = "Анализирую перевод…";
  try {
    const response = await fetch("/api/review", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      source,translation,sourceLang:$("sourceLang").value,targetLang:$("targetLang").value,level:$("level").value
    })});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось проверить перевод.");
    currentReview = {source,translation,result:data.result,sourceLang:$("sourceLang").value,targetLang:$("targetLang").value,level:$("level").value,format:$("format").value,topic:$("topic").value};
    $("resultContent").textContent = data.result;
    $("resultWrap").hidden = false;
    $("resultWrap").scrollIntoView({behavior:"smooth",block:"start"});
  } catch(e) { toast((location.protocol === "file:" || e instanceof TypeError) ? "ИИ-проверка пока недоступна: страница открыта как локальный файл. Для проверки нужен запущенный сервер с API-ключом. Твой перевод не потерян." : e.message); }
  finally { btn.disabled = false; btn.innerHTML = 'Проверить перевод <span>→</span>'; }
});
$("saveBtn").addEventListener("click", () => {
  if (!currentReview) return toast("Сначала проверь перевод.");
  const works = getWorks();
  works.unshift({...currentReview,id:crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),createdAt:new Date().toISOString()});
  setWorks(works); refreshCounts(); toast("Работа сохранена в архив на этом устройстве.");
});
function renderArchive() {
  const q = $("archiveSearch").value.toLowerCase();
  const list = getWorks().filter(w => `${w.source} ${w.translation} ${langNames[w.sourceLang]} ${langNames[w.targetLang]}`.toLowerCase().includes(q));
  $("archiveList").innerHTML = list.length ? list.map(w => `
    <article class="archive-item"><div><h3>${escapeHTML(langNames[w.sourceLang])} → ${escapeHTML(langNames[w.targetLang])} · ${escapeHTML(w.level)}</h3><p>${new Date(w.createdAt).toLocaleString("ru-RU")} · ${words(w.source)+words(w.translation)} слов · ${escapeHTML(w.source.slice(0,100))}${w.source.length>100?"…":""}</p></div>
    <div class="archive-actions"><button data-open="${escapeHTML(w.id)}">Открыть</button><button data-delete="${escapeHTML(w.id)}">Удалить</button></div></article>`).join("") : `<div class="empty-state"><strong>Здесь пока тихо и пусто</strong>Сохрани первую проверенную работу — и она появится в архиве.</div>`;
  document.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => openWork(b.dataset.open)));
  document.querySelectorAll("[data-delete]").forEach(b => b.addEventListener("click", () => {
    setWorks(getWorks().filter(w => w.id !== b.dataset.delete)); renderArchive(); refreshCounts(); toast("Работа удалена.");
  }));
}
function openWork(id) {
  const w = getWorks().find(x => x.id === id); if (!w) return;
  $("sourceLang").value=w.sourceLang; $("targetLang").value=w.targetLang; $("level").value=w.level;
  $("sourceText").value=w.source; $("translationText").value=w.translation;
  currentReview=w; $("resultContent").textContent=w.result; $("resultWrap").hidden=false;
  refreshCounts(); showView("practice"); $("resultWrap").scrollIntoView({behavior:"smooth"});
}
$("archiveSearch").addEventListener("input", renderArchive);
$("exportAllBtn").addEventListener("click", () => {
  const data = getWorks(); if (!data.length) return toast("Архив пока пуст.");
  downloadFile("translation-lab-archive.json", JSON.stringify(data,null,2), "application/json");
});
function downloadFile(name, content, type) {
  const blob = new Blob([content],{type}); const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url);
}
function renderProgress() {
  const works=getWorks(); $("statWorks").textContent=works.length;
  $("statPairs").textContent=new Set(works.map(w=>w.sourceLang+"-"+w.targetLang)).size;
  $("statWords").textContent=works.reduce((n,w)=>n+words(w.source)+words(w.translation),0).toLocaleString("ru-RU");
}
$("todayLabel").textContent = new Date().toLocaleDateString("ru-RU",{day:"numeric",month:"long",year:"numeric"});
refreshCounts();

renderVocabulary();

// Grow source and translation areas automatically as text is entered.
function autoGrowTextarea(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.max(240, el.scrollHeight) + "px";
}
["sourceText","translationText"].forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener("input", () => autoGrowTextarea(el));
  autoGrowTextarea(el);
});
