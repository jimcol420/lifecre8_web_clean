/* ============================================================
   LifeCre8 — main.js  v1.11.0
   What's new:
   - Add Tile now asks /api/ai-tile for ONE smart plan
   - New "results" tile (clean multi-link list, no iframes)
   - Travel maps get helpful related links alongside the map
============================================================ */

/* ===== Keys & Version ===== */
const K_SECTIONS   = "lifecre8.sections";
const K_ASSIST_ON  = "lifecre8.assistantOn";
const K_CHAT       = "lifecre8.chat";
const K_VERSION    = "lifecre8.version";
const K_PREFS      = "lifecre8.prefs";
const DATA_VERSION = 6;

/* ===== State ===== */
let sections    = JSON.parse(localStorage.getItem(K_SECTIONS)  || "[]");
let assistantOn = localStorage.getItem(K_ASSIST_ON) === null ? true : JSON.parse(localStorage.getItem(K_ASSIST_ON));
let chat        = JSON.parse(localStorage.getItem(K_CHAT)      || "[]");
if (!chat.length) chat = [{ role:'ai', text:"Hi! I'm your AI Assistant. Ask me anything." }];

let prefs = JSON.parse(localStorage.getItem(K_PREFS) || "{}");
if (!prefs.theme)   prefs.theme   = "solar";
if (!prefs.density) prefs.density = "comfortable";
document.body.classList.toggle('theme-ice',        prefs.theme   === 'ice');
document.body.classList.toggle('density-compact',  prefs.density === 'compact');

let dynamicTimers = {};
let liveIntervals = {};

const $  = (q)=>document.querySelector(q);
const $$ = (q)=>Array.from(document.querySelectorAll(q));
const uid = ()=>Math.random().toString(36).slice(2);
const hostOf = (u)=>{ try { return new URL(u).hostname; } catch { return ""; } };

const appEl = document.querySelector(".app");

/* Backdrop for fullscreen */
let fsBackdrop = document.getElementById("fsBackdrop");
if (!fsBackdrop) { fsBackdrop = document.createElement("div"); fsBackdrop.id = "fsBackdrop"; document.body.appendChild(fsBackdrop); }

/* -----------------------------
   Small helpers for tiles
----------------------------- */
function faviconFor(url){
  const host = hostOf(url);
  return host ? `https://www.google.com/s2/favicons?domain=${host}&sz=32` : "";
}

/* -----------------------------
   RESULTS tile (multi-link, no iframes)
----------------------------- */
function resultsTileMarkup(items=[]){
  const rows = (items||[]).map(it=>{
    const fav = faviconFor(it.url);
    const kind = (it.kind||"site").toUpperCase();
    return `
      <div class="res-row">
        <img class="res-ico" src="${fav}" alt="">
        <div class="res-main">
          <div class="res-title">${it.title||hostOf(it.url)||"Link"}</div>
          <div class="res-meta"><span class="badge">${kind}</span> ${hostOf(it.url)}</div>
        </div>
        <a class="btn sm" target="_blank" rel="noopener" href="${it.url}">Open</a>
      </div>
    `;
  }).join("");
  return `<div class="results-tile">${rows || `<div class="muted">No links found.</div>`}</div>`;
}

/* -----------------------------
   Web tile (preview-only)
----------------------------- */
function webTileMarkup(url){
  const host = hostOf(url);
  const fav  = faviconFor(url);
  return `
    <div class="web-tile" data-web data-url="${url}">
      <div class="web-preview">
        <div class="web-header">
          <img class="web-favicon" src="${fav}" alt="">
          <div>
            <div class="web-title">${host || url}</div>
            <div class="web-host">${url}</div>
          </div>
        </div>
        <div class="web-actions">
          <a class="btn sm" href="${url}" target="_blank" rel="noopener">Open</a>
        </div>
        <div class="muted" style="margin-top:6px">Some sites block embedding. Use Open to view.</div>
      </div>
    </div>
  `;
}

