/* ============================================================
   LifeCre8 — main.js  v1.9.8
   - Add-Tile uses /api/ai-plan (single tile)
   - Travel → Maps. Recipes → RSS. Shopping → Web. YT → YouTube.
   - AI Assistant re-wired (buttons responsive; adds a tile).
   - Keeps previous layout/tiles behavior; safe minimal changes.
============================================================ */

/* ===== Keys & Version ===== */
const K_SECTIONS = "lifecre8.sections";
const K_ASSIST_ON = "lifecre8.assistantOn";
const K_CHAT = "lifecre8.chat";
const K_VERSION = "lifecre8.version";
const DATA_VERSION = 5;

/* ===== State ===== */
let sections = JSON.parse(localStorage.getItem(K_SECTIONS) || "[]");
let assistantOn = localStorage.getItem(K_ASSIST_ON) === null
  ? true
  : JSON.parse(localStorage.getItem(K_ASSIST_ON));
let chat = JSON.parse(localStorage.getItem(K_CHAT) || "[]");
if (!chat.length) chat = [{ role: "ai", text: "Hi! I'm your AI Assistant. Ask me anything." }];

/* ===== Shorthands ===== */
const $ = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));
const uid = () => Math.random().toString(36).slice(2);
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ""; } };

/* ===== Presets (RSS / YouTube / Stocks kept simple) ===== */
const RSS_PRESETS = {
  uk: [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://www.theguardian.com/uk-news/rss",
  ],
};
const YT_DEFAULTS = ["M7lc1UVf-VE", "5qap5aO4i9A", "jfKfPfyJRdk"];

/* ===== Backdrop for fullscreen ===== */
let fsBackdrop = document.getElementById("fsBackdrop");
if (!fsBackdrop) {
  fsBackdrop = document.createElement("div");
  fsBackdrop.id = "fsBackdrop";
  document.body.appendChild(fsBackdrop);
}

/* -----------------------------
   Core tile renderers
----------------------------- */
function webTileMarkup(url, mode = "preview") {
  const host = hostOf(url);
  const favicon = host ? `https://www.google.com/s2/favicons?domain=${host}&sz=32` : "";
  if (mode === "embed") {
    return `
      <div class="web-tile" data-web data-url="${url}" data-mode="embed">
        <div class="web-actions">
          <button class="btn sm web-toggle" data-mode="preview">Preview</button>
          <a class="btn sm" href="${url}" target="_blank" rel="noopener">Open</a>
        </div>
        <iframe src="${url}" style="width:100%;height:300px;border:0;border-radius:10px;background:#0a1522"></iframe>
        <div class="muted">If this is blank, the site likely blocks iframes. Use Preview/Open.</div>
      </div>`;
  }
  return `
    <div class="web-tile" data-web data-url="${url}" data-mode="preview">
      <div class="web-preview">
        <div class="web-header">
          <img class="web-favicon" src="${favicon}" alt="">
          <div>
            <div class="web-title">${host || url}</div>
            <div class="web-host">${url}</div>
          </div>
        </div>
        <div class="web-actions">
          <button class="btn sm web-toggle" data-mode="embed">Embed</button>
          <a class="btn sm" href="${url}" target="_blank" rel="noopener">Open</a>
        </div>
        <div class="muted" style="margin-top:6px">Preview mode avoids iframe blocks. Try Embed; if it fails, use Open.</div>
      </div>
    </div>`;
}

function mapsTileMarkup(q) {
  const embed = `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
  const open = `https://www.google.com/maps/search/${encodeURIComponent(q)}`;
  const booking = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(q)}`;
  const trip = `https://www.tripadvisor.com/Search?q=${encodeURIComponent(q)}`;
  return `
    <div data-maps>
      <div class="web-actions" style="margin-bottom:8px;display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn sm" href="${open}" target="_blank" rel="noopener">Open Maps</a>
        <a class="btn sm" href="${booking}" target="_blank" rel="noopener">Booking</a>
        <a class="btn sm" href="${trip}" target="_blank" rel="noopener">Tripadvisor</a>
      </div>
      <iframe src="${embed}" style="width:100%;height:320px;border:0;border-radius:10px"></iframe>
    </div>`;
}

