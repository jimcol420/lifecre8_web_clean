/* ============================================================
   LifeCre8 — main.js  v1.10.1
   Built on: v1.10.0
   What's new:
   - Web tile "Summarize" button -> /api/ai-summarize
============================================================ */

/* ===== Keys & Version ===== */
const K_SECTIONS   = "lifecre8.sections";
const K_ASSIST_ON  = "lifecre8.assistantOn";
const K_CHAT       = "lifecre8.chat";
const K_VERSION    = "lifecre8.version";
const K_PREFS      = "lifecre8.prefs";
const DATA_VERSION = 5;

/* ===== Presets ===== */
const RSS_PRESETS = {
  world: [
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://www.reuters.com/world/rss",
  ],
  tech: [
    "https://www.theverge.com/rss/index.xml",
    "https://www.engadget.com/rss.xml",
    "https://www.wired.com/feed/rss",
  ],
  finance: [
    "https://feeds.bbci.co.uk/news/business/rss.xml",
    "https://www.reuters.com/markets/rss",
  ],
  uk: [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://www.theguardian.com/uk-news/rss",
  ],
};

const STOCK_PRESETS = {
  "Tech Giants": ["AAPL","MSFT","GOOGL","AMZN","NVDA"],
  "Crypto": ["BTC-USD","ETH-USD","SOL-USD"],
  "US Indexes": ["^GSPC","^DJI","^IXIC"],
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
const uid   = () => Math.random().toString(36).slice(2);
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
const YT_DEFAULTS = [
  "M7lc1UVf-VE","5qap5aO4i9A","DWcJFNfaw9c","jfKfPfyJRdk",
];
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
   Web tile (generic) — now with Summarize
----------------------------- */
function webTileMarkup(url, mode = "preview") {
  const host = hostOf(url);
  const favicon = host ? `https://www.google.com/s2/favicons?domain=${host}&sz=32` : "";
  const actions = `
    <div class="web-actions">
      <button class="btn sm web-toggle" data-mode="${mode === 'embed' ? 'preview' : 'embed'}">${mode === 'embed' ? 'Preview' : 'Embed'}</button>
      <button class="btn sm web-summarize" data-url="${url}">Summarize</button>
      <a class="btn sm" href="${url}" target="_blank" rel="noopener">Open</a>
    </div>
  `;
  if (mode === "embed") {
    return `
      <div class="web-tile" data-web data-url="${url}" data-mode="embed">
        ${actions}
        <iframe src="${url}" style="width:100%;height:300px;border:0;border-radius:10px;background:#0a1522"></iframe>
        <div class="muted">If this is blank, the site likely blocks iframes. Use Preview/Open.</div>
      </div>
    `;
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
        ${actions}
        <div class="muted" style="margin-top:6px">Preview mode avoids iframe blocks. Try Embed; if it fails, use Open.</div>
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

/* ---- normalize vague/UK travel queries ---- */
function normalizeTravelQuery(val){
  const raw = (val || "").trim();
  if (!raw) return raw;
  if (/\bnear me\b/i.test(raw)) return raw;

  const ukWords = /\b(uk|u\.k\.|united kingdom|england|scotland|wales|northern ireland)\b/i;
  const hasPlaceHint = /\b(in|near|around)\s+[A-Za-z][\w\s'-]+$/i.test(raw);
  const isVeryGeneric = /\b(holiday|holidays|break|breaks|trip|trips|ideas|getaway|getaways|staycation|weekend)\b/i.test(raw);

  if (ukWords.test(raw)) return /united kingdom/i.test(raw) ? raw : `${raw} United Kingdom`;
  if (!hasPlaceHint && isVeryGeneric) return `${raw} United Kingdom`;
  return raw;
}

/* ----------------------------- Spotify, RSS, Gallery, Markets, Football ----------------------------- */
// (unchanged from v1.10.0; omitted for brevity in this comment block — they remain identical)
function spotifyMarkup(spotifyUrl) {
  const src = spotifyUrl.replace("open.spotify.com/", "open.spotify.com/embed/");
  return `
    <div data-spotify>
      <iframe style="border-radius:12px" src="${src}"
        width="100%" height="232" frameborder="0" allowfullscreen=""
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>
    </div>
  `;
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
function rssLoadingMarkup() { return `<div class="rss" data-rss><div class="rss-controls"><button class="btn sm rss-refresh">Refresh</button></div><div class="muted">Loading…</div></div>`; }
function rssErrorMarkup() { return `<div class="rss" data-rss><div class="rss-controls"><button class="btn sm rss-refresh">Refresh</button></div><div class="muted">Couldn’t load news right now. Try Refresh in a moment.</div></div>`; }
function loadRssInto(card, feeds, attempt=1) {
  const content = card.querySelector(".content");
  if (!feeds || !feeds.length || !content) return;
  const url = `/api/rss?full=1&url=${encodeURIComponent(feeds[0])}`;
  fetch(url).then(r=>r.json()).then(data=>{
    const items = (data.items||[]).slice(0,10);
    content.innerHTML = rssListMarkup(items);
  }).catch(()=>{
    if (attempt < 2) setTimeout(()=>loadRssInto(card, feeds, attempt+1), 1000);
    else content.innerHTML = rssErrorMarkup();
  });
}
function galleryMarkup(urls) {
  const imgs = (urls || []).map(u => `<img src="${u}" alt="">`).join("");
  return `<div class="gallery-tile" data-gallery><div class="gallery-view"><img alt=""></div><div class="gallery">${imgs}</div></div>`;
}
function tickerMarkup(symbols) {
  const rows = symbols.map(sym => `<div class="trow" data-sym="${sym}"><div class="sym">${sym}</div><div class="price" data-price>—</div><div class="chg" data-chg>—</div></div>`).join("");
  return `<div class="ticker" data-symbols="${symbols.join(",")}">${rows}</div>`;
}
function loadQuotesInto(card, symbols) {
  const url = `/api/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
  fetch(url).then(r=>r.json()).then(data=>{
    const map = {}; (data.quotes||[]).forEach(q=>{ map[q.symbol.toUpperCase()] = q; });
    const rows = card.querySelectorAll(".trow");
    rows.forEach(row=>{
      const sym = row.dataset.sym.toUpperCase();
      const q = map[sym]; if (!q) return;
      const priceEl = row.querySelector("[data-price]"); const chgEl = row.querySelector("[data-chg]");
      const price = q.price; const delta = q.change; const pct = q.changePercent;
      priceEl.textContent = (price!=null) ? price.toFixed(2) : "—";
      chgEl.textContent   = (delta!=null && pct!=null) ? `${delta>=0?"+":""}${delta.toFixed(2)}  (${pct>=0?"+":""}${pct.toFixed(2)}%)` : "—";
      row.classList.toggle("up", delta >= 0); row.classList.toggle("down", delta < 0);
    });
  }).catch(()=>{
    const content = card.querySelector(".content");
    if (content && !content.querySelector(".ticker")) content.innerHTML = `<div class="muted">Live prices unavailable right now.</div>`;
  });
}
function footballMarkupSeed() {
  const matches = [
    { home:"Arsenal", away:"Chelsea", hs:0, as:0, min:0, status:"KO 20:00", started:false, finished:false, homeBadge:"https://flagcdn.com/w20/gb-eng.png", awayBadge:"https://flagcdn.com/w20/gb-eng.png" },
    { home:"Barcelona", away:"Real Madrid", hs:0, as:0, min:0, status:"KO 20:15", started:false, finished:false, homeBadge:"https://flagcdn.com/w20/es.png", awayBadge:"https://flagcdn.com/w20/es.png" },
    { home:"Bayern", away:"Dortmund", hs:0, as:0, min:0, status:"KO 20:30", started:false, finished:false, homeBadge:"https://flagcdn.com/w20/de.png", awayBadge:"https://flagcdn.com/w20/de.png" },
  ];
  const rows = matches.map((m,i)=>`
    <div class="match" data-idx="${i}">
      <div class="team home"><img alt="" src="${m.homeBadge}"/><span>${m.home}</span></div>
      <div class="score" data-score>${m.hs}–${m.as}</div>
      <div class="team away"><img alt="" src="${m.awayBadge}"/><span>${m.away}</span></div>
      <div class="status" data-status>${m.status}</div>
    </div>
  `).join("");
  return `<div class="scores" data-matches="${encodeURIComponent(JSON.stringify(matches))}">${rows}</div>`;
}

/* -----------------------------
   Defaults / Versioning / Rendering
----------------------------- */
function gallerySeed(){ return [
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=600&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?q=80&w=600&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470?q=80&w=600&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?q=80&w=600&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?q=80&w=600&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1491553895911-0055eca6402d?q=80&w=600&auto=format&fit=crop"
];}
function defaultSections(){ return [
  { id: uid(), type:"rss",      title:"Daily Brief", meta:{ feeds: RSS_PRESETS.uk }, content: rssLoadingMarkup() },
  { id: uid(), type:"web",      title:"BBC News",    meta:{url:"https://www.bbc.com", mode:"preview"}, content: webTileMarkup("https://www.bbc.com","preview") },
  { id: uid(), type:"youtube",  title:"YouTube",     meta:{ playlist:[...YT_DEFAULTS], current:"M7lc1UVf-VE" }, content: ytPlaylistMarkup(YT_DEFAULTS, "M7lc1UVf-VE") },
  { id: uid(), type:"stocks",   title:"Markets",     meta:{ symbols:["AAPL","MSFT","BTC-USD"] }, content: tickerMarkup(["AAPL","MSFT","BTC-USD"]) },
  { id: uid(), type:"football", title:"Football",    meta:{}, content: footballMarkupSeed() },
  { id: uid(), type:"gallery",  title:"Gallery",     meta:{ urls: gallerySeed() }, content: galleryMarkup(gallerySeed()) }
];}
function ensureVersion(){
  const current = parseInt(localStorage.getItem(K_VERSION) || "0", 10);
  if (!sections.length) { sections = defaultSections(); localStorage.setItem(K_SECTIONS, JSON.stringify(sections)); }
  if (current !== DATA_VERSION) localStorage.setItem(K_VERSION, String(DATA_VERSION));
}
function tileContentFor(section) {
  switch (section.type) {
    case "youtube": {
      const playlist = section.meta?.playlist || (section.meta?.videoId ? [section.meta.videoId] : YT_DEFAULTS);
      const current  = section.meta?.current || section.meta?.videoId || playlist[0];
      return ytPlaylistMarkup(playlist, current);
    }
    case "web":   return webTileMarkup(section.meta?.url || "https://example.com", section.meta?.mode || "preview");
    case "maps":  return mapsTileMarkup(section.meta?.q || "nearby");
    case "spotify": return spotifyMarkup(section.meta?.url || "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
    case "rss":   return section.content || rssLoadingMarkup();
    case "gallery": {
      const urls = section.meta?.urls || []; return galleryMarkup(urls);
    }
    case "stocks": return section.content;
    case "football": return section.content;
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
function render(){
  stopDynamicTimers(); stopLiveIntervals();
  const grid = $("#grid"); grid.innerHTML = "";
  const others = sections.filter(s=>s.type!=="email"); const emails = sections.filter(s=>s.type==="email");
  [...others, ...emails].forEach(s=>{
    const card = document.createElement("div");
    card.className = "card"; card.dataset.id = s.id; card.dataset.type = s.type || "interest";
    card.innerHTML = `
      <h3><span class="title">${s.title}</span>${cardHeaderActions(s.id)}</h3>
      <div class="content">${tileContentFor(s)}</div>`;
    grid.appendChild(card);
  });
  initDynamicTiles(); initLiveFeeds();
}

/* -----------------------------
   Delegated handlers (incl. Summarize)
----------------------------- */
(function attachDelegatesOnce(){
  const grid = $("#grid");

  grid.addEventListener("click", (e)=>{
    const btn = e.target.closest(".expandBtn"); if (!btn) return;
    const card = btn.closest(".card"); if (!card) return;
    if (card.classList.contains("card-full")) {
      card.classList.remove("card-full"); document.body.style.overflow = ""; fsBackdrop.classList.remove("show"); btn.textContent = "⤢ Expand";
    } else {
      card.classList.add("card-full"); document.body.style.overflow = "hidden"; fsBackdrop.classList.add("show"); btn.textContent = "Close";
    }
  });

  grid.addEventListener("click", (e)=>{
    const btn = e.target.closest(".removeBtn"); if (!btn) return;
    const card = btn.closest(".card"); const id = btn.dataset.id;
    if (card?.classList.contains("card-full")) { card.classList.remove("card-full"); document.body.style.overflow = ""; fsBackdrop.classList.remove("show"); }
    sections = sections.filter(s=>s.id!==id); localStorage.setItem(K_SECTIONS, JSON.stringify(sections)); render();
  });

  // Settings modal (unchanged)
  grid.addEventListener("click", (e)=>{
    const btn = e.target.closest(".settingsBtn"); if (!btn) return;
    const id = btn.dataset.id; const s = sections.find(x=>x.id===id); if (!s) return;

    let fields = "";
    if (s.type === "web") {
      const url = s.meta?.url || ""; const mode = s.meta?.mode || "preview";
      fields = `
        <div class="field"><label>URL</label><input class="input" id="set_url" value="${url}"></div>
        <div class="field">
          <label>Mode</label>
          <select class="input" id="set_mode">
            <option value="preview" ${mode==='preview'?'selected':''}>Preview</option>
            <option value="embed" ${mode==='embed'?'selected':''}>Embed</option>
          </select>
        </div>`;
    } else if (s.type === "maps") {
      const q = s.meta?.q || "";
      fields = `<div class="field"><label>Maps search</label><input class="input" id="set_maps_q" value="${q}"></div>`;
    } else if (s.type === "youtube") {
      const list = (s.meta?.playlist || YT_DEFAULTS).join(",");
      fields = `<div class="field"><label>Playlist (comma-separated video IDs)</label><input class="input" id="set_playlist" value="${list}"></div>`;
    } else if (s.type === "stocks") {
      const syms = (s.meta?.symbols || ["AAPL","MSFT","BTC-USD"]).join(",");
      const presetOptions = Object.keys(STOCK_PRESETS).map(n=>`<option value="${n}">${n}</option>`).join("");
      fields = `
        <div class="field"><label>Symbols (comma-separated)</label><input class="input" id="set_symbols" value="${syms}"></div>
        <div class="field">
          <label>Presets</label>
          <div class="row" style="gap:8px">
            <select class="input" id="set_symbols_preset" style="min-width:180px">
              <option value="">Choose a preset…</option>${presetOptions}
            </select>
            <button class="btn sm" id="apply_symbols_preset" type="button">Apply</button>
          </div>
        </div>`;
    } else if (s.type === "rss") {
      const feeds = (s.meta?.feeds || RSS_PRESETS.uk).join("");
      const presetOptions = Object.keys(RSS_PRESETS).map(k=>`<option value="${k}">${k.toUpperCase()}</option>`).join("");
      fields = `
        <div class="field"><label>RSS feeds (comma-separated URLs; first is used)</label><input class="input" id="set_feeds" value="${feeds}"></div>
        <div class="field">
          <label>News Presets</label>
          <div class="row" style="gap:8px">
            <select class="input" id="set_feeds_preset" style="min-width:180px">
              <option value="">Choose a preset…</option>${presetOptions}
            </select>
            <button class="btn sm" id="apply_feeds_preset" type="button">Apply</button>
          </div>
        </div>`;
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
      </div>`;
    __openModal(html);

    $("#apply_symbols_preset")?.addEventListener("click", ()=>{
      const key = $("#set_symbols_preset").value; if (!key) return;
      const arr = STOCK_PRESETS[key] || []; $("#set_symbols").value = arr.join(",");
    });
    $("#apply_feeds_preset")?.addEventListener("click", ()=>{
      const key = $("#set_feeds_preset").value; if (!key) return;
      const arr = RSS_PRESETS[key] || []; $("#set_feeds").value = arr.join(",");
    });

    $("#settingsSaveBtn")?.addEventListener("click", ()=>{
      if (s.type === "web") {
        const url = $("#set_url")?.value?.trim() || s.meta?.url || "";
        const mode = $("#set_mode")?.value || "preview";
        s.meta = {...(s.meta||{}), url, mode}; s.content = webTileMarkup(url, mode);
      } else if (s.type === "maps") {
        const q = $("#set_maps_q")?.value?.trim() || s.meta?.q || "";
        s.meta = {...(s.meta||{}), q}; s.content = mapsTileMarkup(q);
      } else if (s.type === "youtube") {
        const playlist = ($("#set_playlist")?.value || "").split(",").map(x=>x.trim()).filter(Boolean);
        const list = playlist.length? playlist : (s.meta?.playlist || YT_DEFAULTS);
        const current = list[0]; s.meta = {...(s.meta||{}), playlist:list, current};
        s.content = ytPlaylistMarkup(list, current);
      } else if (s.type === "stocks") {
        const symbols = ($("#set_symbols")?.value || "").split(",").map(x=>x.trim()).filter(Boolean);
        const syms = symbols.length? symbols : (s.meta?.symbols || ["AAPL","MSFT","BTC-USD"]);
        s.meta = {...(s.meta||{}), symbols: syms}; s.content = tickerMarkup(syms);
      } else if (s.type === "rss") {
        const feeds = ($("#set_feeds")?.value || "").split(",").map(x=>x.trim()).filter(Boolean);
        const list = feeds.length? feeds : (s.meta?.feeds || RSS_PRESETS.uk);
        s.meta = {...(s.meta||{}), feeds: list}; s.content = rssLoadingMarkup();
      }
      localStorage.setItem(K_SECTIONS, JSON.stringify(sections)); __closeModal(); render();
    }, { once:true });
  });

  // Toggle preview/embed on Web tile
  grid.addEventListener("click", (e)=>{
    const toggle = e.target.closest(".web-toggle"); if (!toggle) return;
    const card = e.target.closest(".card"); const tile = e.target.closest("[data-web]");
    if (!card || !tile) return;
    const id = card.dataset.id; const s = sections.find(x=>x.id===id); if (!s) return;
    const url = tile.dataset.url; const nextMode = toggle.dataset.mode;
    s.meta = s.meta || {}; s.meta.url = url; s.meta.mode = nextMode;
    s.content = webTileMarkup(url, nextMode);
    localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
    card.querySelector(".content").innerHTML = s.content;
  });

  // NEW: Summarize button on Web tile
  grid.addEventListener("click", async (e)=>{
    const btn = e.target.closest(".web-summarize"); if (!btn) return;
    const url = btn.dataset.url;
    const card = btn.closest(".card");
    const title = card?.querySelector('h3 .title')?.textContent || 'Summary';

    const loading = `
      <div class="modal-card">
        <h2>Summarizing…</h2>
        <div class="muted">Fetching the page and generating a quick brief.</div>
      </div>`;
    __openModal(loading);

    try {
      const r = await fetch(`/api/ai-summarize?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`);
      const j = await r.json();
      const html = `
        <div class="modal-card">
          <h2>Summary — ${title}</h2>
          <div class="summary-text" style="white-space:pre-wrap;line-height:1.35">${(j.summary || 'No summary available.').trim()}</div>
          <div class="actions" style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
            <button class="btn sm" data-action="close">Close</button>
          </div>
        </div>`;
      __openModal(html);
    } catch {
      __openModal(`
        <div class="modal-card">
          <h2>Summary</h2>
          <div class="muted">Sorry, I couldn't summarize that page right now.</div>
          <div class="actions" style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
            <button class="btn sm" data-action="close">Close</button>
          </div>
        </div>
      `);
    }
  });

  // Backdrop & Escape
  fsBackdrop.addEventListener("click", ()=>{
    const open = document.querySelector(".card.card-full"); if (!open) return;
    const closeBtn = open.querySelector(".expandBtn");
    open.classList.remove("card-full"); document.body.style.overflow = ""; fsBackdrop.classList.remove("show");
    if (closeBtn) closeBtn.textContent = "⤢ Expand";
  });
  document.addEventListener("keydown", (e)=>{
    if (e.key === "Escape") {
      const open = document.querySelector(".card.card-full"); if (!open) return;
      const closeBtn = open.querySelector(".expandBtn");
      open.classList.remove("card-full"); document.body.style.overflow = ""; fsBackdrop.classList.remove("show");
      if (closeBtn) closeBtn.textContent = "⤢ Expand";
    }
  });
})();

/* -----------------------------
   Add Tile — MINI AI (unchanged from v1.10.0)
----------------------------- */
const addBtn     = $("#addTileBtnTop");
const tileMenu   = $("#tileMenu");
const tileSearch = $("#tileSearch");

addBtn.addEventListener("click", () => {
  tileMenu.classList.toggle("hidden");
  if (!tileMenu.classList.contains("hidden")) tileSearch.focus();
});

tileSearch.addEventListener("keydown", (e)=>{
  if (e.key !== "Enter") { if (e.key === "Escape") tileMenu.classList.add("hidden"); return; }
  const valRaw = tileSearch.value.trim(); if (!valRaw) return;
  const val = valRaw.replace(/\s+/g, " ");

  // Travel fast-path
  const TRAVEL_RE = /(retreat|spa|resort|hotel|hostel|air\s*bnb|airbnb|villa|wellness|yoga|camp|lodg(e|ing)|stay|bnb|guesthouse|inn|aparthotel|boutique|residence|beach\s*resort|city\s*break|holiday|getaway|staycation|weekend)/i;
  const GEO_HINT  = /\b(near me|in\s+[A-Za-z][\w\s'-]+)$/i;
  if (TRAVEL_RE.test(val) || GEO_HINT.test(val)) {
    const q = normalizeTravelQuery(val);
    const tile = { id: uid(), type: "maps", title: `Search — ${val}`, meta: { q }, content: mapsTileMarkup(q) };
    sections.unshift(tile); localStorage.setItem(K_SECTIONS, JSON.stringify(sections)); render();
    tileMenu.classList.add("hidden"); tileSearch.value = ""; return;
  }

  // AI planner (single tile)
  fetch(`/api/ai-tile?q=${encodeURIComponent(val)}`)
    .then(r=>r.json())
    .then(j=>{
      const t = j.tile; if (!t) throw new Error("empty plan");
      let made = null;
      if (t.type === "rss" && t.feeds?.length)         made = { id: uid(), type:"rss", title: t.title || `Daily Brief — ${val}`, meta:{ feeds: t.feeds }, content: rssLoadingMarkup() };
      else if (t.type === "web" && t.url)              made = { id: uid(), type:"web", title: t.title || hostOf(t.url) || "Web", meta:{ url: t.url, mode:"preview" }, content: webTileMarkup(t.url, "preview") };
      else if (t.type === "youtube" && t.playlist?.length) { const cur = t.playlist[0]; made = { id: uid(), type:"youtube", title: t.title || "YouTube", meta:{ playlist: t.playlist, current: cur }, content: ytPlaylistMarkup(t.playlist, cur) }; }
      else if (t.type === "stocks" && t.symbols?.length)   made = { id: uid(), type:"stocks", title: t.title || "Markets", meta:{ symbols: t.symbols }, content: tickerMarkup(t.symbols) };
      else if (t.type === "gallery" && t.images?.length)   made = { id: uid(), type:"gallery", title: t.title || "Gallery", meta:{ urls: t.images }, content: galleryMarkup(t.images) };
      else if (t.type === "maps" && t.q) { const qn = normalizeTravelQuery(t.q); made = { id: uid(), type:"maps", title: t.title || `Search — ${qn}`, meta:{ q: qn }, content: mapsTileMarkup(qn) }; }
      else if (t.type === "spotify" && t.url)              made = { id: uid(), type:"spotify", title: t.title || "Spotify", meta:{ url: t.url }, content: spotifyMarkup(t.url) };
      if (!made) throw new Error("unsupported tile");
      sections.unshift(made); localStorage.setItem(K_SECTIONS, JSON.stringify(sections)); render();
      tileMenu.classList.add("hidden"); tileSearch.value = "";
    })
    .catch(()=>{
      const gn  = `https://news.google.com/rss/search?q=${encodeURIComponent(val)}&hl=en-GB&gl=GB&ceid=GB:en`;
      const a = { id: uid(), type:"rss", title:`Daily Brief — ${val}`, meta:{ feeds:[gn] }, content: rssLoadingMarkup() };
      sections.unshift(a); localStorage.setItem(K_SECTIONS, JSON.stringify(sections)); render();
      tileMenu.classList.add("hidden"); tileSearch.value = "";
    });
});

/* -----------------------------
   Assistant (standalone chat via /api/ai-chat)
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
assistantToggle?.addEventListener("click", (e) => { e.preventDefault(); assistantOn = !assistantOn; updateAssistant(); });

function renderChat(){
  if (!chatLog) return; chatLog.innerHTML = "";
  chat.forEach(m=>{ const d = document.createElement("div"); d.className = `msg ${m.role}`; d.textContent = m.text; chatLog.appendChild(d); });
  chatLog.scrollTop = chatLog.scrollHeight;
}
function addChat(role, text){ chat.push({role, text}); localStorage.setItem(K_CHAT, JSON.stringify(chat)); renderChat(); }
chatForm?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const text = chatInput.value.trim(); if (!text) return;
  addChat('user', text); chatInput.value = "";
  try { const r = await fetch(`/api/ai-chat?q=${encodeURIComponent(text)}`); if (!r.ok) throw 0; const j = await r.json(); addChat('ai', j.message || "…"); }
  catch { addChat('ai', "I couldn't reach the chat service just now. Try again in a moment."); }
});

/* -----------------------------
   Modal helpers & Init
----------------------------- */
(function modalSafetyNet(){
  const modal = document.getElementById('modal'); const backdrop = document.getElementById('fsBackdrop');
  function isOpen(){ return modal && !modal.classList.contains('hidden') && modal.classList.contains('show'); }
  window.__openModal = window.__openModal || function(html){
    if (!modal) return; modal.innerHTML = html || modal.innerHTML; modal.classList.remove('hidden'); modal.classList.add('show');
    document.body.style.overflow = 'hidden'; if (backdrop) backdrop.classList.remove('show');
  };
  window.__closeModal = window.__closeModal || function(){
    if (!modal) return; modal.classList.add('hidden'); modal.classList.remove('show'); modal.innerHTML = '';
    document.body.style.overflow = ''; if (backdrop) backdrop.classList.remove('show');
  };
  if (modal) {
    modal.addEventListener('click', (e)=>{ if (e.target === modal) window.__closeModal(); });
    modal.addEventListener('click', (e)=>{ const c = e.target.closest('[data-action="close"],[data-action="cancel"],[data-action="dismiss"],[data-action="save"],[data-action="ok"],[data-action="apply"]'); if (c) window.__closeModal(); });
  }
  document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape' && isOpen()) window.__closeModal(); });
})();

document.addEventListener("DOMContentLoaded", () => {
  $("#yr") && ($("#yr").textContent = new Date().getFullYear());
  ensureVersion(); updateAssistant(); renderChat(); render();
});