/* -----------------------------
   Maps tile with related links
----------------------------- */
function mapsTileMarkup(q, related=[]){
  const embed   = `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
  const open    = `https://www.google.com/maps/search/${encodeURIComponent(q)}`;
  const booking = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(q)}`;
  const trip    = `https://www.tripadvisor.com/Search?q=${encodeURIComponent(q)}`;

  const relatedList = (related||[]).map(r=>`
    <a class="rlink" href="${r.url}" target="_blank" rel="noopener">
      <span class="badge">${(r.kind||'site').toUpperCase()}</span>
      <span>${r.title || hostOf(r.url) || r.url}</span>
    </a>`).join("");

  return `
    <div class="maps-tile" data-maps>
      <div class="web-actions" style="margin-bottom:8px;display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn sm" href="${open}" target="_blank" rel="noopener">Open Maps</a>
        <a class="btn sm" href="${booking}" target="_blank" rel="noopener">Booking</a>
        <a class="btn sm" href="${trip}" target="_blank" rel="noopener">Tripadvisor</a>
      </div>
      <div class="maps-grid">
        <iframe class="map" src="${embed}" style="width:100%;height:320px;border:0;border-radius:10px"></iframe>
        <div class="related">${relatedList}</div>
      </div>
    </div>
  `;
}

/* -----------------------------
   Seed tiles (kept lean)
----------------------------- */
function defaultSections(){
  return [
    { id: uid(), type:"rss", title:"Daily Brief", content:`<div class="muted">Loading…</div>`, meta:{ feeds:["https://feeds.bbci.co.uk/news/rss.xml"] } },
    { id: uid(), type:"web", title:"BBC News", content:webTileMarkup("https://www.bbc.com"), meta:{ url:"https://www.bbc.com" } },
  ];
}

/* -----------------------------
   Storage versioning / seed
----------------------------- */
function ensureVersion(){
  const current = parseInt(localStorage.getItem(K_VERSION) || "0", 10);
  if (!sections.length){
    sections = defaultSections();
    localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
  }
  if (current !== DATA_VERSION){
    localStorage.setItem(K_VERSION, String(DATA_VERSION));
  }
}

/* -----------------------------
   Rendering
----------------------------- */
function tileContentFor(s){
  switch (s.type){
    case "web":    return webTileMarkup(s.meta?.url || "https://example.com");
    case "maps":   return mapsTileMarkup(s.meta?.q || "holiday ideas", s.meta?.related || []);
    case "results":return resultsTileMarkup(s.meta?.items || []);
    case "rss":    return s.content || `<div class="muted">Loading…</div>`;
    default:       return s.content || "Empty";
  }
}

function cardHeaderActions(id){
  return `
    <div class="actions">
      <button class="btn sm settingsBtn" data-id="${id}">Settings</button>
      <button class="btn sm expandBtn" data-id="${id}">⤢ Expand</button>
      <button class="btn sm removeBtn" data-id="${id}">Remove</button>
    </div>
  `;
}

function render(){
  const grid = $("#grid");
  grid.innerHTML = "";
  sections.forEach(s=>{
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = s.id;
    card.dataset.type = s.type;
    card.innerHTML = `
      <h3><span class="title">${s.title}</span>${cardHeaderActions(s.id)}</h3>
      <div class="content">${tileContentFor(s)}</div>
    `;
    grid.appendChild(card);
  });
}

