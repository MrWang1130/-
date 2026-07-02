const STORAGE_KEY = "qwerty-sync.progress.v2";
const AUTH_KEY = "qwerty-sync.auth.v1";
const MANIFEST_URL = new URL("./dictionaries.json", import.meta.url).toString();
const DEFAULT_DICT_ID = "cet4";

const SELECTORS = {
  accountButton: "#accountButton",
  accuracy: "#accuracy",
  authDialog: "#authDialog",
  authForm: "#authForm",
  authMessage: "#authMessage",
  authSubmit: "#authSubmit",
  authTitle: "#authTitle",
  categorySelect: "#categorySelect",
  chapterSelect: "#chapterSelect",
  closeAuth: "#closeAuth",
  correctCount: "#correctCount",
  deckName: "#deckName",
  deckProgress: "#deckProgress",
  deckSelect: "#deckSelect",
  definition: "#definition",
  exportButton: "#exportButton",
  importButton: "#importButton",
  importFile: "#importFile",
  inputCount: "#inputCount",
  keyboard: "#keyboard",
  letterRow: "#letterRow",
  loginTab: "#loginTab",
  nextChapterButton: "#nextChapterButton",
  passwordInput: "#passwordInput",
  phonetic: "#phonetic",
  prevChapterButton: "#prevChapterButton",
  pronounceButton: "#pronounceButton",
  resetButton: "#resetButton",
  saveState: "#saveState",
  signupTab: "#signupTab",
  soundButton: "#soundButton",
  speed: "#speed",
  startOverlay: "#startOverlay",
  syncButton: "#syncButton",
  syncLine: "#syncLine",
  timeUsed: "#timeUsed",
  typingInput: "#typingInput",
  usernameInput: "#usernameInput",
  wordIndex: "#wordIndex"
};

const el = Object.fromEntries(
  Object.entries(SELECTORS).map(([name, selector]) => [name, document.querySelector(selector)])
);

let manifest = null;
let dictionaries = [];
let categoryList = [];
let dictionaryCache = new Map();
let activeWords = [];
let activeChapterWords = [];
let loading = true;
let account = loadAuth();
let progress = loadProgress();
let authMode = "login";
let isTyping = false;
let completionLock = false;
let sessionStartedAt = 0;
let sessionTimer = 0;
let syncTimer = 0;
let saveTimer = 0;
let wrongResetTimer = 0;

init();

async function init() {
  ensureProgressShape();
  countSession();
  bindEvents();
  renderKeyboard();
  renderAccount();
  renderLoading("加载词库");

  try {
    await loadDictionaryManifest();
    await restoreSession();
    normalizeActiveDictionary();
    renderDictionaryControls();
    await loadActiveDictionary();
  } catch (error) {
    renderLoading(error.message || "词库加载失败");
  }

  registerServiceWorker();
  focusInput();
}

function bindEvents() {
  el.typingInput.addEventListener("input", onInput);
  el.typingInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (isCurrentInputComplete()) completeWord();
    }
  });

  el.categorySelect.addEventListener("change", onCategoryChange);
  el.deckSelect.addEventListener("change", () => switchDictionary(el.deckSelect.value));
  el.chapterSelect.addEventListener("change", () => switchChapter(Number(el.chapterSelect.value)));
  el.prevChapterButton.addEventListener("click", () => switchChapter(activeChapter() - 1));
  el.nextChapterButton.addEventListener("click", () => switchChapter(activeChapter() + 1));
  el.pronounceButton.addEventListener("click", speakCurrentWord);
  el.soundButton.addEventListener("click", toggleSound);
  el.syncButton.addEventListener("click", () => syncNow({ manual: true }));
  el.accountButton.addEventListener("click", onAccountClick);
  el.resetButton.addEventListener("click", resetProgress);
  el.exportButton.addEventListener("click", exportProgress);
  el.importButton.addEventListener("click", () => el.importFile.click());
  el.importFile.addEventListener("change", importProgress);

  el.closeAuth.addEventListener("click", () => el.authDialog.close());
  el.loginTab.addEventListener("click", () => setAuthMode("login"));
  el.signupTab.addEventListener("click", () => setAuthMode("signup"));
  el.authForm.addEventListener("submit", submitAuth);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveProgress({ sync: false });
  });
}

