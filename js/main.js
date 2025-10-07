/* ============================================================
   LifeCre8 — main.js  v1.11.1
   What's new:
   - AI-first Add Tile uses /api/ai-tile for every free-text query
   - Better travel normalization (demonyms + hints, no random “UK”)
   - Daily Brief loads on startup (with retry + friendly error)
   - AI Assistant keeps chat history; POSTs to /api/ai-chat
   - No iframe toggle; clean web tiles with “Open” only
============================================================ */

/* ===== Keys & Version ===== */
const K_SECTIONS   = "lifecre8.sections";
const K_ASSIST_ON  = "lifecre8.assistantOn";
const K_CHAT       = "lifecre8.chat";
const K_VERSION    = "lifecre8.version";
const K_PREFS      = "lifecre8.prefs";
const DATA_VERSION = 6;

/* ===== Presets ===== */
const RSS_PRESETS = {
  uk: [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://www.theguardian.com/uk-news/rss",
  ],
};
const STOCK_PRESETS = {
  "Tech Giants": ["AAPL","MSFT","GOOGL","AMZN","NVDA"],
};

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

/* ===== Utils ===== */
const $  = q => document.querySelector(q);
const $$ = q => Array.from(document.querySelectorAll(q));
const uid = () => Math.random().toString(36).slice(2);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ""; } };

const appEl = document.querySelector(".app");

/* Backdrop for fullscreen */
let fsBackdrop = document.getElementById("fsBackdrop");
if (!fsBackdrop) {
  fsBackdrop = document.createElement("div");
  fsBackdrop.id = "fsBackdrop";
  document.body.appendChild(fsBackdrop);
}

/* -----------------------------
   YouTube helpers
----------------------------- */
const YT_DEFAULTS = [ "M7lc1UVf-VE","5qap5aO4i9A","DWcJFNfaw9c","jfKfPfyJRdk" ];
const ytEmbedSrc = (id) => `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`;
function ytPlaylistMarkup(playlist, currentId) {
  const ids = (playlist && playlist.length) ? playlist : YT_DEFAULTS;
  const cur = currentId && ids.includes(currentId) ? currentId : ids[0];
  const titleFor = (id) => {
    if (id === "M7lc1UVf-VE") return "YouTube IFrame API Demo";
    if (id === "5qap5aO4i9A") return "lofi hip hop radio";
    if (id === "DWcJFNfaw9c") return "Coding Music Mix";
    if (id === "jfKfPfyJRdk") return "lofi beats stream";
    return `Video ${id}`;
  };
  const items = ids.map(id => `
    <div class="yt-item ${id===cur?'active':''}" data-vid="${id}">
      <img class="yt-thumb" src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="">
      <div class="yt-title">${titleFor(id)}</div>
    </div>
  `).join("");
  return `
    <div class="yt-tile" data-yt data-current="${cur}" data-playlist="${ids.join(',')}">
      <div class="yt-main">
        <iframe class="yt-embed" src="${ytEmbedSrc(cur)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
      </div>
      <div class="yt-list">${items}</div>
    </div>
  `;
}

/* -----------------------------
   Web tile (no embed toggle)
----------------------------- */
function webTileMarkup(url) {
  const host = hostOf(url);
  const favicon = host ? `https://www.google.com/s2/favicons?domain=${host}&sz=32` : "";
  return `
    <div class="web-tile" data-web data-url="${url}">
      <div class="web-preview">
        <div class="web-header">
          <img class="web-favicon" src="${favicon}" alt="">
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
   Maps tile (travel intent)
----------------------------- */
function mapsTileMarkup(query){
  const embed   = `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
  const open    = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
  const booking = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(query)}`;
  const trip    = `https://www.tripadvisor.com/Search?q=${encodeURIComponent(query)}`;
  return `
    <div data-maps>
      <div class="web-actions" style="margin-bottom:8px;display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn sm" href="${open}" target="_blank" rel="noopener">Open Maps</a>
        <a class="btn sm" href="${booking}" target="_blank" rel="noopener">Booking</a>
        <a class="btn sm" href="${trip}" target="_blank" rel="noopener">Tripadvisor</a>
      </div>
      <iframe src="${embed}" style="width:100%;height:320px;border:0;border-radius:10px"></iframe>
    </div>
  `;
}

