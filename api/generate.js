const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "gemini-2.5-flash-lite";
const MAX_BATCH = 20;

const SYSTEM_PROMPT = `[역할]
너는 재치 있고 유머 감각이 뛰어난 '아재개그 생성기'야. 사용자의 요청에 따라 썰렁하지만 웃음이 나오는 정통 한국식 아재개그를 만들어내는 것이 너의 임무야.

[지시사항]
1. 반드시 한국어 아재개그만 생성해.
2. 사용자가 특정 키워드나 주제(예: "커피", "동물", "회사")를 제공하면, 반드시 그 주제와 관련된 개그를 만들어야 해. 주제가 없으면 랜덤으로 품질 높은 개그를 만들어줘.
3. 개그는 반드시 질문(Setup)과 정답(Punchline)의 구조를 가져야 해.
4. '동음이의어(말장난)', '언어유희', '넌센스 퀴즈' 형태로 만들어줘.
5. 정치적, 공격적, 성적이거나 불쾌감을 줄 수 있는 유해한 내용은 절대 포함해서는 안 돼. 깨끗하고 건전한 개그만.

[출력 형식]
반드시 아래의 JSON 형식으로만 답변해. 앞뒤에 설명이나 마크다운 코드 블록은 절대 붙이지 말고, 순수한 JSON 객체만 반환해.

{
  "type": "Korean",
  "category": "제시된 키워드 혹은 Random",
  "question": "아재개그 질문 내용",
  "answer": "아재개그 정답 내용",
  "explanation": "왜 이게 재미있는지, 어떤 말장난(동음이의어 등)이 숨어있는지 아주 짧게 설명"
}`;

const SAFETY_SETTINGS = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_ONLY_HIGH" }));

const jokeSchema = {
  type: "object",
  required: ["type", "category", "question", "answer", "explanation"],
  properties: {
    type: { type: "string" },
    category: { type: "string" },
    question: { type: "string" },
    answer: { type: "string" },
    explanation: { type: "string" },
  },
};

function buildUserPrompt(keyword) {
  const kw = (keyword || "").trim();
  const cat = kw || "Random";
  return `주제(category): ${cat}\n위 조건으로 시스템 지침을 따라 한국어 아재개그 JSON 한 개만 반환하세요.`;
}

function buildBatchPrompt(keyword, count) {
  const kw = (keyword || "").trim();
  const cat = kw || "Random";
  return (
    `주제(category): ${cat}\n` +
    `개수: ${count}\n` +
    `위 조건으로 시스템 지침을 따라 서로 겹치지 않는 한국어 아재개그 ${count}개를 ` +
    `JSON 배열로만 반환하세요. 각 항목은 type/category/question/answer/explanation 5개 필드를 모두 가져야 합니다.`
  );
}

function buildSinglePayload(userText) {
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 1.1,
      maxOutputTokens: 600,
      responseMimeType: "application/json",
      responseSchema: jokeSchema,
    },
    safetySettings: SAFETY_SETTINGS,
  };
}

function buildBatchPayload(userText, count) {
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 1.2,
      maxOutputTokens: Math.min(320 * count, 8192),
      responseMimeType: "application/json",
      responseSchema: { type: "array", items: jokeSchema },
    },
    safetySettings: SAFETY_SETTINGS,
  };
}

function extractJsonObject(text) {
  const t = text.trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  return s >= 0 && e > s ? t.substring(s, e + 1) : t;
}

function extractJsonArray(text) {
  const t = text.trim();
  const s = t.indexOf("[");
  const e = t.lastIndexOf("]");
  return s >= 0 && e > s ? t.substring(s, e + 1) : t;
}

function parseRetrySeconds(body, header) {
  const m = body.match(/retry in\s+([\d.]+)\s*s/i);
  if (m) return Math.ceil(parseFloat(m[1]));
  if (header) {
    const n = parseInt(header, 10);
    if (!isNaN(n)) return n;
  }
  return 30;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "서버 설정 오류: GEMINI_API_KEY 환경변수가 설정되지 않았습니다.",
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const mode = body.mode === "batch" ? "batch" : "single";
  const keyword = (body.keyword || "").toString();
  const count = Math.max(2, Math.min(MAX_BATCH, parseInt(body.count, 10) || 2));

  const payload =
    mode === "batch"
      ? buildBatchPayload(buildBatchPrompt(keyword, count), count)
      : buildSinglePayload(buildUserPrompt(keyword));

  let upstream;
  try {
    upstream = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return res.status(502).json({ error: "상위 API 호출 실패: " + e.message });
  }

  const raw = await upstream.text();

  if (upstream.status === 429) {
    const retrySecs = parseRetrySeconds(raw, upstream.headers.get("retry-after"));
    res.setHeader("retry-after", String(retrySecs));
    return res.status(429).json({
      error: "rate-limited",
      retryAfterSeconds: retrySecs,
    });
  }

  if (!upstream.ok) {
    let message = raw || `HTTP ${upstream.status}`;
    try {
      const j = JSON.parse(raw);
      if (j?.error?.message) message = j.error.message;
    } catch {}
    return res.status(upstream.status).json({ error: "API 오류: " + message });
  }

  let respText;
  try {
    const parsed = JSON.parse(raw);
    respText = parsed?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
  } catch (e) {
    return res.status(500).json({ error: "응답 파싱 실패: " + e.message });
  }

  if (!respText) {
    return res.status(500).json({ error: "응답에 텍스트가 없습니다." });
  }

  try {
    if (mode === "batch") {
      const arr = JSON.parse(extractJsonArray(respText));
      return res.status(200).json({ jokes: arr });
    } else {
      const obj = JSON.parse(extractJsonObject(respText));
      return res.status(200).json({ joke: obj });
    }
  } catch (e) {
    return res.status(500).json({ error: "JSON 추출 실패: " + e.message });
  }
}