function defaultProgress() {
  return {
    schema: 2,
    activeDeck: DEFAULT_DICT_ID,
    chapters: {},
    cursors: {},
    deckStats: {},
    stats: {
      words: 0,
      chars: 0,
      errors: 0,
      totalMs: 0,
      streak: 0,
      bestStreak: 0,
      sessions: 0
    },
    history: [],
    settings: {
      sound: true
    },
    updatedAt: new Date().toISOString()
  };
}

function loadProgress() {
  try {
    return { ...defaultProgress(), ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch {
    return defaultProgress();
  }
}

function loadAuth() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTH_KEY));
    return saved?.token ? saved : null;
  } catch {
    return null;
  }
}

function ensureProgressShape() {
  const base = defaultProgress();
  progress = {
    ...base,
    ...progress,
    chapters: { ...base.chapters, ...(progress.chapters || {}) },
    cursors: { ...base.cursors, ...(progress.cursors || {}) },
    deckStats: { ...base.deckStats, ...(progress.deckStats || {}) },
    stats: { ...base.stats, ...(progress.stats || {}) },
    settings: { ...base.settings, ...(progress.settings || {}) },
    history: Array.isArray(progress.history) ? progress.history.slice(0, 30) : []
  };
}

function countSession() {
  const marker = "qwerty-sync.session.counted";
  if (sessionStorage.getItem(marker)) return;
  progress.stats.sessions += 1;
  sessionStorage.setItem(marker, "1");
  saveProgress({ sync: false });
}

async function loadDictionaryManifest() {
  const response = await fetch(MANIFEST_URL, { cache: "no-cache" });
  if (!response.ok) throw new Error("无法读取词库目录");
  manifest = await response.json();
  dictionaries = Array.isArray(manifest.dictionaries) ? manifest.dictionaries : [];
  if (!dictionaries.length) throw new Error("词库目录为空");
  categoryList = [...new Set(dictionaries.map((dict) => dict.category || "词库"))];
}

function normalizeActiveDictionary() {
  if (!dictionaries.some((dict) => dict.id === progress.activeDeck)) {
    progress.activeDeck = dictionaries.some((dict) => dict.id === DEFAULT_DICT_ID) ? DEFAULT_DICT_ID : dictionaries[0].id;
  }
  progress.chapters[progress.activeDeck] = activeChapter();
}

function activeDictionary() {
  return dictionaries.find((dict) => dict.id === progress.activeDeck) || dictionaries[0];
}

function activeChapter() {
  return Math.max(0, Number(progress.chapters?.[progress.activeDeck] || 0));
}

function currentCursorKey() {
  return `${progress.activeDeck}:${activeChapter()}`;
}

function currentIndex() {
  if (!activeChapterWords.length) return 0;
  return Math.min(progress.cursors[currentCursorKey()] || 0, activeChapterWords.length - 1);
}

function currentWord() {
  return activeChapterWords[currentIndex()] || null;
}

function currentChapterCount() {
  const size = manifest?.chapterSize || 20;
  return Math.max(1, Math.ceil(activeWords.length / size));
}

function getChapterWords() {
  const size = manifest?.chapterSize || 20;
  const start = activeChapter() * size;
  return activeWords.slice(start, start + size);
}

function renderDictionaryControls() {
  const active = activeDictionary();
  const activeCategory = active.category || categoryList[0];

  fillSelect(
    el.categorySelect,
    categoryList.map((category) => ({ value: category, label: category })),
    activeCategory
  );

  const decks = dictionaries.filter((dict) => (dict.category || "词库") === activeCategory);
  fillSelect(
    el.deckSelect,
    decks.map((dict) => ({ value: dict.id, label: `${dict.name} (${dict.length || "?"})` })),
    active.id
  );

  const chapters = Array.from({ length: currentChapterCount() }, (_, index) => ({
    value: String(index),
    label: `第 ${index + 1} 章`
  }));
  fillSelect(el.chapterSelect, chapters, String(activeChapter()));

  el.prevChapterButton.disabled = activeChapter() <= 0;
  el.nextChapterButton.disabled = activeChapter() >= currentChapterCount() - 1;
}

