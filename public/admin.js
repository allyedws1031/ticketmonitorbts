const isLocal = location.hostname === "127.0.0.1" || location.hostname === "localhost" || location.protocol === "file:";
const LOCAL_KEY = "bts_monitor_secure_preview_v2";
let token = sessionStorage.getItem("bts_admin_token") || "";
let currentConfig;
const $ = id => document.getElementById(id);

const defaults = {
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
  pollingSeconds:15,
  monitorEnabled:true,
  visualAlertEnabled:true,
  soundAlertEnabled:true,
  browserNotificationEnabled:true,
  sectorDetailsEnabled:true,
  manualAlert:{enabled:false,message:""},
  shows:[{"id": "28", "day": "QUARTA-FEIRA", "date": "28 DE OUTUBRO", "url": "https://www.ticketmaster.com.br/event/venda-geral-bts-world-tour-arirang-28-10", "buttonText": "ABRIR SITE OFICIAL", "image": "", "extraLinkText": "", "extraLinkUrl": "", "enabled": true, "alertsEnabled": true}, {"id": "30", "day": "SEXTA-FEIRA", "date": "30 DE OUTUBRO", "url": "https://www.ticketmaster.com.br/event/venda-geral-bts-world-tour-arirang-30-10", "buttonText": "ABRIR SITE OFICIAL", "image": "", "extraLinkText": "", "extraLinkUrl": "", "enabled": true, "alertsEnabled": true}, {"id": "31", "day": "SÁBADO", "date": "31 DE OUTUBRO", "url": "https://www.ticketmaster.com.br/event/venda-geral-bts-world-tour-arirang-31-10", "buttonText": "ABRIR SITE OFICIAL", "image": "", "extraLinkText": "", "extraLinkUrl": "", "enabled": true, "alertsEnabled": true}],
  infoCards:[{"title": "LINKS OFICIAIS", "text": "Acesse somente páginas oficiais para comprar seus ingressos.", "image": "", "linkText": "", "linkUrl": ""}, {"title": "ALERTA DE SOM", "text": "Ative o som do navegador para receber o aviso de disponibilidade.", "image": "", "linkText": "", "linkUrl": ""}, {"title": "ATUALIZAÇÃO", "text": "O monitor verifica as páginas automaticamente a cada 1 minuto.", "image": "", "linkText": "", "linkUrl": ""}, {"title": "STATUS", "text": "Esgotado aparece em vermelho e disponível aparece em verde.", "image": "", "linkText": "", "linkUrl": ""}, {"title": "TELEGRAM", "text": "Entre no canal para acompanhar os avisos do projeto.", "image": "", "linkText": "ABRIR CANAL", "linkUrl": "https://t.me/monitorticketmbts"}, {"title": "SEGURANÇA", "text": "O site não solicita dados pessoais nem realiza compras.", "image": "", "linkText": "", "linkUrl": ""}, {"title": "FILA", "text": "O monitor não entra na fila e não reserva ingressos.", "image": "", "linkText": "", "linkUrl": ""}]
};

function esc(value){return String(value ?? "").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]))}
function localData(){try{return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {config:structuredClone(defaults),results:{},logs:[]}}catch{return{config:structuredClone(defaults),results:{},logs:[]}}}
function saveLocal(data){localStorage.setItem(LOCAL_KEY,JSON.stringify(data))}