/* ---- Demonyms → Countries & query normalization ---- */
const DEMONYMS = {
  "british":"United Kingdom","english":"England","scottish":"Scotland","welsh":"Wales","irish":"Ireland",
  "french":"France","spanish":"Spain","italian":"Italy","german":"Germany","portuguese":"Portugal",
  "thai":"Thailand","indian":"India","greek":"Greece","turkish":"Turkey","dutch":"Netherlands","swiss":"Switzerland",
  "austrian":"Austria","norwegian":"Norway","swedish":"Sweden","danish":"Denmark","finnish":"Finland",
  "icelandic":"Iceland","moroccan":"Morocco","egyptian":"Egypt","japanese":"Japan","korean":"Korea",
  "vietnamese":"Vietnam","indonesian":"Indonesia","malaysian":"Malaysia","australian":"Australia",
  "new zealand":"New Zealand","polish":"Poland","czech":"Czechia","hungarian":"Hungary","croatian":"Croatia",
  "canadian":"Canada","american":"United States","chilean":"Chile","argentinian":"Argentina","brazilian":"Brazil",
  "south african":"South Africa"
};

function demonymToCountry(text){
  const l = text.toLowerCase();
  for (const k of Object.keys(DEMONYMS).sort((a,b)=>b.length-a.length)) {
    if (l.includes(k)) return DEMONYMS[k];
  }
  return null;
}
function isLikelyJustAPlace(text){
  return /^[a-z0-9\s'.,-]+$/i.test(text) && text.trim().split(/\s+/).length <= 3;
}
function normalizeTravelQuery(val){
  const raw = (val || "").trim();
  if (!raw) return raw;
  if (/\bnear me\b/i.test(raw)) return raw;

  let out = raw;
  const country = demonymToCountry(raw);
  if (country && !new RegExp(`\\b${country}\\b`, "i").test(out)) {
    out = `${out} ${country}`;
  }

  // No silent “UK” append anymore — only hinting
  if (isLikelyJustAPlace(out) && !/\b(holiday|trip|ideas|things to do|attractions|resort|hotel|safari|villa|beach|canal boat)\b/i.test(out)) {
    out = `${out} holiday ideas`;
  }
  return out;
}

/* -----------------------------
   RSS tile helpers
----------------------------- */
function rssListMarkup(items) {
  const list = (items || []).map(i => `
    <div class="rss-item" style="display:flex; gap:10px; align-items:flex-start;">
      ${i.image ? `<img src="${i.image}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--border)" />`
                 : `<div style="width:56px;height:56px;border-radius:8px;border:1px solid var(--border);background:#0a1522"></div>`}
      <div>
        <a href="${i.link}" target="_blank" rel="noopener">${i.title}</a>
        <div class="muted">${i.source || ''} ${i.time ? `— ${i.time}`:''}</div>
      </div>
    </div>
  `).join("");
  return `
    <div class="rss" data-rss>
      <div class="rss-controls">
        <button class="btn sm rss-refresh">Refresh</button>
      </div>
      ${list}
    </div>
  `;
}
function rssLoadingMarkup() {
  return `
    <div class="rss" data-rss>
      <div class="rss-controls"><button class="btn sm rss-refresh">Refresh</button></div>
      <div class="muted">Loading…</div>
    </div>
  `;
}
function rssErrorMarkup() {
  return `
    <div class="rss" data-rss>
      <div class="rss-controls"><button class="btn sm rss-refresh">Refresh</button></div>
      <div class="muted">Couldn’t load news right now. Try Refresh in a moment.</div>
    </div>
  `;
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
      if (attempt < 2) setTimeout(()=>loadRssInto(card, feeds, attempt+1), 900);
      else content.innerHTML = rssErrorMarkup();
    });
}

