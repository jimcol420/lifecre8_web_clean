/* ============================================================
   LifeCre8 — main.js  v1.10.0
   BASE: v1.9.0 (no features removed)
   + AI intent-router for Add Tile (/api/ai/route) with fallback
   + AI summaries/images for Daily Brief (/api/ai/summarize) with fallback
   - Solar + Ice themes
   - Modal safety-net (close on Save/Cancel/backdrop/Esc)
   - LIVE NEWS via /api/rss (real RSS → JSON) with presets
   - LIVE MARKETS via /api/quote (Yahoo → JSON) with presets
   - Smart "Add Tile" commands (kept as fallback)
============================================================ */

/* ===== Keys & Version ===== */
const K_SECTIONS   = "lifecre8.sections";
const K_ASSIST_ON  = "lifecre8.assistantOn";
const K_CHAT       = "lifecre8.chat";
const K_VERSION    = "lifecre8.version";
const K_PREFS      = "lifecre8.prefs"; // theme, density
const DATA_VERSION = 6;

/* ===== Presets ===== */
const RSS_PRESETS = {
  world: [
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://www.reuters.com/world/rss"
  ],
  tech: [
    "https://www.theverge.com/rss/index.xml",
    "https://www.engadget.com/rss.xml",
    "https://www.wired.com/feed/rss"
  ],
  finance: [
    "https://feeds.bbci.co.uk/news/business/rss.xml",
    "https://www.reuters.com/markets/rss"
  ],
  uk: [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://www.theguardian.com/uk-news/rss"
  ]
};
const STOCK_PRESETS = {
  "Tech Giants": ["AAPL","MSFT","GOOGL","AMZN","NVDA"],
  "Crypto": ["BTC-USD","ETH-USD","SOL-USD"],
  "US Indexes": ["^GSPC","^DJI","^IXIC"]
};

/* ===== State ===== */
let sections    = JSON.parse(localStorage.getItem(K_SECTIONS)  || "[]");
let assistantOn = localStorage.getItem(K_ASSIST_ON) === null ? true : JSON.parse(localStorage.getItem(K_ASSIST_ON));
let chat        = JSON.parse(localStorage.getItem(K_CHAT)      || "[]");
if (!chat.length) chat = [{ role:'ai', text:"Hi! I'm your AI Assistant. Ask me anything." }];

let prefs = JSON.parse(localStorage.getItem(K_PREFS) || "{}");
if (!prefs.theme) prefs.theme = "solar";
if (!prefs.density) prefs.density = "comfortable";
document.body.classList.toggle('theme-ice', prefs.theme === 'ice');
document.body.classList.toggle('density-compact', prefs.density === 'compact');

/* timers for dynamic tiles */
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
  "M7lc1UVf-VE",
  "5qap5aO4i9A",
  "DWcJFNfaw9c",
  "jfKfPfyJRdk",
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
   Web tile
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

/* -----------------------------
   Spotify tile
----------------------------- */
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