function fillSelect(select, options, selectedValue) {
  const previous = select.value;
  select.textContent = "";
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    select.append(node);
  }
  select.value = options.some((option) => option.value === selectedValue) ? selectedValue : previous;
}

async function onCategoryChange() {
  const first = dictionaries.find((dict) => (dict.category || "词库") === el.categorySelect.value);
  if (first) await switchDictionary(first.id);
}

async function switchDictionary(id) {
  if (id === progress.activeDeck) return;
  progress.activeDeck = id;
  progress.chapters[id] = progress.chapters[id] || 0;
  stopTyping();
  saveProgress({ sync: true });
  renderDictionaryControls();
  await loadActiveDictionary();
}

async function switchChapter(chapter) {
  const next = Math.min(Math.max(0, chapter), currentChapterCount() - 1);
  if (next === activeChapter()) return;
  progress.chapters[progress.activeDeck] = next;
  stopTyping();
  saveProgress({ sync: true });
  await loadActiveDictionary();
}

async function loadActiveDictionary() {
  const dict = activeDictionary();
  loading = true;
  renderLoading("加载词库");

  try {
    if (!dictionaryCache.has(dict.id)) {
      const url = `${manifest.dictionaryBaseUrl}${dict.url}`;
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) throw new Error(`词库加载失败：${dict.name}`);
      const rawWords = await response.json();
      dictionaryCache.set(dict.id, normalizeWords(rawWords));
    }

    activeWords = dictionaryCache.get(dict.id);
    progress.chapters[dict.id] = Math.min(activeChapter(), currentChapterCount() - 1);
    activeChapterWords = getChapterWords();
    loading = false;
    resetCurrentWord();
    renderDictionaryControls();
    renderAll();
  } catch (error) {
    activeWords = [];
    activeChapterWords = [];
    loading = false;
    renderLoading(error.message || "词库加载失败");
  }
}

function normalizeWords(rawWords) {
  if (!Array.isArray(rawWords)) return [];
  return rawWords
    .map((item) => {
      const term = normalizeTerm(item.name || item.word || item.term || "");
      const trans = Array.isArray(item.trans) ? item.trans : item.trans ? [item.trans] : [];
      return {
        term,
        phonetic: item.usphone || item.ukphone || item.phone || "",
        definition: trans.join("；")
      };
    })
    .filter((item) => item.term.length > 0);
}

function normalizeTerm(value) {
  return String(value)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"');
}

function renderLoading(text) {
  el.deckName.textContent = text;
  el.wordIndex.textContent = "";
  el.letterRow.textContent = "";
  const span = document.createElement("span");
  span.textContent = "...";
  span.className = "pending";
  el.letterRow.append(span);
  el.phonetic.textContent = "";
  el.definition.textContent = text;
  el.deckProgress.style.width = "0%";
}

function renderAll() {
  renderWord();
  renderStats();
  renderAccount();
  el.soundButton.classList.toggle("is-off", !progress.settings.sound);
}

function renderWord() {
  if (loading || !activeChapterWords.length) {
    renderLoading(loading ? "加载词库" : "当前词库为空");
    return;
  }

  const dict = activeDictionary();
  const word = currentWord();
  const index = currentIndex();
  const typed = Array.from(canonicalText(el.typingInput.value));
  const target = Array.from(canonicalText(word.term));

  el.deckName.textContent = `${dict.name} · 第 ${activeChapter() + 1} 章`;
  el.wordIndex.textContent = `${index + 1} / ${activeChapterWords.length}`;
  el.phonetic.textContent = word.phonetic ? `/${word.phonetic.replace(/^\/|\/$/g, "")}/` : "";
  el.definition.textContent = word.definition;
  el.startOverlay.classList.toggle("is-hidden", isTyping);
  el.letterRow.textContent = "";

  Array.from(word.term).forEach((letter, index) => {
    const span = document.createElement("span");
    span.textContent = letter === " " ? "␣" : letter;
    const inputChar = typed[index];
    if (inputChar != null) {
      span.className = compareChar(inputChar, target[index]) ? "correct" : "wrong";
    } else {
      span.className = "pending";
    }
    if (letter === " ") span.classList.add("space");
    el.letterRow.append(span);
  });

  const progressPercent = Math.floor((index / activeChapterWords.length) * 100);
  el.deckProgress.style.width = `${progressPercent}%`;
}

