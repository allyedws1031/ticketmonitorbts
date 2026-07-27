const API_BASE_URL = String(window.MONITOR_CONFIG?.apiBaseUrl || "").replace(/\/$/, "");
const isLocal =
  location.hostname === "127.0.0.1" ||
  location.hostname === "localhost" ||
  location.protocol === "file:";

const LOCAL_KEY = "bts_monitor_secure_preview_v2";
let currentSnapshot = null;
let soundUnlocked = localStorage.getItem("bts_sound") === "1";
let lastEventId = sessionStorage.getItem("bts_last_alert_event") || "";
let audioContext;
let clientNextCheckAt = 0;
let countdownRefreshing = false;

const DEFAULT_SHOWS = [
  {
    id:"28",day:"QUARTA-FEIRA",date:"28 DE OUTUBRO",
    url:"https://www.ticketmaster.com.br/event/venda-geral-bts-world-tour-arirang-28-10",
    buttonText:"ABRIR SITE OFICIAL",enabled:true
  },
  {
    id:"30",day:"SEXTA-FEIRA",date:"30 DE OUTUBRO",
    url:"https://www.ticketmaster.com.br/event/venda-geral-bts-world-tour-arirang-30-10",
    buttonText:"ABRIR SITE OFICIAL",enabled:true
  },
  {
    id:"31",day:"SÁBADO",date:"31 DE OUTUBRO",
    url:"https://www.ticketmaster.com.br/event/venda-geral-bts-world-tour-arirang-31-10",
    buttonText:"ABRIR SITE OFICIAL",enabled:true
  }
];

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[char]));

const formatTime = iso => iso
  ? new Date(iso).toLocaleTimeString("pt-BR", {
      hour:"2-digit", minute:"2-digit", second:"2-digit"
    })
  : "—";

function playAlarm() {
  if (!soundUnlocked || !currentSnapshot?.config?.soundAlertEnabled) return;

  audioContext ||= new (window.AudioContext || window.webkitAudioContext)();

  [0,450,900,1350,1800].forEach((delay,index) => {
    setTimeout(() => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = index % 2 ? 690 : 940;
      gain.gain.setValueAtTime(.001,audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.24,audioContext.currentTime+.02);
      gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.35);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime+.38);
    },delay);
  });
}

function hideAlert() {
  const banner = document.getElementById("alertBanner");
  banner.hidden = true;
  banner.setAttribute("hidden","");
}

function showAlert(event) {
  if (!event || !currentSnapshot?.config?.visualAlertEnabled) return;

  document.getElementById("alertTitle").textContent = event.title;
  document.getElementById("alertMessage").textContent = event.message;

  const banner = document.getElementById("alertBanner");
  banner.hidden = false;
  banner.removeAttribute("hidden");

  playAlarm();

  if (
    currentSnapshot.config.browserNotificationEnabled &&
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    new Notification(event.title.replace(/[^\w\sÀ-ÿ]/g,"").trim(), {
      body:event.message
    });
  }
}

function social(url,label) {
  return url
    ? `<a class="social-link" href="${escapeHtml(url)}"
          target="_blank" rel="noopener">${label}</a>`
    : "";
}

const DEFAULT_INFO_CARDS = [
  {title:"LINKS OFICIAIS",text:"Use somente as páginas oficiais da Ticketmaster para consultar e comprar ingressos.",image:"",linkText:"VER DIAS DE SHOW",linkUrl:"#shows"},
  {title:"ALERTA DE SOM",text:"Ative o áudio no cabeçalho para ouvir o aviso quando houver disponibilidade.",image:"",linkText:"",linkUrl:""},
  {title:"ATUALIZAÇÃO AUTOMÁTICA",text:"O servidor verifica as páginas oficiais automaticamente no intervalo configurado.",image:"",linkText:"",linkUrl:""},
  {title:"STATUS DOS INGRESSOS",text:"Esgotado aparece em vermelho. Disponível aparece em verde e libera o alerta.",image:"",linkText:"",linkUrl:""},
  {title:"CANAL TELEGRAM",text:"Acesse o canal do projeto para acompanhar avisos e atualizações importantes.",image:"",linkText:"ABRIR TELEGRAM",linkUrl:"https://t.me/monitorticketmbts"},
  {title:"SEGURANÇA",text:"O monitor não solicita dados pessoais, não compra ingressos e não realiza pagamentos.",image:"",linkText:"",linkUrl:""},
  {title:"FILA E RESERVA",text:"O sistema não entra na fila, não reserva lugares e não contorna proteções da Ticketmaster.",image:"",linkText:"",linkUrl:""}
];

