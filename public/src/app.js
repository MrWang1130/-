const MANIFEST_URL = new URL("./dictionaries.json", import.meta.url).toString();
const STORAGE_KEY = "qwerty-learner.full.progress.v1";
const DEFAULT_DICT_ID = "cet4";

const LANGUAGES = [
  { id: "en", label: "英语" },
  { id: "ja", label: "日语" },
  { id: "de", label: "德语" },
  { id: "kk", label: "哈萨克语" },
  { id: "id", label: "印尼语" },
  { id: "code", label: "Code" }
];

const EN_PRIMARY = ["大学英语", "考研", "专业英语", "PET", "自考英语二", "其他"];
const EN_SECONDARY = ["TOEFL", "PET", "GMAT", "GRE", "IELTS", "KET", "SAT", "BEC", "PTE", "TOEIC", "CEFR", "牛津版", "其他", "FCE"];
const CODE_GROUPS = ["全部", "JavaScript", "Python", "Java", "C#", "Go", "Rust", "Node", "SQL", "少儿编程", "其他"];
const COLLEGE_ORDER = [
  "cet4",
  "cet6",
  "xinghuoqiaoji_4",
  "xinghuoqiaoji_6",
  "cet4-sub",
  "cet6-sub",
  "level4",
  "level8",
  "3000_ClassRoom_English_Words"
];

const $ = (selector) => document.querySelector(selector);
const el = {
  galleryView: $("#galleryView"),
  practiceView: $("#practiceView"),
  languageTabs: $("#languageTabs"),
  primaryGroupTabs: $("#primaryGroupTabs"),
  secondaryGroupTabs: $("#secondaryGroupTabs"),
  dictionaryGrid: $("#dictionaryGrid"),
  openGalleryButton: $("#openGalleryButton"),
  chapterButton: $("#chapterButton"),
  accentButton: $("#accentButton"),
  soundButton: $("#soundButton"),
  shuffleButton: $("#shuffleButton"),
  wordVisibleButton: $("#wordVisibleButton"),
  translationButton: $("#translationButton"),
  listButton: $("#listButton"),
  statsButton: $("#statsButton"),
  themeButton: $("#themeButton"),
  keyboardButton: $("#keyboardButton"),
  settingsButton: $("#settingsButton"),
  startButton: $("#startButton"),
  backToGalleryButton: $("#backToGalleryButton"),
  deckName: $("#deckName"),
  wordIndex: $("#wordIndex"),
  letterRow: $("#letterRow"),
  startOverlay: $("#startOverlay"),
  pronounceButton: $("#pronounceButton"),
  phonetic: $("#phonetic"),
  definition: $("#definition"),
  typingInput: $("#typingInput"),
  deckProgress: $("#deckProgress"),
  timeUsed: $("#timeUsed"),
  inputCount: $("#inputCount"),
  speed: $("#speed"),
  correctCount: $("#correctCount"),
  accuracy: $("#accuracy"),
  keyboard: $("#keyboard"),
  syncLine: $("#syncLine"),
  saveState: $("#saveState"),
  exportButton: $("#exportButton"),
  importButton: $("#importButton"),
  importFile: $("#importFile"),
  resetButton: $("#resetButton"),
  chapterDialog: $("#chapterDialog"),
  chapterGrid: $("#chapterGrid"),
  closeChapterDialog: $("#closeChapterDialog"),
  listDialog: $("#listDialog"),
  wordList: $("#wordList"),
  closeListDialog: $("#closeListDialog")
};

let manifest = null;
let dictionaries = [];
let dictionaryCache = new Map();
let activeLanguage = "en";
let activePrimary = "大学英语";
let activeSecondary = null;
let activeDictId = DEFAULT_DICT_ID;
let activeWords = [];
let chapterWords = [];
let currentIndex = 0;
let isTyping = false;
let isLoading = false;
let sessionStartedAt = 0;
let timerId = 0;
let wrongResetTimer = 0;
let progress = loadProgress();

init();

async function init() {
  bindEvents();
  renderKeyboard();
  renderShellState();
  await loadManifest();
  restoreLastDictionary();
  renderGallery();
  if (location.hash.startsWith("#practice")) {
    await openPractice(activeDictId);
  }
}