function renderStats() {
  const stats = progress.stats;
  const seconds = Math.floor(currentSessionMs() / 1000);
  const totalInputs = (stats.chars || 0) + (stats.errors || 0);
  const minutes = Math.max(1 / 60, currentSessionMs() / 60000);
  const wpm = isTyping ? Math.round((stats.words || 0) / minutes) : 0;
  const accuracy = totalInputs ? Math.max(0, Math.round(((stats.chars || 0) / totalInputs) * 100)) : 100;

  el.timeUsed.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  el.inputCount.textContent = String(totalInputs);
  el.speed.textContent = String(wpm);
  el.correctCount.textContent = String(stats.chars || 0);
  el.accuracy.textContent = `${accuracy}%`;
}

function renderAccount() {
  if (account?.token) {
    el.accountButton.textContent = "退出";
    el.syncLine.textContent = `${account.user?.username || "账号"} · 可同步`;
  } else {
    el.accountButton.textContent = "登录";
    el.syncLine.textContent = "本地访客";
  }
}

function renderKeyboard() {
  const rows = [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    ["清空", "z", "x", "c", "v", "b", "n", "m", "空格", "<-"]
  ];
  el.keyboard.textContent = "";
  rows.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "keyboard-row";
    row.forEach((key) => {
      const wide = key.length > 1;
      rowEl.append(
        createKey(key, wide ? "wide-key" : "", () => {
          if (key === "清空") setInputValue("");
          else if (key === "<-") setInputValue(el.typingInput.value.slice(0, -1));
          else if (key === "空格") appendInput(" ");
          else appendInput(key);
        })
      );
    });
    el.keyboard.append(rowEl);
  });
}

function createKey(label, className, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = className;
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    action();
    focusInput();
  });
  return button;
}

function appendInput(value) {
  setInputValue(`${el.typingInput.value}${value}`);
}

function setInputValue(value) {
  el.typingInput.value = value;
  onInput();
}

function onInput() {
  if (loading || completionLock || !currentWord()) return;
  if (!isTyping) startTyping();

  clearTimeout(wrongResetTimer);
  const wrongIndex = firstWrongIndex();
  if (wrongIndex !== -1) {
    progress.stats.errors += 1;
    progress.stats.streak = 0;
    shakeWord();
    saveProgress({ sync: true });
    wrongResetTimer = window.setTimeout(() => {
      el.typingInput.value = "";
      renderWord();
    }, 300);
    renderWord();
    renderStats();
    return;
  }

  renderWord();
  renderStats();
  if (isCurrentInputComplete()) completeWord();
}

function firstWrongIndex() {
  const typed = Array.from(canonicalText(el.typingInput.value));
  const target = Array.from(canonicalText(currentWord().term));
  for (let index = 0; index < typed.length; index += 1) {
    if (!compareChar(typed[index], target[index])) return index;
  }
  return -1;
}

function isCurrentInputComplete() {
  const typed = Array.from(canonicalText(el.typingInput.value));
  const target = Array.from(canonicalText(currentWord()?.term || ""));
  return target.length > 0 && typed.length === target.length && typed.every((char, index) => compareChar(char, target[index]));
}

function canonicalText(value) {
  return normalizeTerm(value).toLowerCase();
}

function compareChar(a, b) {
  return (a || "") === (b || "");
}

