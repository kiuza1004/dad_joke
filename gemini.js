export const MAX_BATCH = 20;

export class RateLimitedError extends Error {
  constructor(message, retryAfterSeconds) {
    super(message);
    this.name = "RateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function readAccessToken() {
  const meta = document.querySelector('meta[name="x-access-token"]');
  const v = meta?.getAttribute("content")?.trim();
  return v || "";
}

async function callProxy(payload) {
  const headers = { "content-type": "application/json" };
  const token = readAccessToken();
  if (token) headers["x-access-token"] = token;

  let res;
  try {
    res = await fetch("/api/generate", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error("서버 호출 실패: " + e.message);
  }

  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}

  if (res.status === 429) {
    throw new RateLimitedError(
      "rate-limited",
      Number(data.retryAfterSeconds) || 30
    );
  }

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data;
}

export async function generateJoke(keyword) {
  const data = await callProxy({ mode: "single", keyword });
  if (!data.joke) throw new Error("응답에 joke가 없습니다.");
  return data.joke;
}

export async function generateJokes(keyword, count) {
  const safe = Math.max(2, Math.min(MAX_BATCH, count));
  const data = await callProxy({ mode: "batch", keyword, count: safe });
  if (!Array.isArray(data.jokes)) throw new Error("응답에 jokes 배열이 없습니다.");
  return data.jokes;
}