function ytEmbed(id) { return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`; }
function ytMarkup(list, cur) {
  const ids = list && list.length ? list : YT_DEFAULTS;
  const active = cur && ids.includes(cur) ? cur : ids[0];
  const items = ids.map(id => `
    <div class="yt-item ${id===active?'active':''}" data-vid="${id}">
      <img class="yt-thumb" src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="">
      <div class="yt-title">Video ${id}</div>
    </div>`).join("");
  return `
    <div class="yt-tile" data-yt data-current="${active}" data-playlist="${ids.join(',')}">
      <div class="yt-main">
        <iframe class="yt-embed" src="${ytEmbed(active)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
      </div>
      <div class="yt-list">${items}</div>
    </div>`;
}

function rssLoadingMarkup() {
  return `
    <div class="rss" data-rss>
      <div class="rss-controls"><button class="btn sm rss-refresh">Refresh</button></div>
      <div class="muted">Loading…</div>
    </div>`;
}
function rssListMarkup(items) {
  const list = (items || []).map(i => `
    <div class="rss-item" style="display:flex; gap:10px; align-items:flex-start;">
      ${i.image ? `<img src="${i.image}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--border)" />`
                : `<div style="width:56px;height:56px;border-radius:8px;border:1px solid var(--border);background:#0a1522"></div>`}
      <div>
        <a href="${i.link}" target="_blank" rel="noopener">${i.title}</a>
        <div class="muted">${i.source || ''} ${i.time ? `— ${i.time}`:''}</div>
      </div>
    </div>`).join("");
  return `
    <div class="rss" data-rss>
      <div class="rss-controls"><button class="btn sm rss-refresh">Refresh</button></div>
      ${list}
    </div>`;
}
function loadRssInto(card, feeds, attempt=1) {
  const content = card.querySelector(".content");
  if (!feeds || !feeds.length || !content) return;
  const url = `/api/rss?full=1&url=${encodeURIComponent(feeds[0])}`;
  fetch(url)
    .then(r=>r.json())
    .then(data=>{
      const items = (data.items||[]).slice(0,10);
      content.innerHTML = rssListMarkup(items);
    })
    .catch(()=>{
      if (attempt < 2) setTimeout(()=>loadRssInto(card, feeds, attempt+1), 800);
      else content.innerHTML = `<div class="muted">Couldn’t load news. Try Refresh.</div>`;
    });
}

function galleryMarkup(urls) {
  const imgs = (urls || []).map(u => `<img src="${u}" alt="">`).join("");
  return `
    <div class="gallery-tile" data-gallery>
      <div class="gallery-view"><img alt=""></div>
      <div class="gallery">${imgs}</div>
    </div>`;
}

/* -----------------------------
   Render all cards
----------------------------- */
function tileContentFor(section) {
  switch (section.type) {
    case "web":      return webTileMarkup(section.meta?.url, section.meta?.mode || "preview");
    case "maps":     return mapsTileMarkup(section.meta?.q || "nearby");
    case "youtube":  return ytMarkup(section.meta?.playlist, section.meta?.current);
    case "rss":      return section.content || rssLoadingMarkup();
    case "gallery":  return galleryMarkup(section.meta?.urls || section.meta?.images || []);
    default:         return section.content || "Empty";
  }
}
function cardHeaderActions(id){
  return `
    <div class="actions">
      <button class="btn sm settingsBtn" data-id="${id}">Settings</button>
      <button class="btn sm expandBtn" data-id="${id}">⤢ Expand</button>
      <button class="btn sm removeBtn" data-id="${id}">Remove</button>
    </div>`;
}
function render() {
  const grid = $("#grid");
  grid.innerHTML = "";
  sections.forEach(s=>{
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = s.id;
    card.dataset.type = s.type || "interest";
    card.innerHTML = `
      <h3><span class="title">${s.title}</span>${cardHeaderActions(s.id)}</h3>
      <div class="content">${tileContentFor(s)}</div>`;
    grid.appendChild(card);
  });
  // kick RSS loads
  $$('.card[data-type="rss"]').forEach(card=>{
    const id = card.dataset.id;
    const s = sections.find(x=>x.id===id);
    const feeds = s?.meta?.feeds || RSS_PRESETS.uk;
    loadRssInto(card, feeds);
  });
}

/* -----------------------------
   Helpers to add tiles from planner
----------------------------- */
function addTileFromPlan(t) {
  if (!t) return;
  if (t.type === "web") {
    sections.unshift({
      id: uid(), type: "web", title: t.title || (hostOf(t.url)||"Web"),
      meta: { url: t.url, mode: "preview" }, content: webTileMarkup(t.url, "preview")
    });
  } else if (t.type === "maps") {
    sections.unshift({
      id: uid(), type: "maps", title: t.title || `Search — ${t.q}`,
      meta: { q: t.q }, content: mapsTileMarkup(t.q)
    });
  } else if (t.type === "rss") {
    sections.unshift({
      id: uid(), type: "rss", title: t.title || "Daily Brief",
      meta: { feeds: t.feeds && t.feeds.length ? t.feeds : RSS_PRESETS.uk },
      content: rssLoadingMarkup()
    });
  } else if (t.type === "youtube") {
    const list = t.playlist && t.playlist.length ? t.playlist : YT_DEFAULTS;
    const cur = list[0];
    sections.unshift({
      id: uid(), type: "youtube", title: t.title || "YouTube",
      meta: { playlist: list, current: cur }, content: ytMarkup(list, cur)
    });
  } else if (t.type === "gallery") {
    sections.unshift({
      id: uid(), type: "gallery", title: t.title || "Gallery",
      meta: { urls: t.images || [] }, content: galleryMarkup(t.images || [])
    });
  }
  localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
  render();
}

/* -----------------------------
   UI wiring (top buttons + assistant)
----------------------------- */
function wireTopButtons() {
  // Add Tile launcher is assumed existing in your HTML already
  const addBtn = $("#addTileBtnTop");
  const tileMenu = $("#tileMenu");
  const tileSearch = $("#tileSearch");

  addBtn?.addEventListener("click", ()=>{
    tileMenu?.classList.toggle("hidden");
    if (!tileMenu?.classList.contains("hidden")) tileSearch?.focus();
  });

  tileSearch?.addEventListener("keydown", (e)=>{
    if (e.key !== "Enter") { if (e.key === "Escape") tileMenu?.classList.add("hidden"); return; }
    const q = (tileSearch.value || "").trim();
    if (!q) return;
    tileMenu?.classList.add("hidden");
    fetch(`/api/ai-plan?q=${encodeURIComponent(q)}`)
      .then(r=>r.json())
      .then(({tiles})=>{
        const t = (tiles||[])[0];
        addTileFromPlan(t);
      })
      .catch(()=> {
        addTileFromPlan({ type:"web", url:`https://www.google.com/search?q=${encodeURIComponent(q)}`, title:`Search — ${q}` });
      });
  });

  // Settings button (optional modal toggle if you have one)
  $("#settingsBtnTop")?.addEventListener("click", ()=>{
    document.body.classList.toggle("show-settings");
  });

  // AI Assistant toggle (fixes “unresponsive”)
  const aiToggle = $("#aiAssistantBtn");
  const aiPanel  = $("#assistantPanel");
  aiToggle?.addEventListener("click", ()=>{
    aiPanel?.classList.toggle("show");
    localStorage.setItem(K_ASSIST_ON, JSON.stringify(!!aiPanel?.classList.contains("show")));
  });
}

