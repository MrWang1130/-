(function () {
  const ACCOUNT_KEY = "qwerty.accounts.v1";
  const SESSION_KEY = "qwerty.session.v1";
  const SNAPSHOT_PREFIX = "qwerty.snapshot.";
  const APP_STATE_KEYS = ["state"];

  const readJson = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  };

  const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  const digest = async (value) => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };

  const getAccounts = () => readJson(ACCOUNT_KEY, {});
  const getSession = () => readJson(SESSION_KEY, null);

  const saveSnapshot = (username) => {
    if (!username) return;
    const snapshot = {};
    APP_STATE_KEYS.forEach((key) => {
      const value = localStorage.getItem(key);
      if (value != null) snapshot[key] = value;
    });
    writeJson(`${SNAPSHOT_PREFIX}${username}`, { savedAt: new Date().toISOString(), snapshot });
  };

  const restoreSnapshot = (username) => {
    const saved = readJson(`${SNAPSHOT_PREFIX}${username}`, null);
    if (!saved?.snapshot) return;
    Object.entries(saved.snapshot).forEach(([key, value]) => localStorage.setItem(key, value));
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
          <button type="button" data-mode="signup">注册</button>
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

  const setMode = (nextMode) => {
    mode = nextMode;
    el.title.textContent = mode === "login" ? "登录" : "注册";
    el.submit.textContent = mode === "login" ? "登录" : "注册";
    el.message.textContent = "";
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

  el.open.addEventListener("click", () => {
    render();
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
    const username = el.username.value.trim();
    const password = el.password.value;
    if (!username || !password) return;
    const accounts = getAccounts();
    const passwordHash = await digest(password);

    if (mode === "signup") {
      if (accounts[username]) {
        el.message.textContent = "这个用户名已经注册";
        return;
      }
      accounts[username] = { passwordHash, createdAt: new Date().toISOString() };
      writeJson(ACCOUNT_KEY, accounts);
      writeJson(SESSION_KEY, { username, loginAt: new Date().toISOString() });
      saveSnapshot(username);
      el.panel.dataset.open = "false";
      render();
      return;
    }

    if (!accounts[username] || accounts[username].passwordHash !== passwordHash) {
      el.message.textContent = "用户名或密码不正确";
      return;
    }
    writeJson(SESSION_KEY, { username, loginAt: new Date().toISOString() });
    restoreSnapshot(username);
    el.panel.dataset.open = "false";
    render();
  });

  el.save.addEventListener("click", () => {
    const session = getSession();
    saveSnapshot(session?.username);
    el.userText.textContent = session ? `已保存：${session.username}` : "";
  });

  el.logout.addEventListener("click", () => {
    const session = getSession();
    saveSnapshot(session?.username);
    localStorage.removeItem(SESSION_KEY);
    el.panel.dataset.open = "false";
    render();
  });

  window.addEventListener("beforeunload", () => {
    saveSnapshot(getSession()?.username);
  });

  setMode("login");
  render();
})();
