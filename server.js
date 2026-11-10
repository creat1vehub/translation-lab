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

async function callYandex(instructions, input) {
  const apiKey = process.env.YANDEX_API_KEY;
  const folderId = process.env.YANDEX_FOLDER_ID;

  if (!apiKey || !folderId) {
    const error = new Error(
      "ИИ пока не подключён. Проверь YANDEX_API_KEY и YANDEX_FOLDER_ID в настройках сервера."
    );
    error.status = 503;
    throw error;
  }

  const modelName = process.env.YANDEX_MODEL || "yandexgpt-5-lite";

  const response = await fetch(
    "https://ai.api.cloud.yandex.net/v1/responses",
    {
      method: "POST",
      headers: {
        "Authorization": `Api-Key ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: `gpt://${folderId}/${modelName}`,
        instructions,
        input,
        max_output_tokens: 4000
      })
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      "Не удалось получить ответ от Yandex AI Studio.";

    const error = new Error(
      `Ошибка Yandex AI Studio (${response.status}): ${message}`
    );

    error.status = response.status;
    throw error;
  }

  const outputText =
    data.output_text ||
    (data.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text)
      .join("\n");

  if (!outputText) {
    const error = new Error("Yandex AI Studio вернула пустой ответ.");
    error.status = 502;
    throw error;
  }

  return outputText;
}

function buildReviewPrompt({
  source,
  translation,
  sourceLang,
  targetLang,
  level
}) {
  return `Ты — опытный преподаватель практики письменного перевода и редактор.

Проверяй перевод как профессиональную работу, а не как упражнение на угадывание эталона.

Язык исходника: ${LANG_NAMES[sourceLang]}.
Язык перевода: ${LANG_NAMES[targetLang]}.
Ориентировочный уровень: ${level}.

Для A1/A2 оценивай перевод с учётом начального уровня: простые конструкции, базовая лексика и допустимые ошибки, характерные для этапа обучения.

Исходный текст:
${source}

Перевод студента:
${translation}

Дай разбор НА РУССКОМ языке.

Не считай допустимые переводческие решения ошибками только потому, что они отличаются от твоего варианта. Разделяй объективные ошибки, спорные/контекстные решения и стилистические улучшения.

Структура ответа:
1. Общая оценка: точность смысла, грамматика, лексика, естественность и стиль отдельно.
2. Что получилось хорошо.
3. Проблемы: фрагмент перевода, тип проблемы, объяснение и возможное исправление.
4. Полный отредактированный вариант перевода.
5. Альтернативные решения для спорных мест и объяснение оттенков.
6. Переводческие трансформации, если они применены или могли бы улучшить результат.
7. 3–5 рекомендаций, на чём сосредоточиться дальше.

Если ошибок нет, так и скажи. Не выдумывай недостатки. Не переписывай текст без объяснений.`;
}

// Проверка перевода
app.post("/api/review", async (req, res) => {
  try {
    const {
      source,
      translation,
      sourceLang,
      targetLang,
      level
    } = req.body || {};

    if (
      ![source, translation].every(
        value => typeof value === "string" && value.trim()
      )
    ) {
      return res.status(400).json({
        error: "Добавь исходный текст и свой перевод."
      });
    }

    if (
      !LANG_NAMES[sourceLang] ||
      !LANG_NAMES[targetLang] ||
      sourceLang === targetLang
    ) {
      return res.status(400).json({
        error: "Выбери разные исходный и целевой языки."
      });
    }

    if (source.length > 12000 || translation.length > 16000) {
      return res.status(413).json({
        error: "Текст слишком большой. Сократи его и попробуй ещё раз."
      });
    }

    const prompt = buildReviewPrompt({
      source,
      translation,
      sourceLang,
      targetLang,
      level: level || "B2"
    });

    const result = await callYandex(
      "Ты — внимательный, требовательный, но справедливый эксперт по переводу. Отвечай структурированно и исключительно по-русски.",
      prompt
    );

    res.json({ result });

  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || "Внутренняя ошибка сервера."
    });
  }
});