function wireAssistant() {
  const panel = $("#assistantPanel");
  const input = $("#aiInput");
  const send  = $("#aiSendBtn");
  const feed  = $("#aiFeed");

  const push = (role, text) => {
    chat.push({ role, text });
    localStorage.setItem(K_CHAT, JSON.stringify(chat));
    if (feed) {
      const b = document.createElement("div");
      b.className = `msg ${role}`;
      b.textContent = text;
      feed.appendChild(b);
      feed.scrollTop = feed.scrollHeight;
    }
  };

  send?.addEventListener("click", ()=>{
    const q = (input?.value || "").trim();
    if (!q) return;
    push("user", q);
    input.value = "";
    fetch(`/api/ai-plan?q=${encodeURIComponent(q)}`)
      .then(r=>r.json())
      .then(({message, tiles})=>{
        const t = (tiles||[])[0];
        if (t) addTileFromPlan(t);
        push("ai", t ? `Done — added **${t.title || t.type}**.` : (message || "Okay."));
      })
      .catch(()=> push("ai","I couldn’t reach the planner. Try again."));
  });

  input?.addEventListener("keydown",(e)=>{ if (e.key==="Enter") send?.click(); });

  // Persist initial show/hide
  const aiPanel = $("#assistantPanel");
  if (assistantOn) aiPanel?.classList.add("show"); else aiPanel?.classList.remove("show");
}

