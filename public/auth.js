(function () {
  const SESSION_KEY = "qwerty.remote.session.v1";
  const APP_STATE_KEYS = [
    "state",
    "currentDict",
    "currentChapter",
    "isOpenDarkModeAtom",
    "isIgnoreCase",
    "isShowAnswerOnHover",
    "isShowPrevAndNextWord",
    "isTextSelectable",
    "reviewModeInfo",
    "hasSeenEnhancedPromotion"
  ];
  const DEFAULT_API_BASE = "https://api.wk113.xyz";
  const API_BASE = String(window.QWERTY_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
  const DB_NAME = "RecordDB";
  const DB_VERSION = 3;
  const DB_STORES = ["wordRecords", "chapterRecords", "reviewRecords"];
  const SAVE_DEBOUNCE_MS = 2500;
  const AUTO_SAVE_MS = 30000;

  const readJson = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  };

  const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const getSession = () => readJson(SESSION_KEY, null);

  const setSession = (payload) => {
    writeJson(SESSION_KEY, {
      token: payload.token,
      username: payload.user.username,
      loginAt: new Date().toISOString()
    });
  };

  const clearSession = () => localStorage.removeItem(SESSION_KEY);
  const apiUrl = (path) => `${API_BASE}${path}`;

  const apiRequest = async (path, options = {}) => {
    const session = getSession();
    const headers = {
      "content-type": "application/json",
      ...(options.headers || {})
    };
    if (session?.token) headers.authorization = `Bearer ${session.token}`;

    let response;
    try {
      response = await fetch(apiUrl(path), {
        ...options,
        headers,
        body: options.body == null ? undefined : JSON.stringify(options.body)
      });
    } catch {
      throw new Error("后端暂时无法访问，请稍后再试。");
    }

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) throw new Error(data.error || "请求失败，请稍后再试。");
    return data;
  };

  const createRecordStores = (db, transaction) => {
    const createStore = (name) => {
      if (db.objectStoreNames.contains(name)) return transaction.objectStore(name);
      return db.createObjectStore(name, { keyPath: "id", autoIncrement: true });
    };
    const createIndex = (store, name, keyPath) => {
      if (!store.indexNames.contains(name)) store.createIndex(name, keyPath);
    };

    const wordRecords = createStore("wordRecords");
    createIndex(wordRecords, "word", "word");
    createIndex(wordRecords, "timeStamp", "timeStamp");
    createIndex(wordRecords, "dict", "dict");
    createIndex(wordRecords, "chapter", "chapter");
    createIndex(wordRecords, "wrongCount", "wrongCount");
    createIndex(wordRecords, "[dict+chapter]", ["dict", "chapter"]);

    const chapterRecords = createStore("chapterRecords");
    createIndex(chapterRecords, "timeStamp", "timeStamp");
    createIndex(chapterRecords, "dict", "dict");
    createIndex(chapterRecords, "chapter", "chapter");
    createIndex(chapterRecords, "time", "time");
    createIndex(chapterRecords, "[dict+chapter]", ["dict", "chapter"]);

    const reviewRecords = createStore("reviewRecords");
    createIndex(reviewRecords, "dict", "dict");
    createIndex(reviewRecords, "createTime", "createTime");
    createIndex(reviewRecords, "isFinished", "isFinished");
  };

  const openRecordDb = () =>
    new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => createRecordStores(request.result, request.transaction);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开学习记录数据库。"));
      request.onblocked = () => reject(new Error("学习记录数据库被其他页面占用，请关闭其他 Key World 页面后重试。"));
    });

  const requestToPromise = (request) =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

  const stableStringify = (value) => {
    if (value == null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  };

  const recordSignature = (record) => {
    const copy = { ...record };
    delete copy.id;
    return stableStringify(copy);
  };

  const readStore = async (db, storeName) => {
    if (!db || !db.objectStoreNames.contains(storeName)) return [];
    const tx = db.transaction(storeName, "readonly");
    return requestToPromise(tx.objectStore(storeName).getAll());
  };

  const writeMergedStore = async (db, storeName, remoteItems) => {
    if (!db || !db.objectStoreNames.contains(storeName) || !Array.isArray(remoteItems)) return false;
    if (remoteItems.length === 0) return false;

    const localItems = await readStore(db, storeName);
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    let changed = false;

    if (localItems.length === 0) {
      await requestToPromise(store.clear());
      for (const item of remoteItems) {
        await requestToPromise(store.put({ ...item }));
      }
      return remoteItems.length > 0;
    }

    const signatures = new Set(localItems.map(recordSignature));
    const localIds = new Set(localItems.map((item) => item.id).filter((id) => id != null));
    for (const item of remoteItems) {
      const signature = recordSignature(item);
      if (signatures.has(signature)) continue;
      const copy = { ...item };
      if (copy.id != null && localIds.has(copy.id)) delete copy.id;
      await requestToPromise(copy.id == null ? store.add(copy) : store.put(copy));
      signatures.add(signature);
      changed = true;
    }
    return changed;
  };

  const collectRecordDb = async () => {
    const db = await openRecordDb();
    if (!db) return { version: DB_VERSION, stores: {} };
    try {
      const stores = {};
      for (const storeName of DB_STORES) stores[storeName] = await readStore(db, storeName);
      return {
        version: DB_VERSION,
        exportedAt: new Date().toISOString(),
        stores
      };
    } finally {
      db.close();
    }
  };

  const applyRecordDb = async (recordDb) => {
    const stores = recordDb?.stores;
    if (!stores || typeof stores !== "object") return false;

    const db = await openRecordDb();
    if (!db) return false;
    try {
      let changed = false;
      for (const storeName of DB_STORES) {
        if (await writeMergedStore(db, storeName, stores[storeName])) changed = true;
      }
      return changed;
    } finally {
      db.close();
    }
  };

  const collectLocalStorage = () => {
    const items = {};
    APP_STATE_KEYS.forEach((key) => {
      const value = localStorage.getItem(key);
      if (value != null) items[key] = value;
    });
    return items;
  };

  const applyLocalStorage = (progress) => {
    const items = progress?.items || {};
    let changed = false;
    Object.entries(items).forEach(([key, value]) => {
      if (!APP_STATE_KEYS.includes(key) || typeof value !== "string") return;
      if (localStorage.getItem(key) !== value) {
        localStorage.setItem(key, value);
        changed = true;
      }
    });
    return changed;
  };

  const collectProgress = async () => {
    const recordDb = await collectRecordDb();
    const stores = recordDb.stores || {};
    return {
      version: 2,
      savedAt: new Date().toISOString(),
      items: collectLocalStorage(),
      recordDb,
      summary: {
        wordRecords: stores.wordRecords?.length || 0,
        chapterRecords: stores.chapterRecords?.length || 0,
        reviewRecords: stores.reviewRecords?.length || 0
      }
    };
  };

  const applyProgress = async (progress) => {
    const localChanged = applyLocalStorage(progress);
    const dbChanged = await applyRecordDb(progress?.recordDb);
    return localChanged || dbChanged;
  };

  let lastProgressBody = "";
  let saveTimer = 0;
  let savingPromise = null;

  const saveRemoteProgress = async () => {
    const session = getSession();
    if (!session?.token) return null;
    if (savingPromise) return savingPromise;

    savingPromise = (async () => {
      const progress = await collectProgress();
      lastProgressBody = JSON.stringify({ progress });
      return apiRequest("/api/progress", {
        method: "PUT",
        body: { progress }
      });
    })();

    try {
      return await savingPromise;
    } finally {
      savingPromise = null;
    }
  };

  const queueRemoteSave = () => {
    if (!getSession()?.token) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveRemoteProgress().catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  };

  const shell = document.createElement("ql-auth");
  shell.innerHTML = `
    <button class="ql-auth-button" type="button" id="qlAuthOpen">登录</button>
    <section class="ql-auth-panel" id="qlAuthPanel" aria-label="登录和注册">
      <div class="ql-auth-card">
        <div class="ql-auth-head">
          <h2 class="ql-auth-title" id="qlAuthTitle">登录</h2>
          <button class="ql-auth-close" type="button" id="qlAuthClose" aria-label="关闭">×</button>
        </div>
        <div class="ql-auth-tabs" id="qlAuthTabs">
          <button type="button" data-mode="login" data-active="true">登录</button>
          <button type="button" data-mode="register">注册</button>
        </div>
        <form class="ql-auth-form" id="qlAuthForm">
          <label>用户名<input id="qlAuthUsername" autocomplete="username" required /></label>
          <label>密码<input id="qlAuthPassword" type="password" autocomplete="current-password" required /></label>
          <div class="ql-auth-message" id="qlAuthMessage"></div>
          <button class="ql-auth-submit" type="submit" id="qlAuthSubmit">确认登录</button>
        </form>
        <div class="ql-auth-user" id="qlAuthUser">
          <p id="qlAuthUserText"></p>
          <button class="ql-auth-secondary" type="button" id="qlAuthSave">同步当前记录</button>
          <button class="ql-auth-secondary" type="button" id="qlAuthLogout">退出登录</button>
        </div>
      </div>
    </section>
  `;
  document.body.append(shell);

  const el = {
    open: document.getElementById("qlAuthOpen"),
    panel: document.getElementById("qlAuthPanel"),
    close: document.getElementById("qlAuthClose"),
    title: document.getElementById("qlAuthTitle"),
    tabs: document.getElementById("qlAuthTabs"),
    form: document.getElementById("qlAuthForm"),
    username: document.getElementById("qlAuthUsername"),
    password: document.getElementById("qlAuthPassword"),
    message: document.getElementById("qlAuthMessage"),
    submit: document.getElementById("qlAuthSubmit"),
    user: document.getElementById("qlAuthUser"),
    userText: document.getElementById("qlAuthUserText"),
    save: document.getElementById("qlAuthSave"),
    logout: document.getElementById("qlAuthLogout")
  };

  let mode = "login";
  let busy = false;

  const setBusy = (nextBusy) => {
    busy = nextBusy;
    el.submit.disabled = nextBusy;
    el.save.disabled = nextBusy;
  };

  const setMessage = (message, tone = "error") => {
    el.message.textContent = message;
    el.message.dataset.tone = tone;
  };

  const setMode = (nextMode) => {
    mode = nextMode;
    el.title.textContent = mode === "login" ? "登录" : "注册";
    el.submit.textContent = mode === "login" ? "确认登录" : "确认注册";
    setMessage("");
    el.tabs.querySelectorAll("button").forEach((button) => {
      button.dataset.active = String(button.dataset.mode === mode);
    });
  };

  const render = () => {
    const session = getSession();
    el.open.textContent = session?.username || "登录";
    el.form.style.display = session ? "none" : "grid";
    el.tabs.style.display = session ? "none" : "grid";
    el.user.dataset.open = String(Boolean(session));
    el.userText.textContent = session ? `已登录：${session.username}` : "";
  };

  const finishAuth = async (data) => {
    setSession(data);
    const changed = await applyProgress(data.progress);
    await saveRemoteProgress();
    render();
    el.panel.dataset.open = "false";
    if (changed) window.location.reload();
  };

  el.open.addEventListener("click", () => {
    render();
    setMessage("");
    el.panel.dataset.open = "true";
    if (!getSession()) setTimeout(() => el.username.focus(), 0);
  });

  el.close.addEventListener("click", () => {
    el.panel.dataset.open = "false";
  });

  el.panel.addEventListener("click", (event) => {
    if (event.target === el.panel) el.panel.dataset.open = "false";
  });

  el.tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-mode]");
    if (button) setMode(button.dataset.mode);
  });

  el.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const username = el.username.value.trim();
    const password = el.password.value;
    if (!username || !password) {
      setMessage("请输入用户名和密码。");
      return;
    }

    setBusy(true);
    setMessage("处理中...", "info");
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const data = await apiRequest(path, {
        method: "POST",
        body: { username, password }
      });
      await finishAuth(data);
    } catch (error) {
      setMessage(error.message || "登录失败，请稍后再试。");
    } finally {
      setBusy(false);
    }
  });

  el.save.addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await saveRemoteProgress();
      const session = getSession();
      const summary = data?.progress?.summary;
      const countText = summary
        ? `，学习记录 ${summary.wordRecords || 0} 条，章节记录 ${summary.chapterRecords || 0} 条，错题复习 ${summary.reviewRecords || 0} 条`
        : "";
      el.userText.textContent = session ? `已同步：${session.username}${countText}` : "";
    } catch (error) {
      el.userText.textContent = error.message || "同步失败。";
    } finally {
      setBusy(false);
    }
  });

  el.logout.addEventListener("click", async () => {
    try {
      await saveRemoteProgress();
      await apiRequest("/api/auth/logout", { method: "POST", body: {} });
    } catch {
      // Local logout should still work when the network is unavailable.
    }
    clearSession();
    el.panel.dataset.open = "false";
    render();
  });

  ["click", "pointerup", "keyup", "input", "change", "keyworld:mobile-input"].forEach((eventName) => {
    document.addEventListener(eventName, queueRemoteSave, true);
  });

  setInterval(() => {
    saveRemoteProgress().catch(() => {});
  }, AUTO_SAVE_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveRemoteProgress().catch(() => {});
  });

  window.addEventListener("beforeunload", () => {
    const session = getSession();
    if (!session?.token || !lastProgressBody) return;
    fetch(apiUrl("/api/progress"), {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.token}`
      },
      body: lastProgressBody,
      keepalive: true
    }).catch(() => {});
  });

  const boot = async () => {
    const session = getSession();
    if (!session?.token) {
      render();
      return;
    }
    try {
      const data = await apiRequest("/api/auth/me");
      setSession({ token: session.token, user: data.user });
      const changed = await applyProgress(data.progress);
      render();
      if (changed) window.location.reload();
    } catch {
      clearSession();
      render();
    }
  };

  window.__KEY_WORLD_SYNC__ = {
    collectProgress,
    saveRemoteProgress,
    applyProgress
  };

  setMode("login");
  boot();
})();
