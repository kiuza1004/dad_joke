const KEY_FAVS = "dad_joke_favorites_v1";
const KEY_USER_API = "dad_joke_user_api_key_v1";

export function getUserApiKey() {
  try { return (localStorage.getItem(KEY_USER_API) || "").trim(); }
  catch { return ""; }
}

export function setUserApiKey(key) {
  const v = (key || "").trim();
  try {
    if (v) localStorage.setItem(KEY_USER_API, v);
    else localStorage.removeItem(KEY_USER_API);
  } catch {}
}

export function clearUserApiKey() {
  try { localStorage.removeItem(KEY_USER_API); } catch {}
}

function uuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function fromJoke(joke) {
  return {
    id: uuid(),
    type: joke.type?.trim() || "Korean",
    category: joke.category || "",
    question: joke.question || "",
    answer: joke.answer || "",
    explanation: joke.explanation || "",
    savedAt: Date.now(),
    custom: false,
    starred: false,
  };
}

export function makeManual({ question, answer, explanation, category }) {
  return {
    id: uuid(),
    type: "Korean",
    category: category?.trim() || "Custom",
    question: (question || "").trim(),
    answer: (answer || "").trim(),
    explanation: (explanation || "").trim(),
    savedAt: Date.now(),
    custom: true,
    starred: false,
  };
}

function normalize(s) {
  return (s || "").trim();
}

function fingerprint(saved) {
  return normalize(saved.question) + "\u0001" + normalize(saved.answer);
}

export class Favorites {
  constructor() {
    this.items = this._load();
    this.listeners = new Set();
  }

  _load() {
    try {
      const raw = localStorage.getItem(KEY_FAVS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item) => ({
        id: item.id || uuid(),
        type: item.type || "Korean",
        category: item.category || "",
        question: item.question || "",
        answer: item.answer || "",
        explanation: item.explanation || "",
        savedAt: typeof item.savedAt === "number" ? item.savedAt : Date.now(),
        custom: !!item.custom,
        starred: !!item.starred,
      }));
    } catch {
      return [];
    }
  }

  _save() {
    localStorage.setItem(KEY_FAVS, JSON.stringify(this.items));
    this.listeners.forEach((fn) => fn(this.items));
  }

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.items);
    return () => this.listeners.delete(fn);
  }

  add(saved) {
    if (!saved.custom) {
      const fp = fingerprint(saved);
      if (this.items.some((it) => !it.custom && fingerprint(it) === fp)) {
        return false;
      }
    }
    this.items = [saved, ...this.items];
    this._save();
    return true;
  }

  addAll(list) {
    const seen = new Set(this.items.map(fingerprint));
    let added = 0;
    const fresh = [];
    for (const s of list) {
      const fp = fingerprint(s);
      if (seen.has(fp)) continue;
      seen.add(fp);
      fresh.push(s);
      added++;
    }
    if (added > 0) {
      this.items = [...fresh, ...this.items];
      this._save();
    }
    return added;
  }

  update(updated) {
    const idx = this.items.findIndex((it) => it.id === updated.id);
    if (idx < 0) return;
    this.items = [...this.items];
    this.items[idx] = { ...this.items[idx], ...updated };
    this._save();
  }

  toggleStar(id) {
    const idx = this.items.findIndex((it) => it.id === id);
    if (idx < 0) return;
    this.items = [...this.items];
    this.items[idx] = { ...this.items[idx], starred: !this.items[idx].starred };
    this._save();
  }

  remove(id) {
    const next = this.items.filter((it) => it.id !== id);
    if (next.length === this.items.length) return;
    this.items = next;
    this._save();
  }

  clearAll() {
    this.items = [];
    this._save();
  }

  parseJokes(raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((it) => it && typeof it === "object" && it.question && it.answer)
        .map((it) => ({
          id: it.id || uuid(),
          type: it.type || "Korean",
          category: it.category || "",
          question: it.question,
          answer: it.answer,
          explanation: it.explanation || "",
          savedAt: typeof it.savedAt === "number" ? it.savedAt : Date.now(),
          custom: !!it.custom,
          starred: !!it.starred,
        }));
    } catch {
      return [];
    }
  }

  exportJson() {
    return JSON.stringify(this.items, null, 2);
  }
}