/* -----------------------------
   Grid delegated handlers
----------------------------- */
(function wireGrid(){
  const grid = $("#grid");

  // Expand
  grid?.addEventListener("click",(e)=>{
    const btn = e.target.closest(".expandBtn"); if (!btn) return;
    const card = btn.closest(".card"); if (!card) return;
    const open = card.classList.toggle("card-full");
    document.body.style.overflow = open ? "hidden" : "";
    fsBackdrop.classList.toggle("show", open);
    btn.textContent = open ? "Close" : "⤢ Expand";
  });

  // Remove
  grid?.addEventListener("click",(e)=>{
    const btn = e.target.closest(".removeBtn"); if (!btn) return;
    const id = btn.dataset.id;
    sections = sections.filter(s=>s.id!==id);
    localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
    render();
  });

  // Web preview <-> embed
  grid?.addEventListener("click",(e)=>{
    const toggle = e.target.closest(".web-toggle"); if (!toggle) return;
    const card = e.target.closest(".card");
    const tile = e.target.closest("[data-web]");
    if (!card || !tile) return;
    const id = card.dataset.id;
    const s = sections.find(x=>x.id===id); if (!s) return;
    const url = tile.dataset.url;
    const nextMode = toggle.dataset.mode;
    s.meta = {...(s.meta||{}), url, mode: nextMode};
    s.content = webTileMarkup(url, nextMode);
    localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
    card.querySelector(".content").innerHTML = s.content;
  });

  // RSS refresh
  grid?.addEventListener("click",(e)=>{
    const refresh = e.target.closest(".rss-refresh"); if (!refresh) return;
    const card = e.target.closest(".card"); if (!card) return;
    const s = sections.find(x=>x.id===card.dataset.id); if (!s) return;
    const feeds = s.meta?.feeds || RSS_PRESETS.uk;
    loadRssInto(card, feeds);
  });

  // YouTube swap
  grid?.addEventListener("click",(e)=>{
    const item = e.target.closest(".yt-item"); if (!item) return;
    const container = item.closest("[data-yt]"); if (!container) return;
    const newId = item.dataset.vid;
    const iframe = container.querySelector("iframe.yt-embed");
    container.querySelectorAll(".yt-item").forEach(el=>el.classList.remove("active"));
    item.classList.add("active");
    iframe.src = ytEmbed(newId);
  });

  // Backdrop closes fullscreen
  fsBackdrop.addEventListener("click", ()=>{
    const open = $(".card.card-full"); if (!open) return;
    open.classList.remove("card-full");
    document.body.style.overflow = "";
    fsBackdrop.classList.remove("show");
    open.querySelector(".expandBtn").textContent = "⤢ Expand";
  });
})();

/* -----------------------------
   Seed + render
----------------------------- */
function ensureVersion(){
  const cur = parseInt(localStorage.getItem(K_VERSION) || "0", 10);
  if (!sections.length) {
    sections = [
      { id: uid(), type:"rss", title:"Daily Brief", meta:{ feeds: RSS_PRESETS.uk }, content: rssLoadingMarkup() },
      { id: uid(), type:"web", title:"BBC News", meta:{ url:"https://www.bbc.com", mode:"preview" }, content: webTileMarkup("https://www.bbc.com","preview") },
      { id: uid(), type:"youtube", title:"YouTube", meta:{ playlist:[...YT_DEFAULTS], current:YT_DEFAULTS[0] }, content: ytMarkup(YT_DEFAULTS, YT_DEFAULTS[0]) },
    ];
    localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
  }
  if (cur !== DATA_VERSION) localStorage.setItem(K_VERSION, String(DATA_VERSION));
}

/* -----------------------------
   Init
----------------------------- */
document.addEventListener("DOMContentLoaded", ()=>{
  $("#yr") && ($("#yr").textContent = new Date().getFullYear());
  ensureVersion();
  render();
  wireTopButtons();
  wireAssistant();
});
/* ============================================================
   LifeCre8 — Safety Footer (AI assistant + top buttons wiring)
   - No dependencies on earlier code; safe to paste at EOF.
   - Binds the "AI Assistant" header button to show/hide panel.
   - Makes the assistant input + Send button actually submit.
   - Calls itself on DOMContentLoaded (no changes to your init).
============================================================ */