/* -----------------------------
   RSS tile (LIVE via /api/rss) + AI summarize (/api/ai/summarize)
----------------------------- */
function rssCard(i) {
  // Render a nicer card-style item with optional image + summary
  const img = i.image ? `<img src="${i.image}" alt="" style="width:92px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border);background:#0a1522;margin-right:10px"/>` : "";
  const summary = i.summary ? `<div class="muted" style="margin-top:4px">${i.summary}</div>` : "";
  const meta = [i.source, i.time].filter(Boolean).join(" — ");
  return `
    <a class="rss-card" href="${i.link}" target="_blank" rel="noopener"
       style="display:flex;align-items:center;text-decoration:none;color:inherit;border:1px solid var(--border);border-radius:12px;padding:8px 10px;background:rgba(0,0,0,.03);gap:10px">
      ${img}
      <div style="min-width:0">
        <div style="font-weight:700;line-height:1.25">${i.title}</div>
        ${summary}
        <div class="muted" style="margin-top:4px">${meta}</div>
      </div>
    </a>
  `;
}
function rssMarkup(items) {
  const list = (items || []).map(rssCard).join("");
  return `
    <div class="rss" data-rss>
      <div class="rss-controls" style="margin-bottom:8px">
        <button class="btn sm rss-refresh">Refresh</button>
      </div>
      <div class="rss-list" style="display:grid;gap:8px">${list}</div>
    </div>
  `;
}
function rssLoadingMarkup() {
  return `
    <div class="rss" data-rss>
      <div class="rss-controls" style="margin-bottom:8px">
        <button class="btn sm rss-refresh">Refresh</button>
      </div>
      <div class="muted">Loading…</div>
    </div>
  `;
}
function rssErrorMarkup() {
  return `
    <div class="rss" data-rss>
      <div class="rss-controls" style="margin-bottom:8px">
        <button class="btn sm rss-refresh">Refresh</button>
      </div>
      <div class="muted">Couldn’t load news right now. Try Refresh in a moment.</div>
    </div>
  `;
}
async function loadRssInto(card, feeds, attempt=1) {
  const content = card.querySelector(".content");
  if (!feeds || !feeds.length || !content) return;
  const rssUrl = `/api/rss?url=${encodeURIComponent(feeds[0])}`;
  try {
    const r = await fetch(rssUrl);
    const data = await r.json();
    const rawItems = (data.items||[]).slice(0,12);
    // Enrich with AI summaries/images (graceful fallback)
    let enriched = rawItems;
    try {
      const s = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ items: rawItems })
      });
      if (s.ok) {
        const sj = await s.json();
        if (Array.isArray(sj.items) && sj.items.length) enriched = sj.items;
      }
    } catch {}
    content.innerHTML = rssMarkup(enriched);
  } catch (e) {
    if (attempt < 2) {
      setTimeout(()=>loadRssInto(card, feeds, attempt+1), 1000);
    } else {
      content.innerHTML = rssErrorMarkup();
    }
  }
}

