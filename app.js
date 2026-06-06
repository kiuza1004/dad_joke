import { generateJoke, generateJokes, RateLimitedError, MAX_BATCH } from "./gemini.js";
import {
  Favorites,
  fromJoke,
  makeManual,
  getApiKey,
  setApiKey,
  hasApiKey,
} from "./storage.js";

const MAX_TOTAL_BATCH = 30;
const MAX_RETRIES = 1;
const MAX_RETRY_SECONDS = 60;

const favorites = new Favorites();

const state = {
  view: "home",
  keyword: "",
  pendingJokes: [],
  loading: false,
  batch: null,
  retryCountdown: null,
  error: null,
  filter: { category: null, starredOnly: false },
};

const appEl = document.getElementById("app");
const topTitle = document.getElementById("topTitle");
const topActions = document.getElementById("topActions");
const backBtn = document.getElementById("backBtn");
const snackbar = document.getElementById("snackbar");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalEl = document.getElementById("modal");
const filePicker = document.getElementById("filePicker");

backBtn.addEventListener("click", () => navigate("home"));

function uuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function showSnackbar(message) {
  if (!message) return;
  snackbar.textContent = message;
  snackbar.hidden = false;
  clearTimeout(showSnackbar._t);
  showSnackbar._t = setTimeout(() => {
    snackbar.hidden = true;
  }, 2800);
}

function navigate(view) {
  state.view = view;
  render();
}

function setTopActions(actions) {
  topActions.innerHTML = "";
  for (const { icon, title, onClick } of actions) {
    const btn = document.createElement("button");
    btn.className = "icon-btn";
    btn.textContent = icon;
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.onclick = onClick;
    topActions.appendChild(btn);
  }
}

function openModal(node) {
  modalEl.innerHTML = "";
  modalEl.appendChild(node);
  modalBackdrop.hidden = false;
}

function closeModal() {
  modalBackdrop.hidden = true;
  modalEl.innerHTML = "";
}

modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});

function confirmDialog({ title, message, confirmText = "확인", danger = false, onConfirm }) {
  const root = document.createElement("div");
  const h = document.createElement("h2");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = message;
  p.style.color = "var(--muted)";
  const row = document.createElement("div");
  row.className = "row gap";

  const cancel = document.createElement("button");
  cancel.className = "text-btn";
  cancel.textContent = "취소";
  cancel.onclick = closeModal;

  const ok = document.createElement("button");
  ok.className = "text-btn" + (danger ? " danger" : "");
  ok.textContent = confirmText;
  ok.onclick = () => {
    closeModal();
    onConfirm?.();
  };

  row.append(cancel, ok);
  root.append(h, p, row);
  openModal(root);
}

function twoStepConfirm({ count, label, onConfirm }) {
  confirmDialog({
    title: `${label} 하시겠습니까?`,
    message: `${count}개 항목을 ${label}합니다.`,
    confirmText: "다음",
    onConfirm: () => {
      confirmDialog({
        title: "정말로 삭제하시겠습니까?",
        message: "이 작업은 되돌릴 수 없습니다.",
        confirmText: "삭제",
        danger: true,
        onConfirm,
      });
    },
  });
}

function render() {
  if (state.view === "home") renderHome();
  else if (state.view === "favorites") renderFavorites();
  else if (state.view === "settings") renderSettings();
}

// ============ HOME ============

