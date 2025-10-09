export const config = { runtime: "edge" };

const STQ_BASE = "https://stooq.com/q/l/?s=";
const CG_SIMPLE = "https://api.coingecko.com/api/v3/simple/price";
const CG_SEARCH = "https://api.coingecko.com/api/v3/search";
const UA = "Mozilla/5.0 (compatible; LifeCre8 Quote/2.0)";

const TIMEOUT_MS = 12000;

// Optional CoinGecko Pro key (if you have one)
const CG_KEY = process.env.COINGECKO_API_KEY || process.env.CG_API_KEY || "";

// ---- tiny caches (best-effort on warm edge) ----
const _cache = {
  cgIds: new Map(),        // "BTC" -> "bitcoin"
  stooqOk: new Map(),      // "AAPL" -> "AAPL.US" or "^spx"
  stooqFail: new Set(),    // "FOO" -> known-bad
  ts: Date.now()
};

function normalizeSymbol(sym) {
  const s = String(sym || "").trim().toUpperCase();
  return s.replace(/[_\s]+/g, "-");
}

function withTimeout() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort("timeout"), TIMEOUT_MS);
  return { signal: ctrl.signal, cleanup: () => clearTimeout(t) };
}

// ---------------- CoinGecko dynamic resolver ----------------
function isCryptoSymbol(sym) {
  if (!sym) return false;
  if (/-USD$/.test(sym)) return true;
  if (/^[A-Z0-9]{2,10}$/.test(sym)) return true; // bare coin like BTC
  if (/^[A-Z0-9]{2,10}[-/][A-Z0-9]{2,10}$/.test(sym)) return true; // pair
  return false;
}

function baseQuote(sym) {
  const s = sym.replace("/", "-");
  const parts = s.split("-");
  if (parts.length === 1) return { base: s, quote: "USD" };
  return { base: parts[0], quote: parts[1] || "USD" };
}

async function cgSearchSymbol(base) {
  const key = base.toUpperCase();
  if (_cache.cgIds.has(key)) return _cache.cgIds.get(key);
  const { signal, cleanup } = withTimeout();
  try {
    const url = `${CG_SEARCH}?query=${encodeURIComponent(base)}`;
    const headers = { "user-agent": UA };
    if (CG_KEY) headers["x-cg-pro-api-key"] = CG_KEY;
    const res = await fetch(url, { headers, signal });
    if (!res.ok) throw new Error(`CG search ${res.status}`);
    const data = await res.json();
    const coins = Array.isArray(data.coins) ? data.coins : [];
    const exact = coins.find(c => (c.symbol || "").toUpperCase() === key);
    const pick = exact || coins[0];
    const id = pick?.id || null;
    if (id) _cache.cgIds.set(key, id);
    return id;
  } finally {
    cleanup();
  }
}

async function fetchCrypto(sym) {
  const { base, quote } = baseQuote(sym);
  const vs = (quote || "USD").toLowerCase();
  const id = await cgSearchSymbol(base);
  if (!id) throw new Error(`Unknown crypto symbol: ${base}`);

  const { signal, cleanup } = withTimeout();
  try {
    const url = `${CG_SIMPLE}?ids=${encodeURIComponent(id)}&vs_currencies=${encodeURIComponent(vs)}&include_24hr_change=true`;
    const headers = { "user-agent": UA };
    if (CG_KEY) headers["x-cg-pro-api-key"] = CG_KEY;
    const res = await fetch(url, { headers, signal });
    if (!res.ok) throw new Error(`CG price ${sym} ${res.status}`);
    const json = await res.json();
    const row = json[id];
    const px = row?.[vs];
    if (typeof px !== "number") throw new Error(`CG bad body for ${sym}`);
    const pct = typeof row?.[`${vs}_24h_change`] === "number" ? row[`${vs}_24h_change`] : null;
    const change = (pct != null) ? (px * (pct / 100)) : null;
    return {
      symbol: sym,
      name: id,
      price: px,
      change,
      changePercent: pct,
      currency: vs.toUpperCase(),
      source: "coingecko",
      asOf: new Date().toISOString(),
    };
  } finally {
    cleanup();
  }
}