function normalizeConfig(raw = {}) {
  const merged = {
    siteTitle:"MONITOR TICKET BTS",
    siteSubtitle:"BTS WORLD TOUR ARIRANG - SÃO PAULO",
    siteDescription:"",
    coverImage:"",
    headerAlertText:"Ativar alerta",
    showSectionTitle:"DIAS DE SHOWS",
    infoSectionTitle:"INFORMAÇÕES IMPORTANTES",
    footerText:"BTS Ticket Monitor Brasil",
    instagramUrl:"https://instagram.com/",
    twitterUrl:"https://x.com/",
    telegramUrl:"https://t.me/monitorticketmbts",
    showSocialButtons:true,
    checkIntervalSeconds:60,
    visualAlertEnabled:true,
    soundAlertEnabled:true,
    browserNotificationEnabled:true,
    sectorDetailsEnabled:true,
    infoCards:DEFAULT_INFO_CARDS,
    shows:DEFAULT_SHOWS,
    ...raw
  };

  if (!Array.isArray(merged.shows) || !merged.shows.length) {
    merged.shows = structuredClone(DEFAULT_SHOWS);
  }
  if (!Array.isArray(merged.infoCards) || !merged.infoCards.length) {
    merged.infoCards = structuredClone(DEFAULT_INFO_CARDS);
  }
  if (!merged.instagramUrl) merged.instagramUrl = "https://instagram.com/";
  if (!merged.twitterUrl) merged.twitterUrl = "https://x.com/";
  if (!merged.telegramUrl) merged.telegramUrl = "https://t.me/monitorticketmbts";

  return merged;
}

function render(snapshot) {
  const config = normalizeConfig(snapshot.config || {});
  const results = snapshot.results || {};
  currentSnapshot = { ...snapshot, config, results };

  const serverNext = snapshot.nextCheckAt
    ? new Date(snapshot.nextCheckAt).getTime()
    : 0;

  clientNextCheckAt = serverNext > Date.now()
    ? serverNext
    : Date.now() + Number(config.checkIntervalSeconds || 60) * 1000;

  document.title = config.siteTitle;
  document.getElementById("title").textContent = config.siteTitle;
  document.getElementById("subtitle").textContent = config.siteSubtitle;
  document.getElementById("description").textContent =
    config.siteDescription || "";
  document.getElementById("showSectionTitle").textContent =
    config.showSectionTitle;
  document.getElementById("infoSectionTitle").textContent =
    config.infoSectionTitle;
  document.getElementById("footerText").textContent =
    config.footerText || "";
  document.getElementById("enableSound").textContent =
    `🔔 ${config.headerAlertText || "Ativar alerta"}`;

  document.getElementById("hero").style.backgroundImage =
    config.coverImage
      ? `url("${config.coverImage}")`
      : "linear-gradient(180deg,#333,#0b0b0b)";

  document.getElementById("socialButtons").innerHTML =
    config.showSocialButtons
      ? [
          social(config.twitterUrl,"X"),
          social(config.instagramUrl,"INSTAGRAM"),
          social(config.telegramUrl,"CANAL TELEGRAM")
        ].join("")
      : "";

  document.getElementById("shows").innerHTML = config.shows
    .filter(show => show.enabled !== false)
    .map(show => {
      const result = results[show.id] || {
        status:"soldout",
        label:"Esgotado",
        message:"Nenhuma atualização confirmada no site oficial.",
        offers:[],
        checkedAt:null
      };

      const offers =
        config.sectorDetailsEnabled && result.offers?.length
          ? `<div class="offers">${result.offers.map(offer => `
              <div class="offer">
                <strong>${escapeHtml(offer.sector)}</strong>
                <span>${escapeHtml(offer.type)} · ${escapeHtml(offer.price)}</span>
              </div>`).join("")}</div>`
          : "";

      return `<article class="show-card">
        ${show.image ? `<img class="show-image" src="${show.image}" alt="">` : ""}
        <div class="show-card-accent"></div>
        <div class="show-body">
          <div class="show-topline">
            <div class="show-day-wrap">
              <span class="calendar-icon">▣</span>
              <p class="show-day">${escapeHtml(show.day)}</p>
            </div>
            <span class="show-number">${escapeHtml(show.id)}</span>
          </div>

          <h3 class="show-date">${escapeHtml(show.date)}</h3>

          <div class="status-row">
            <span class="status-label">STATUS DO INGRESSO</span>
            <div class="status ${escapeHtml(result.status)}">
              <span class="status-dot"></span>
              ${escapeHtml(result.label)}
            </div>
          </div>

          <p class="show-message">${escapeHtml(result.message)}</p>
          ${offers}

          <div class="show-meta">
            <span>ÚLTIMA VERIFICAÇÃO</span>
            <strong>${formatTime(result.checkedAt)}</strong>
          </div>

          <div class="show-actions">
            <a class="show-link primary"
               href="${escapeHtml(show.url)}"
               target="_blank" rel="noopener">
              <span>${escapeHtml(show.buttonText || "ABRIR SITE OFICIAL")}</span>
              <b>↗</b>
            </a>
          </div>
        </div>
      </article>`;
    })
    .join("");

  document.getElementById("infoCards").innerHTML = (config.infoCards || [])
    .map(card => `<article class="info-card">
      ${card.image ? `<img class="info-image" src="${card.image}" alt="">` : ""}
      <div class="info-body">
        <h3>${escapeHtml(card.title)}</h3>
        <p>${escapeHtml(card.text)}</p>
        ${card.linkUrl
          ? `<a class="info-link" href="${escapeHtml(card.linkUrl)}"
                target="_blank" rel="noopener">
               ${escapeHtml(card.linkText || "ABRIR LINK")} →
             </a>`
          : ""}
      </div>
    </article>`)
    .join("");

  const event = snapshot.alertEvent;
  if (event && event.id !== lastEventId) {
    showAlert(event);
    lastEventId = event.id;
    sessionStorage.setItem("bts_last_alert_event",event.id);
  }

  if (!event) hideAlert();
}

