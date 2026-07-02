const TOKEN_DAYS = 30;
const MAX_PROGRESS_BYTES = 1024 * 1024;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
      "access-control-allow-headers": "content-type,authorization"
    }
  });

const error = (message, status = 400) => json({ error: message }, status);

const normalizeUsername = (value) => String(value || "").trim().replace(/\s+/g, "_").slice(0, 32);
const usernameKey = (value) => normalizeUsername(value).toLowerCase();

const randomId = () => crypto.randomUUID();

const randomToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const sha256 = async (value) => {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const passwordHash = async (password, salt) => sha256(`${salt}:${password}`);

const parseBody = async (request) => {
  try {
    return await request.json();
  } catch {
    return {};
  }
};

const publicUser = (user) => ({
  id: user.id,
  username: user.username
});

const defaultProgress = () => ({
  version: 1,
  savedAt: new Date().toISOString(),
  items: {}
});

const parseProgress = (value) => {
  try {
    return JSON.parse(value || "");
  } catch {
    return defaultProgress();
  }
};

const sanitizeProgress = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultProgress();
  const progress = {
    version: 1,
    savedAt: typeof value.savedAt === "string" ? value.savedAt : new Date().toISOString(),
    items: {}
  };
  if (value.items && typeof value.items === "object" && !Array.isArray(value.items)) {
    for (const [key, itemValue] of Object.entries(value.items)) {
      if (typeof key === "string" && typeof itemValue === "string") {
        progress.items[key] = itemValue;
      }
    }
  }
  const serialized = JSON.stringify(progress);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PROGRESS_BYTES) {
    throw new Error("进度数据太大，保存失败。");
  }
  return progress;
};

const createSession = async (env, userId) => {
  const token = randomToken();
  const now = new Date();
  const expiresAt = Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000;
  await env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(token, userId, expiresAt, now.toISOString())
    .run();
  return token;
};

const getUserFromRequest = async (request, env) => {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT users.*
       FROM sessions
       JOIN users ON users.id = sessions.user_id
      WHERE sessions.token = ? AND sessions.expires_at > ?`
  )
    .bind(token, Date.now())
    .first();
  return row || null;
};

const handleRegister = async (request, env) => {
  const body = await parseBody(request);
  const username = normalizeUsername(body.username);
  const key = usernameKey(username);
  const password = String(body.password || "");

  if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(username)) {
    return error("用户名只能使用 1 到 32 个字母、数字、下划线或短横线。");
  }
  if (!password) return error("请输入密码。");

  const now = new Date().toISOString();
  const salt = randomToken().slice(0, 32);
  const user = {
    id: randomId(),
    username,
    username_key: key,
    password_hash: await passwordHash(password, salt),
    salt,
    progress_json: JSON.stringify(defaultProgress()),
    created_at: now,
    updated_at: now
  };

  try {
    await env.DB.prepare(
      `INSERT INTO users
        (id, username, username_key, password_hash, salt, progress_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        user.id,
        user.username,
        user.username_key,
        user.password_hash,
        user.salt,
        user.progress_json,
        user.created_at,
        user.updated_at
      )
      .run();
  } catch {
    return error("这个用户名已经注册过。", 409);
  }

  const token = await createSession(env, user.id);
  return json({ token, user: publicUser(user), progress: parseProgress(user.progress_json) }, 201);
};

const handleLogin = async (request, env) => {
  const body = await parseBody(request);
  const key = usernameKey(body.username);
  const password = String(body.password || "");
  const user = await env.DB.prepare("SELECT * FROM users WHERE username_key = ?").bind(key).first();
  if (!user) return error("用户名或密码不正确。", 401);
  const actual = await passwordHash(password, user.salt);
  if (actual !== user.password_hash) return error("用户名或密码不正确。", 401);
  const token = await createSession(env, user.id);
  return json({ token, user: publicUser(user), progress: parseProgress(user.progress_json) });
};

const handleLogout = async (request, env) => {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return json({ ok: true });
};

const handleMe = async (request, env) => {
  const user = await getUserFromRequest(request, env);
  if (!user) return error("登录已失效，请重新登录。", 401);
  return json({ user: publicUser(user), progress: parseProgress(user.progress_json) });
};

const handleGetProgress = async (request, env) => {
  const user = await getUserFromRequest(request, env);
  if (!user) return error("登录已失效，请重新登录。", 401);
  return json({ progress: parseProgress(user.progress_json) });
};

const handlePutProgress = async (request, env) => {
  const user = await getUserFromRequest(request, env);
  if (!user) return error("登录已失效，请重新登录。", 401);
  const body = await parseBody(request);
  let progress;
  try {
    progress = sanitizeProgress(body.progress);
  } catch (err) {
    return error(err.message || "进度保存失败。");
  }
  await env.DB.prepare("UPDATE users SET progress_json = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(progress), new Date().toISOString(), user.id)
    .run();
  return json({ progress });
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return json({}, 204);

    const url = new URL(request.url);
    if (url.pathname === "/api/health") return json({ ok: true });
    if (url.pathname === "/api/auth/register" && request.method === "POST") return handleRegister(request, env);
    if (url.pathname === "/api/auth/login" && request.method === "POST") return handleLogin(request, env);
    if (url.pathname === "/api/auth/logout" && request.method === "POST") return handleLogout(request, env);
    if (url.pathname === "/api/auth/me" && request.method === "GET") return handleMe(request, env);
    if (url.pathname === "/api/progress" && request.method === "GET") return handleGetProgress(request, env);
    if (url.pathname === "/api/progress" && request.method === "PUT") return handlePutProgress(request, env);
    return error("接口不存在。", 404);
  }
};