function completeWord() {
  if (completionLock || !currentWord()) return;
  completionLock = true;
  const word = currentWord();
  const ms = Math.max(120, performance.now() - (sessionStartedAt || performance.now()));
  const cursorKey = currentCursorKey();
  const dictId = progress.activeDeck;

  progress.stats.words += 1;
  progress.stats.chars += Array.from(canonicalText(word.term)).length;
  progress.stats.totalMs += ms;
  progress.stats.streak = (progress.stats.streak || 0) + 1;
  progress.stats.bestStreak = Math.max(progress.stats.bestStreak || 0, progress.stats.streak || 0);
  progress.cursors[cursorKey] = (progress.cursors[cursorKey] || 0) + 1;
  progress.deckStats[dictId] = progress.deckStats[dictId] || { completed: 0, errors: 0 };
  progress.deckStats[dictId].completed += 1;
  progress.history.unshift({
    term: word.term,
    deckId: dictId,
    chapter: activeChapter(),
    at: new Date().toISOString()
  });
  progress.history = progress.history.slice(0, 30);

  saveProgress({ sync: true });
  window.setTimeout(async () => {
    await advanceWord();
    completionLock = false;
  }, 130);
}

async function advanceWord() {
  const cursorKey = currentCursorKey();
  if ((progress.cursors[cursorKey] || 0) >= activeChapterWords.length) {
    if (activeChapter() < currentChapterCount() - 1) {
      progress.chapters[progress.activeDeck] = activeChapter() + 1;
      progress.cursors[currentCursorKey()] = progress.cursors[currentCursorKey()] || 0;
    } else {
      progress.cursors[cursorKey] = 0;
      stopTyping();
    }
  }
  await loadActiveDictionary();
  speakCurrentWord();
}

function startTyping() {
  isTyping = true;
  if (!sessionStartedAt) sessionStartedAt = performance.now();
  clearInterval(sessionTimer);
  sessionTimer = window.setInterval(renderStats, 1000);
  renderWord();
}

function stopTyping() {
  isTyping = false;
  clearInterval(sessionTimer);
  sessionStartedAt = 0;
  el.typingInput.value = "";
}

function resetCurrentWord() {
  el.typingInput.value = "";
  clearTimeout(wrongResetTimer);
  focusInput();
}

function currentSessionMs() {
  return sessionStartedAt ? performance.now() - sessionStartedAt : 0;
}

function shakeWord() {
  el.letterRow.classList.remove("shake");
  void el.letterRow.offsetWidth;
  el.letterRow.classList.add("shake");
}

function saveProgress({ sync }) {
  ensureProgressShape();
  progress.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  markSaved("已保存");
  if (sync && account?.token) {
    clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => pushProgress().catch(showSyncError), 700);
  }
}

function markSaved(text) {
  el.saveState.textContent = text;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    el.saveState.textContent = "已保存";
  }, 1200);
}

async function restoreSession() {
  if (!account?.token) return;
  try {
    const data = await api("/api/me");
    account.user = data.user;
    localStorage.setItem(AUTH_KEY, JSON.stringify(account));
    mergeRemote(data.progress);
  } catch {
    account = null;
    localStorage.removeItem(AUTH_KEY);
    renderAccount();
  }
}

async function syncNow({ manual }) {
  if (!account?.token) {
    openAuth();
    return;
  }
  if (manual) markSaved("同步中");
  try {
    const data = await api("/api/progress");
    const previousDeck = progress.activeDeck;
    mergeRemote(data.progress);
    if (previousDeck !== progress.activeDeck) await loadActiveDictionary();
    await pushProgress();
    markSaved("已同步");
  } catch (error) {
    showSyncError(error);
  }
}

function mergeRemote(remoteProgress) {
  if (!remoteProgress) return;
  const remoteTime = Date.parse(remoteProgress.updatedAt || 0);
  const localTime = Date.parse(progress.updatedAt || 0);
  const remoteWords = remoteProgress.stats?.words || 0;
  const localWords = progress.stats?.words || 0;
  if (remoteTime > localTime || remoteWords > localWords) {
    progress = { ...defaultProgress(), ...remoteProgress };
    ensureProgressShape();
    normalizeActiveDictionary();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }
}

async function pushProgress() {
  if (!account?.token) return;
  markSaved("同步中");
  const data = await api("/api/progress", {
    method: "PUT",
    body: JSON.stringify({ progress })
  });
  if (data.progress) {
    progress = { ...defaultProgress(), ...data.progress };
    ensureProgressShape();
    normalizeActiveDictionary();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }
  markSaved("已同步");
}