/* -----------------------------
   Gallery + Markets (unchanged behavior)
----------------------------- */
function galleryMarkup(urls) {
  const imgs = (urls || []).map(u => `<img src="${u}" alt="">`).join("");
  return `
    <div class="gallery-tile" data-gallery>
      <div class="gallery-view"><img alt=""></div>
      <div class="gallery">${imgs}</div>
    </div>
  `;
}
function tickerMarkup(symbols) {
  const rows = symbols.map(sym => `
    <div class="trow" data-sym="${sym}">
      <div class="sym">${sym}</div>
      <div class="price" data-price>—</div>
      <div class="chg" data-chg>—</div>
    </div>`).join("");
  return `<div class="ticker" data-symbols="${symbols.join(",")}">${rows}</div>`;
}
function loadQuotesInto(card, symbols) {
  const url = `/api/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
  fetch(url)
    .then(r=>r.json())
    .then(data=>{
      const map = {};
      (data.quotes||[]).forEach(q=>{ map[q.symbol.toUpperCase()] = q; });
      const rows = card.querySelectorAll(".trow");
      rows.forEach(row=>{
        const sym = row.dataset.sym.toUpperCase();
        const q = map[sym];
        if (!q) return;
        const priceEl = row.querySelector("[data-price]");
        const chgEl   = row.querySelector("[data-chg]");
        const price = q.price;
        const delta = q.change;
        const pct   = q.changePercent;
        priceEl.textContent = (price!=null) ? price.toFixed(2) : "—";
        chgEl.textContent   = (delta!=null && pct!=null)
          ? `${delta>=0?"+":""}${delta.toFixed(2)}  (${pct>=0?"+":""}${pct.toFixed(2)}%)`
          : "—";
        row.classList.toggle("up",   delta >= 0);
        row.classList.toggle("down", delta <  0);
      });
    })
    .catch(()=>{
      const content = card.querySelector(".content");
      if (content && !content.querySelector(".ticker")) {
        content.innerHTML = `<div class="muted">Live prices unavailable right now.</div>`;
      }
    });
}

/* -----------------------------
   Defaults & seed
----------------------------- */
function gallerySeed() {
  return [
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1469474968028-56623f02e42e?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1501785888041-af3ef285b470?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?q=80&w=600&auto=format&fit=crop",
  ];
}
function defaultSections() {
  return [
    { id: uid(), type:"rss",      title:"Daily Brief", meta:{ feeds: RSS_PRESETS.uk }, content: rssLoadingMarkup() },
    { id: uid(), type:"web",      title:"BBC News",    meta:{url:"https://www.bbc.com"}, content: webTileMarkup("https://www.bbc.com") },
  ];
}
function ensureVersion() {
  const current = parseInt(localStorage.getItem(K_VERSION) || "0", 10);
  if (!sections.length) {
    sections = defaultSections();
    localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
  }
  if (current !== DATA_VERSION) {
    localStorage.setItem(K_VERSION, String(DATA_VERSION));
  }
}

/* -----------------------------
   Rendering
----------------------------- */
function tileContentFor(section) {
  switch (section.type) {
    case "youtube": {
      const playlist = section.meta?.playlist || (section.meta?.videoId ? [section.meta.videoId] : YT_DEFAULTS);
      const current  = section.meta?.current || section.meta?.videoId || playlist[0];
      return ytPlaylistMarkup(playlist, current);
    }
    case "web": {
      const url = section.meta?.url || "https://example.com";
      return webTileMarkup(url);
    }
    case "maps": {
      const q = section.meta?.q || "nearby";
      return mapsTileMarkup(q);
    }
    case "rss": {
      return section.content || rssLoadingMarkup();
    }
    case "gallery": {
      const urls = section.meta?.urls || [];
      return galleryMarkup(urls);
    }
    case "stocks": return section.content;
    default: return section.content || "Empty tile";
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
function render() {
  stopDynamicTimers();
  stopLiveIntervals();

  const grid = $("#grid");
  grid.innerHTML = "";

  sections.forEach(s => {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = s.id;
    card.dataset.type = s.type || "interest";
    card.innerHTML = `
      <h3>
        <span class="title">${s.title}</span>
        ${cardHeaderActions(s.id)}
      </h3>
      <div class="content">${tileContentFor(s)}</div>
    `;
    grid.appendChild(card);
  });

  initDynamicTiles();
  initLiveFeeds();
}

/* -----------------------------
   Delegated handlers (once)
----------------------------- */
(function attachDelegatesOnce(){
  const grid = $("#grid");

  // Expand / Collapse
  grid.addEventListener("click", (e)=>{
    const btn = e.target.closest(".expandBtn");
    if (!btn) return;
    const card = btn.closest(".card");
    if (!card) return;

    if (card.classList.contains("card-full")) {
      card.classList.remove("card-full");
      document.body.style.overflow = "";
      fsBackdrop.classList.remove("show");
      btn.textContent = "⤢ Expand";
    } else {
      card.classList.add("card-full");
      document.body.style.overflow = "hidden";
      fsBackdrop.classList.add("show");
      btn.textContent = "Close";
    }
  });

  // Remove
  grid.addEventListener("click", (e)=>{
    const btn = e.target.closest(".removeBtn");
    if (!btn) return;
    const card = btn.closest(".card");
    const id = btn.dataset.id;
    if (card?.classList.contains("card-full")) {
      card.classList.remove("card-full");
      document.body.style.overflow = "";
      fsBackdrop.classList.remove("show");
    }
    sections = sections.filter(s=>s.id!==id);
    localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
    render();
  });

  // Settings (per tile)
  grid.addEventListener("click", (e)=>{
    const btn = e.target.closest(".settingsBtn");
    if (!btn) return;
    const id = btn.dataset.id;
    const s = sections.find(x => x.id === id);
    if (!s) return;

    let fields = "";
    if (s.type === "web") {
      const url = s.meta?.url || "";
      fields = `
        <div class="field"><label>URL</label><input class="input" id="set_url" value="${url}"></div>
      `;
    } else if (s.type === "maps") {
      const q = s.meta?.q || "";
      fields = `
        <div class="field"><label>Maps search</label><input class="input" id="set_maps_q" value="${q}"></div>
      `;
    } else if (s.type === "rss") {
      const feeds = (s.meta?.feeds || RSS_PRESETS.uk).join(",");
      fields = `
        <div class="field"><label>RSS feeds</label><input class="input" id="set_feeds" value="${feeds}"></div>
      `;
    } else {
      fields = `<div class="muted">No settings for this tile.</div>`;
    }

    const html = `
      <div class="modal-card">
        <h2>Settings — ${s.title}</h2>
        ${fields}
        <div class="actions" style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
          <button class="btn sm" data-action="cancel">Cancel</button>
          <button class="btn sm primary" data-action="save" id="settingsSaveBtn">Save</button>
        </div>
      </div>
    `;
    __openModal(html);

    $("#settingsSaveBtn")?.addEventListener("click", ()=>{
      if (s.type === "web") {
        const url = $("#set_url")?.value?.trim() || s.meta?.url || "";
        s.meta = {...(s.meta||{}), url};
        s.content = webTileMarkup(url);
      } else if (s.type === "maps") {
        const q = $("#set_maps_q")?.value?.trim() || s.meta?.q || "";
        s.meta = {...(s.meta||{}), q};
        s.content = mapsTileMarkup(q);
      } else if (s.type === "rss") {
        const feeds = ($("#set_feeds")?.value || "").split(",").map(x=>x.trim()).filter(Boolean);
        const list = feeds.length? feeds : (s.meta?.feeds || RSS_PRESETS.uk);
        s.meta = {...(s.meta||{}), feeds: list};
        s.content = rssLoadingMarkup();
      }
      localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
      __closeModal();
      render();
    }, { once:true });
  });

  // Backdrop close
  fsBackdrop.addEventListener("click", ()=>{
    const open = document.querySelector(".card.card-full");
    if (!open) return;
    const closeBtn = open.querySelector(".expandBtn");
    open.classList.remove("card-full");
    document.body.style.overflow = "";
    fsBackdrop.classList.remove("show");
    if (closeBtn) closeBtn.textContent = "⤢ Expand";
  });

  // Esc closes fullscreen
  document.addEventListener("keydown", (e)=>{
    if (e.key === "Escape") {
      const open = document.querySelector(".card.card-full");
      if (!open) return;
      const closeBtn = open.querySelector(".expandBtn");
      open.classList.remove("card-full");
      document.body.style.overflow = "";
      fsBackdrop.classList.remove("show");
      if (closeBtn) closeBtn.textContent = "⤢ Expand";
    }
  });
})();

/* -----------------------------
   Dynamic tiles & live feeds
----------------------------- */
function stopDynamicTimers(){
  Object.values(dynamicTimers).forEach(clearInterval);
  dynamicTimers = {};
}
function stopLiveIntervals(){
  Object.values(liveIntervals).forEach(clearInterval);
  liveIntervals = {};
}
function initDynamicTiles(){
  // (Reserved for future live animations)
}
function initLiveFeeds(){
  // RSS on load + interval
  $$('.card[data-type="rss"]').forEach(card=>{
    const id = card.dataset.id;
    const s = sections.find(x=>x.id===id);
    const feeds = s?.meta?.feeds || RSS_PRESETS.uk;
    loadRssInto(card, feeds);
    liveIntervals[id+"_rss"] = setInterval(()=>loadRssInto(card, feeds), 15*60*1000);
  });

  // Stocks live (if any future tile uses it)
  $$('.card[data-type="stocks"]').forEach(card=>{
    const id = card.dataset.id;
    const ticker = card.querySelector(".ticker");
    if (!ticker) return;
    const syms = (ticker.dataset.symbols || "").split(",").map(s=>s.trim()).filter(Boolean);
    const refresh = () => loadQuotesInto(card, syms);
    refresh();
    liveIntervals[id+"_quotes"] = setInterval(refresh, 30*1000);
  });
}

/* -----------------------------
   Add Tile (AI-first)
----------------------------- */
const addBtn     = $("#addTileBtnTop");
const tileMenu   = $("#tileMenu");
const tileSearch = $("#tileSearch");

addBtn?.addEventListener("click", () => {
  tileMenu.classList.toggle("hidden");
  if (!tileMenu.classList.contains("hidden")) tileSearch.focus();
});

// Create concrete tiles from AI plan
function inflateTiles(plan, rawQuery){
  const made = [];
  for (const t of plan.tiles || []) {
    if (!t || !t.type) continue;

    if (t.type === "maps" && t.q) {
      const q = normalizeTravelQuery(t.q);
      made.push({
        id: uid(), type:"maps",
        title: t.title || `Search — ${rawQuery}`,
        meta: { q }, content: mapsTileMarkup(q)
      });
    } else if (t.type === "web" && Array.isArray(t.links) && t.links.length) {
      // Convert the first link into our clean web tile (plus allow multiple web tiles)
      const top = t.links[0];
      if (top?.url) {
        made.push({
          id: uid(), type:"web",
          title: t.title || (hostOf(top.url) || "Web"),
          meta: { url: top.url }, content: webTileMarkup(top.url)
        });
      }
      // Add 1-2 extra links as additional compact tiles
      t.links.slice(1, 3).forEach(link=>{
        if (!link?.url) return;
        made.push({
          id: uid(), type:"web",
          title: hostOf(link.url) || "Web",
          meta: { url: link.url }, content: webTileMarkup(link.url)
        });
      });
    } else if (t.type === "youtube" && Array.isArray(t.playlist) && t.playlist.length) {
      const cur = t.playlist[0];
      made.push({
        id: uid(), type:"youtube",
        title: t.title || "YouTube",
        meta:{ playlist: t.playlist, current: cur },
        content: ytPlaylistMarkup(t.playlist, cur)
      });
    } else if (t.type === "rss" && Array.isArray(t.feeds) && t.feeds.length) {
      made.push({
        id: uid(), type:"rss",
        title: t.title || `Daily Brief — ${rawQuery}`,
        meta:{ feeds: t.feeds }, content: rssLoadingMarkup()
      });
    }
  }
  return made;
}

tileSearch?.addEventListener("keydown", (e)=>{
  if (e.key !== "Enter") {
    if (e.key === "Escape") tileMenu.classList.add("hidden");
    return;
  }
  const q = (tileSearch.value || "").trim();
  if (!q) return;

  fetch(`/api/ai-tile?q=${encodeURIComponent(q)}`)
    .then(r=>r.json())
    .then(plan=>{
      const tiles = inflateTiles(plan || {tiles:[]}, q);
      if (!tiles.length) {
        // graceful fallback → RSS
        const gn  = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`;
        tiles.push({ id: uid(), type:"rss", title:`Daily Brief — ${q}`, meta:{ feeds:[gn] }, content: rssLoadingMarkup() });
      }
      sections = [...tiles, ...sections];
      localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
      render();
      tileMenu.classList.add("hidden");
      tileSearch.value = "";
    })
    .catch(()=>{
      const gn  = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`;
      const a = { id: uid(), type:"rss", title:`Daily Brief — ${q}`, meta:{ feeds:[gn] }, content: rssLoadingMarkup() };
      sections.unshift(a);
      localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
      render();
      tileMenu.classList.add("hidden");
      tileSearch.value = "";
    });
});

/* -----------------------------
   Assistant (standalone chat)
----------------------------- */
const assistantToggle = $("#assistantToggle");
const assistantPanel  = $("#assistantPanel");
const chatLog   = $("#assistantChat");
const chatForm  = $("#chatForm");
const chatInput = $("#chatInput");

function updateAssistant() {
  assistantPanel.style.display = assistantOn ? "block" : "none";
  assistantToggle?.classList.toggle("primary", assistantOn);
  appEl.classList.toggle("no-right", !assistantOn);
  localStorage.setItem(K_ASSIST_ON, JSON.stringify(assistantOn));
}
assistantToggle?.addEventListener("click", (e) => {
  e.preventDefault();
  assistantOn = !assistantOn;
  updateAssistant();
});

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

chatForm?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  addChat('user', text);
  chatInput.value = "";

  try {
    const r = await fetch(`/api/ai-chat`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ q: text, messages: chat })
    });
    if (!r.ok) throw new Error("chat endpoint not available");
    const j = await r.json();
    addChat('ai', j.message || "…");
  } catch (err) {
    addChat('ai', "I couldn't reach the chat service just now. Try again in a moment.");
  }
});

/* -----------------------------
   Global settings
----------------------------- */
$("#globalSettingsBtn")?.addEventListener("click", ()=>{
  const html = `
    <div class="modal-card">
      <h2>Global Settings</h2>
      <div class="field">
        <label>Theme</label>
        <select class="input" id="g_theme">
          <option value="solar" ${prefs.theme==='solar'?'selected':''}>Solar (Dark)</option>
          <option value="ice" ${prefs.theme==='ice'?'selected':''}>Ice (Light)</option>
        </select>
      </div>
      <div class="field">
        <label>Density</label>
        <select class="input" id="g_density">
          <option value="comfortable" ${prefs.density==='comfortable'?'selected':''}>Comfortable</option>
          <option value="compact" ${prefs.density==='compact'?'selected':''}>Compact</option>
        </select>
      </div>
      <div class="actions" style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
        <button class="btn sm" data-action="cancel">Cancel</button>
        <button class="btn sm" id="resetLayout">Reset Layout</button>
        <button class="btn sm primary" data-action="save" id="g_save">Save</button>
      </div>
    </div>
  `;
  __openModal(html);
  $("#g_save")?.addEventListener("click", ()=>{
    const theme = $("#g_theme").value;
    const density = $("#g_density").value;
    prefs.theme = theme; prefs.density = density;
    localStorage.setItem(K_PREFS, JSON.stringify(prefs));
    document.body.classList.toggle('theme-ice', theme === 'ice');
    document.body.classList.toggle('density-compact', density === 'compact');
    __closeModal();
  }, { once:true });
  $("#resetLayout")?.addEventListener("click", ()=>{
    localStorage.removeItem(K_SECTIONS);
    localStorage.removeItem(K_VERSION);
    navigator.serviceWorker?.getRegistrations?.().then(rs=>rs.forEach(r=>r.unregister()));
    location.reload();
  }, { once:true });
});

/* -----------------------------
   Modal helpers (safe)
----------------------------- */
(function modalSafetyNet(){
  const modal = document.getElementById('modal');
  const backdrop = document.getElementById('fsBackdrop');

  function isOpen() {
    return modal && !modal.classList.contains('hidden') && modal.classList.contains('show');
  }
  window.__openModal = window.__openModal || function(html){
    if (!modal) return;
    modal.innerHTML = html || modal.innerHTML;
    modal.classList.remove('hidden');
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    if (backdrop) backdrop.classList.remove('show');
  };
  window.__closeModal = window.__closeModal || function(){
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('show');
    modal.innerHTML = '';
    document.body.style.overflow = '';
    if (backdrop) backdrop.classList.remove('show');
  };

  if (modal) {
    modal.addEventListener('click', (e)=>{
      if (e.target === modal) window.__closeModal();
    });
    modal.addEventListener('click', (e)=>{
      const closeBtn = e.target.closest('[data-action="close"],[data-action="cancel"],[data-action="dismiss"]');
      const saveBtn  = e.target.closest('[data-action="save"],[data-action="ok"],[data-action="apply"]');
      if (closeBtn || saveBtn) window.__closeModal();
    });
  }
  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape' && isOpen()) window.__closeModal();
  });
})();

/* -----------------------------
   Init
----------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  $("#yr") && ($("#yr").textContent = new Date().getFullYear());
  ensureVersion();
  // If Daily Brief present, load immediately
  setTimeout(()=>render(), 10);
  updateAssistant();
  renderChat();
});