function bindEvents() {
  el.openGalleryButton.addEventListener("click", showGallery);
  el.backToGalleryButton.addEventListener("click", showGallery);
  el.chapterButton.addEventListener("click", openChapterDialog);
  el.closeChapterDialog.addEventListener("click", () => el.chapterDialog.close());
  el.listButton.addEventListener("click", openWordList);
  el.closeListDialog.addEventListener("click", () => el.listDialog.close());
  el.pronounceButton.addEventListener("click", speakCurrentWord);
  el.soundButton.addEventListener("click", () => toggleSetting("sound"));
  el.shuffleButton.addEventListener("click", () => toggleSetting("shuffle"));
  el.wordVisibleButton.addEventListener("click", () => toggleSetting("showWord"));
  el.translationButton.addEventListener("click", () => toggleSetting("showTranslation"));
  el.statsButton.addEventListener("click", () => toggleSetting("showStats"));
  el.themeButton.addEventListener("click", () => toggleSetting("dark"));
  el.keyboardButton.addEventListener("click", () => toggleSetting("showKeyboard"));
  el.settingsButton.addEventListener("click", () => alert("设置已在工具栏中展开：发音、随机、隐藏、翻译、统计、主题、键盘。"));
  el.startButton.addEventListener("click", startTyping);
  el.typingInput.addEventListener("input", onInput);
  el.typingInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && inputIsComplete()) {
      event.preventDefault();
      completeWord();
    }
  });
  el.exportButton.addEventListener("click", exportProgress);
  el.importButton.addEventListener("click", () => el.importFile.click());
  el.importFile.addEventListener("change", importProgress);
  el.resetButton.addEventListener("click", resetProgress);
  document.addEventListener("keydown", (event) => {
    if (el.practiceView.classList.contains("is-hidden")) return;
    if (event.target === el.typingInput) return;
    if (event.key.length === 1 || event.key === "Backspace") {
      startTyping();
      el.typingInput.focus({ preventScroll: true });
    }
  });
}

async function loadManifest() {
  const response = await fetch(MANIFEST_URL, { cache: "no-cache" });
  if (!response.ok) throw new Error("词库目录加载失败");
  manifest = await response.json();
  dictionaries = manifest.dictionaries || [];
}

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      activeDictId: DEFAULT_DICT_ID,
      chapters: {},
      cursors: {},
      stats: { words: 0, chars: 0, errors: 0, totalMs: 0 },
      settings: {
        sound: true,
        shuffle: false,
        showWord: true,
        showTranslation: true,
        showStats: true,
        showKeyboard: true,
        dark: false
      },
      ...saved
    };
  } catch {
    return {
      activeDictId: DEFAULT_DICT_ID,
      chapters: {},
      cursors: {},
      stats: { words: 0, chars: 0, errors: 0, totalMs: 0 },
      settings: {
        sound: true,
        shuffle: false,
        showWord: true,
        showTranslation: true,
        showStats: true,
        showKeyboard: true,
        dark: false
      }
    };
  }
}

function saveProgress() {
  progress.activeDictId = activeDictId;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  el.saveState.textContent = "已保存";
}

function restoreLastDictionary() {
  if (dictionaries.some((dict) => dict.id === progress.activeDictId)) {
    activeDictId = progress.activeDictId;
  }
  const dict = getDict(activeDictId);
  if (dict) {
    activeLanguage = dict.languageCategory;
    activePrimary = classifyPrimary(dict);
  }
}

function renderGallery() {
  renderLanguageTabs();
  renderPrimaryGroups();
  renderSecondaryGroups();
  renderDictionaryGrid();
}

function renderLanguageTabs() {
  el.languageTabs.textContent = "";
  LANGUAGES.filter((lang) => dictionaries.some((dict) => dict.languageCategory === lang.id)).forEach((lang) => {
    const button = document.createElement("button");
    button.className = `language-tab ${lang.id === activeLanguage ? "active" : ""}`;
    button.type = "button";
    button.innerHTML = `<span class="flag flag-${lang.id}" aria-hidden="true"></span>${lang.label}`;
    button.addEventListener("click", () => {
      activeLanguage = lang.id;
      activeSecondary = null;
      activePrimary = defaultPrimaryForLanguage(lang.id);
      renderGallery();
    });
    el.languageTabs.append(button);
  });
}