/* -----------------------------
   Delegated handlers (expand, remove, settings)
----------------------------- */
(function attachDelegatesOnce(){
  const grid = $("#grid");

  // Expand
  grid.addEventListener("click", (e)=>{
    const btn = e.target.closest(".expandBtn");
    if (!btn) return;
    const card = btn.closest(".card");
    if (!card) return;
    const full = card.classList.toggle("card-full");
    document.body.style.overflow = full ? "hidden" : "";
    fsBackdrop.classList.toggle("show", full);
    btn.textContent = full ? "Close" : "⤢ Expand";
  });

  // Remove
  grid.addEventListener("click", (e)=>{
    const btn = e.target.closest(".removeBtn");
    if (!btn) return;
    const id = btn.dataset.id;
    sections = sections.filter(s=>s.id !== id);
    localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
    render();
  });

  // Settings (web/maps/results only)
  grid.addEventListener("click", (e)=>{
    const btn = e.target.closest(".settingsBtn");
    if (!btn) return;
    const id = btn.dataset.id;
    const s = sections.find(x=>x.id===id);
    if (!s) return;

    let fields = `<div class="muted">No settings for this tile.</div>`;
    if (s.type==="web"){
      fields = `
        <div class="field"><label>URL</label>
          <input class="input" id="set_url" value="${s.meta?.url||''}">
        </div>`;
    } else if (s.type==="maps"){
      fields = `
        <div class="field"><label>Maps search</label>
          <input class="input" id="set_maps_q" value="${s.meta?.q||''}">
        </div>`;
    } else if (s.type==="results"){
      fields = `<div class="muted">This list is generated by AI. Re-run Add Tile to refresh.</div>`;
    }

    const html = `
      <div class="modal-card">
        <h2>Settings — ${s.title}</h2>
        ${fields}
        <div class="actions" style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
          <button class="btn sm" data-action="cancel">Cancel</button>
          <button class="btn sm primary" data-action="save" id="settingsSaveBtn">Save</button>
        </div>
      </div>`;
    __openModal(html);

    $("#settingsSaveBtn")?.addEventListener("click", ()=>{
      if (s.type==="web"){
        const url = $("#set_url")?.value?.trim() || s.meta?.url || "";
        s.meta = {...(s.meta||{}), url};
        s.content = webTileMarkup(url);
      } else if (s.type==="maps"){
        const q = $("#set_maps_q")?.value?.trim() || s.meta?.q || "";
        s.meta = {...(s.meta||{}), q};
        s.content = mapsTileMarkup(q, s.meta.related||[]);
      }
      localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
      __closeModal(); render();
    }, { once:true });
  });

  // Backdrop close
  fsBackdrop.addEventListener("click", ()=>{
    const open = document.querySelector(".card.card-full");
    if (!open) return;
    open.classList.remove("card-full");
    document.body.style.overflow = "";
    fsBackdrop.classList.remove("show");
    const btn = open.querySelector(".expandBtn"); if (btn) btn.textContent = "⤢ Expand";
  });
})();

/* -----------------------------
   Add Tile (calls /api/ai-tile)
----------------------------- */
const addBtn     = $("#addTileBtnTop");
const tileMenu   = $("#tileMenu");
const tileSearch = $("#tileSearch");

addBtn?.addEventListener("click", ()=>{
  tileMenu.classList.toggle("hidden");
  if (!tileMenu.classList.contains("hidden")) tileSearch.focus();
});

tileSearch?.addEventListener("keydown", async (e)=>{
  if (e.key !== "Enter") { if (e.key==="Escape") tileMenu.classList.add("hidden"); return; }
  const q = tileSearch.value.trim();
  if (!q) return;

  try {
    const r = await fetch(`/api/ai-tile?q=${encodeURIComponent(q)}`);
    if (!r.ok) throw new Error("ai-tile failed");
    const { tile } = await r.json();

    let t = null;
    if (tile?.type === "maps") {
      t = { id: uid(), type:"maps", title: tile.title || `Search — ${q}`, meta:{ q: tile.q, related: tile.related||[] }, content: mapsTileMarkup(tile.q, tile.related||[]) };
    } else if (tile?.type === "results") {
      t = { id: uid(), type:"results", title: tile.title || `Results — ${q}`, meta:{ items: tile.items||[] }, content: resultsTileMarkup(tile.items||[]) };
    } else if (tile?.url) {
      t = { id: uid(), type:"web", title: tile.title || (hostOf(tile.url)||"Web"), meta:{ url: tile.url }, content: webTileMarkup(tile.url) };
    }

    if (!t) throw new Error("no tile returned");

    sections.unshift(t);
    localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
    render();
    tileMenu.classList.add("hidden");
    tileSearch.value = "";
  } catch (err) {
    // Very safe fallback — at least give the user something to click
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
    const t = { id: uid(), type:"results", title:`Results — ${q}`, meta:{ items:[{kind:"search", title:"Open Google results", url: searchUrl}] }, content: resultsTileMarkup([{kind:"search", title:"Open Google results", url: searchUrl}]) };
    sections.unshift(t);
    localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
    render();
    tileMenu.classList.add("hidden");
    tileSearch.value = "";
  }
});

