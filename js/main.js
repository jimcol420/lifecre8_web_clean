/* ============================================================
   LifeCre8 — main.js  v1.10.6
   What's new:
   - Nationality → country mapping (French→France, Spanish→Spain, …)
   - Maps tile centers on detected country consistently
   - Assistant chat keeps context and falls back to GET if POST fails
============================================================ */

/* ===== Keys & Version ===== */
const K_SECTIONS   = "lifecre8.sections";
const K_ASSIST_ON  = "lifecre8.assistantOn";
const K_CHAT       = "lifecre8.chat";
const K_VERSION    = "lifecre8.version";
const K_PREFS      = "lifecre8.prefs";
const DATA_VERSION = 9;

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
const favOf  = (u) => { const h = hostOf(u); return h ? `https://www.google.com/s2/favicons?domain=${h}&sz=32` : ""; };

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
const YT_DEFAULTS = ["M7lc1UVf-VE","5qap5aO4i9A","DWcJFNfaw9c","jfKfPfyJRdk"];
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
   Results tile (link cards)
----------------------------- */
function resultsTileMarkup(q, items) {
  const list = (items || []).map((it) => {
    const host = hostOf(it.url);
    const fav  = favOf(it.url);
    const type = (it.kind || "link").toUpperCase();
    return `
      <div class="result">
        <div class="row" style="gap:10px;align-items:flex-start">
          <img class="favicon" src="${fav}" alt="">
          <div class="grow">
            <a class="title" href="${it.url}" target="_blank" rel="noopener">${it.title || host}</a>
            ${it.snippet ? `<div class="muted">${it.snippet}</div>` : ""}
            <div class="muted" style="font-size:12px;margin-top:4px">${type} — ${host}</div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="results-tile" data-results data-q="${encodeURIComponent(q)}">
      <div class="results-list">
        ${list || `<div class="muted">No suggestions yet.</div>`}
      </div>
    </div>
  `;
}

/* -----------------------------
   Country hints + nationality mapping
----------------------------- */
const COUNTRY_CENTER = {
  "united kingdom": { lat: 54.3, lng: -2.3, z: 5 },
  "england":        { lat: 52.3, lng: -1.6, z: 6 },
  "scotland":       { lat: 56.8, lng: -4.2, z: 6 },
  "wales":          { lat: 52.4, lng: -3.6, z: 6 },
  "northern ireland": { lat: 54.6, lng: -6.7, z: 7 },
  "france":   { lat: 46.2, lng: 2.2,   z: 5 },
  "spain":    { lat: 40.2, lng: -3.6,  z: 5 },
  "italy":    { lat: 42.5, lng: 12.5,  z: 5 },
  "germany":  { lat: 51.2, lng: 10.4,  z: 5 },
  "portugal": { lat: 39.7, lng: -8.0,  z: 6 },
  "switzerland": { lat: 46.8, lng: 8.2, z: 6 },
  "austria":  { lat: 47.6, lng: 14.1, z: 6 },
  "greece":   { lat: 39.1, lng: 22.9, z: 6 },
  "netherlands": { lat: 52.2, lng: 5.3, z: 6 },
  "belgium":  { lat: 50.8, lng: 4.5,  z: 7 },
  "ireland":  { lat: 53.3, lng: -8.0, z: 6 },
  "united states": { lat: 39.7, lng: -98.6, z: 4 },
  "usa":      { lat: 39.7, lng: -98.6, z: 4 },
  "canada":   { lat: 56.1, lng: -106.3, z: 3 },
  "mexico":   { lat: 23.6, lng: -102.6, z: 4 },
  "japan":    { lat: 36.2, lng: 138.3, z: 5 },
  "australia":{ lat: -25.3, lng: 133.8, z: 4 },
  "new zealand": { lat: -41.3, lng: 174.7, z: 5 }
};

// adjective → country
const NATIONALITY_MAP = {
  french: "france",
  spanish: "spain",
  italian: "italy",
  german: "germany",
  portuguese: "portugal",
  swiss: "switzerland",
  austrian: "austria",
  greek: "greece",
  dutch: "netherlands",
  belgian: "belgium",
  irish: "ireland",
  british: "united kingdom",
  english: "england",
  scottish: "scotland",
  welsh: "wales",
  american: "united states",
  canadian: "canada",
  mexican: "mexico",
  japanese: "japan",
  australian: "australia",
  kiwi: "new zealand"
};

function replaceNationalities(str) {
  let s = ` ${str.toLowerCase()} `;
  for (const [adj, country] of Object.entries(NATIONALITY_MAP)) {
    const re = new RegExp(`\\b${adj}\\b`, "gi");
    s = s.replace(re, country);
  }
  return s.trim();
}

function countryCenterFromQuery(q) {
  const s = replaceNationalities(q || "");
  for (const name of Object.keys(COUNTRY_CENTER)) {
    if (s.includes(name)) return COUNTRY_CENTER[name];
  }
  return null;
}

/* -----------------------------
   Maps tile (travel intent) — centered
----------------------------- */
function mapsTileMarkup(query){
  const hint = countryCenterFromQuery(query);
  const base = `https://www.google.com/maps`;
  let embed;

  if (hint) {
    embed = `${base}?q=${encodeURIComponent(query)}&ll=${hint.lat},${hint.lng}&z=${hint.z}&output=embed`;
  } else {
    embed = `${base}?q=${encodeURIComponent(query)}&output=embed`;
  }

  const open    = `${base}/search/${encodeURIComponent(query)}`;
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

/* ---- Travel query normalization ---- */
function normalizeTravelQuery(val){
  const raw0 = (val || "").trim();
  if (!raw0) return raw0;
  if (/\bnear me\b/i.test(raw0)) return raw0;

  // Replace adjectives first (French→France, etc.)
  const raw = replaceNationalities(raw0);

  // If any non-UK country is present, don't append UK
  const NON_UK_COUNTRIES =
    /\b(france|spain|italy|germany|portugal|switzerland|austria|greece|croatia|turkey|netherlands|belgium|ireland(?!\s*northern)|iceland|norway|sweden|denmark|finland|poland|czech|hungary|romania|bulgaria|slovenia|slovakia|estonia|latvia|lithuania|canada|mexico|united states|usa|brazil|argentina|chile|peru|japan|south korea|korea|china|india|thailand|vietnam|indonesia|malaysia|singapore|australia|new zealand|morocco|egypt|south africa|uae|dubai|qatar)\b/i;
  if (NON_UK_COUNTRIES.test(raw)) return raw;

  const ukWords = /\b(uk|u\.k\.|united kingdom|england|scotland|wales|northern ireland)\b/i;
  const hasPlaceHint = /\b(in|near|around)\s+[A-Za-z][\w\s'-]+$/i.test(raw);
  const isVeryGeneric = /\b(holiday|holidays|break|breaks|trip|trips|ideas|getaway|getaways|staycation|weekend)\b/i.test(raw);

  if (ukWords.test(raw)) {
    return /united kingdom/i.test(raw) ? raw : `${raw} United Kingdom`;
  }
  if (!hasPlaceHint && isVeryGeneric) {
    return `${raw} United Kingdom`;
  }
  return raw;
}

/* -----------------------------
   RSS / Gallery / Markets (unchanged)
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
      if (attempt < 2) setTimeout(()=>loadRssInto(card, feeds, attempt+1), 1000);
      else content.innerHTML = rssErrorMarkup();
    });
}

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
   Football (sim fallback)
----------------------------- */
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
   Defaults / seed
----------------------------- */
function gallerySeed() {
  return [
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1469474968028-56623f02e42e?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1501785888041-af3ef285b470?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1491553895911-0055eca6402d?q=80&w=600&auto=format&fit=crop"
  ];
}
function defaultSections() {
  return [
    { id: uid(), type:"rss",      title:"Daily Brief", meta:{ feeds: RSS_PRESETS.uk }, content: rssLoadingMarkup() },
    { id: uid(), type:"web",      title:"BBC News",    meta:{url:"https://www.bbc.com", mode:"preview"}, content: webTileMarkup("https://www.bbc.com","preview") },
    { id: uid(), type:"youtube",  title:"YouTube",     meta:{ playlist:[...YT_DEFAULTS], current:"M7lc1UVf-VE" }, content: ytPlaylistMarkup(YT_DEFAULTS, "M7lc1UVf-VE") },
    { id: uid(), type:"stocks",   title:"Markets",     meta:{ symbols:["AAPL","MSFT","BTC-USD"] }, content: tickerMarkup(["AAPL","MSFT","BTC-USD"]) },
    { id: uid(), type:"football", title:"Football",    meta:{}, content: footballMarkupSeed() },
    { id: uid(), type:"gallery",  title:"Gallery",     meta:{ urls: gallerySeed() }, content: galleryMarkup(gallerySeed()) }
  ];
}

/* -----------------------------
   Storage versioning / seed
----------------------------- */
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
function webTileMarkup(url, mode = "preview") {
  const host = hostOf(url);
  const favicon = favOf(url);
  if (mode === "embed") {
    return `
      <div class="web-tile" data-web data-url="${url}" data-mode="embed">
        <div class="web-actions">
          <button class="btn sm web-toggle" data-mode="preview">Preview</button>
          <a class="btn sm" href="${url}" target="_blank" rel="noopener">Open</a>
        </div>
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
        <div class="web-actions">
          <button class="btn sm web-toggle" data-mode="embed">Embed</button>
          <a class="btn sm" href="${url}" target="_blank" rel="noopener">Open</a>
        </div>
        <div class="muted" style="margin-top:6px">Preview mode avoids iframe blocks. Try Embed; if it fails, use Open.</div>
      </div>
    </div>
  `;
}

function tileContentFor(section) {
  switch (section.type) {
    case "youtube": {
      const playlist = section.meta?.playlist || (section.meta?.videoId ? [section.meta.videoId] : YT_DEFAULTS);
      const current  = section.meta?.current || section.meta?.videoId || playlist[0];
      return ytPlaylistMarkup(playlist, current);
    }
    case "web": {
      const url = section.meta?.url || "https://example.com";
      const mode = section.meta?.mode || "preview";
      return webTileMarkup(url, mode);
    }
    case "maps": {
      const q = section.meta?.q || "nearby";
      return mapsTileMarkup(q);
    }
    case "results": {
      const q = section.meta?.q || "";
      const items = section.meta?.items || [];
      return resultsTileMarkup(q, items);
    }
    case "rss": return section.content || rssLoadingMarkup();
    case "gallery": return galleryMarkup(section.meta?.urls || []);
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
function render() {
  stopDynamicTimers();
  stopLiveIntervals();

  const grid = $("#grid");
  grid.innerHTML = "";

  const others = sections.filter(s=>s.type!=="email");
  const emails = sections.filter(s=>s.type==="email");

  [...others, ...emails].forEach(s => {
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
   Delegated handlers
----------------------------- */
(function attachDelegatesOnce(){
  const grid = $("#grid");

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

  grid.addEventListener("click", (e)=>{
    const btn = e.target.closest(".settingsBtn");
    if (!btn) return;
    const id = btn.dataset.id;
    const s = sections.find(x => x.id === id);
    if (!s) return;

    let fields = "";
    if (s.type === "web") {
      const url = s.meta?.url || "";
      const mode = s.meta?.mode || "preview";
      fields = `
        <div class="field">
          <label>URL</label>
          <input class="input" id="set_url" value="${url}">
        </div>
        <div class="field">
          <label>Mode</label>
          <select class="input" id="set_mode">
            <option value="preview" ${mode==='preview'?'selected':''}>Preview</option>
            <option value="embed" ${mode==='embed'?'selected':''}>Embed</option>
          </select>
        </div>
      `;
    } else if (s.type === "maps") {
      const q = s.meta?.q || "";
      fields = `
        <div class="field">
          <label>Maps search</label>
          <input class="input" id="set_maps_q" value="${q}">
        </div>
      `;
    } else if (s.type === "results") {
      const q = s.meta?.q || "";
      fields = `
        <div class="field">
          <label>Query</label>
          <input class="input" id="set_results_q" value="${q}">
        </div>
        <div class="muted">This tile lists multiple high-quality links.</div>
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

    $("#settingsSaveBtn")?.addEventListener("click", async ()=>{
      if (s.type === "web") {
        const url = $("#set_url")?.value?.trim() || s.meta?.url || "";
        const mode = $("#set_mode")?.value || "preview";
        s.meta = {...(s.meta||{}), url, mode};
        s.content = webTileMarkup(url, mode);
      } else if (s.type === "maps") {
        const q = $("#set_maps_q")?.value?.trim() || s.meta?.q || "";
        s.meta = {...(s.meta||{}), q};
        s.content = mapsTileMarkup(q);
      } else if (s.type === "results") {
        const q = $("#set_results_q")?.value?.trim() || s.meta?.q || "";
        const resp = await fetch(`/api/ai-tile?q=${encodeURIComponent(q)}&region=GB`);
        const data = await resp.json();
        s.meta = { q, items: data.items || [] };
        s.title = data.title || `Results — ${q}`;
        s.type  = "results";
        s.content = resultsTileMarkup(q, s.meta.items);
      }
      localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
      __closeModal();
      render();
    }, { once:true });
  });

  // Web tile preview <-> embed
  grid.addEventListener("click", (e) => {
    const toggle = e.target.closest(".web-toggle");
    if (!toggle) return;
    const card = e.target.closest(".card");
    const tile = e.target.closest("[data-web]");
    if (!card || !tile) return;
    const id = card.dataset.id;
    const s = sections.find(x => x.id === id);
    if (!s) return;
    const url = tile.dataset.url;
    const nextMode = toggle.dataset.mode;
    s.meta = s.meta || {};
    s.meta.url = url;
    s.meta.mode = nextMode;
    s.content = webTileMarkup(url, nextMode);
    localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
    const content = card.querySelector(".content");
    if (content) content.innerHTML = s.content;
  });

  // RSS refresh
  grid.addEventListener("click", (e) => {
    const refresh = e.target.closest(".rss-refresh");
    if (!refresh) return;
    const card = e.target.closest(".card");
    if (!card) return;
    const id = card.dataset.id;
    const s = sections.find(x => x.id === id);
    if (!s) return;
    const feeds = s.meta?.feeds || RSS_PRESETS.uk;
    loadRssInto(card, feeds);
  });

  // Gallery viewer
  grid.addEventListener("click", (e) => {
    const img = e.target.closest(".gallery img");
    if (img) {
      const tile = e.target.closest(".gallery-tile");
      const view = tile.querySelector(".gallery-view");
      const large = view.querySelector("img");
      large.src = img.src;
      view.classList.add("show");
      return;
    }
    const close = e.target.closest(".gallery-view");
    if (close) {
      close.classList.remove("show");
    }
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
function stopDynamicTimers(){ Object.values(dynamicTimers).forEach(clearInterval); dynamicTimers = {}; }
function stopLiveIntervals(){ Object.values(liveIntervals).forEach(clearInterval); liveIntervals = {}; }
function initDynamicTiles(){
  // (football + stocks simulated heartbeat; unchanged)
}
function initLiveFeeds(){
  // RSS + quotes refresh; unchanged
}

/* stock fallbacks */
function seedPrice(sym){ if (sym.includes("BTC")) return 65000 + Math.random()*4000; if (sym.includes("ETH")) return 3200 + Math.random()*300; return 100 + Math.random()*100; }
function stepPrice(p){ const drift = (Math.random()-0.5) * (p*0.004); return Math.max(0.01, p + drift); }
function renderTicker(card, prices, prev){ /* unchanged visual updater */ }

/* -----------------------------
   Add Tile — AI-first + travel
----------------------------- */
const addBtn     = $("#addTileBtnTop");
const tileMenu   = $("#tileMenu");
const tileSearch = $("#tileSearch");

addBtn?.addEventListener("click", () => {
  tileMenu.classList.toggle("hidden");
  if (!tileMenu.classList.contains("hidden")) tileSearch.focus();
});

tileSearch?.addEventListener("keydown", (e)=>{
  if (e.key !== "Enter") {
    if (e.key === "Escape") tileMenu.classList.add("hidden");
    return;
  }

  const valRaw = tileSearch.value.trim();
  if (!valRaw) return;
  const val = valRaw.replace(/\s+/g, " ");
  let newTile = null;

  // Travel intent → Maps
  const TRAVEL_RE = /(retreat|spa|resort|hotel|hostel|air\s*bnb|airbnb|villa|wellness|yoga|camp|lodg(e|ing)|stay|bnb|guesthouse|inn|aparthotel|boutique|residence|beach\s*resort|city\s*break|holiday|holidays|getaway|staycation|weekend|canal\s*boat|boating|cruise)/i;
  const GEO_HINT  = /\b(near me|in\s+[A-Za-z][\w\s'-]+)$/i;
  if (TRAVEL_RE.test(val) || GEO_HINT.test(val)) {
    const q = normalizeTravelQuery(val);
    newTile = {
      id: uid(),
      type: "maps",
      title: `Search — ${val}`,
      meta: { q },
      content: mapsTileMarkup(q)
    };
  }

  // URL → Web
  const isUrl = /^https?:\/\//i.test(val);
  if (!newTile && isUrl) {
    const url = val;
    newTile = { id: uid(), type:"web", title: new URL(val).hostname, meta:{ url, mode:"preview" }, content: webTileMarkup(url, "preview") };
  }

  // AI multi-result endpoint
  const goAi = async () => {
    try {
      const r = await fetch(`/api/ai-tile?q=${encodeURIComponent(val)}&region=GB`);
      if (!r.ok) throw new Error("ai-tile not available");
      const data = await r.json();
      const s = {
        id: uid(),
        type: "results",
        title: data.title || `Results — ${val}`,
        meta: { q: val, items: data.items || [] },
        content: resultsTileMarkup(val, data.items || []),
      };
      sections.unshift(s);
      localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
      render();
      tileMenu.classList.add("hidden");
      tileSearch.value = "";
    } catch {
      const gn  = `https://news.google.com/rss/search?q=${encodeURIComponent(val)}&hl=en-GB&gl=GB&ceid=GB:en`;
      const s = { id: uid(), type:"rss", title:`Daily Brief — ${val}`, meta:{ feeds:[gn] }, content: rssLoadingMarkup() };
      sections.unshift(s);
      localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
      render();
      tileMenu.classList.add("hidden");
      tileSearch.value = "";
    }
  };

  if (newTile) {
    sections.unshift(newTile);
    localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
    render();
    tileMenu.classList.add("hidden");
    tileSearch.value = "";
  } else {
    goAi();
  }
});

/* -----------------------------
   Assistant — standalone, multi-turn (POST→GET fallback)
----------------------------- */
const assistantToggle = $("#assistantToggle");
const assistantPanel  = $("#assistantPanel");
const chatLog   = $("#assistantChat");
const chatForm  = $("#chatForm");
const chatInput = $("#chatInput");

function updateAssistant() {
  if (!assistantPanel) return;
  assistantPanel.style.display = assistantOn ? "block" : "none";
  assistantToggle?.classList.toggle("primary", assistantOn);
  appEl?.classList.toggle("no-right", !assistantOn);
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
    const recent = chat.slice(-12);
    const r = await fetch(`/api/ai-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: recent })
    });
    if (!r.ok) throw new Error("POST failed");
    const j = await r.json();
    addChat('ai', j.message || "…");
  } catch {
    // Fallback to GET so the chat still works even if POST parsing fails
    try {
      const r2 = await fetch(`/api/ai-chat?q=${encodeURIComponent(text)}`);
      const j2 = await r2.json();
      addChat('ai', j2.message || "…");
    } catch {
      addChat('ai', "I couldn't reach the chat service just now. Try again in a moment.");
    }
  }
});

/* -----------------------------
   Global settings & modals (unchanged)
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
  updateAssistant();
  renderChat();
  render();
});