function renderHome() {
  topTitle.textContent = "아재개그 생성기";
  backBtn.hidden = true;
  setTopActions([
    { icon: "🔖", title: "저장한 개그", onClick: () => navigate("favorites") },
    { icon: "⚙️", title: "설정", onClick: () => navigate("settings") },
  ]);

  const tpl = document.getElementById("tpl-home").content.cloneNode(true);
  appEl.innerHTML = "";
  appEl.appendChild(tpl);

  const warning = appEl.querySelector("#apiKeyWarning");
  warning.hidden = hasApiKey();

  const kw = appEl.querySelector("#keyword");
  kw.value = state.keyword;
  kw.addEventListener("input", (e) => (state.keyword = e.target.value));

  const genBtn = appEl.querySelector("#generateBtn");
  const genLabel = genBtn.querySelector(".btn-label");
  genBtn.disabled = state.loading || !!state.batch;
  if (state.loading) genLabel.textContent = "생성 중...";
  genBtn.onclick = handleSingleGenerate;

  const batchInput = appEl.querySelector("#batchCount");
  const batchInc = appEl.querySelector("#batchInc");
  const batchDec = appEl.querySelector("#batchDec");
  const batchGen = appEl.querySelector("#batchGen");
  const batchLabel = appEl.querySelector("#batchGenLabel");

  let batchCount = parseInt(batchInput.value, 10) || 10;
  const setBatchCount = (n) => {
    batchCount = Math.max(2, Math.min(MAX_TOTAL_BATCH, n));
    batchInput.value = batchCount;
    batchLabel.textContent = `${batchCount}개 생성`;
    batchDec.disabled = batchCount <= 2;
    batchInc.disabled = batchCount >= MAX_TOTAL_BATCH;
  };
  setBatchCount(batchCount);

  batchInput.addEventListener("change", () => setBatchCount(parseInt(batchInput.value, 10) || 2));
  batchInc.onclick = () => setBatchCount(batchCount + 1);
  batchDec.onclick = () => setBatchCount(batchCount - 1);
  batchGen.disabled = state.loading || !!state.batch;
  batchGen.onclick = () => handleBatchGenerate(batchCount);

  // progress
  const progressCard = appEl.querySelector("#progressCard");
  if (state.batch) {
    progressCard.hidden = false;
    const { received, target, added, keyword } = state.batch;
    appEl.querySelector("#progressTitle").textContent =
      `일괄 생성 중 · 주제: ${keyword || "Random"}`;
    appEl.querySelector("#progressFill").style.width =
      `${Math.min(100, Math.round((received / Math.max(1, target)) * 100))}%`;
    appEl.querySelector("#progressStat").textContent =
      `${received} / ${target} 수신 · 추가 ${added}개`;
  } else {
    progressCard.hidden = true;
  }

  const waitingCard = appEl.querySelector("#waitingCard");
  if (state.retryCountdown != null) {
    waitingCard.hidden = false;
    waitingCard.textContent = `잠시만 기다려주세요... ${state.retryCountdown}초 후 자동으로 다시 시도합니다.`;
  } else {
    waitingCard.hidden = true;
  }

  const errorCard = appEl.querySelector("#errorCard");
  if (state.error && state.retryCountdown == null) {
    errorCard.hidden = false;
    errorCard.textContent = state.error;
  } else {
    errorCard.hidden = true;
  }

  const pendingSection = appEl.querySelector("#pendingSection");
  const pendingTitle = appEl.querySelector("#pendingTitle");
  const pendingList = appEl.querySelector("#pendingList");
  const clearAllBtn = appEl.querySelector("#clearAllPending");

  if (state.pendingJokes.length > 0) {
    pendingSection.hidden = false;
    pendingTitle.textContent = `생성한 개그 ${state.pendingJokes.length}개`;
    clearAllBtn.onclick = () =>
      twoStepConfirm({
        count: state.pendingJokes.length,
        label: "전체 삭제",
        onConfirm: () => {
          state.pendingJokes = [];
          render();
        },
      });

    pendingList.innerHTML = "";
    for (const pending of state.pendingJokes) {
      pendingList.appendChild(buildJokeCard(pending));
    }
  } else {
    pendingSection.hidden = true;
  }
}

function buildJokeCard(pending) {
  const tpl = document.getElementById("tpl-joke-card").content.cloneNode(true);
  const card = tpl.querySelector(".joke-card");
  const j = pending.joke;
  tpl.querySelector(".joke-category").textContent = `카테고리: ${j.category || "Random"}`;
  tpl.querySelector(".question").textContent = j.question;
  tpl.querySelector(".answer").textContent = j.answer;
  const exp = tpl.querySelector(".explanation");
  if (j.explanation?.trim()) {
    exp.hidden = false;
    exp.textContent = `💡 ${j.explanation}`;
  }
  tpl.querySelector(".save").onclick = () => savePending(pending.id);
  tpl.querySelector(".discard").onclick = () => discardPending(pending.id);
  return card;
}

