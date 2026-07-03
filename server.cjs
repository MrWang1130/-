const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const PORT = Number(process.env.PORT || 4175);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const SECRET_PATH = path.join(DATA_DIR, "secret.txt");
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const RECORD_STORES = ["wordRecords", "chapterRecords", "reviewRecords"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

fs.mkdirSync(DATA_DIR, { recursive: true });

function readDb() {
  if (!fs.existsSync(DB_PATH)) {
    return { users: {} };
  }
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { users: {} };
  }
}

function writeDb(db) {
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

function getSecret() {
  if (!fs.existsSync(SECRET_PATH)) {
    fs.writeFileSync(SECRET_PATH, crypto.randomBytes(32).toString("base64url"));
  }
  return fs.readFileSync(SECRET_PATH, "utf8").trim();
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "content-type,authorization"
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/\s+/g, "_").slice(0, 32);
}

function passwordHash(password, salt = crypto.randomBytes(16).toString("base64url")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 210000, 32, "sha256");
  return `${salt}:${hash.toString("base64url")}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  const actual = passwordHash(password, salt).split(":")[1];
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signToken(userId) {
  const payload = {
    sub: userId,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyToken(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", getSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.sub || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function findUserById(db, id) {
  return Object.values(db.users).find((user) => user.id === id) || null;
}

function getAuthUser(req, db) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = verifyToken(token);
  if (!payload) return null;
  return findUserById(db, payload.sub);
}

function createDefaultProgress() {
  return {
    version: 2,
    savedAt: new Date().toISOString(),
    items: {},
    recordDb: {
      version: 3,
      stores: {
        wordRecords: [],
        chapterRecords: [],
        reviewRecords: []
      }
    },
    summary: {
      wordRecords: 0,
      chapterRecords: 0,
      reviewRecords: 0
    }
  };
}

function sanitizeJsonValue(value, depth = 0) {
  if (depth > 8) return null;
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50000).map((item) => sanitizeJsonValue(item, depth + 1));
  if (typeof value === "object") {
    const output = {};
    for (const [key, itemValue] of Object.entries(value)) {
      if (typeof key === "string" && key.length <= 80) output[key] = sanitizeJsonValue(itemValue, depth + 1);
    }
    return output;
  }
  return null;
}

function sanitizeProgress(progress) {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) {
    return createDefaultProgress();
  }
  const output = createDefaultProgress();
  output.savedAt = typeof progress.savedAt === "string" ? progress.savedAt : new Date().toISOString();

  if (progress.items && typeof progress.items === "object" && !Array.isArray(progress.items)) {
    for (const [key, value] of Object.entries(progress.items)) {
      if (typeof key === "string" && typeof value === "string") output.items[key] = value;
    }
  }

  const stores = progress.recordDb?.stores;
  if (stores && typeof stores === "object" && !Array.isArray(stores)) {
    for (const storeName of RECORD_STORES) {
      const records = stores[storeName];
      if (!Array.isArray(records)) continue;
      output.recordDb.stores[storeName] = records
        .slice(0, 50000)
        .map((record) => sanitizeJsonValue(record))
        .filter((record) => record && typeof record === "object" && !Array.isArray(record));
      output.summary[storeName] = output.recordDb.stores[storeName].length;
    }
  }

  const text = JSON.stringify(output);
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new Error("Progress payload is too large.");
  return output;
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (url.pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/signup" && req.method === "POST") {
    const body = await readBody(req);
    const username = normalizeUsername(body.username);
    const password = String(body.password || "");
    if (!/^[\p{L}\p{N}_-]{2,32}$/u.test(username)) {
      sendError(res, 400, "用户名需要 2 到 32 个字符。");
      return;
    }
    if (password.length < 6) {
      sendError(res, 400, "密码至少需要 6 位。");
      return;
    }

    const db = readDb();
    const key = username.toLowerCase();
    if (db.users[key]) {
      sendError(res, 409, "这个用户名已经存在。");
      return;
    }

    const user = {
      id: crypto.randomUUID(),
      username,
      passwordHash: passwordHash(password),
      progress: createDefaultProgress(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.users[key] = user;
    writeDb(db);
    sendJson(res, 201, {
      token: signToken(user.id),
      user: { id: user.id, username: user.username },
      progress: user.progress
    });
    return;
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    const body = await readBody(req);
    const username = normalizeUsername(body.username);
    const password = String(body.password || "");
    const db = readDb();
    const user = db.users[username.toLowerCase()];
    if (!user || !verifyPassword(password, user.passwordHash)) {
      sendError(res, 401, "用户名或密码不正确。");
      return;
    }
    sendJson(res, 200, {
      token: signToken(user.id),
      user: { id: user.id, username: user.username },
      progress: user.progress || createDefaultProgress()
    });
    return;
  }

  if (url.pathname === "/api/me" && req.method === "GET") {
    const db = readDb();
    const user = getAuthUser(req, db);
    if (!user) {
      sendError(res, 401, "登录已失效。");
      return;
    }
    sendJson(res, 200, {
      user: { id: user.id, username: user.username },
      progress: user.progress || createDefaultProgress()
    });
    return;
  }

  if (url.pathname === "/api/progress" && req.method === "GET") {
    const db = readDb();
    const user = getAuthUser(req, db);
    if (!user) {
      sendError(res, 401, "登录已失效。");
      return;
    }
    sendJson(res, 200, { progress: user.progress || createDefaultProgress() });
    return;
  }

  if (url.pathname === "/api/progress" && req.method === "PUT") {
    const body = await readBody(req);
    const db = readDb();
    const user = getAuthUser(req, db);
    if (!user) {
      sendError(res, 401, "登录已失效。");
      return;
    }
    user.progress = sanitizeProgress(body.progress);
    user.updatedAt = new Date().toISOString();
    writeDb(db);
    sendJson(res, 200, { progress: user.progress });
    return;
  }

  sendError(res, 404, "接口不存在。");
}

function safeStaticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const normalized = decoded === "/" ? "/index.html" : decoded;
  const target = path.resolve(PUBLIC_DIR, `.${normalized}`);
  if (!target.startsWith(PUBLIC_DIR)) {
    return null;
  }
  return target;
}

function serveStatic(req, res, url) {
  const target = safeStaticPath(url.pathname);
  if (!target) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(target, (err, file) => {
    if (err) {
      const fallback = path.join(PUBLIC_DIR, "index.html");
      fs.readFile(fallback, (fallbackErr, html) => {
        if (fallbackErr) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, {
          "content-type": MIME[".html"],
          "cache-control": "no-cache"
        });
        res.end(html);
      });
      return;
    }

    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });
    res.end(file);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendError(res, 400, error.message || "请求失败。");
  }
});

server.listen(PORT, HOST, () => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${PORT}`);
  console.log(`KeyFlow running at http://localhost:${PORT}`);
  if (addresses.length) {
    console.log(`LAN address: ${addresses.join(", ")}`);
  }
});