function showSyncError(error) {
  markSaved("同步失败");
  console.warn(error);
}

async function api(path, options = {}) {
  const headers = {
    "content-type": "application/json",
    ...(options.headers || {})
  };
  if (account?.token) {
    headers.authorization = `Bearer ${account.token}`;
  }
  const response = await fetch(path, {
    ...options,
    headers
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function onAccountClick() {
  if (!account?.token) {
    openAuth();
    return;
  }
  if (confirm("退出当前账号？")) {
    account = null;
    localStorage.removeItem(AUTH_KEY);
    renderAccount();
    markSaved("已退出");
  }
}

function openAuth() {
  setAuthMode("login");
  el.authMessage.textContent = "";
  el.passwordInput.value = "";
  if (typeof el.authDialog.showModal === "function") {
    el.authDialog.showModal();
  } else {
    el.authDialog.setAttribute("open", "");
  }
  window.setTimeout(() => el.usernameInput.focus(), 80);
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  el.authTitle.textContent = isLogin ? "登录" : "注册";
  el.authSubmit.textContent = isLogin ? "登录" : "注册";
  el.loginTab.classList.toggle("active", isLogin);
  el.signupTab.classList.toggle("active", !isLogin);
  el.passwordInput.autocomplete = isLogin ? "current-password" : "new-password";
  el.authMessage.textContent = "";
}

async function submitAuth(event) {
  event.preventDefault();
  el.authSubmit.disabled = true;
  el.authMessage.textContent = "";
  try {
    const payload = {
      username: el.usernameInput.value.trim(),
      password: el.passwordInput.value
    };
    const data = await api(authMode === "login" ? "/api/login" : "/api/signup", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    account = { token: data.token, user: data.user };
    localStorage.setItem(AUTH_KEY, JSON.stringify(account));
    if (shouldPushLocal(data.progress)) {
      await pushProgress();
    } else {
      mergeRemote(data.progress);
      await loadActiveDictionary();
    }
    el.authDialog.close();
    renderAccount();
    markSaved("已登录");
  } catch (error) {
    el.authMessage.textContent = error.message;
  } finally {
    el.authSubmit.disabled = false;
  }
}

function shouldPushLocal(remoteProgress) {
  const localWords = progress.stats?.words || 0;
  const remoteWords = remoteProgress?.stats?.words || 0;
  const localTime = Date.parse(progress.updatedAt || 0);
  const remoteTime = Date.parse(remoteProgress?.updatedAt || 0);
  return localWords > remoteWords || localTime > remoteTime;
}

function toggleSound() {
  progress.settings.sound = !progress.settings.sound;
  saveProgress({ sync: true });
  renderAll();
  if (progress.settings.sound) speakCurrentWord();
}

function speakCurrentWord() {
  if (!progress.settings.sound || !currentWord() || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(currentWord().term);
  utterance.lang = activeDictionary()?.languageCategory === "en" ? "en-US" : "en-US";
  utterance.rate = 0.92;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function resetProgress() {
  if (!confirm("重置当前浏览器里的练习进度？")) return;
  progress = defaultProgress();
  ensureProgressShape();
  stopTyping();
  saveProgress({ sync: true });
  normalizeActiveDictionary();
  loadActiveDictionary();
}

function exportProgress() {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          app: "Qwerty Learner Sync",
          exportedAt: new Date().toISOString(),
          progress
        },
        null,
        2
      )
    ],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `qwerty-learner-sync-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function importProgress() {
  const file = el.importFile.files?.[0];
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    progress = { ...defaultProgress(), ...(json.progress || json) };
    ensureProgressShape();
    normalizeActiveDictionary();
    stopTyping();
    saveProgress({ sync: true });
    await loadActiveDictionary();
    markSaved("已导入");
  } catch {
    markSaved("导入失败");
  } finally {
    el.importFile.value = "";
  }
}

function focusInput() {
  if (document.activeElement !== el.typingInput) {
    el.typingInput.focus({ preventScroll: true });
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;
  if (location.hostname.includes("cdn.jsdelivr.net")) return;
  navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)).catch(() => {});
}