function localFallback() {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
    return normalizeConfig(stored?.config || {});
  } catch {
    return normalizeConfig({});
  }
}

async function load() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/status`,{cache:"no-store"});
    if (!response.ok) throw new Error();
    render(await response.json());
  } catch {
    if (!isLocal) return;

    const config = localFallback();
    render({
      config,
      results:Object.fromEntries(config.shows.map(show => [
        show.id,
        {
          status:"soldout",
          label:"Esgotado",
          message:"Nenhuma atualização confirmada no site oficial.",
          offers:[],
          checkedAt:null
        }
      ])),
      nextCheckAt:new Date(
        Date.now() + Number(config.checkIntervalSeconds || 60) * 1000
      ).toISOString(),
      alertEvent:null
    });
  }
}

async function activateSound() {
  soundUnlocked = true;
  localStorage.setItem("bts_sound","1");

  if (
    "Notification" in window &&
    Notification.permission === "default"
  ) {
    await Notification.requestPermission();
  }

  document.getElementById("enableSound").textContent =
    "✅ ALERTA ATIVADO";
  playAlarm();
}

document.getElementById("enableSound")
  .addEventListener("click",activateSound);
document.getElementById("closeAlert")
  .addEventListener("click",hideAlert);

async function restartCountdownCycle() {
  if (countdownRefreshing) return;
  countdownRefreshing = true;

  const intervalSeconds = Math.max(
    30,
    Number(currentSnapshot?.config?.checkIntervalSeconds || 60)
  );

  // Reinicia imediatamente na tela, sem exigir atualização manual.
  clientNextCheckAt = Date.now() + intervalSeconds * 1000;
  document.getElementById("seconds").textContent =
    String(intervalSeconds);

  // No Render, busca o novo horário confirmado pelo servidor.
  if (!isLocal) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/status`, {
        cache:"no-store"
      });

      if (response.ok) {
        render(await response.json());
      }
    } catch {
      // O contador local continua funcionando mesmo se a consulta atrasar.
    }
  }

  countdownRefreshing = false;
}

setInterval(() => {
  if (!clientNextCheckAt) {
    const intervalSeconds = Math.max(
      30,
      Number(currentSnapshot?.config?.checkIntervalSeconds || 60)
    );
    clientNextCheckAt = Date.now() + intervalSeconds * 1000;
  }

  const remaining = Math.ceil(
    (clientNextCheckAt - Date.now()) / 1000
  );

  if (remaining <= 0) {
    document.getElementById("seconds").textContent = "0";
    restartCountdownCycle();
    return;
  }

  document.getElementById("seconds").textContent =
    String(remaining);
},500);

hideAlert();
load().finally(startStatusPolling);

if (!isLocal) {
  const events = new EventSource("/api/events");
  events.addEventListener("status",event => {
    render(JSON.parse(event.data));
  });
}