/* -----------------------------
   Assistant chat (unchanged from your working version)
----------------------------- */
const assistantToggle = $("#assistantToggle");
const assistantPanel  = $("#assistantPanel");
const chatLog   = $("#assistantChat");
const chatForm  = $("#chatForm");
const chatInput = $("#chatInput");

function updateAssistant(){
  assistantPanel && (assistantPanel.style.display = assistantOn ? "block" : "none");
  assistantToggle?.classList.toggle("primary", assistantOn);
  appEl?.classList.toggle("no-right", !assistantOn);
  localStorage.setItem(K_ASSIST_ON, JSON.stringify(assistantOn));
}
assistantToggle?.addEventListener("click", (e)=>{ e.preventDefault(); assistantOn=!assistantOn; updateAssistant(); });

function renderChat(){
  if (!chatLog) return;
  chatLog.innerHTML = "";
  chat.forEach(m=>{
    const d = document.createElement("div");
    d.className = `msg ${m.role}`;
    d.textContent = m.text;
    chatLog.appendChild(d);
  });
  chatLog.scrollTop = chatLog.scrollHeight;
}
function addChat(role, text){
  chat.push({role, text});
  localStorage.setItem(K_CHAT, JSON.stringify(chat));
  renderChat();
}

// POST chat history to /api/ai-chat
chatForm?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  addChat("user", text);
  chatInput.value = "";
  try {
    const r = await fetch("/api/ai-chat", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ q: text, messages: chat }),
    });
    const j = await r.json();
    addChat("ai", j.message || "…");
  } catch {
    addChat("ai", "I couldn't reach the chat service just now. Try again in a moment.");
  }
});

/* -----------------------------
   Modal helpers (simple)
----------------------------- */
(function modalHelpers(){
  const modal = document.getElementById("modal");
  const backdrop = document.getElementById("fsBackdrop");
  window.__openModal = function(html){
    if (!modal) return;
    modal.innerHTML = html || "";
    modal.classList.remove("hidden"); modal.classList.add("show");
    document.body.style.overflow = "hidden";
    backdrop?.classList.remove("show");
  };
  window.__closeModal = function(){
    if (!modal) return;
    modal.classList.add("hidden"); modal.classList.remove("show");
    modal.innerHTML = ""; document.body.style.overflow = "";
    backdrop?.classList.remove("show");
  };
  modal?.addEventListener("click", (e)=>{
    if (e.target === modal) window.__closeModal();
    const closeBtn = e.target.closest('[data-action="cancel"],[data-action="close"],[data-action="dismiss"]');
    const saveBtn  = e.target.closest('[data-action="save"]');
    if (closeBtn || saveBtn) window.__closeModal();
  });
  document.addEventListener("keydown", (e)=>{ if (e.key==="Escape") window.__closeModal(); });
})();

/* -----------------------------
   Init
----------------------------- */
document.addEventListener("DOMContentLoaded", ()=>{
  $("#yr") && ($("#yr").textContent = new Date().getFullYear());
  ensureVersion();
  updateAssistant();
  renderChat();
  render();
});