function renderPrimaryGroups() {
  const groups = primaryGroupsForLanguage(activeLanguage);
  if (!groups.includes(activePrimary)) activePrimary = groups[0];
  el.primaryGroupTabs.textContent = "";
  groups.forEach((group) => {
    const button = document.createElement("button");
    button.className = `group-tab ${group === activePrimary && !activeSecondary ? "active" : ""}`;
    button.type = "button";
    button.textContent = group;
    button.addEventListener("click", () => {
      activePrimary = group;
      activeSecondary = null;
      renderGallery();
    });
    el.primaryGroupTabs.append(button);
  });
}

function renderSecondaryGroups() {
  el.secondaryGroupTabs.textContent = "";
  const groups = activeLanguage === "en" ? EN_SECONDARY : activeLanguage === "code" ? CODE_GROUPS.slice(1) : [];
  groups.forEach((group, index) => {
    const button = document.createElement("button");
    button.className = `group-tab ${group === activeSecondary || (!activeSecondary && index === 0) ? "active" : ""}`;
    button.type = "button";
    button.textContent = group;
    button.addEventListener("click", () => {
      activeSecondary = group;
      activePrimary = activeLanguage === "code" ? "全部" : activePrimary;
      renderGallery();
    });
    el.secondaryGroupTabs.append(button);
  });
}

function renderDictionaryGrid() {
  el.dictionaryGrid.textContent = "";
  const items = filteredDictionaries().slice(0, 80);
  items.forEach((dict) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dict-card";
    button.innerHTML = `<h3>${escapeHtml(dict.name)}</h3><p>${escapeHtml(dict.description || dict.category || "")}</p><strong>${dict.length || 0} 词</strong>`;
    button.addEventListener("click", () => openPractice(dict.id));
    el.dictionaryGrid.append(button);
  });
}

function filteredDictionaries() {
  const base = dictionaries.filter((dict) => dict.languageCategory === activeLanguage);
  let result;
  if (activeSecondary) {
    result = base.filter((dict) => classifySecondary(dict) === activeSecondary);
  } else {
    result = base.filter((dict) => classifyPrimary(dict) === activePrimary);
  }
  return sortDictionaries(result);
}

function sortDictionaries(items) {
  return [...items].sort((a, b) => {
    const ai = COLLEGE_ORDER.indexOf(a.id);
    const bi = COLLEGE_ORDER.indexOf(b.id);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return (a.name || "").localeCompare(b.name || "", "zh-Hans-CN");
  });
}

function primaryGroupsForLanguage(language) {
  if (language === "en") return EN_PRIMARY;
  if (language === "code") return CODE_GROUPS;
  const names = [...new Set(dictionaries.filter((dict) => dict.languageCategory === language).map((dict) => normalizeCategoryName(dict.category)))];
  return names.length ? names : ["全部"];
}

function defaultPrimaryForLanguage(language) {
  if (language === "en") return "大学英语";
  if (language === "code") return "全部";
  return primaryGroupsForLanguage(language)[0];
}

function classifyPrimary(dict) {
  if (dict.languageCategory === "code") {
    const group = classifyCode(dict);
    return CODE_GROUPS.includes(group) ? group : "其他";
  }
  if (dict.languageCategory !== "en") return normalizeCategoryName(dict.category);
  const text = `${dict.id} ${dict.name} ${dict.description} ${dict.category}`.toLowerCase();
  if (COLLEGE_ORDER.includes(dict.id)) return "大学英语";
  if (/kaoyan|考研|926|hongbao|english_ii|dancimimi|shanguo/.test(text)) return "考研";
  if (/arch|biomedical|itvocabulary|xueshiyingyu|专业|medical|architecture/.test(text)) return "专业英语";
  if (/pets|pet/.test(text)) return "PET";
  if (/self-study|自考|adult-self/.test(text)) return "自考英语二";
  return "其他";
}