// Создание задания
app.post("/api/task", async (req, res) => {
  try {
    const {
      sourceLang,
      targetLang,
      level,
      format,
      topic,
      vocabulary = []
    } = req.body || {};

    if (
      !LANG_NAMES[sourceLang] ||
      !LANG_NAMES[targetLang] ||
      sourceLang === targetLang
    ) {
      return res.status(400).json({
        error: "Выбери разные исходный и целевой языки."
      });
    }

    if ((format || "текст") === "свой текст") {
      return res.status(400).json({
        error: "Вставь свой исходный текст в левое поле — генерация для этого режима не нужна."
      });
    }

    const vocabularyList = Array.isArray(vocabulary)
      ? vocabulary
          .filter(v => v && typeof v.term === "string" && typeof v.meaning === "string")
          .slice(0, 30)
      : [];

    const vocabularyText = vocabularyList
      .map(v => `${v.term} — ${v.meaning} [${v.status || "learning"}]`)
      .join("; ");

    const prompt = `Создай одно качественное задание для практики письменного перевода.

Исходный язык: ${LANG_NAMES[sourceLang]}.
Целевой язык: ${LANG_NAMES[targetLang]}.

Уровень: ${level || "B2"}.
Формат: ${format || "текст"}.
Тема: ${topic || "на выбор"}.

ТРЕБОВАНИЯ К УРОВНЯМ:

A1 — очень простая повседневная лексика, короткие предложения, Präsens/Present Simple и базовые конструкции.

A2 — знакомые бытовые темы, простые связки, прошедшее и будущее время на базовом уровне.

B1 — базовые сложные конструкции и устойчивые сочетания.

B2 — сложные придаточные, устойчивые сочетания и нюансы регистра.

C1/C2 — плотная аргументация, идиоматичность и стилистические оттенки.

Избегай примитивных учебниковых предложений.

ЛЕКСИКА ДЛЯ ПОВТОРЕНИЯ:
${vocabularyText || "Нет дополнительной лексики."}

Если подходящие слова есть, естественно включи в текст 2–5 слов из списка, преимущественно со статусом «Сложное» и «Изучаю». Не вставляй их искусственно и не нарушай уровень.

ТРЕБОВАНИЯ К ФОРМАТАМ:

«Одно предложение» — ровно одно содержательное предложение.

«Короткий текст» — 60–100 слов.

«Текст» — 120–220 слов.

«Аудирование» — естественный связный фрагмент на 70–120 слов, удобный для прослушивания и последовательного перевода.

Не создавай список предложений, если формат этого не просит.

Не показывай перевод, подсказки или разбор.

Верни только исходный текст на выбранном исходном языке.`;

    const result = await callYandex(
      "Ты составляешь задания для серьёзной университетской практики перевода. Не добавляй вступлений.",
      prompt
    );

    res.json({ source: result.trim() });

  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || "Не удалось создать задание."
    });
  }
});

// Статус подключения ИИ
app.get("/api/status", (_req, res) => {
  res.json({
    aiReady: Boolean(
      process.env.YANDEX_API_KEY &&
      process.env.YANDEX_FOLDER_ID
    )
  });
});

// Словарная карточка
app.post("/api/lookup", async (req, res) => {
  try {
    const {
      term,
      sourceLang,
      targetLang
    } = req.body || {};

    if (
      typeof term !== "string" ||
      !term.trim() ||
      term.length > 180 ||
      !LANG_NAMES[sourceLang] ||
      !LANG_NAMES[targetLang] ||
      sourceLang === targetLang
    ) {
      return res.status(400).json({
        error: "Нужны слово и корректная языковая пара."
      });
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
  "noun": null или {
    "article": "der/die/das, если применимо; иначе пустая строка",
    "gender": "мужской/женский/средний род или не применимо",
    "singular": "форма единственного числа",
    "plural": "форма множественного числа"
  },
  "verb": null или {
    "infinitive": "инфинитив",
    "present3sg": "форма 3-го лица единственного числа",
    "preterite": "Präteritum для немецкого или Past Simple для английского",
    "participle": "Partizip II / Past Participle / причастная форма",
    "type": "сильный / слабый / смешанный для немецкого; regular / irregular для английского"
  },
  "adjective": null или {
    "comparative": "сравнительная степень",
    "superlative": "превосходная степень"
  },
  "usageNote": "короткая важная помета об управлении, предлоге, регистре или употреблении; если нечего добавить — пустая строка"
}

ПРАВИЛА:

- Заполняй noun только если это существительное; verb только если глагол; adjective только если прилагательное.
- Для немецких существительных обязательно укажи правильный артикль, род, форму единственного и множественного числа.
- Для немецких глаголов укажи Infinitiv, 3-е лицо Präsens, Präteritum, Partizip II и классификацию: слабый, сильный или смешанный.
- Для английских глаголов укажи base form, 3rd person, Past Simple, Past Participle и regular/irregular.
- Для выражений и фразовых глаголов укажи значение целиком и основные грамматические особенности.
- Если форма стоит в склонённом или спрягаемом виде, восстанови словарную форму.
- Не выдумывай грамматические сведения. Если не уверен, укажи null или пустую строку.
- Пример должен быть естественным, коротким и соответствовать уровню B1–B2.`;

    const raw = await callYandex(
      "Ты — точный многоязычный лексикограф. Возвращай только JSON, без markdown.",
      prompt
    );

    let entry;

    try {
      const cleaned = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");

      entry = JSON.parse(cleaned);

    } catch {
      return res.status(502).json({
        error: "Не удалось разобрать словарную карточку. Попробуй ещё раз."
      });
    }

    res.json({ entry });

  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || "Не удалось найти слово."
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Translation Lab is running on port ${port}`);
});
