const { chromium } = require("playwright");

const SOLD_OUT_RE = /\b(esgotad[oa]s?|sold\s*out|indispon[ií]vel|sem\s+ingressos|no\s+tickets\s+available|currently\s+unavailable)\b/i;
const BUY_RE = /\b(comprar(?:\s+ingressos?)?|selecionar(?:\s+ingressos?)?|escolher(?:\s+ingressos?)?|ver\s+ingressos|buy\s+tickets?|find\s+tickets?|select\s+tickets?|choose\s+tickets?)\b/i;
const CHALLENGE_RE = /(captcha|atividade\s+suspeita|actividad\s+sospechosa|access\s+denied|are\s+you\s+(?:a\s+)?human|verify\s+you\s+are|queue-it)/i;

const SECTOR_PATTERNS = [
  /pista\s+premium/i, /pista\b/i, /cadeira\s+inferior/i, /cadeira\s+superior/i,
  /arquibancada/i, /camarote/i, /vip/i, /soundcheck/i
];
const TYPE_PATTERNS = [
  /inteira/i, /meia[-\s]?entrada/i, /entrada\s+social/i, /social/i,
  /vip/i, /soundcheck/i, /premium/i
];

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function moneyFrom(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = value > 10000 ? value / 100 : value;
    return `R$ ${normalized.toFixed(2).replace(".", ",")}`;
  }
  const match = cleanText(value).match(/R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/i);
  return match ? match[0] : "";
}

function looksAvailable(value) {
  if (value === true) return true;
  if (typeof value === "number") return value > 0;
  const text = cleanText(value).toLowerCase();
  return /available|dispon[ií]vel|on\s*sale|onsale|open|active/.test(text) &&
    !SOLD_OUT_RE.test(text);
}

function firstString(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === "string" && cleanText(value)) return cleanText(value);
  }
  return "";
}