async function handleSingleGenerate() {
  if (state.loading || state.batch) return;
  state.loading = true;
  state.error = null;
  state.retryCountdown = null;
  render();

  let attempts = 0;
  while (true) {
    try {
      const joke = await generateJoke(getApiKey(), state.keyword);
      state.pendingJokes = [{ id: uuid(), joke }, ...state.pendingJokes];
      state.loading = false;
      state.retryCountdown = null;
      render();
      return;
    } catch (err) {
      if (
        err instanceof RateLimitedError &&
        err.retryAfterSeconds >= 1 &&
        err.retryAfterSeconds <= MAX_RETRY_SECONDS &&
        attempts < MAX_RETRIES
      ) {
        attempts++;
        await waitCountdown(err.retryAfterSeconds + 1);
        continue;
      }
      const msg =
        err instanceof RateLimitedError
          ? `분당 무료 한도를 초과했습니다. 약 ${err.retryAfterSeconds}초 후 다시 시도해주세요.`
          : err.message || "알 수 없는 오류가 발생했습니다.";
      state.loading = false;
      state.error = msg;
      state.retryCountdown = null;
      render();
      return;
    }
  }
}

async function handleBatchGenerate(count) {
  if (state.loading || state.batch) return;
  const target = Math.max(2, Math.min(MAX_TOTAL_BATCH, count));
  const keyword = state.keyword;
  state.batch = { target, received: 0, added: 0, keyword };
  state.error = null;
  render();

  let remaining = target;
  let failureMessage = null;

  while (remaining > 0) {
    const chunk = Math.max(2, Math.min(MAX_BATCH, remaining));
    let attempts = 0;
    let done = false;
    while (!done) {
      try {
        const jokes = await generateJokes(getApiKey(), keyword, chunk);
        const newPending = jokes.map((j) => ({ id: uuid(), joke: j }));
        state.pendingJokes = [...newPending, ...state.pendingJokes];
        state.batch.received += jokes.length;
        state.batch.added += newPending.length;
        remaining -= Math.max(1, jokes.length);
        render();
        done = true;
      } catch (err) {
        if (
          err instanceof RateLimitedError &&
          err.retryAfterSeconds >= 1 &&
          err.retryAfterSeconds <= MAX_RETRY_SECONDS &&
          attempts < MAX_RETRIES
        ) {
          attempts++;
          await waitCountdown(err.retryAfterSeconds + 1);
        } else {
          failureMessage =
            err instanceof RateLimitedError
              ? `분당 무료 한도 초과로 일괄 생성을 중단했습니다. (${state.batch.added}개 생성됨)`
              : err.message || "알 수 없는 오류로 일괄 생성을 중단했습니다.";
          done = true;
          remaining = 0;
        }
      }
    }
  }

  const added = state.batch.added;
  state.batch = null;
  state.retryCountdown = null;
  if (failureMessage) {
    state.error = failureMessage;
  }
  render();
  showSnackbar(failureMessage ?? `일괄 생성 완료: ${added}개 추가됨`);
}