(function () {
  const K_ASSIST_ON = "lifecre8.assistantOn";

  // Utility: query helpers
  const $  = (q, root=document) => root.querySelector(q);
  const $$ = (q, root=document) => Array.from(root.querySelectorAll(q));

  // Find first button whose text matches /regex/i
  function buttonByText(re) {
    const btns = $$("button, .btn");
    return btns.find(b => re.test(b.textContent || ""));
  }

  // --- Assistant panel wiring ---------------------------------------------
  function wireAssistant() {
    if (window.__wiredAssistant) return;
    window.__wiredAssistant = true;

    // Try to locate the right-side assistant panel
    const panel =
      $("#assistantPanel") ||
      $(".assistant-panel") ||
      $(".ai-assistant") ||
      $("[data-assistant]") ||
      // last resort: the right column that contains the input placeholder
      $$("div,aside,section").find(el => /AI Assistant/i.test(el.textContent || "")) ||
      null;

    // Input + send button (be generous with selectors)
    const input =
      (panel && (panel.querySelector('input[type="text"]') ||
                 panel.querySelector('textarea') ||
                 panel.querySelector('input[placeholder^="Ask me anything"]'))) || null;

    let sendBtn = panel && (
      panel.querySelector('button[type="submit"]') ||
      panel.querySelector('.ai-send') ||
      // find a button that literally says "Send"
      $$("button, .btn", panel).find(b => /^(send)$/i.test((b.textContent || "").trim()))
    );

    // Create a simple log area if none exists (so you see responses)
    let log = panel && panel.querySelector(".ai-log");
    if (panel && !log) {
      log = document.createElement("div");
      log.className = "ai-log";
      log.style.cssText = "display:grid; gap:8px; padding:8px 0;";
      panel.insertBefore(log, panel.firstChild);
    }

    // Helper to append messages
    function appendMsg(role, text) {
      if (!log) return;
      const row = document.createElement("div");
      row.className = `ai-row ${role}`;
      row.style.cssText = "display:flex; gap:8px; align-items:flex-start;";
      const badge = document.createElement("div");
      badge.textContent = role === "user" ? "🟠" : "🔵";
      const body = document.createElement("div");
      body.textContent = text;
      row.appendChild(badge); row.appendChild(body);
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
    }

    async function askAI(q) {
      // Try your /api/ai-search first; fall back to echo if not available
      try {
        const r = await fetch(`/api/ai-search?q=${encodeURIComponent(q)}`);
        if (!r.ok) throw new Error("ai-search unavailable");
        const data = await r.json();
        // Prefer a 'reply' or 'summary' field if present
        const reply = data.reply || data.summary || JSON.stringify(data);
        return typeof reply === "string" ? reply : String(reply);
      } catch {
        return `I’d search and summarise results for: "${q}". (AI endpoint not reachable right now.)`;
      }
    }

    async function handleSend() {
      if (!input) return;
      const q = (input.value || "").trim();
      if (!q) return;
      input.value = "";
      appendMsg("user", q);
      // small delay so UI feels responsive
      await new Promise(r => setTimeout(r, 60));
      const ans = await askAI(q);
      appendMsg("ai", ans);
    }

    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      });
    }
    if (sendBtn) {
      sendBtn.addEventListener("click", (e) => {
        e.preventDefault();
        handleSend();
      });
    }
  }

  // --- Top buttons: AI Assistant toggle ------------------------------------
  function applyAssistantVisibility() {
    const on = JSON.parse(localStorage.getItem(K_ASSIST_ON) ?? "true");
    // Support both classnames we’ve used historically
    document.body.classList.toggle("no-right", !on);          // older layout
    document.body.classList.toggle("assistant-closed", !on);  // newer name
  }

  function wireTopButtons() {
    if (window.__wiredTopBtns) return;
    window.__wiredTopBtns = true;

    // Bind the "AI Assistant" header button by its label text
    const aiBtn = buttonByText(/^\s*AI\s+Assistant\s*$/i);
    if (aiBtn) {
      aiBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const current = JSON.parse(localStorage.getItem(K_ASSIST_ON) ?? "true");
        localStorage.setItem(K_ASSIST_ON, String(!current));
        applyAssistantVisibility();
      });
    }

    // Apply current visibility on first wire
    applyAssistantVisibility();
  }

  // --- Bootstrap (no need to edit your existing init) ----------------------
  document.addEventListener("DOMContentLoaded", () => {
    try { wireTopButtons(); } catch {}
    try { wireAssistant(); } catch {}
  });
})();
/* ============================================================
   LifeCre8 — Safety Footer v2 (buttons + assistant formatter)
   Paste at the very end of js/main.js. No other edits needed.
============================================================ */
(function () {
  // --- storage keys (redeclare safely) ---------------------
  const K_ASSIST_ON = "lifecre8.assistantOn";
  const K_PREFS     = "lifecre8.prefs";
  const K_SECTIONS  = "lifecre8.sections";
  const K_VERSION   = "lifecre8.version";

  // --- tiny helpers ----------------------------------------
  const $  = (q, root=document) => root.querySelector(q);
  const $$ = (q, root=document) => Array.from(root.querySelectorAll(q));
  const byText = (re) => $$("button,.btn").find(b => re.test((b.textContent||"").trim()));

  // =========================================================
  // Assistant panel: wire input + send, pretty print replies
  // =========================================================
  function wireAssistant() {
    if (window.__wiredAssistant) return; window.__wiredAssistant = true;

    // find panel + parts (be generous with selectors)
    const panel =
      $("#assistantPanel") || $(".assistant-panel") || $(".ai-assistant") ||
      $$("aside,section,div").find(el => /AI Assistant/i.test(el?.textContent||""));

    if (!panel) return;

    const input =
      panel.querySelector('textarea') ||
      panel.querySelector('input[type="text"]') ||
      panel.querySelector('input[placeholder^="Ask me anything"]');

    let sendBtn =
      panel.querySelector('button[type="submit"]') ||
      panel.querySelector('.ai-send') ||
      byText(/^(send)$/i);

    // message list (create if missing)
    let log = panel.querySelector(".ai-log");
    if (!log) {
      log = document.createElement("div");
      log.className = "ai-log";
      log.style.cssText = "display:grid;gap:10px;padding:6px 0;max-height:calc(100% - 56px);overflow:auto;";
      panel.insertBefore(log, panel.firstChild);
    }

    function addMsg(role, html) {
      const row = document.createElement("div");
      row.className = `ai-row ${role}`;
      row.style.cssText = "display:flex;gap:8px;align-items:flex-start;";
      const badge = document.createElement("div");
      badge.textContent = role === "user" ? "🟠" : "🔵";
      const body = document.createElement("div");
      body.style.cssText = "white-space:pre-wrap;line-height:1.4";
      body.innerHTML = html;
      row.appendChild(badge); row.appendChild(body);
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
    }

    function fmt(obj) {
      // Try common fields first
      if (typeof obj === "string") return obj;
      const reply = obj?.reply || obj?.answer || obj?.message || obj?.summary;
      if (reply) return String(reply);

      // ai-plan style tiles
      if (Array.isArray(obj?.tiles) && obj.tiles.length) {
        const items = obj.tiles.map(t => {
          if (t.type === "rss" && t.topic) return `• News plan for <strong>${t.topic}</strong>`;
          if (t.type === "maps" && t.q)    return `• Places: <strong>${t.q}</strong>`;
          if (t.type === "web" && t.url)   return `• Web: <a href="${t.url}" target="_blank" rel="noopener">${t.title || t.url}</a>`;
          if (t.type === "gallery")        return `• Gallery (${(t.images||[]).length} images)`;
          if (t.type === "youtube")        return `• YouTube playlist (${(t.playlist||[]).length})`;
          return `• ${t.type || "tile"}`;
        }).join("<br>");
        return items || "I’ve prepared a plan.";
      }

      // fallback: compact JSON, but not the huge dump
      try { return `<code>${JSON.stringify(obj, null, 2)}</code>`; }
      catch { return "I’m not sure how to display that result."; }
    }

    async function askAI(q) {
      // Prefer /api/ai-search; fall back gracefully
      try {
        const r = await fetch(`/api/ai-search?q=${encodeURIComponent(q)}`);
        if (!r.ok) throw new Error("ai-search unavailable");
        return await r.json();
      } catch {
        return { reply: `I’d search & summarise results for: “${q}”. (AI endpoint not reachable right now.)` };
      }
    }

    async function handleSend() {
      if (!input) return;
      const q = (input.value || "").trim();
      if (!q) return;
      input.value = "";
      addMsg("user", q);
      const data = await askAI(q);
      addMsg("ai", fmt(data));
    }

    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
      });
    }
    if (sendBtn) {
      sendBtn.addEventListener("click", (e) => { e.preventDefault(); handleSend(); });
    }
  }

  // ================================================
  // Top bar buttons: AI Assistant toggle + Settings
  // ================================================
  function applyAssistantVisibility() {
    const on = JSON.parse(localStorage.getItem(K_ASSIST_ON) ?? "true");
    document.body.classList.toggle("no-right", !on);          // old name
    document.body.classList.toggle("assistant-closed", !on);  // new name
  }

  function wireTopButtons() {
    if (window.__wiredTopBtns) return; window.__wiredTopBtns = true;

    // AI Assistant toggle
    const aiBtn = byText(/^\s*AI\s+Assistant\s*$/i);
    if (aiBtn) {
      aiBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const cur = JSON.parse(localStorage.getItem(K_ASSIST_ON) ?? "true");
        localStorage.setItem(K_ASSIST_ON, String(!cur));
        applyAssistantVisibility();
      });
    }
    applyAssistantVisibility();

    // Settings modal (lightweight, independent of app modal)
    const setBtn = byText(/^\s*Settings\s*$/i);
    if (setBtn) setBtn.addEventListener("click", openSettingsMini);
  }

  function openSettingsMini(e) {
    e?.preventDefault?.();
    let prefs;
    try { prefs = JSON.parse(localStorage.getItem(K_PREFS) || "{}"); } catch { prefs = {}; }
    const theme   = prefs.theme   || "solar";
    const density = prefs.density || "comfortable";

    const wrap = document.createElement("div");
    wrap.id = "miniSettings";
    wrap.style.cssText = `
      position:fixed;inset:0;z-index:9999;display:grid;place-items:center;
      background:rgba(0,0,0,0.4)`;
    wrap.innerHTML = `
      <div style="min-width:320px;background:#0e1a2a;border:1px solid var(--border);
                  border-radius:12px;padding:16px;box-shadow:0 10px 40px rgba(0,0,0,.4)">
        <h2 style="margin:0 0 12px 0;font-size:18px">Settings</h2>

        <div class="field" style="margin:8px 0">
          <label>Theme</label>
          <select id="mini_theme" class="input">
            <option value="solar" ${theme==='solar'?'selected':''}>Solar</option>
            <option value="ice"   ${theme==='ice'?'selected':''}>Ice</option>
          </select>
        </div>

        <div class="field" style="margin:8px 0">
          <label>Density</label>
          <select id="mini_density" class="input">
            <option value="comfortable" ${density==='comfortable'?'selected':''}>Comfortable</option>
            <option value="compact"     ${density==='compact'?'selected':''}>Compact</option>
          </select>
        </div>

        <div style="display:flex;gap:8px;justify-content:space-between;margin-top:14px">
          <button id="mini_reset"  class="btn">Reset Layout</button>
          <div style="display:flex;gap:8px">
            <button id="mini_cancel" class="btn">Cancel</button>
            <button id="mini_save"   class="btn primary">Save</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    function close(){ wrap.remove(); }

    $("#mini_cancel", wrap).addEventListener("click", close);

    $("#mini_save", wrap).addEventListener("click", () => {
      const newPrefs = {
        theme:   $("#mini_theme", wrap).value,
        density: $("#mini_density", wrap).value
      };
      localStorage.setItem(K_PREFS, JSON.stringify(newPrefs));
      // apply classes immediately
      document.body.classList.toggle('theme-ice', newPrefs.theme === 'ice');
      document.body.classList.toggle('density-compact', newPrefs.density === 'compact');
      if (newPrefs.theme !== 'ice') document.body.classList.remove('theme-ice');
      if (newPrefs.density !== 'compact') document.body.classList.remove('density-compact');
      close();
    });

    $("#mini_reset", wrap).addEventListener("click", () => {
      if (!confirm("Reset layout and reload?")) return;
      localStorage.removeItem(K_SECTIONS);
      localStorage.removeItem(K_VERSION);
      location.reload();
    });

    wrap.addEventListener("click", (ev) => { if (ev.target === wrap) close(); });
  }

  // --- bootstrap (doesn't require touching your init) -----
  document.addEventListener("DOMContentLoaded", () => {
    try { wireTopButtons(); } catch {}
    try { wireAssistant(); }  catch {}
  });
})();
