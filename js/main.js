/* ============================================================
   LifeCre8 — main.js  v1.11.2
   Changes (vs 1.11.0):
   - Assistant: auto /web when the query needs fresh info (weather, forecast, latest, price today, news, scores, etc.)
   - Assistant: lightweight Markdown rendering (bold/italic/links/lists/code)
   - Assistant: show tiny mode badge (e.g., web+llm / time-local / passthrough)
   - Assistant: safer error handling (no silent crashes)
   Other app features preserved as-is.
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
if (!chat.length) chat = [{ role:'ai', text:"Hi! I'm your AI Assistant. Ask me anything.", meta:{} }];

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

/* -----------------------------
   RSS tile (enriched)
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

/* -----------------------------
   Gallery
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

/* -----------------------------
   Markets
----------------------------- */
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
      (data.quotes||data.items||[]).forEach(q=>{
        const sym = (q.symbol||q.ticker||"").toUpperCase();
        map[sym] = q;
      });
      const rows = card.querySelectorAll(".trow");
      rows.forEach(row=>{
        const sym = row.dataset.sym.toUpperCase();
        const q = map[sym];
        if (!q) return;
        const priceEl = row.querySelector("[data-price]");
        const chgEl   = row.querySelector("[data-chg]");
        const price = q.price;
        const delta = q.change ?? q.change24h ?? q.changePct24h;
        const pct   = q.changePercent ?? q.changePct24h;
        priceEl.textContent = (price!=null) ? Number(price).toFixed(2) : "—";
        chgEl.textContent   = (delta!=null && pct!=null)
          ? `${delta>=0?"+":""}${Number(delta).toFixed(2)}  (${pct>=0?"+":""}${Number(pct).toFixed(2)}%)`
          : (delta!=null ? `${delta>=0?"+":""}${Number(delta).toFixed(2)}` : "—");
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
   Football (simulated fallback)
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
   Defaults
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
    { id: uid(), type:"web",      title:"BBC News",    meta:{url:"https://www.bbc.com"}, content: webTileMarkup("https://www.bbc.com") },
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
   Render helpers
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
    case "rss":  return section.content || rssLoadingMarkup();
    case "gallery": {
      const urls = section.meta?.urls || [];
      return galleryMarkup(urls);
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
function render() {
  Object.values(dynamicTimers).forEach(clearInterval); dynamicTimers = {};
  Object.values(liveIntervals).forEach(clearInterval); liveIntervals = {};

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

  // live: RSS + Quotes
  $$('.card[data-type="rss"]').forEach(card=>{
    const id = card.dataset.id;
    const s = sections.find(x=>x.id===id);
    const feeds = s?.meta?.feeds || RSS_PRESETS.uk;
    loadRssInto(card, feeds);
    liveIntervals[id+"_rss"] = setInterval(()=>loadRssInto(card, feeds), 15*60*1000);
  });
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
   Delegated handlers
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
        <div class="field"><label>URL</label>
          <input class="input" id="set_url" value="${url}">
        </div>`;
    } else if (s.type === "maps") {
      const q = s.meta?.q || "";
      fields = `
        <div class="field"><label>Maps search</label>
          <input class="input" id="set_maps_q" value="${q}">
        </div>`;
    } else if (s.type === "youtube") {
      const list = (s.meta?.playlist || YT_DEFAULTS).join(",");
      fields = `
        <div class="field"><label>Playlist (comma-separated video IDs)</label>
          <input class="input" id="set_playlist" value="${list}">
        </div>`;
    } else if (s.type === "stocks") {
      const syms = (s.meta?.symbols || ["AAPL","MSFT","BTC-USD"]).join(",");
      const presetOptions = Object.keys(STOCK_PRESETS).map(name=>`<option value="${name}">${name}</option>`).join("");
      fields = `
        <div class="field"><label>Symbols (comma-separated)</label>
          <input class="input" id="set_symbols" value="${syms}">
        </div>
        <div class="field"><label>Presets</label>
          <div class="row" style="gap:8px">
            <select class="input" id="set_symbols_preset" style="min-width:180px">
              <option value="">Choose a preset…</option>
              ${presetOptions}
            </select>
            <button class="btn sm" id="apply_symbols_preset" type="button">Apply</button>
          </div>
        </div>`;
    } else if (s.type === "rss") {
      const feeds = (s.meta?.feeds || RSS_PRESETS.uk).join(",");
      const presetOptions = Object.keys(RSS_PRESETS).map(key=>`<option value="${key}">${key.toUpperCase()}</option>`).join("");
      fields = `
        <div class="field"><label>RSS feeds (comma-separated URLs; first is used)</label>
          <input class="input" id="set_feeds" value="${feeds}">
        </div>
        <div class="field"><label>News Presets</label>
          <div class="row" style="gap:8px">
            <select class="input" id="set_feeds_preset" style="min-width:180px">
              <option value="">Choose a preset…</option>
              ${presetOptions}
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
      const key = $("#set_symbols_preset").value;
      if (!key) return;
      const arr = STOCK_PRESETS[key] || [];
      $("#set_symbols").value = arr.join(",");
    });
    $("#apply_feeds_preset")?.addEventListener("click", ()=>{
      const key = $("#set_feeds_preset").value;
      if (!key) return;
      const arr = RSS_PRESETS[key] || [];
      $("#set_feeds").value = arr.join(",");
    });

    $("#settingsSaveBtn")?.addEventListener("click", ()=>{
      if (s.type === "web") {
        const url = $("#set_url")?.value?.trim() || s.meta?.url || "";
        s.meta = {...(s.meta||{}), url };
        s.content = webTileMarkup(url);
      } else if (s.type === "maps") {
        const q = $("#set_maps_q")?.value?.trim() || s.meta?.q || "";
        s.meta = {...(s.meta||{}), q};
        s.content = mapsTileMarkup(q);
      } else if (s.type === "youtube") {
        const playlist = ($("#set_playlist")?.value || "").split(",").map(x=>x.trim()).filter(Boolean);
        const list = playlist.length? playlist : (s.meta?.playlist || YT_DEFAULTS);
        const current = list[0];
        s.meta = {...(s.meta||{}), playlist:list, current};
        s.content = ytPlaylistMarkup(list, current);
      } else if (s.type === "stocks") {
        const symbols = ($("#set_symbols")?.value || "").split(",").map(x=>x.trim()).filter(Boolean);
        const syms = symbols.length? symbols : (s.meta?.symbols || ["AAPL","MSFT","BTC-USD"]);
        s.meta = {...(s.meta||{}), symbols: syms};
        s.content = tickerMarkup(syms);
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

  // YouTube swap
  grid.addEventListener("click", (e) => {
    const item = e.target.closest(".yt-item");
    if (!item) return;
    const container = item.closest("[data-yt]");
    if (!container) return;
    const newId = item.dataset.vid;
    const iframe = container.querySelector("iframe.yt-embed");
    if (!iframe) return;
    container.querySelectorAll(".yt-item").forEach(el => el.classList.remove("active"));
    item.addClass?.("active") || item.classList.add("active");
    iframe.src = ytEmbedSrc(newId);
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
})();

/* -----------------------------
   Add Tile — AI agent (unchanged client; server decides)
----------------------------- */
const addBtn     = $("#addTileBtnTop");
const tileMenu   = $("#tileMenu");
const tileSearch = $("#tileSearch");

addBtn?.addEventListener("click", () => {
  tileMenu?.classList.toggle("hidden");
  if (!tileMenu?.classList.contains("hidden")) tileSearch?.focus();
});

tileSearch?.addEventListener("keydown", async (e)=>{
  if (e.key !== "Enter") { if (e.key === "Escape") tileMenu?.classList.add("hidden"); return; }

  const q = (tileSearch.value || "").trim();
  if (!q) return;

  // ask the server agent to decide the tile
  let plan;
  try {
    const r = await fetch("/api/ai-tile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q })
    });
    const j = await r.json();
    plan = j.tile || j;
  } catch {
    // fallback → basic RSS
    plan = {
      type: "rss",
      title: `Daily Brief — ${q}`,
      feeds: [`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`]
    };
  }

  // build client tile from plan
  let newTile = null;
  if (plan.type === "maps" && plan.q) {
    newTile = { id: uid(), type: "maps", title: plan.title || q, meta:{ q: plan.q }, content: mapsTileMarkup(plan.q) };
  } else if (plan.type === "web" && plan.url) {
    newTile = { id: uid(), type: "web", title: plan.title || hostOf(plan.url) || "Web", meta:{ url: plan.url }, content: webTileMarkup(plan.url) };
  } else if (plan.type === "youtube" && Array.isArray(plan.playlist) && plan.playlist.length) {
    const cur = plan.playlist[0];
    newTile = { id: uid(), type:"youtube", title: plan.title || "YouTube", meta:{ playlist: plan.playlist, current: cur }, content: ytPlaylistMarkup(plan.playlist, cur) };
  } else if (plan.type === "rss" && Array.isArray(plan.feeds) && plan.feeds.length) {
    newTile = { id: uid(), type:"rss", title: plan.title || `Daily Brief — ${q}`, meta:{ feeds: plan.feeds }, content: rssLoadingMarkup() };
  } else if (plan.type === "gallery" && Array.isArray(plan.images) && plan.images.length) {
    newTile = { id: uid(), type:"gallery", title: plan.title || "Gallery", meta:{ urls: plan.images }, content: galleryMarkup(plan.images) };
  } else if (plan.type === "stocks" && Array.isArray(plan.symbols) && plan.symbols.length) {
    newTile = { id: uid(), type:"stocks", title: plan.title || "Markets", meta:{ symbols: plan.symbols }, content: tickerMarkup(plan.symbols) };
  }

  // if still nothing, fallback to RSS
  if (!newTile) {
    newTile = {
      id: uid(), type:"rss", title:`Daily Brief — ${q}`,
      meta:{ feeds: [`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`] },
      content: rssLoadingMarkup()
    };
  }

  sections.unshift(newTile);
  localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
  render();
  tileMenu?.classList.add("hidden");
  tileSearch.value = "";
});

/* -----------------------------
   Assistant Toggle & Chat (live-aware)
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

/* --- tiny Markdown renderer (safe, minimal) --- */
function escapeHtml(s){ return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function mdRender(src=""){
  let s = escapeHtml(src);
  // code
  s = s.replace(/```([\s\S]*?)```/g, (_,code)=>`<pre><code>${code.trim()}</code></pre>`);
  // inline code
  s = s.replace(/`([^`]+)`/g, (_,t)=>`<code>${t}</code>`);
  // bold / italics
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  // links
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, `<a href="$2" target="_blank" rel="noopener">$1</a>`);
  // simple lists
  s = s.replace(/(^|\n)\s*[-•]\s+(.+)(?=\n|$)/g, "$1<li>$2</li>");
  s = s.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");
  // newlines
  s = s.replace(/\n/g, "<br/>");
  return s;
}

function renderChat(){
  if (!chatLog) return;
  chatLog.innerHTML = "";
  chat.forEach(m=>{
    const d = document.createElement("div");
    d.className = `msg ${m.role}`;
    if (m.role === "ai") {
      const html = mdRender(m.text || "");
      d.innerHTML = `<div>${html}</div>${m.meta?.mode ? `<div class="muted" style="margin-top:4px;font-size:11px">mode: ${m.meta.mode}${m.meta.model?` · ${m.meta.model}`:''}</div>`:""}`;
    } else {
      d.textContent = m.text || "";
    }
    chatLog.appendChild(d);
  });
  chatLog.scrollTop = chatLog.scrollHeight;
}
function addChat(role, text, meta={}){
  chat.push({role, text, meta});
  localStorage.setItem(K_CHAT, JSON.stringify(chat));
  renderChat();
}

/* Detect queries that should force live web (prefix /web) */
function shouldForceWeb(q=""){
  const s = q.toLowerCase();
  if (/^\/web\s+/.test(s)) return true;
  if (/\b(latest|today|this week|this month|breaking|update|just now|live|live price|price now|price today|score|scores|fixtures|schedule|news|weather|forecast|temperature|price|odds)\b/.test(s)) return true;
  if (/\b20(2[3-9]|3\d)\b/.test(s)) return true; // explicit recent years
  return false;
}

chatForm?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const raw = chatInput.value;
  const text = (raw || "").trim();
  if (!text) return;

  // Force live for “fresh-data” questions by prefixing /web (server will pick web+llm path)
  const payloadText = shouldForceWeb(text) && !/^\/web\s+/i.test(text) ? `/web ${text}` : text;

  addChat('user', text);
  chatInput.value = "";
  try {
    const r = await fetch("/api/ai-chat", {
      method:"POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ q: payloadText, messages: chat })
    });
    const j = await r.json();
    addChat('ai', j.message || "…", { mode: j.mode, model: j.model, version: j.version });
  } catch (err) {
    addChat('ai', "I couldn't reach the chat service just now. Try again in a moment.", { mode:"error" });
  }
});

/* -----------------------------
   Global settings (Top button)
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
    </div>`;
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
   Modal helpers
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
  updateAssistant();
  renderChat();
  render();
});