async function waitCountdown(seconds) {
  for (let s = seconds; s >= 1; s--) {
    state.retryCountdown = s;
    render();
    await sleep(1000);
  }
  state.retryCountdown = null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function savePending(id) {
  const idx = state.pendingJokes.findIndex((p) => p.id === id);
  if (idx < 0) return;
  const pending = state.pendingJokes[idx];
  favorites.add(fromJoke(pending.joke));
  state.pendingJokes = state.pendingJokes.filter((p) => p.id !== id);
  render();
  showSnackbar("저장한 개그에 등록되었습니다.");
}

function discardPending(id) {
  state.pendingJokes = state.pendingJokes.filter((p) => p.id !== id);
  render();
}

// ============ FAVORITES ============

function renderFavorites() {
  const items = favorites.items;
  const starredCount = items.filter((it) => it.starred).length;
  topTitle.textContent = state.filter.starredOnly
    ? `관심목록 (${starredCount})`
    : `저장한 개그 (${items.length})`;
  backBtn.hidden = false;
  setTopActions([
    {
      icon: state.filter.starredOnly ? "★" : "☆",
      title: "관심목록 필터",
      onClick: () => {
        state.filter.starredOnly = !state.filter.starredOnly;
        render();
      },
    },
    {
      icon: "⋮",
      title: "메뉴",
      onClick: openFavoritesMenu,
    },
  ]);

  const tpl = document.getElementById("tpl-favorites").content.cloneNode(true);
  appEl.innerHTML = "";
  appEl.appendChild(tpl);

  // category chips
  const categories = Array.from(
    new Set(items.map((it) => (it.category || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "ko"));

  if (
    state.filter.category &&
    !categories.includes(state.filter.category)
  ) {
    state.filter.category = null;
  }

  const filterRow = appEl.querySelector("#filterRow");
  if (categories.length === 0) {
    filterRow.hidden = true;
  } else {
    const all = document.createElement("button");
    all.className = "chip" + (state.filter.category == null ? " active" : "");
    all.textContent = "전체";
    all.onclick = () => {
      state.filter.category = null;
      render();
    };
    filterRow.appendChild(all);
    for (const cat of categories) {
      const chip = document.createElement("button");
      chip.className = "chip" + (state.filter.category === cat ? " active" : "");
      chip.textContent = cat;
      chip.onclick = () => {
        state.filter.category = cat;
        render();
      };
      filterRow.appendChild(chip);
    }
  }

  const list = appEl.querySelector("#favList");
  const empty = appEl.querySelector("#favEmpty");
  const filtered = items.filter((it) => {
    if (state.filter.starredOnly && !it.starred) return false;
    if (state.filter.category && it.category !== state.filter.category) return false;
    return true;
  });

  if (filtered.length === 0) {
    empty.hidden = false;
    empty.textContent = items.length === 0
      ? "저장된 개그가 없습니다."
      : "조건에 맞는 개그가 없습니다.";
  } else {
    for (const item of filtered) {
      list.appendChild(buildFavCard(item));
    }
  }

  appEl.querySelector("#fabAdd").onclick = () => openEditDialog(null);
}

function buildFavCard(item) {
  const tpl = document.getElementById("tpl-fav-card").content.cloneNode(true);
  const card = tpl.querySelector(".fav-card");
  tpl.querySelector(".fav-category").textContent = `카테고리: ${item.category || "Random"}`;
  if (item.custom) tpl.querySelector(".fav-custom").hidden = false;
  tpl.querySelector(".question").textContent = item.question;
  tpl.querySelector(".answer").textContent = item.answer;
  const exp = tpl.querySelector(".explanation");
  if (item.explanation?.trim()) {
    exp.hidden = false;
    exp.textContent = `💡 ${item.explanation}`;
  }

  const star = tpl.querySelector(".star");
  star.textContent = item.starred ? "★" : "☆";
  star.style.color = item.starred ? "#ffb300" : "";
  star.onclick = () => {
    favorites.toggleStar(item.id);
    render();
  };
  tpl.querySelector(".edit").onclick = () => openEditDialog(item);
  tpl.querySelector(".delete").onclick = () => {
    confirmDialog({
      title: "삭제하시겠습니까?",
      message: `"${item.question}" 항목을 삭제합니다.`,
      confirmText: "삭제",
      danger: true,
      onConfirm: () => {
        favorites.remove(item.id);
        render();
      },
    });
  };
  return card;
}

function openFavoritesMenu() {
  const root = document.createElement("div");
  root.innerHTML = `<h2>메뉴</h2>`;
  const opts = [
    { label: "🌱 시드 가져오기", onClick: importSeed },
    { label: "📂 JSON 가져오기", onClick: importJson },
    { label: "💾 JSON 내보내기", onClick: exportJson },
    { label: "🗑 전체 삭제", danger: true, onClick: clearAllFavs },
  ];
  for (const o of opts) {
    const btn = document.createElement("button");
    btn.className = "outlined-btn";
    btn.style.cssText = "display:block;width:100%;margin:6px 0;text-align:left;";
    btn.textContent = o.label;
    if (o.danger) btn.style.borderColor = "#b71c1c", btn.style.color = "#b71c1c";
    btn.onclick = () => {
      closeModal();
      o.onClick();
    };
    root.appendChild(btn);
  }
  const cancel = document.createElement("button");
  cancel.className = "text-btn";
  cancel.textContent = "닫기";
  cancel.onclick = closeModal;
  cancel.style.marginTop = "8px";
  root.appendChild(cancel);
  openModal(root);
}

async function importSeed() {
  try {
    const res = await fetch("./seed_jokes.json");
    if (!res.ok) {
      showSnackbar("내장 시드 데이터를 불러오지 못했습니다.");
      return;
    }
    const raw = await res.text();
    const parsed = favorites.parseJokes(raw);
    if (parsed.length === 0) {
      showSnackbar("시드 데이터가 비어있습니다.");
      return;
    }
    // Convert plain seed items into saved entries
    const fresh = parsed.map((it) =>
      it.id && it.savedAt
        ? it
        : fromJoke({
            type: it.type,
            category: it.category,
            question: it.question,
            answer: it.answer,
            explanation: it.explanation,
          })
    );
    const added = favorites.addAll(fresh);
    render();
    showSnackbar(
      `시드 가져오기 완료: ${added}개 추가 (중복 ${fresh.length - added}개 제외)`
    );
  } catch (e) {
    showSnackbar("시드 가져오기 실패: " + e.message);
  }
}

function importJson() {
  filePicker.value = "";
  filePicker.onchange = async () => {
    const file = filePicker.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = favorites.parseJokes(text);
      if (parsed.length === 0) {
        showSnackbar("가져올 수 있는 항목이 없습니다. (JSON 형식 확인)");
        return;
      }
      const added = favorites.addAll(parsed);
      render();
      showSnackbar(
        `가져오기 완료: ${added}개 추가 (중복 ${parsed.length - added}개 제외)`
      );
    } catch (e) {
      showSnackbar("가져오기 실패: " + e.message);
    }
  };
  filePicker.click();
}

function exportJson() {
  const json = favorites.exportJson();
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.href = url;
  a.download = `dad_jokes_${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showSnackbar(`내보내기 완료: ${favorites.items.length}개 저장`);
}

function clearAllFavs() {
  const count = favorites.items.length;
  if (count === 0) {
    showSnackbar("저장된 개그가 없습니다.");
    return;
  }
  twoStepConfirm({
    count,
    label: "전체 삭제",
    onConfirm: () => {
      favorites.clearAll();
      state.filter.starredOnly = false;
      state.filter.category = null;
      render();
      showSnackbar(`전체 ${count}개 삭제 완료`);
    },
  });
}

// ============ EDIT DIALOG ============

function openEditDialog(initial) {
  const isEdit = !!initial;
  const root = document.createElement("div");
  const existing = Array.from(
    new Set(favorites.items.map((it) => (it.category || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "ko"));

  let mode =
    isEdit && initial.category && existing.includes(initial.category)
      ? "existing"
      : existing.length > 0
      ? "existing"
      : "new";

  let pickedCategory = isEdit && existing.includes(initial?.category)
    ? initial.category
    : existing[0] || "";
  let newCategory =
    isEdit && !existing.includes(initial?.category) ? initial.category : "";

  let question = initial?.question || "";
  let answer = initial?.answer || "";
  let explanation = initial?.explanation || "";

  const h2 = document.createElement("h2");
  h2.textContent = isEdit ? "개그 수정" : "개그 추가";
  root.appendChild(h2);

  const renderModal = () => {
    while (root.children.length > 1) root.removeChild(root.lastChild);

    if (existing.length > 0) {
      const toggle = document.createElement("div");
      toggle.className = "toggle-row";
      const exBtn = document.createElement("button");
      exBtn.textContent = "기존 카테고리";
      const newBtn = document.createElement("button");
      newBtn.textContent = "새 카테고리";
      if (mode === "existing") exBtn.classList.add("active");
      else newBtn.classList.add("active");
      exBtn.onclick = () => { mode = "existing"; renderModal(); };
      newBtn.onclick = () => { mode = "new"; renderModal(); };
      toggle.append(exBtn, newBtn);
      root.appendChild(toggle);
    }

    const catLabel = document.createElement("label");
    catLabel.className = "field";
    const catSpan = document.createElement("span");
    catSpan.textContent = mode === "existing" ? "카테고리 선택" : "새 카테고리";
    catLabel.appendChild(catSpan);

    if (mode === "existing" && existing.length > 0) {
      const sel = document.createElement("select");
      for (const c of existing) {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        if (c === pickedCategory) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.onchange = () => (pickedCategory = sel.value);
      catLabel.appendChild(sel);
    } else {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.value = newCategory;
      inp.placeholder = "예: 음식";
      inp.oninput = () => (newCategory = inp.value);
      catLabel.appendChild(inp);
    }
    root.appendChild(catLabel);

    const addField = (label, value, multi, onChange) => {
      const f = document.createElement("label");
      f.className = "field";
      const s = document.createElement("span");
      s.textContent = label;
      f.appendChild(s);
      const el = document.createElement(multi ? "textarea" : "input");
      el.value = value;
      el.oninput = (e) => onChange(e.target.value);
      f.appendChild(el);
      root.appendChild(f);
    };

    addField("질문 (Q)", question, true, (v) => (question = v));
    addField("정답 (A)", answer, true, (v) => (answer = v));
    addField("해설", explanation, true, (v) => (explanation = v));

    const row = document.createElement("div");
    row.className = "row gap";

    const cancel = document.createElement("button");
    cancel.className = "text-btn";
    cancel.textContent = "취소";
    cancel.onclick = closeModal;

    const save = document.createElement("button");
    save.className = "primary-btn";
    save.textContent = "저장";
    const canSave = () => {
      if (!question.trim() || !answer.trim()) return false;
      if (mode === "existing" && !pickedCategory.trim()) return false;
      return true;
    };
    save.onclick = () => {
      if (!canSave()) {
        showSnackbar("질문/정답/카테고리를 확인하세요.");
        return;
      }
      const category =
        mode === "existing" ? pickedCategory : newCategory.trim();
      if (isEdit) {
        favorites.update({
          ...initial,
          category,
          question: question.trim(),
          answer: answer.trim(),
          explanation: explanation.trim(),
        });
        showSnackbar("수정 완료");
      } else {
        favorites.add(
          makeManual({ question, answer, explanation, category })
        );
        showSnackbar("추가 완료");
      }
      closeModal();
      render();
    };
    row.append(cancel, save);
    root.appendChild(row);
  };
  renderModal();
  openModal(root);
}

// ============ SETTINGS ============

function renderSettings() {
  topTitle.textContent = "설정";
  backBtn.hidden = false;
  setTopActions([]);

  const tpl = document.getElementById("tpl-settings").content.cloneNode(true);
  appEl.innerHTML = "";
  appEl.appendChild(tpl);

  const input = appEl.querySelector("#apiKey");
  input.value = getApiKey();
  const toggle = appEl.querySelector("#toggleVis");
  toggle.onclick = () => {
    if (input.type === "password") {
      input.type = "text";
      toggle.textContent = "숨김";
    } else {
      input.type = "password";
      toggle.textContent = "표시";
    }
  };

  appEl.querySelector("#saveKey").onclick = () => {
    const v = input.value.trim();
    if (!v) {
      showSnackbar("키를 입력하세요.");
      return;
    }
    if (!v.startsWith("AIzaSy")) {
      showSnackbar('유효한 Gemini API 키가 아닙니다. "AIzaSy" 로 시작해야 합니다.');
      return;
    }
    setApiKey(v);
    showSnackbar("저장 완료");
  };

  appEl.querySelector("#clearKey").onclick = () => {
    confirmDialog({
      title: "키 삭제",
      message: "저장된 Gemini API 키를 삭제합니다.",
      confirmText: "삭제",
      danger: true,
      onConfirm: () => {
        setApiKey("");
        input.value = "";
        showSnackbar("삭제 완료");
      },
    });
  };
}

// Init
favorites.subscribe(() => {
  if (state.view === "favorites" || state.view === "home") {
    // re-render only if relevant; cheap enough
    render();
  }
});

render();
