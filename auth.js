(function () {
  const SESSION_KEY = "qwerty.remote.session.v1";
  const APP_STATE_KEYS = ["state"];
  const DEFAULT_API_BASE = "https://api.wk113.xyz";
  const API_BASE = String(window.QWERTY_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");

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
      throw new Error("后端还没有部署成功，暂时不能注册或登录。");
    }

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      throw new Error(data.error || "请求失败，请稍后再试。");
    }
    return data;
  };

  const collectProgress = () => {
    const items = {};
    APP_STATE_KEYS.forEach((key) => {
      const value = localStorage.getItem(key);
      if (value != null) items[key] = value;
    });
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      items
    };
  };

  const applyProgress = (progress) => {
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

  const saveRemoteProgress = async () => {
    const session = getSession();
    if (!session?.token) return null;
    return apiRequest("/api/progress", {
      method: "PUT",
      body: { progress: collectProgress() }
    });
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
          <button class="ql-auth-submit" type="submit" id="qlAuthSubmit">登录</button>
        </form>
        <div class="ql-auth-user" id="qlAuthUser">
          <p id="qlAuthUserText"></p>
          <button class="ql-auth-secondary" type="button" id="qlAuthSave">保存当前进度</button>
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
    el.submit.textContent = mode === "login" ? "登录" : "注册";
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
    const changed = applyProgress(data.progress);
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
      await saveRemoteProgress();
      const session = getSession();
      el.userText.textContent = session ? `已保存：${session.username}` : "";
    } catch (error) {
      el.userText.textContent = error.message || "保存失败。";
    } finally {
      setBusy(false);
    }
  });

  el.logout.addEventListener("click", async () => {
    try {
      await saveRemoteProgress();
      await apiRequest("/api/auth/logout", { method: "POST", body: {} });
    } catch {
      // Logging out locally should still work when the network is unavailable.
    }
    clearSession();
    el.panel.dataset.open = "false";
    render();
  });

  window.addEventListener("beforeunload", () => {
    const session = getSession();
    if (!session?.token) return;
    fetch(apiUrl("/api/progress"), {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify({ progress: collectProgress() }),
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
      applyProgress(data.progress);
    } catch {
      clearSession();
    }
    render();
  };

  setMode("login");
  boot();
})();