function classifySecondary(dict) {
  const text = `${dict.id} ${dict.name} ${dict.description} ${dict.category}`.toLowerCase();
  if (/toefl/.test(text)) return "TOEFL";
  if (/fce/.test(text)) return "FCE";
  if (/gmat/.test(text)) return "GMAT";
  if (/gre/.test(text)) return "GRE";
  if (/ielts/.test(text)) return "IELTS";
  if (/ket/.test(text)) return "KET";
  if (/sat/.test(text)) return "SAT";
  if (/bec/.test(text)) return "BEC";
  if (/pte/.test(text)) return "PTE";
  if (/toeic/.test(text)) return "TOEIC";
  if (/cefr|ef_level/.test(text)) return "CEFR";
  if (/oxford|牛津/.test(text)) return "牛津版";
  if (/pets|pet/.test(text)) return "PET";
  return "其他";
}

function classifyCode(dict) {
  const text = `${dict.id} ${dict.name}`.toLowerCase();
  if (/javascript|js-/.test(text)) return "JavaScript";
  if (/python/.test(text)) return "Python";
  if (/java/.test(text)) return "Java";
  if (/csharp|c#/.test(text)) return "C#";
  if (/go/.test(text)) return "Go";
  if (/rust/.test(text)) return "Rust";
  if (/node/.test(text)) return "Node";
  if (/sql/.test(text)) return "SQL";
  if (/child|少儿/.test(text)) return "少儿编程";
  return "其他";
}

function normalizeCategoryName(value) {
  return value || "全部";
}

async function openPractice(dictId) {
  activeDictId = dictId;
  const dict = getDict(dictId);
  if (!dict) return;
  activeLanguage = dict.languageCategory;
  activePrimary = classifyPrimary(dict);
  activeSecondary = null;
  showPractice();
  await loadDictionary(dict);
  renderPractice();
  saveProgress();
  location.hash = "practice";
}

function showPractice() {
  el.galleryView.classList.add("is-hidden");
  el.practiceView.classList.remove("is-hidden");
  setTimeout(() => el.typingInput.focus({ preventScroll: true }), 60);
}

function showGallery() {
  stopTyping();
  el.practiceView.classList.add("is-hidden");
  el.galleryView.classList.remove("is-hidden");
  location.hash = "";
  renderGallery();
}

async function loadDictionary(dict) {
  isLoading = true;
  el.deckName.textContent = "加载词库";
  if (!dictionaryCache.has(dict.id)) {
    const url = `${manifest.dictionaryBaseUrl}${dict.url}`;
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) throw new Error(`词库加载失败：${dict.name}`);
    const raw = await response.json();
    dictionaryCache.set(dict.id, normalizeWords(raw));
  }
  activeWords = dictionaryCache.get(dict.id);
  buildChapterWords();
  isLoading = false;
}

function normalizeWords(rawWords) {
  return (Array.isArray(rawWords) ? rawWords : [])
    .map((item) => {
      const term = normalizeTerm(item.name || item.word || item.term || "");
      const trans = Array.isArray(item.trans) ? item.trans : item.trans ? [item.trans] : [];
      return {
        term,
        phonetic: item.usphone || item.ukphone || item.phone || "",
        definition: trans.join("；")
      };
    })
    .filter((item) => item.term);
}

function buildChapterWords() {
  const dict = getDict(activeDictId);
  const chapter = activeChapter();
  const size = manifest.chapterSize || 20;
  const start = chapter * size;
  chapterWords = activeWords.slice(start, start + size);
  if (progress.settings.shuffle) chapterWords = seededShuffle(chapterWords, `${dict.id}:${chapter}`);
  currentIndex = Math.min(progress.cursors[cursorKey()] || 0, Math.max(0, chapterWords.length - 1));
  el.typingInput.value = "";
}

function renderPractice() {
  const dict = getDict(activeDictId);
  const chapter = activeChapter();
  const word = currentWord();
  el.openGalleryButton.textContent = dict.name;
  el.chapterButton.textContent = `第 ${chapter + 1} 章`;
  el.deckName.textContent = `${dict.name} · 第 ${chapter + 1} 章`;
  el.wordIndex.textContent = chapterWords.length ? `${currentIndex + 1} / ${chapterWords.length}` : "0 / 0";
  el.startButton.textContent = isTyping ? "Stop" : "Start";
  el.startOverlay.classList.toggle("is-hidden", isTyping);
  el.soundButton.classList.toggle("active", progress.settings.sound);
  el.shuffleButton.classList.toggle("active", progress.settings.shuffle);
  el.wordVisibleButton.classList.toggle("active", progress.settings.showWord);
  el.translationButton.classList.toggle("active", progress.settings.showTranslation);
  el.statsButton.classList.toggle("active", progress.settings.showStats);
  el.keyboardButton.classList.toggle("active", progress.settings.showKeyboard);
  el.keyboard.classList.toggle("is-hidden", !progress.settings.showKeyboard);
  document.body.classList.toggle("dark", progress.settings.dark);
  renderWord(word);
  renderStats();
}