// ---------------- Stooq multi-exchange probe ----------------
function mapIndexToStooq(sym) {
  const m = {
    "^GSPC": "^spx",      // S&P 500
    "^DJI":  "^dji",      // Dow 30
    "^IXIC": "^ndq",      // Nasdaq Composite
    "^FTSE": "^ukx",      // FTSE 100
    "^STOXX50E": "^sx5e", // Euro Stoxx 50
    "^GDAXI": "^dax",     // DAX
    "^FCHI": "^cac",      // CAC 40
    "^IBEX": "^ibex",     // IBEX 35
    "^FTSEMIB": "^ftmib", // FTSE MIB
    "^N225": "^nikkei",   // Nikkei 225
    "^HSI": "^hsi"        // Hang Seng
  };
  return m[sym] || null;
}

const STQ_SUFFIXES = ["", ".US", ".UK", ".DE", ".JP", ".PL", ".FR", ".CA", ".BR", ".HK"];

function parseStooqCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("stooq empty");
  const row = lines[1].split(",");
  const [Symbol, DateStr, TimeStr, Open, High, Low, Close, Volume] = row;
  return { Symbol, DateStr, TimeStr, Open, High, Low, Close, Volume };
}

async function stooqFetchOnce(sym) {
  const { signal, cleanup } = withTimeout();
  try {
    const url = `${STQ_BASE}${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`;
    const res = await fetch(url, { headers: { "cache-control": "no-cache", "user-agent": UA }, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const row = parseStooqCsv(text);
    const price = parseFloat(row.Close);
    if (!isFinite(price)) throw new Error("N/D");
    return row;
  } finally {
    cleanup();
  }
}

async function tryStooqSymbol(base) {
  if (_cache.stooqOk.has(base)) return _cache.stooqOk.get(base);
  if (_cache.stooqFail.has(base)) throw new Error("stooq known-bad");

  const idx = mapIndexToStooq(base);
  if (idx) {
    await stooqFetchOnce(idx);
    _cache.stooqOk.set(base, idx);
    return idx;
  }

  for (const suf of STQ_SUFFIXES) {
    const test = suf ? `${base}${suf}` : base;
    try {
      await stooqFetchOnce(test);
      _cache.stooqOk.set(base, test);
      return test;
    } catch {}
  }

  _cache.stooqFail.add(base);
  throw new Error("symbol not found on stooq");
}

async function fetchEquity(sym) {
  const stqSym = await tryStooqSymbol(sym);
  const row = await stooqFetchOnce(stqSym);
  const price = parseFloat(row.Close);
  const open = parseFloat(row.Open);
  const change = isFinite(open) ? (price - open) : null;
  const changePercent = isFinite(open) && open !== 0 ? ((price / open - 1) * 100) : null;
  return {
    symbol: sym,
    name: sym,
    price,
    change,
    changePercent,
    open: isFinite(open) ? open : null,
    high: parseFloat(row.High),
    low: parseFloat(row.Low),
    volume: parseFloat(row.Volume),
    currency: "USD",
    source: "stooq",
    asOf: row.DateStr + (row.TimeStr ? ` ${row.TimeStr}` : ""),
  };
}

// ---------------- HTTP handler ----------------
export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = searchParams.get("symbols") || "";
    const syms = raw.split(",").map(normalizeSymbol).filter(Boolean);

    if (!syms.length) {
      return new Response(JSON.stringify({ quotes: [], note: "Pass ?symbols=AAPL,MSFT,BTC-USD or BTC" }), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        status: 200,
      });
    }

    const tasks = syms.map(async (s) => {
      try {
        if (isCryptoSymbol(s)) return await fetchCrypto(s);
        return await fetchEquity(s);
      } catch (err) {
        return { symbol: s, error: String(err && err.message ? err.message : err) };
      }
    });

    const quotes = await Promise.all(tasks);

    return new Response(JSON.stringify({ quotes }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "s-maxage=30, stale-while-revalidate=60",
      },
      status: 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ quotes: [], error: String(err) }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 500,
    });
  }
}
