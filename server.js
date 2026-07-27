const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { TicketMonitor } = require("./monitor");

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const STATE_PATH = path.join(DATA_DIR, "state.json");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DEFAULT_CONFIG_PATH = path.join(__dirname, "data", "config.json");
const DEFAULT_STATE_PATH = path.join(__dirname, "data", "state.json");
const MONITOR_SETTINGS_PATH = path.join(__dirname, "config", "monitor.json");

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? "" : "admin123");
const SESSION_SECRET =
  process.env.SESSION_SECRET || (IS_PRODUCTION ? "" : "local-secret-change-me");
const FRONTEND_ORIGIN = String(process.env.FRONTEND_ORIGIN || "").replace(/\/$/, "");

if (!ADMIN_PASSWORD || !SESSION_SECRET) {
  throw new Error("Defina ADMIN_PASSWORD e SESSION_SECRET nas variáveis de ambiente.");
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(CONFIG_PATH)) fs.copyFileSync(DEFAULT_CONFIG_PATH, CONFIG_PATH);
if (!fs.existsSync(STATE_PATH)) fs.copyFileSync(DEFAULT_STATE_PATH, STATE_PATH);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

function atomicWrite(file, value) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporary, file);
}

const monitorSettings = readJson(MONITOR_SETTINGS_PATH, {
  timeoutMs: 45000,
  pageWaitMs: 7000,
  minimumIntervalSeconds: 30,
  historyLimit: 500,
  publicCacheSeconds: 5
});

let config = readJson(CONFIG_PATH, {});
let persisted = readJson(STATE_PATH, {
  results: {},
  history: [],
  stats: {}
});
persisted.results ||= {};
persisted.history ||= [];
persisted.stats = {
  totalChecks: 0,
  checksToday: 0,
  lastStatsDate: "",
  statusChanges: 0,
  alertsSent: 0,
  failedChecks: 0,
  totalDurationMs: 0,
  lastCycleAt: null,
  lastCycleDurationMs: 0,
  ...persisted.stats
};

let logs = [];
let alertEvent = null;
let eventSequence = 0;
const loginAttempts = new Map();
const publicRequests = new Map();

function saveConfig() {
  atomicWrite(CONFIG_PATH, config);
}

let saveStateTimer = null;
function saveStateSoon() {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(() => atomicWrite(STATE_PATH, persisted), 150);
}

function log(message) {
  const entry = { at: new Date().toISOString(), message };
  logs.unshift(entry);
  logs = logs.slice(0, 300);
  console.log(`[${entry.at}] ${message}`);
}

function secureCompare(left, right) {
  const a = crypto.createHash("sha256").update(String(left)).digest();
  const b = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET)
    .update(data).digest("base64url");
  return `${data}.${signature}`;
}

function verifyToken(token) {
  try {
    const [data, signature] = String(token || "").split(".");
    if (!data || !signature) return null;
    const expected = crypto.createHmac("sha256", SESSION_SECRET)
      .update(data).digest("base64url");
    if (!secureCompare(signature, expected)) return null;
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function isAdmin(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return verifyToken(token)?.role === "admin";
}

function allowedOrigin(req) {
  const origin = String(req.headers.origin || "").replace(/\/$/, "");
  if (!origin) return "";
  if (!FRONTEND_ORIGIN) return IS_PRODUCTION ? "" : origin;
  return origin === FRONTEND_ORIGIN ? origin : "";
}

function securityHeaders(contentType, req) {
  const origin = allowedOrigin(req);
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https:; connect-src 'self' " +
      (FRONTEND_ORIGIN ? FRONTEND_ORIGIN : "") +
      "; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    ...(contentType ? { "Content-Type": contentType } : {}),
    ...(origin ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Vary": "Origin"
    } : {})
  };
}

function sendJson(res, status, data, req, cache = "no-store") {
  res.writeHead(status, {
    ...securityHeaders("application/json; charset=utf-8", req),
    "Cache-Control": cache
  });
  res.end(JSON.stringify(data));
}