function renderWord(word) {
  el.letterRow.textContent = "";
  if (!word) {
    el.definition.textContent = "当前章节没有单词";
    return;
  }
  const typed = Array.from(canonical(el.typingInput.value));
  const target = Array.from(canonical(word.term));
  Array.from(word.term).forEach((letter, index) => {
    const span = document.createElement("span");
    span.textContent = letter === " " ? "␣" : letter;
    if (typed[index] != null) {
      span.className = typed[index] === target[index] ? "correct" : "wrong";
    } else {
      span.className = "pending";
    }
    el.letterRow.append(span);
  });
  el.letterRow.classList.toggle("hide-letters", !progress.settings.showWord);
  el.phonetic.textContent = word.phonetic ? `/${word.phonetic.replace(/^\/|\/$/g, "")}/` : "";
  el.definition.textContent = progress.settings.showTranslation ? word.definition : "";
  el.deckProgress.style.width = `${chapterWords.length ? Math.floor((currentIndex / chapterWords.length) * 100) : 0}%`;
}

function renderStats() {
  const stats = progress.stats;
  const ms = sessionStartedAt ? performance.now() - sessionStartedAt : 0;
  const seconds = Math.floor(ms / 1000);
  const inputs = (stats.chars || 0) + (stats.errors || 0);
  const wpm = ms > 0 ? Math.round((stats.words || 0) / Math.max(1 / 60, ms / 60000)) : 0;
  const accuracy = inputs ? Math.max(0, Math.round(((stats.chars || 0) / inputs) * 100)) : 100;
  el.timeUsed.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  el.inputCount.textContent = String(inputs);
  el.speed.textContent = String(wpm);
  el.correctCount.textContent = String(stats.chars || 0);
  el.accuracy.textContent = `${accuracy}%`;
  document.querySelector(".speed-card").classList.toggle("is-hidden", !progress.settings.showStats);
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
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = key;
      if (key.length > 1) button.className = "wide-key";
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        if (key === "清空") el.typingInput.value = "";
        else if (key === "<-") el.typingInput.value = el.typingInput.value.slice(0, -1);
        else if (key === "空格") el.typingInput.value += " ";
        else el.typingInput.value += key;
        onInput();
        el.typingInput.focus({ preventScroll: true });
      });
      rowEl.append(button);
    });
    el.keyboard.append(rowEl);
  });
}

function onInput() {
  if (isLoading || !currentWord()) return;
  startTyping();
  clearTimeout(wrongResetTimer);
  if (firstWrongIndex() !== -1) {
    progress.stats.errors += 1;
    shakeWord();
    wrongResetTimer = window.setTimeout(() => {
      el.typingInput.value = "";
      renderPractice();
    }, 300);
    saveProgress();
    renderPractice();
    return;
  }
  renderPractice();
  if (inputIsComplete()) completeWord();
}

function startTyping() {
  if (isTyping) return;
  isTyping = true;
  sessionStartedAt = sessionStartedAt || performance.now();
  clearInterval(timerId);
  timerId = window.setInterval(renderStats, 1000);
  renderPractice();
  speakCurrentWord();
}

function stopTyping() {
  isTyping = false;
  clearInterval(timerId);
  el.typingInput.value = "";
  renderPractice();
}

function completeWord() {
  const word = currentWord();
  if (!word) return;
  progress.stats.words += 1;
  progress.stats.chars += Array.from(canonical(word.term)).length;
  progress.stats.totalMs += sessionStartedAt ? performance.now() - sessionStartedAt : 0;
  currentIndex += 1;
  progress.cursors[cursorKey()] = currentIndex;
  if (currentIndex >= chapterWords.length) {
    if (activeChapter() + 1 < chapterCount()) {
      progress.chapters[activeDictId] = activeChapter() + 1;
    } else {
      progress.cursors[cursorKey()] = 0;
    }
    buildChapterWords();
  }
  saveProgress();
  el.typingInput.value = "";
  renderPractice();
  speakCurrentWord();
}