/* -----------------------------
   Gallery tile
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
   Markets (LIVE via /api/quote)
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
  fetch(url).then(r=>r.json()).then(data=>{
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
  }).catch(()=>{
    const content = card.querySelector(".content");
    if (content && !content.querySelector(".ticker")) {
      content.innerHTML = `<div class="muted">Live prices unavailable right now.</div>`;
    }
  });
}

/* -----------------------------
   Football (simulated)
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
   Defaults (seed)
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
    case "spotify": {
      const url = section.meta?.url || "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M";
      return spotifyMarkup(url);
    }
    case "rss": return section.content;
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

  // Settings
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
    } else if (s.type === "youtube") {
      const list = (s.meta?.playlist || YT_DEFAULTS).join(",");
      fields = `
        <div class="field">
          <label>Playlist (comma-separated video IDs)</label>
          <input class="input" id="set_playlist" value="${list}">
        </div>
      `;
    } else if (s.type === "stocks") {
      const syms = (s.meta?.symbols || ["AAPL","MSFT","BTC-USD"]).join(",");
      const presetOptions = Object.keys(STOCK_PRESETS).map(name=>`<option value="${name}">${name}</option>`).join("");
      fields = `
        <div class="field">
          <label>Symbols (comma-separated)</label>
          <input class="input" id="set_symbols" value="${syms}">
        </div>
        <div class="field">
          <label>Presets</label>
          <div class="row" style="gap:8px">
            <select class="input" id="set_symbols_preset" style="min-width:180px">
              <option value="">Choose a preset…</option>
              ${presetOptions}
            </select>
            <button class="btn sm" id="apply_symbols_preset" type="button">Apply</button>
          </div>
        </div>
      `;
    } else if (s.type === "rss") {
      const feeds = (s.meta?.feeds || RSS_PRESETS.uk).join(",");
      const presetOptions = Object.keys(RSS_PRESETS).map(key=>`<option value="${key}">${key.toUpperCase()}</option>`).join("");
      fields = `
        <div class="field">
          <label>RSS feeds (comma-separated URLs; first is used)</label>
          <input class="input" id="set_feeds" value="${feeds}">
        </div>
        <div class="field">
          <label>News Presets</label>
          <div class="row" style="gap:8px">
            <select class="input" id="set_feeds_preset" style="min-width:180px">
              <option value="">Choose a preset…</option>
              ${presetOptions}
            </select>
            <button class="btn sm" id="apply_feeds_preset" type="button">Apply</button>
          </div>
        </div>
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
        const mode = $("#set_mode")?.value || "preview";
        s.meta = {...(s.meta||{}), url, mode};
        s.content = webTileMarkup(url, mode);
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
      render();
    }, { once:true });
  });

  // Backdrop close (fullscreen)
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
    item.classList.add("active");
    iframe.src = ytEmbedSrc(newId);
    const card = item.closest(".card");
    const id = card?.dataset.id;
    if (id) {
      const s = sections.find(x => x.id === id);
      if (s) {
        s.meta = s.meta || {};
        const existingList = container.dataset.playlist?.split(",").filter(Boolean) || YT_DEFAULTS;
        s.meta.playlist = existingList;
        s.meta.current  = newId;
        s.content = ytPlaylistMarkup(s.meta.playlist, s.meta.current);
        localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
      }
    }
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
    const nextMode = toggle.dataset.mode; // "embed" or "preview"
    s.meta = s.meta || {};
    s.meta.url = url;
    s.meta.mode = nextMode;
    s.content = webTileMarkup(url, nextMode);
    localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
    const content = card.querySelector(".content");
    if (content) content.innerHTML = s.content;
  });

  // RSS refresh (live)
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
  // Simulated football
  $$('.card[data-type="football"]').forEach(card=>{
    const container = card.querySelector(".scores");
    if (!container) return;

    let matches;
    try { matches = JSON.parse(decodeURIComponent(container.dataset.matches || "[]")); }
    catch { matches = [{ home:"Team A", away:"Team B", hs:0, as:0, min:0, status:"KO 20:00", started:false, finished:false }]; }

    const timer = setInterval(()=>{
      let changed = false;
      matches.forEach((m, i)=>{
        if (!m.started && Math.random() < 0.3) { m.started = true; m.min = 1; m.status = "1'"; changed = true; }
        else if (m.started && !m.finished) {
          if (Math.random() < 0.7) { m.min = clamp(m.min + 1, 1, 95); m.status = m.min >= 90 ? `90'+` : `${m.min}'`; changed = true; }
          if (Math.random() < 0.15) { if (Math.random() < 0.5) m.hs++; else m.as++; flashGoal(card, i, `${m.hs}–${m.as}`); changed = true; }
          if (m.min >= 93 && Math.random() < 0.25) { m.finished = true; m.status = "FT"; changed = true; }
        }
      });
      if (changed) {
        const rows = card.querySelectorAll(".match");
        matches.forEach((m, i)=>{
          const row = rows[i]; if (!row) return;
          row.querySelector('[data-score]').textContent = `${m.hs}–${m.as}`;
          row.querySelector('[data-status]').textContent = m.status;
        });
      }
    }, 5000);

    dynamicTimers[card.dataset.id] = timer;
  });

  // Simulated stocks as fallback (live feed overwrites)
  $$('.card[data-type="stocks"]').forEach(card=>{
    const ticker = card.querySelector(".ticker");
    if (!ticker) return;
    const syms = (ticker.dataset.symbols || "").split(",").map(s=>s.trim()).filter(Boolean);
    const prices = Object.fromEntries(syms.map(s=>[s, seedPrice(s)]));
    renderTicker(card, prices, {});
    const timer = setInterval(()=>{
      const prev = {...prices};
      syms.forEach(s=>{ prices[s] = stepPrice(prices[s]); });
      renderTicker(card, prices, prev);
    }, 2000);
    dynamicTimers[card.dataset.id] = timer;
  });
}
function initLiveFeeds(){
  // RSS (live)
  $$('.card[data-type="rss"]').forEach(card=>{
    const id = card.dataset.id;
    const s = sections.find(x=>x.id===id);
    const feeds = s?.meta?.feeds || RSS_PRESETS.uk;
    loadRssInto(card, feeds);
    liveIntervals[id+"_rss"] = setInterval(()=>loadRssInto(card, feeds), 15*60*1000);
  });

  // Stocks (live)
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

/* stock fallbacks for simulation */
function seedPrice(sym){ if (sym.includes("BTC")) return 65000 + Math.random()*4000; if (sym.includes("ETH")) return 3200 + Math.random()*300; return 100 + Math.random()*100; }
function stepPrice(p){ const drift = (Math.random()-0.5) * (p*0.004); return Math.max(0.01, p + drift); }
function renderTicker(card, prices, prev){
  const rows = card.querySelectorAll(".trow");
  rows.forEach(row=>{
    const sym = row.dataset.sym;
    const priceEl = row.querySelector("[data-price]");
    const chgEl   = row.querySelector("[data-chg]");
    const price = prices[sym];
    const last  = prev[sym] ?? price;
    const delta = price - last;
    const pct   = (delta/last)*100;
    priceEl.textContent = price.toFixed(2);
    chgEl.textContent   = `${delta>=0?"+":""}${delta.toFixed(2)}  (${pct>=0?"+":""}${pct.toFixed(2)}%)`;
    row.classList.toggle("up",   delta >= 0);
    row.classList.toggle("down", delta <  0);
  });
}
function flashGoal(card, matchIdx, scoreText){
  const row = card.querySelector(`.match[data-idx="${matchIdx}"]`);
  if (!row) return;
  const scoreEl = row.querySelector('[data-score]');
  if (!scoreEl) return;
  scoreEl.textContent = scoreText;
  row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
}