function extractOffersFromJson(payload) {
  const found = [];
  const seen = new Set();

  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    const sector = firstString(node, [
      "sectionName", "section", "sectorName", "sector", "areaName", "area",
      "zoneName", "zone", "priceLevelName"
    ]);
    const type = firstString(node, [
      "ticketTypeName", "ticketType", "offerName", "offerType", "inventoryType",
      "admissionType", "name"
    ]);
    const price = moneyFrom(
      node.price ?? node.amount ?? node.faceValue ?? node.totalPrice ??
      node.displayPrice ?? node.priceWithFees
    );
    const available = [
      node.available, node.isAvailable, node.availability, node.status,
      node.quantity, node.remaining, node.inventory
    ].some(looksAvailable);

    if (available && sector && (type || price)) {
      const item = {
        sector,
        type: type && type !== sector ? type : "Tipo não informado",
        price: price || "Preço não informado"
      };
      const key = `${item.sector}|${item.type}|${item.price}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        found.push(item);
      }
    }

    Object.values(node).forEach(visit);
  }

  visit(payload);
  return found.slice(0, 30);
}

function extractOffersFromVisibleText(text) {
  const lines = String(text || "").split(/\n+/).map(cleanText).filter(Boolean);
  const found = [];
  const seen = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const block = lines.slice(Math.max(0, index - 2), index + 3).join(" · ");
    const sectorMatch = SECTOR_PATTERNS.map(pattern => block.match(pattern)).find(Boolean);
    if (!sectorMatch) continue;

    const typeMatch = TYPE_PATTERNS.map(pattern => block.match(pattern)).find(Boolean);
    const price = moneyFrom(block);
    if (!typeMatch && !price) continue;

    const item = {
      sector: cleanText(sectorMatch[0]),
      type: typeMatch ? cleanText(typeMatch[0]) : "Tipo não informado",
      price: price || "Preço não informado"
    };
    const key = `${item.sector}|${item.type}|${item.price}`.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      found.push(item);
    }
  }

  return found.slice(0, 20);
}

class TicketMonitor {
  constructor({ getConfig, onUpdate, onSchedule, onCycleComplete, log, initialResults = {} }) {
    this.getConfig = getConfig;
    this.onUpdate = onUpdate;
    this.onSchedule = onSchedule;
    this.onCycleComplete = onCycleComplete;
    this.log = log;
    this.browser = null;
    this.timer = null;
    this.running = false;
    this.results = { ...initialResults };
    this.nextCheckAt = null;
  }

  async ensureBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"]
      });
    }
  }

  async start() {
    await this.ensureBrowser();
    await this.checkAll();
    this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);

    const seconds = Math.max(
      30,
      Number(this.getConfig().checkIntervalSeconds) || 60
    );

    this.nextCheckAt = new Date(
      Date.now() + seconds * 1000
    ).toISOString();

    if (typeof this.onSchedule === "function") {
      this.onSchedule(this.nextCheckAt);
    }

    this.timer = setTimeout(async () => {
      await this.checkAll();
      this.schedule();
    }, seconds * 1000);
  }

  async checkAll() {
    if (this.running) return false;

    const config = this.getConfig();
    if (!config.monitorEnabled) {
      this.log("Monitor pausado no painel.");
      return false;
    }

    await this.ensureBrowser();
    this.running = true;
    const startedAt = Date.now();
    const enabledShows = (config.shows || [])
      .filter(item => item.enabled !== false);

    try {
      // Uma única rodada do servidor verifica todos os shows em paralelo.
      // A abertura do site pelos fãs nunca executa Playwright.
      const settled = await Promise.allSettled(
        enabledShows.map(show => this.checkShow(show, config))
      );

      const failures = settled.filter(item => item.status === "rejected");
      failures.forEach(item => {
        this.log(`Falha isolada em uma página: ${item.reason?.message || item.reason}`);
      });

      if (typeof this.onCycleComplete === "function") {
        this.onCycleComplete({
          startedAt: new Date(startedAt).toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          total: enabledShows.length,
          failures: failures.length
        });
      }

      return failures.length < enabledShows.length;
    } finally {
      this.running = false;
    }
  }

  async checkShow(show, config) {
    const previous = this.results[show.id] || null;
    const jsonPayloads = [];

    const context = await this.browser.newContext({
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
    });
    const page = await context.newPage();

    await page.route("**/*", route => {
      const type = route.request().resourceType();
      if (["image", "font", "media"].includes(type)) return route.abort();
      return route.continue();
    });

    page.on("response", async response => {
      const contentType = response.headers()["content-type"] || "";
      if (!contentType.includes("application/json")) return;
      try {
        jsonPayloads.push(await response.json());
      } catch {}
    });

    let result;

    try {
      await page.goto(show.url, {
        waitUntil: "domcontentloaded",
        timeout: Number(config.monitorTimeoutMs || 45000)
      });
      await page.waitForTimeout(Number(config.pageWaitMs || 7000));

      const inspection = await page.evaluate(
        ({ soldOutSource, buySource, challengeSource }) => {
          const soldOutRe = new RegExp(soldOutSource, "i");
          const buyRe = new RegExp(buySource, "i");
          const challengeRe = new RegExp(challengeSource, "i");

          const isVisible = element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.width > 0 &&
              rect.height > 0;
          };

          const controls = [...document.querySelectorAll(
            "button, a, [role='button'], input[type='button'], input[type='submit']"
          )]
            .filter(isVisible)
            .map(element => ({
              text: (
                element.innerText ||
                element.value ||
                element.getAttribute("aria-label") ||
                ""
              ).replace(/\s+/g, " ").trim(),
              disabled:
                Boolean(element.disabled) ||
                element.getAttribute("aria-disabled") === "true" ||
                element.hasAttribute("disabled")
            }))
            .filter(item => item.text);

          const bodyText = (document.body?.innerText || "")
            .replace(/\s+/g, " ")
            .trim();

          return {
            bodyText,
            challenge: challengeRe.test(bodyText),
            soldOutControls: controls.filter(item => soldOutRe.test(item.text)),
            purchaseControls: controls.filter(item =>
              buyRe.test(item.text) &&
              !soldOutRe.test(item.text) &&
              !item.disabled
            )
          };
        },
        {
          soldOutSource: SOLD_OUT_RE.source,
          buySource: BUY_RE.source,
          challengeSource: CHALLENGE_RE.source
        }
      );

      let offers = [];
      if (config.sectorDetailsEnabled) {
        for (const payload of jsonPayloads) {
          offers.push(...extractOffersFromJson(payload));
        }
        if (!offers.length) {
          offers = extractOffersFromVisibleText(inspection.bodyText);
        }

        const unique = new Map();
        offers.forEach(item => {
          unique.set(
            `${item.sector}|${item.type}|${item.price}`.toLowerCase(),
            item
          );
        });
        offers = [...unique.values()].slice(0, 25);
      }

      if (inspection.challenge) {
        result = {
          status: "unknown",
          label: "Consulta bloqueada",
          message:
            "A Ticketmaster apresentou uma verificação de segurança. " +
            "Nenhuma disponibilidade foi confirmada.",
          offers: [],
          evidence: "Página de segurança detectada"
        };
      } else if (inspection.purchaseControls.length > 0) {
        result = {
          status: "available",
          label: "Ingressos disponíveis",
          message: offers.length
            ? `${offers.length} opção(ões) de ingresso identificada(s).`
            : "O botão real de compra está habilitado.",
          offers,
          evidence: inspection.purchaseControls
            .map(item => item.text)
            .join(" | ")
        };
      } else if (
        inspection.soldOutControls.length > 0 ||
        SOLD_OUT_RE.test(inspection.bodyText)
      ) {
        result = {
          status: "soldout",
          label: "Esgotado",
          message: "A página oficial continua indicando ingressos esgotados.",
          offers: [],
          evidence:
            inspection.soldOutControls.map(item => item.text).join(" | ") ||
            "Texto público de esgotado encontrado"
        };
      } else {
        result = {
          status: "unknown",
          label: "Sem confirmação",
          message:
            "A página não mostrou um botão de compra habilitado nem " +
            "uma confirmação clara de esgotado.",
          offers: [],
          evidence: "Nenhum controle conclusivo"
        };
      }
    } catch (error) {
      result = {
        status: "error",
        label: "Erro na verificação",
        message: "Não foi possível consultar a página agora.",
        offers: [],
        evidence: error.message
      };
    } finally {
      await context.close();
    }

    const transitionedToAvailable = Boolean(
      previous &&
      previous.status === "soldout" &&
      result.status === "available"
    );

    result = {
      ...result,
      showId: show.id,
      date: show.date,
      checkedAt: new Date().toISOString(),
      previousStatus: previous?.status || null,
      changed: Boolean(previous && previous.status !== result.status),
      shouldAlert: Boolean(
        show.alertsEnabled !== false &&
        transitionedToAvailable
      )
    };

    this.results[show.id] = result;
    this.log(
      `${show.date}: ${result.label}` +
      (result.shouldAlert ? " — TRANSIÇÃO ESGOTADO → DISPONÍVEL" : "")
    );
    if (typeof this.onUpdate === "function") this.onUpdate(result);
  }

  async close() {
    clearTimeout(this.timer);
    if (this.browser) await this.browser.close();
  }
}

module.exports = { TicketMonitor };