function firstWrongIndex() {
  const typed = Array.from(canonical(el.typingInput.value));
  const target = Array.from(canonical(currentWord()?.term || ""));
  for (let index = 0; index < typed.length; index += 1) {
    if (typed[index] !== target[index]) return index;
  }
  return -1;
}

function inputIsComplete() {
  const typed = Array.from(canonical(el.typingInput.value));
  const target = Array.from(canonical(currentWord()?.term || ""));
  return target.length > 0 && typed.length === target.length && typed.every((char, index) => char === target[index]);
}

function openChapterDialog() {
  el.chapterGrid.textContent = "";
  for (let index = 0; index < chapterCount(); index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `第 ${index + 1} 章`;
    button.className = index === activeChapter() ? "active" : "";
    button.addEventListener("click", () => {
      progress.chapters[activeDictId] = index;
      buildChapterWords();
      renderPractice();
      saveProgress();
      el.chapterDialog.close();
    });
    el.chapterGrid.append(button);
  }
  el.chapterDialog.showModal();
}

function openWordList() {
  el.wordList.textContent = "";
  chapterWords.forEach((word) => {
    const item = document.createElement("li");
    item.textContent = `${word.term} ${word.definition ? "· " + word.definition : ""}`;
    el.wordList.append(item);
  });
  el.listDialog.showModal();
}

function toggleSetting(key) {
  progress.settings[key] = !progress.settings[key];
  if (key === "shuffle") buildChapterWords();
  saveProgress();
  renderPractice();
}

function speakCurrentWord() {
  if (!progress.settings.sound || !("speechSynthesis" in window) || !currentWord()) return;
  const utterance = new SpeechSynthesisUtterance(currentWord().term);
  utterance.lang = accentLanguage();
  utterance.rate = 0.92;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function accentLanguage() {
  const dict = getDict(activeDictId);
  if (dict?.languageCategory === "ja") return "ja-JP";
  if (dict?.languageCategory === "de") return "de-DE";
  if (dict?.languageCategory === "id") return "id-ID";
  return "en-US";
}

function exportProgress() {
  const blob = new Blob([JSON.stringify(progress, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `qwerty-progress-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function importProgress() {
  const file = el.importFile.files?.[0];
  if (!file) return;
  try {
    progress = { ...loadProgress(), ...JSON.parse(await file.text()) };
    activeDictId = progress.activeDictId || DEFAULT_DICT_ID;
    await openPractice(activeDictId);
    saveProgress();
  } finally {
    el.importFile.value = "";
  }
}

function resetProgress() {
  if (!confirm("重置当前浏览器的学习进度？")) return;
  localStorage.removeItem(STORAGE_KEY);
  progress = loadProgress();
  activeDictId = DEFAULT_DICT_ID;
  location.hash = "";
  showGallery();
}

function renderShellState() {
  document.body.classList.toggle("dark", progress.settings.dark);
  el.syncLine.textContent = "本地进度";
}

function getDict(id) {
  return dictionaries.find((dict) => dict.id === id);
}

function activeChapter() {
  return Math.max(0, Number(progress.chapters[activeDictId] || 0));
}

function chapterCount() {
  return Math.max(1, Math.ceil(activeWords.length / (manifest?.chapterSize || 20)));
}

function cursorKey() {
  return `${activeDictId}:${activeChapter()}`;
}

function currentWord() {
  return chapterWords[currentIndex] || null;
}

function normalizeTerm(value) {
  return String(value).trim().replace(/\s+/g, " ").replace(/[‘’`]/g, "'").replace(/[“”]/g, '"');
}

function canonical(value) {
  return normalizeTerm(value).toLowerCase();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function shakeWord() {
  el.letterRow.classList.remove("shake");
  void el.letterRow.offsetWidth;
  el.letterRow.classList.add("shake");
}

function seededShuffle(items, seed) {
  const result = [...items];
  let state = 0;
  for (const char of seed) state = (state * 31 + char.charCodeAt(0)) >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    const swap = state % (index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}