/* -----------------------------
   Add Tile (AI router first, fallback to heuristics)
----------------------------- */
const addBtn     = $("#addTileBtnTop");
const tileMenu   = $("#tileMenu");
const tileSearch = $("#tileSearch");
addBtn.addEventListener("click", () => {
  tileMenu.classList.toggle("hidden");
  if (!tileMenu.classList.contains("hidden")) tileSearch.focus();
});
tileSearch.addEventListener("keydown", async (e)=>{
  if (e.key === "Enter") {
    const val = tileSearch.value.trim();
    if (!val) return;

    let newTile = null;

    // 1) Try AI router
    try {
      const resp = await fetch('/api/ai/route', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ query: val })
      });
      if (resp.ok) {
        const j = await resp.json();
        const t = (j.type || "").toLowerCase();
        const p = j.params || {};
        const title = j.title || val.replace(/\b\w/g, m=>m.toUpperCase());

        if (t === "news" || t === "rss") {
          const feeds = p.topic ? guessRssByTopic(p.topic) : (RSS_PRESETS.uk);
          newTile = { id: uid(), type:"rss", title: title || "Daily Brief", meta:{ feeds }, content: rssLoadingMarkup() };
        } else if (t === "youtube") {
          const playlist = [...YT_DEFAULTS];
          newTile = { id: uid(), type:"youtube", title: title || "YouTube", meta:{playlist, current:playlist[0]}, content: ytPlaylistMarkup(playlist, playlist[0]) };
        } else if (t === "stocks") {
          const symbols = (p.symbols && p.symbols.length) ? p.symbols : ["AAPL","MSFT","BTC-USD"];
          newTile = { id: uid(), type:"stocks", title: title || "Markets", meta:{symbols}, content: tickerMarkup(symbols) };
        } else if (t === "spotify" && p.url) {
          const url = p.url;
          newTile = { id: uid(), type:"spotify", title:"Spotify", meta:{url}, content: spotifyMarkup(url) };
        } else if (t === "web" && p.url) {
          const url = p.url;
          newTile = { id: uid(), type:"web", title: new URL(url).hostname, meta:{ url, mode:"preview" }, content: webTileMarkup(url, "preview") };
        } else if (t === "discover") {
          newTile = { id: uid(), type:"interest", title, content: `Auto-created tile for <strong>${title}</strong>` };
        }
      }
    } catch {}

    // 2) Fallback: your original heuristics (unchanged)
    if (!newTile) {
      const ytUrl = val.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_\-]+)/i);
      if (ytUrl) {
        const videoId = ytUrl[1];
        const playlist = [videoId, ...YT_DEFAULTS.filter(x=>x!==videoId)].slice(0,4);
        newTile = { id: uid(), type:"youtube", title:"YouTube", meta:{playlist, current:videoId}, content: ytPlaylistMarkup(playlist, videoId) };
      } else if (/^youtube\s+/i.test(val)) {
        const playlist = [...YT_DEFAULTS];
        newTile = { id: uid(), type:"youtube", title:"YouTube", meta:{playlist, current:playlist[0]}, content: ytPlaylistMarkup(playlist, playlist[0]) };
      }

      if (!newTile && /spotify/i.test(val)) {
        const url = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M";
        newTile = { id: uid(), type:"spotify", title:"Spotify", meta:{url}, content: spotifyMarkup(url) };
      }

      if (!newTile && /stocks?|markets?/i.test(val)) {
        const symbols = ["AAPL","MSFT","BTC-USD"];
        newTile = { id: uid(), type:"stocks", title:"Markets", meta:{symbols}, content: tickerMarkup(symbols) };
      }

      if (!newTile && /weather/i.test(val)) {
        const html = `
          <div class="row"><strong>London</strong><span class="muted">Next 24h</span></div>
          <div class="row" style="margin-top:8px">
            <div>🌤️</div><div class="muted">Partly cloudy</div><div>18°C</div>
          </div>`;
        newTile = { id: uid(), type:"weather", title:"Weather", content: html };
      }

      if (!newTile && /(football|soccer|scores|prem|premier)/i.test(val)) {
        newTile = { id: uid(), type:"football", title:"Football", content: footballMarkupSeed() };
      }

      const isUrl = /^https?:\/\//i.test(val);
      if (!newTile && isUrl) {
        const url = val;
        newTile = { id: uid(), type:"web", title: new URL(val).hostname, meta:{ url, mode:"preview" }, content: webTileMarkup(url, "preview") };
      }

      if (!newTile) {
        newTile = { id: uid(), type:"interest", title: val.replace(/\b\w/g, m=>m.toUpperCase()), content: `Auto-created tile for <strong>${val}</strong>` };
      }
    }

    sections.push(newTile);
    localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
    render();
    tileMenu.classList.add("hidden");
    tileSearch.value = "";
  } else if (e.key === "Escape") {
    tileMenu.classList.add("hidden");
  }
});
function guessRssByTopic(topic=""){
  const t = topic.toLowerCase();
  if (/tech|ai|software|gadgets/.test(t)) return RSS_PRESETS.tech;
  if (/finance|market|economy|stock|crypto/.test(t)) return RSS_PRESETS.finance;
  if (/uk|britain|england|london/.test(t)) return RSS_PRESETS.uk;
  return RSS_PRESETS.world;
}

