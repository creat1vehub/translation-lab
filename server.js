import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const LANG_NAMES = {
  ru: "русский",
  de: "немецкий",
  en: "английский"
};

function buildReviewPrompt({ source, translation, sourceLang, targetLang, level }) {
  return `Ты — опытный преподаватель практики письменного перевода и редактор.
Проверяй перевод как профессиональную работу, а не как упражнение на угадывание эталона.
Язык исходника: ${LANG_NAMES[sourceLang]}.
Язык перевода: ${LANG_NAMES[targetLang]}.
Ориентировочный уровень: ${level}. Для A1/A2 оценивай перевод с учётом начального уровня: простые конструкции, базовая лексика и допустимые ошибки, характерные для этапа обучения.
Исходный текст:
${source}

Перевод студента:
${translation}

Дай разбор НА РУССКОМ языке. Не считай допустимые переводческие решения ошибками только потому, что они отличаются от твоего варианта. Разделяй объективные ошибки, спорные/контекстные решения и стилистические улучшения.
Структура ответа:
1. Общая оценка (точность смысла, грамматика, лексика, естественность, стиль — отдельно, без искусственной точности).
2. Что получилось хорошо.
3. Таблица или список проблем: фрагмент перевода, тип проблемы, объяснение, возможное исправление.
4. Полный отредактированный вариант перевода.
5. Альтернативные решения для спорных мест и объяснение оттенков.
6. Переводческие трансформации, если они применены или могли бы улучшить результат.
7. 3–5 рекомендаций, на чём сосредоточиться дальше.
Если ошибок нет, так и скажи. Не выдумывай недостатки. Не переписывай текст без объяснений.`;
}

async function callOpenAI(instructions, input) {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("ИИ-проверка пока не подключена. Для неё нужно добавить API-ключ в переменную OPENAI_API_KEY на сервере.");
    error.status = 503;
    throw error;
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.5",
      instructions,
      input,
      store: false
    })
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data?.error?.message || "Не удалось получить ответ от ИИ.");
    error.status = response.status;
    throw error;
  }
  return data.output_text || (data.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === "output_text")
    .map(item => item.text)
    .join("\n");
}