async function api(path,options={}){
  if(isLocal){
    const data=localData();
    if(path==="/api/admin/login"){
      const body=JSON.parse(options.body||"{}");
      if(body.password!=="admin123")throw new Error("Senha incorreta. Use admin123.");
      return{token:"local"};
    }
    if(path==="/api/admin/config"&&(!options.method||options.method==="GET"))return data;
    if(path==="/api/admin/config"&&options.method==="PUT"){
      data.config=JSON.parse(options.body||"{}");
      data.logs.unshift({at:new Date().toISOString(),message:"Configurações salvas localmente."});
      saveLocal(data);
      return{ok:true};
    }
    if(path==="/api/admin/check-now"){
      data.logs.unshift({at:new Date().toISOString(),message:"Verificação simulada."});
      saveLocal(data);
      return{ok:true};
    }
    if(path==="/api/admin/manual-alert"){
      const body=JSON.parse(options.body||"{}");
      data.alertEvent={
        id:String(Date.now()),
        type:"manual",
        title:"📢 AVISO DO MONITOR",
        message:body.message||"Aviso manual",
        createdAt:new Date().toISOString()
      };
      saveLocal(data);
      return{ok:true,alertEvent:data.alertEvent};
    }
    if(path==="/api/admin/clear-alert"){
      data.alertEvent=null;
      saveLocal(data);
      return{ok:true};
    }
    if(path==="/api/admin/diagnostics"){
      return{
        checking:false,
        nextCheckAt:null,
        results:data.results||{},
        alertEvent:data.alertEvent||null,
        logs:data.logs||[],
        stats:data.stats||{},
        history:data.history||[]
      };
    }
    if(path==="/api/admin/test-alert"){const body=JSON.parse(options.body||"{}");data.config.manualAlert={enabled:true,message:body.message||"Aviso do monitor"};saveLocal(data);return{ok:true}}
    if(path==="/api/admin/clear-alert"){data.config.manualAlert={enabled:false,message:""};saveLocal(data);return{ok:true}}
  }
  const response=await fetch(path,{...options,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"Erro ao conectar.");
  return data;
}

function readImage(file){
  return new Promise((resolve,reject)=>{
    if(!file)return resolve("");
    if(!file.type.startsWith("image/"))return reject(new Error("Selecione uma imagem válida."));
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error("Não foi possível ler a imagem."));
    reader.onload=()=>{
      const image=new Image();
      image.onerror=()=>reject(new Error("Não foi possível abrir a imagem."));
      image.onload=()=>{
        const maxWidth=1920,maxHeight=1080;
        const scale=Math.min(1,maxWidth/image.width,maxHeight/image.height);
        const canvas=document.createElement("canvas");
        canvas.width=Math.max(1,Math.round(image.width*scale));
        canvas.height=Math.max(1,Math.round(image.height*scale));
        canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
        const dataUrl=canvas.toDataURL("image/jpeg",.82);
        if(isLocal)return resolve(dataUrl);
        api("/api/admin/upload",{
          method:"POST",
          body:JSON.stringify({dataUrl})
        }).then(result=>resolve(result.url)).catch(reject);
      };
      image.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function showEditor(show,index){
  return `<div class="editor-card show-editor">
    <div class="editor-header"><h3>Show ${index+1}</h3><button type="button" class="remove-card remove-show">Remover</button></div>
    <div class="toggles">
      <label><input class="show-enabled" type="checkbox" ${show.enabled?"checked":""}> Mostrar e monitorar</label>
      <label><input class="show-alerts" type="checkbox" ${show.alertsEnabled?"checked":""}> Permitir alerta</label>
    </div>
    <div class="show-grid">
      <div><label>ID único</label><input class="show-id" value="${esc(show.id)}"></div>
      <div><label>Dia da semana</label><input class="show-day" value="${esc(show.day)}"></div>
      <div><label>Data</label><input class="show-date" value="${esc(show.date)}"></div>
      <div><label>Texto do botão</label><input class="show-button-text" value="${esc(show.buttonText||"ABRIR SITE OFICIAL")}"></div>
    </div>
    <label>Link oficial monitorado</label><input class="show-url" value="${esc(show.url)}">
    <label>Foto opcional do card</label><input class="show-image-file" type="file" accept="image/*">
    <input class="show-image-data" type="hidden" value="${esc(show.image||"")}">
    <div class="mini-preview" style="${show.image?`background-image:url('${show.image}')`:""}"></div>
    <div class="show-grid">
      <div><label>Texto do link extra</label><input class="show-extra-text" value="${esc(show.extraLinkText||"")}"></div>
      <div><label>Link extra</label><input class="show-extra-url" value="${esc(show.extraLinkUrl||"")}"></div>
    </div>
  </div>`;
}

function infoEditor(card,index){
  return `<div class="editor-card info-editor">
    <div class="editor-header"><h3>Informação ${index+1}</h3><button type="button" class="remove-card remove-info">Remover</button></div>
    <label>Título</label><input class="info-title" value="${esc(card.title||"")}">
    <label>Texto</label><textarea class="info-text">${esc(card.text||"")}</textarea>
    <label>Foto opcional</label><input class="info-image-file" type="file" accept="image/*">
    <input class="info-image-data" type="hidden" value="${esc(card.image||"")}">
    <div class="mini-preview" style="${card.image?`background-image:url('${card.image}')`:""}"></div>
    <div class="form-grid">
      <div><label>Texto do link</label><input class="info-link-text" value="${esc(card.linkText||"")}"></div>
      <div><label>Endereço do link</label><input class="info-link-url" value="${esc(card.linkUrl||"")}"></div>
    </div>
  </div>`;
}

function bindEditors(){
  document.querySelectorAll(".remove-show").forEach(button=>button.onclick=()=>button.closest(".show-editor").remove());
  document.querySelectorAll(".remove-info").forEach(button=>button.onclick=()=>button.closest(".info-editor").remove());
  document.querySelectorAll(".show-image-file").forEach(input=>input.onchange=async()=>{
    const data=await readImage(input.files[0]);
    const editor=input.closest(".show-editor");
    editor.querySelector(".show-image-data").value=data;
    editor.querySelector(".mini-preview").style.backgroundImage=`url("${data}")`;
  });
  document.querySelectorAll(".info-image-file").forEach(input=>input.onchange=async()=>{
    const data=await readImage(input.files[0]);
    const editor=input.closest(".info-editor");
    editor.querySelector(".info-image-data").value=data;
    editor.querySelector(".mini-preview").style.backgroundImage=`url("${data}")`;
  });
}


function renderOperationalData(data){
  const stats=data.stats||{};
  const results=Object.values(data.results||{});
  const average=stats.totalChecks
    ? Math.round((stats.totalDurationMs||0)/Math.max(1,stats.totalChecks))
    : 0;

  if($("monitorOverview")){
    $("monitorOverview").innerHTML=[
      ["Estado",data.checking?"🟡 Verificando agora":"🟢 Rodando"],
      ["Último ciclo",stats.lastCycleAt?new Date(stats.lastCycleAt).toLocaleString("pt-BR"):"—"],
      ["Próximo ciclo",data.nextCheckAt?new Date(data.nextCheckAt).toLocaleString("pt-BR"):"—"],
      ["Duração do último ciclo",`${((stats.lastCycleDurationMs||0)/1000).toFixed(1)} s`]
    ].map(([label,value])=>`<div class="stat-card"><small>${label}</small><strong>${esc(value)}</strong></div>`).join("");
  }

  if($("statsDashboard")){
    $("statsDashboard").innerHTML=[
      ["Verificações hoje",stats.checksToday||0],
      ["Verificações totais",stats.totalChecks||0],
      ["Mudanças detectadas",stats.statusChanges||0],
      ["Alertas enviados",stats.alertsSent||0],
      ["Falhas/indefinidos",stats.failedChecks||0],
      ["Média registrada",`${(average/1000).toFixed(1)} s`]
    ].map(([label,value])=>`<div class="stat-card"><small>${label}</small><strong>${esc(value)}</strong></div>`).join("");
  }

  if($("history")){
    const history=data.history||[];
    $("history").innerHTML=history.length
      ?history.map(item=>`<div class="history-item ${item.changed?"changed":""}">
          <div><b>${esc(item.date||item.showId)}</b> — ${esc(item.label||item.status)}</div>
          <small>${item.at?new Date(item.at).toLocaleString("pt-BR"):"—"} · ${esc(item.message||item.evidence||"")}</small>
        </div>`).join("")
      :"<p class='muted'>O histórico aparecerá após as verificações.</p>";
  }
}

async function loadDashboard(){
  const data=await api("/api/admin/config");
  currentConfig={...defaults,...data.config};
  renderOperationalData(data);
  $("loginBox").hidden=true;
  $("dashboard").hidden=false;
  ["monitorEnabled","visualAlertEnabled","soundAlertEnabled","browserNotificationEnabled","sectorDetailsEnabled","showSocialButtons"].forEach(id=>$(id).checked=!!currentConfig[id]);
  ["headerAlertText","twitterUrl","instagramUrl","telegramUrl","siteSubtitle","siteTitle","siteDescription","showSectionTitle","infoSectionTitle","footerText","checkIntervalSeconds","pollingSeconds"].forEach(id=>$(id).value=currentConfig[id]??"");
    $("coverPreview").style.backgroundImage=currentConfig.coverImage?`url("${currentConfig.coverImage}")`:"";
  $("showsEditor").innerHTML=(currentConfig.shows||[]).map(showEditor).join("");
  $("infoCardsEditor").innerHTML=(currentConfig.infoCards||[]).map(infoEditor).join("");
  bindEditors();
  const results=Object.values(data.results||{});
  $("results").innerHTML=results.length?results.map(result=>`<div class="result"><b>${esc(result.date)}</b> — ${esc(result.label)}<br><small>${esc(result.evidence||"")}</small></div>`).join(""):"<p class='muted'>Ainda não há resultados.</p>";
  $("logs").innerHTML=(data.logs||[]).map(log=>`<div class="log">${new Date(log.at).toLocaleString("pt-BR")} — ${esc(log.message)}</div>`).join("");
}

$("login").onclick=async()=>{try{const data=await api("/api/admin/login",{method:"POST",body:JSON.stringify({password:$("password").value})});token=data.token;sessionStorage.setItem("bts_admin_token",token);await loadDashboard()}catch(error){alert(error.message)}};
$("coverUpload").onchange=async()=>{currentConfig.coverImage=await readImage($("coverUpload").files[0]);$("coverPreview").style.backgroundImage=`url("${currentConfig.coverImage}")`};
$("removeCover").onclick=()=>{currentConfig.coverImage="";$("coverPreview").style.backgroundImage=""};
$("addShow").onclick=()=>{$("showsEditor").insertAdjacentHTML("beforeend",showEditor({id:String(Date.now()),day:"NOVO DIA",date:"NOVA DATA",url:"",buttonText:"ABRIR SITE OFICIAL",image:"",extraLinkText:"",extraLinkUrl:"",enabled:true,alertsEnabled:true},document.querySelectorAll(".show-editor").length));bindEditors()};
$("addInfoCard").onclick=()=>{$("infoCardsEditor").insertAdjacentHTML("beforeend",infoEditor({title:"NOVA INFORMAÇÃO",text:"Digite a informação.",image:"",linkText:"",linkUrl:""},document.querySelectorAll(".info-editor").length));bindEditors()};

$("configForm").onsubmit=async event=>{
  event.preventDefault();
  const shows=[...document.querySelectorAll(".show-editor")].map(editor=>({
    id:editor.querySelector(".show-id").value.trim()||String(Date.now()),
    day:editor.querySelector(".show-day").value,
    date:editor.querySelector(".show-date").value,
    url:editor.querySelector(".show-url").value,
    buttonText:editor.querySelector(".show-button-text").value,
    image:editor.querySelector(".show-image-data").value,
    extraLinkText:editor.querySelector(".show-extra-text").value,
    extraLinkUrl:editor.querySelector(".show-extra-url").value,
    enabled:editor.querySelector(".show-enabled").checked,
    alertsEnabled:editor.querySelector(".show-alerts").checked
  }));
  const infoCards=[...document.querySelectorAll(".info-editor")].map(editor=>({
    title:editor.querySelector(".info-title").value,
    text:editor.querySelector(".info-text").value,
    image:editor.querySelector(".info-image-data").value,
    linkText:editor.querySelector(".info-link-text").value,
    linkUrl:editor.querySelector(".info-link-url").value
  }));
  const payload={
    ...currentConfig,
    headerAlertText:$("headerAlertText").value,
    showSocialButtons:$("showSocialButtons").checked,
    twitterUrl:$("twitterUrl").value,
    instagramUrl:$("instagramUrl").value,
    telegramUrl:$("telegramUrl").value,
    siteSubtitle:$("siteSubtitle").value,
    siteTitle:$("siteTitle").value,
    siteDescription:$("siteDescription").value,
    monitorEnabled:$("monitorEnabled").checked,
    visualAlertEnabled:$("visualAlertEnabled").checked,
    soundAlertEnabled:$("soundAlertEnabled").checked,
    browserNotificationEnabled:$("browserNotificationEnabled").checked,
    sectorDetailsEnabled:$("sectorDetailsEnabled").checked,
    checkIntervalSeconds:Number($("checkIntervalSeconds").value)||60,
    pollingSeconds:Number($("pollingSeconds").value)||15,
    showSectionTitle:$("showSectionTitle").value,
    infoSectionTitle:$("infoSectionTitle").value,
    footerText:$("footerText").value,
    shows,
    infoCards
  };
  try{await api("/api/admin/config",{method:"PUT",body:JSON.stringify(payload)});currentConfig=payload;alert("Alterações salvas.");await loadDashboard()}catch(error){alert(error.message)}
};

$("checkNow").onclick=async()=>{await api("/api/admin/check-now",{method:"POST",body:"{}"});alert(isLocal?"Verificação simulada.":"Verificação iniciada.")};

if(isLocal){$("previewNotice").hidden=false;$("password").placeholder="Use admin123"}
if(token)loadDashboard().catch(()=>{token="";sessionStorage.removeItem("bts_admin_token")});


function playAdminSoundTest(){
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  const context=new AudioContextClass();

  [0,450,900,1350,1800].forEach((delay,index)=>{
    setTimeout(()=>{
      const oscillator=context.createOscillator();
      const gain=context.createGain();
      oscillator.type="sine";
      oscillator.frequency.value=index%2?690:940;
      gain.gain.setValueAtTime(.001,context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.24,context.currentTime+.02);
      gain.gain.exponentialRampToValueAtTime(.001,context.currentTime+.35);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime+.38);
    },delay);
  });
}

function renderDiagnostics(data){
  renderOperationalData(data);
  const results=Object.values(data.results||{});
  const eventText=data.alertEvent
    ? `${data.alertEvent.type}: ${data.alertEvent.message}`
    : "Nenhum alerta publicado.";

  $("diagnosticSummary").innerHTML=`
    <div class="diagnostic-head">
      <strong>Diagnóstico do monitor</strong>
      <span>${data.checking?"Verificando agora":"Aguardando"}</span>
    </div>
    <p><b>Próxima verificação:</b> ${
      data.nextCheckAt
        ? new Date(data.nextCheckAt).toLocaleString("pt-BR")
        : "—"
    }</p>
    <p><b>Alerta atual:</b> ${esc(eventText)}</p>
    <div class="diagnostic-results">
      ${results.length
        ? results.map(result=>`
            <div class="diagnostic-item">
              <b>${esc(result.date)}</b>
              <span class="diag-status ${esc(result.status)}">
                ${esc(result.label)}
              </span>
              <small>${esc(result.evidence||result.message||"")}</small>
            </div>
          `).join("")
        : "<small>Ainda não há verificações reais.</small>"}
    </div>
  `;
}

$("testSound").onclick=()=>{
  playAdminSoundTest();
};

$("publishManualAlert").onclick=async()=>{
  try{
    const message=$("manualAlertMessage").value.trim();
    if(!message){
      alert("Digite a mensagem do alerta.");
      return;
    }
    await api("/api/admin/manual-alert",{
      method:"POST",
      body:JSON.stringify({message})
    });
    alert("Alerta liberado no site.");
    await refreshDiagnostics();
  }catch(error){
    alert(error.message);
  }
};

$("clearPublishedAlert").onclick=async()=>{
  try{
    await api("/api/admin/clear-alert",{
      method:"POST",
      body:"{}"
    });
    alert("Alerta retirado do site.");
    await refreshDiagnostics();
  }catch(error){
    alert(error.message);
  }
};

async function refreshDiagnostics(){
  try{
    const data=await api("/api/admin/diagnostics");
    renderDiagnostics(data);
  }catch(error){
    alert(error.message);
  }
}

$("loadDiagnostics").onclick=refreshDiagnostics;