/* -----------------------------
   Assistant Toggle & Chat
----------------------------- */
const assistantToggle = $("#assistantToggle");
const assistantPanel  = $("#assistantPanel");
const chatLog   = $("#assistantChat");
const chatForm  = $("#chatForm");
const chatInput = $("#chatInput");
function updateAssistant() {
  assistantPanel.style.display = assistantOn ? "block" : "none";
  assistantToggle.classList.toggle("primary", assistantOn);
  appEl.classList.toggle("no-right", !assistantOn);
  localStorage.setItem(K_ASSIST_ON, JSON.stringify(assistantOn));
}
assistantToggle.addEventListener("click", () => {
  assistantOn = !assistantOn;
  updateAssistant();
});
function renderChat(){
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
function fakeAIResponse(text){ return `You said: “${text}”. (Local stub)`; }
chatForm.addEventListener("submit", (e)=>{
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  addChat('user', text);
  chatInput.value = "";
  setTimeout(()=> addChat('ai', fakeAIResponse(text)), 250);
});

/* -----------------------------
   Global settings (Theme + Density)
----------------------------- */
$("#globalSettingsBtn").addEventListener("click", ()=>{
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
  }, { once:true });
});

/* -----------------------------
   Modal close safety net
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
  $("#yr").textContent = new Date().getFullYear();
  ensureVersion();
  updateAssistant();
  renderChat();
  render();
});