app.post("/api/review", async (req, res) => {
  try {
    const { source, translation, sourceLang, targetLang, level } = req.body || {};
    if (![source, translation].every(v => typeof v === "string" && v.trim())) {
      return res.status(400).json({ error: "Добавь исходный текст и свой перевод." });
    }
    if (!LANG_NAMES[sourceLang] || !LANG_NAMES[targetLang] || sourceLang === targetLang) {
      return res.status(400).json({ error: "Выбери разные исходный и целевой языки." });
    }
    if (source.length > 12000 || translation.length > 16000) {
      return res.status(413).json({ error: "Текст слишком большой. Сократи его и попробуй ещё раз." });
    }
    const prompt = buildReviewPrompt({ source, translation, sourceLang, targetLang, level: level || "B2" });
    const result = await callOpenAI(
      "Ты — внимательный, требовательный, но справедливый эксперт по переводу. Отвечай структурированно и исключительно по-русски.",
      prompt
    );
    res.json({ result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Внутренняя ошибка сервера." });
  }
});

app.post("/api/task", async (req, res) => {
  try {
    const { sourceLang, targetLang, level, format, topic, vocabulary = [] } = req.body || {};
    if (!LANG_NAMES[sourceLang] || !LANG_NAMES[targetLang] || sourceLang === targetLang) {
      return res.status(400).json({ error: "Выбери разные исходный и целевой языки." });
    }
    const prompt = `Создай одно качественное задание для практики письменного перевода.
Исходный язык: ${LANG_NAMES[sourceLang]}. Целевой язык: ${LANG_NAMES[targetLang]}.
Уровень: ${level || "B2"}. Для A1 используй очень простую повседневную лексику, короткие предложения в Präsens/Present Simple и базовые грамматические конструкции. Для A2 используй знакомые бытовые темы, простые связки, прошедшее/будущее время на базовом уровне и умеренно расширенную лексику. Не включай идиомы, сложные придаточные и редкую лексику на A1/A2. Формат: ${format || "текст"}. Тема: ${topic || "на выбор"}.\nЛексика для повторения (по возможности органично включи 2–5 единиц, если они подходят по языку, уровню и контексту): ${Array.isArray(vocabulary) ? vocabulary.slice(0,30).map(x => `${x.term} — ${x.meaning}`).join("; ") : "нет"}. Не вставляй слова искусственно и не меняй смысл текста ради списка.
Уровень должен ощущаться по синтаксису, лексике и смысловой плотности, а не только по длине.
Избегай примитивных учебниковых предложений. Для A1 используй 1–2 коротких простых предложения или короткий текст из знакомых слов; для A2 — простые связные фразы на повседневные темы. Для B1 — базовые сложные конструкции и устойчивые сочетания; для B2 используй сложные придаточные, устойчивые сочетания, нюансы регистра; для C1/C2 — плотную аргументацию, идиоматичность, стилистические оттенки.
Не показывай перевод, подсказки или разбор. Верни только исходный текст на выбранном исходном языке. Для формата «одно предложение» верни ровно одно содержательное предложение. Для «короткий текст» — 60–100 слов. Для «текст» — 120–220 слов. Для «аудирование» — естественный связный фрагмент на 70–120 слов, удобный для прослушивания и последовательного перевода. Не создавай список предложений, если формат этого не просит.
Личный словарь пользователя (используй только слова, подходящие по языку, уровню и контексту): ${Array.isArray(vocabulary) ? vocabulary.filter(v => v && typeof v.term === "string" && typeof v.meaning === "string").slice(0,30).map(v => `${v.term} — ${v.meaning} [${v.status || "learning"}]`).join("; ") : ""}
Если подходящие слова есть, естественно включи в текст 2–5 слов из списка, преимущественно со статусом «Сложное» и «Изучаю». Не вставляй их искусственно, не перегружай текст и не нарушай уровень. Если формат — одно предложение, достаточно 0–2 слов. Если подходящих слов нет, создай обычное задание.
Для «свой текст» не генерируй задание, попроси пользователя вставить исходник в поле.`;
    if ((format || "текст") === "свой текст") return res.status(400).json({ error: "Вставь свой исходный текст в левое поле — генерация для этого режима не нужна." });
    const result = await callOpenAI("Ты составляешь задания для серьёзной университетской практики перевода. Не добавляй вступлений.", prompt);
    res.json({ source: result.trim() });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Не удалось создать задание." });
  }
});

app.get("/api/status", (_req, res) => {
  res.json({ aiReady: Boolean(process.env.OPENAI_API_KEY) });
});

const port = process.env.PORT || 3000;

app.post("/api/lookup", async (req, res) => {
  try {
    const { term, sourceLang, targetLang } = req.body || {};
    if (typeof term !== "string" || !term.trim() || term.length > 180 ||
        !LANG_NAMES[sourceLang] || !LANG_NAMES[targetLang] || sourceLang === targetLang) {
      return res.status(400).json({ error: "Нужны слово и корректная языковая пара." });
    }
    const prompt = `Подготовь точную словарную карточку для изучающего язык.
Слово/выражение: "${term.trim()}".
Язык слова: ${LANG_NAMES[sourceLang]}.
Перевести на: ${LANG_NAMES[targetLang]}.
Верни ТОЛЬКО валидный JSON без markdown и пояснений со следующими полями:
{
  "translation": "1–4 наиболее подходящих перевода на целевой язык, через ; если несколько",
  "partOfSpeech": "часть речи на русском",
  "lemma": "словарная форма слова",
  "example": "короткий пример на языке слова",
  "exampleTranslation": "перевод примера на целевой язык",
  "noun": null или {"article":"der/die/das, если применимо; иначе пустая строка","gender":"мужской/женский/средний род или не применимо","singular":"форма единственного числа","plural":"форма множественного числа"},
  "verb": null или {"infinitive":"инфинитив","present3sg":"форма 3-го лица ед. числа в Präsens/Present Simple","preterite":"Präteritum для немецкого или Past Simple для английского; для русского укажи прошедшее время","participle":"Partizip II / Past Participle / причастная форма","type":"сильный / слабый / смешанный для немецкого; для английского regular / irregular; для русского вид и тип спряжения, если надёжно определяется"},
  "adjective": null или {"comparative":"сравнительная степень","superlative":"превосходная степень"},
  "usageNote": "короткая важная помета об управлении, предлоге, регистре или употреблении; если нечего добавить — пустая строка"
}
Правила:
- Заполняй noun только если это существительное; verb только если глагол; adjective только если прилагательное. Остальные поля соответствующих объектов оставляй null.
- Для немецких существительных обязательно укажи правильный артикль, род, форму ед. и мн. числа. Не угадывай: если форма зависит от значения, укажи наиболее обычное значение.
- Для немецких глаголов укажи Infinitiv, 3-е лицо Präsens, Präteritum, Partizip II и классификацию: слабый, сильный или смешанный.
- Для английских глаголов укажи base form, 3rd person, Past Simple, Past Participle и regular/irregular.
- Для выражений и фразовых глаголов укажи значение целиком и основные грамматические особенности, если применимо.
- Если выделенная форма стоит в тексте в склонённой/спрягаемой форме, восстанови словарную форму и переведи именно её с учётом контекста.
- Не выдумывай грамматические сведения. Если не уверен, укажи null/пустую строку.
- Пример должен быть естественным, коротким и соответствовать уровню B1–B2.`;
    const raw = await callOpenAI(
      "Ты — точный многоязычный лексикограф. Возвращай только JSON, без markdown.",
      prompt
    );
    let entry;
    try {
      const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      entry = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ error: "Не удалось разобрать словарную карточку. Попробуй ещё раз." });
    }
    res.json({ entry });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Не удалось найти слово." });
  }
});

app.listen(port, () => console.log(`Translation Lab is running on port ${port}`));