function readBody(req, maxBytes = 12_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error("Corpo muito grande"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
  });
}

function clientIp(req) {
  return String(req.headers["cf-connecting-ip"] ||
    req.headers["x-forwarded-for"] ||
    req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function rateAllowed(store, key, limit, windowMs) {
  const now = Date.now();
  const current = store.get(key);
  if (!current || now > current.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

function loginAllowed(ip) {
  return rateAllowed(loginAttempts, ip, 8, 15 * 60 * 1000);
}

function publicAllowed(ip) {
  // Muito acima do polling normal, mas bloqueia scripts abusivos.
  return rateAllowed(publicRequests, ip, 180, 60 * 1000);
}

function publicConfig() {
  return {
    siteTitle: config.siteTitle,
    siteSubtitle: config.siteSubtitle,
    siteDescription: config.siteDescription,
    coverImage: config.coverImage,
    headerAlertText: config.headerAlertText,
    showSectionTitle: config.showSectionTitle,
    infoSectionTitle: config.infoSectionTitle,
    footerText: config.footerText,
    telegramUrl: config.telegramUrl,
    instagramUrl: config.instagramUrl,
    twitterUrl: config.twitterUrl,
    showSocialButtons: config.showSocialButtons,
    checkIntervalSeconds: config.checkIntervalSeconds,
    pollingSeconds: Number(config.pollingSeconds || monitorSettings.pollingSeconds || 15),
    visualAlertEnabled: config.visualAlertEnabled,
    soundAlertEnabled: config.soundAlertEnabled,
    browserNotificationEnabled: config.browserNotificationEnabled,
    sectorDetailsEnabled: config.sectorDetailsEnabled,
    infoCards: config.infoCards || [],
    shows: (config.shows || []).map(show => ({
      id: show.id,
      day: show.day,
      date: show.date,
      url: show.url,
      buttonText: show.buttonText,
      image: show.image,
      extraLinkText: show.extraLinkText,
      extraLinkUrl: show.extraLinkUrl,
      enabled: show.enabled
    }))
  };
}

function publicResults() {
  return Object.fromEntries(
    Object.entries(monitor.results).map(([id, result]) => [id, {
      showId: result.showId,
      date: result.date,
      status: result.status,
      label: result.label,
      message: result.message,
      offers: result.offers,
      checkedAt: result.checkedAt
    }])
  );
}

function publicAlertEvent() {
  if (!alertEvent) return null;
  return {
    id: alertEvent.id,
    type: alertEvent.type,
    title: alertEvent.title,
    message: alertEvent.message,
    createdAt: alertEvent.createdAt
  };
}

function snapshot() {
  return {
    config: publicConfig(),
    results: publicResults(),
    nextCheckAt: monitor.nextCheckAt,
    checking: monitor.running,
    alertEvent: publicAlertEvent()
  };
}

function createAlertEvent({ type, title, message }) {
  eventSequence += 1;
  alertEvent = {
    id: `${Date.now()}-${eventSequence}`,
    type, title, message,
    createdAt: new Date().toISOString()
  };
  persisted.stats.alertsSent += 1;
  saveStateSoon();
}

function clearAlertEvent() {
  alertEvent = null;
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

function registerResult(result) {
  const previous = persisted.results[result.showId];
  const changed = previous && previous.status !== result.status;

  persisted.results[result.showId] = result;
  persisted.history.unshift({
    at: result.checkedAt,
    showId: result.showId,
    date: result.date,
    status: result.status,
    label: result.label,
    message: result.message,
    evidence: result.evidence || "",
    durationMs: result.durationMs || 0,
    changed: Boolean(changed)
  });
  persisted.history = persisted.history.slice(0, Number(monitorSettings.historyLimit || 500));

  const today = todayKey();
  if (persisted.stats.lastStatsDate !== today) {
    persisted.stats.lastStatsDate = today;
    persisted.stats.checksToday = 0;
  }

  persisted.stats.totalChecks += 1;
  persisted.stats.checksToday += 1;
  if (changed) persisted.stats.statusChanges += 1;
  if (result.status === "unknown" || result.status === "error") {
    persisted.stats.failedChecks += 1;
  }
  saveStateSoon();
}

const monitor = new TicketMonitor({
  getConfig: () => ({
    ...config,
    monitorTimeoutMs: monitorSettings.timeoutMs,
    pageWaitMs: monitorSettings.pageWaitMs
  }),
  initialResults: persisted.results,
  log,
  onSchedule: () => {},
  onCycleComplete: cycle => {
    persisted.stats.lastCycleAt = cycle.finishedAt;
    persisted.stats.lastCycleDurationMs = cycle.durationMs;
    persisted.stats.totalDurationMs += cycle.durationMs;
    saveStateSoon();
    log(`Ciclo concluído em ${(cycle.durationMs / 1000).toFixed(1)}s: ${cycle.total - cycle.failures}/${cycle.total} páginas.`);
  },
  onUpdate: result => {
    registerResult(result);
    if (result.shouldAlert) {
      const offerText = result.offers?.length
        ? ` ${result.offers.slice(0, 5)
            .map(item => `${item.sector} — ${item.type} — ${item.price}`)
            .join("; ")}`
        : "";
      createAlertEvent({
        type: "availability",
        title: "🚨 INGRESSOS DISPONÍVEIS",
        message: `${result.date}: a página mudou de esgotado para disponível.${offerText}`
      });
    }
  }
});

function uploadDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
  if (!match) throw new Error("Imagem inválida");
  const extension = match[1] === "jpeg" ? "jpg" : match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 5_000_000) throw new Error("Imagem maior que 5 MB");
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${extension}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

async function handleApi(req, res, pathname) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, securityHeaders("", req));
    return res.end();
  }

  if (pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      monitorRunning: monitor.running,
      configuredShows: (config.shows || []).length
    }, req, "no-store");
  }

  if (pathname === "/api/status" && req.method === "GET") {
    if (!publicAllowed(clientIp(req))) {
      return sendJson(res, 429, { error: "Muitas consultas. Aguarde alguns segundos." }, req);
    }
    const seconds = Math.max(1, Number(monitorSettings.publicCacheSeconds || 5));
    return sendJson(
      res, 200, snapshot(), req,
      `public, max-age=${seconds}, s-maxage=${seconds}, stale-while-revalidate=10`
    );
  }

  if (pathname === "/api/admin/login" && req.method === "POST") {
    const ip = clientIp(req);
    if (!loginAllowed(ip)) {
      return sendJson(res, 429, { error: "Muitas tentativas. Aguarde 15 minutos." }, req);
    }
    const body = await readBody(req);
    if (!secureCompare(body.password, ADMIN_PASSWORD)) {
      return sendJson(res, 401, { error: "Senha incorreta" }, req);
    }
    loginAttempts.delete(ip);
    return sendJson(res, 200, {
      token: signToken({ role: "admin", exp: Date.now() + 8 * 60 * 60 * 1000 })
    }, req);
  }

  if (pathname.startsWith("/api/admin/") && !isAdmin(req)) {
    return sendJson(res, 401, { error: "Não autorizado" }, req);
  }

  if (pathname === "/api/admin/config" && req.method === "GET") {
    return sendJson(res, 200, {
      config,
      logs,
      results: monitor.results,
      alertEvent,
      stats: persisted.stats,
      history: persisted.history.slice(0, 100),
      nextCheckAt: monitor.nextCheckAt,
      checking: monitor.running
    }, req);
  }

  if (pathname === "/api/admin/config" && req.method === "PUT") {
    const body = await readBody(req);
    config = {
      ...config,
      ...body,
      checkIntervalSeconds: Math.max(
        Number(monitorSettings.minimumIntervalSeconds || 30),
        Number(body.checkIntervalSeconds || config.checkIntervalSeconds || 60)
      ),
      pollingSeconds: Math.max(10, Number(body.pollingSeconds || config.pollingSeconds || 15)),
      shows: Array.isArray(body.shows) ? body.shows : config.shows,
      infoCards: Array.isArray(body.infoCards) ? body.infoCards : config.infoCards
    };
    saveConfig();
    monitor.schedule();
    log("Configurações atualizadas pelo painel.");
    return sendJson(res, 200, { ok: true }, req);
  }

  if (pathname === "/api/admin/upload" && req.method === "POST") {
    const body = await readBody(req, 8_000_000);
    const url = uploadDataUrl(body.dataUrl);
    log("Imagem otimizada salva no servidor.");
    return sendJson(res, 200, { ok: true, url }, req);
  }

  if (pathname === "/api/admin/check-now" && req.method === "POST") {
    if (monitor.running) {
      return sendJson(res, 409, { error: "Já existe uma verificação em andamento." }, req);
    }
    monitor.checkAll().then(() => monitor.schedule()).catch(error => {
      log(`Erro na verificação manual: ${error.message}`);
    });
    return sendJson(res, 202, { ok: true }, req);
  }

  if (pathname === "/api/admin/manual-alert" && req.method === "POST") {
    const body = await readBody(req);
    const message = String(body.message || "").trim();
    if (!message) return sendJson(res, 400, { error: "Digite a mensagem do alerta." }, req);
    createAlertEvent({ type: "manual", title: "📢 AVISO DO MONITOR", message });
    log("Alerta manual liberado pelo painel.");
    return sendJson(res, 200, { ok: true, alertEvent }, req);
  }

  if (pathname === "/api/admin/clear-alert" && req.method === "POST") {
    clearAlertEvent();
    log("Alerta do site retirado pelo painel.");
    return sendJson(res, 200, { ok: true }, req);
  }

  if (pathname === "/api/admin/diagnostics" && req.method === "GET") {
    return sendJson(res, 200, {
      checking: monitor.running,
      nextCheckAt: monitor.nextCheckAt,
      results: monitor.results,
      alertEvent,
      logs: logs.slice(0, 80),
      stats: persisted.stats,
      history: persisted.history.slice(0, 100)
    }, req);
  }

  return sendJson(res, 404, { error: "Rota não encontrada" }, req);
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function serveStatic(res, pathname, req) {
  let base = PUBLIC_DIR;
  let relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");

  if (relative === "admin") relative = "admin.html";
  if (relative.startsWith("uploads/")) {
    base = UPLOAD_DIR;
    relative = relative.replace(/^uploads\//, "");
  }

  const file = path.normalize(path.join(base, relative));
  if (!file.startsWith(base)) {
    res.writeHead(403, securityHeaders("text/plain; charset=utf-8", req));
    return res.end("Proibido");
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404, securityHeaders("text/plain; charset=utf-8", req));
      return res.end("Página não encontrada");
    }
    const extension = path.extname(file);
    res.writeHead(200, {
      ...securityHeaders(mime[extension] || "application/octet-stream", req),
      "Cache-Control": extension === ".html"
        ? "no-cache"
        : "public, max-age=86400, immutable"
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url.pathname);
    }
    return serveStatic(res, url.pathname, req);
  } catch (error) {
    log(`Erro HTTP: ${error.message}`);
    return sendJson(res, 500, { error: "Erro interno" }, req);
  }
});

server.listen(PORT, () => {
  log(`Servidor iniciado na porta ${PORT}.`);
  monitor.start().catch(error => log(`Monitor não iniciou: ${error.message}`));
});

async function shutdown() {
  try {
    atomicWrite(STATE_PATH, persisted);
    await monitor.close();
  } finally {
    server.close(() => process.exit(0));
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
