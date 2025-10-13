export const config = { runtime: "edge" };

// ------------------------ Constants ------------------------
const STQ_BASE = "https://stooq.com/q/l/?s="; // AAPL -> AAPL.US
const CG_SIMPLE_PRICE = "https://api.coingecko.com/api/v3/simple/price";
const CG_COIN_LIST = "https://api.coingecko.com/api/v3/coins/list?include_platform=false";

// Cache (in-memory for Edge runtime instance)
let COIN_LIST_CACHE = { at: 0, map: null }; // { symbolUpper -> [id,id2,...] }

// Manual overrides for common/exact symbols that are ambiguous or recently renamed
const OVERRIDE_SYMBOL_TO_ID = {
  "BTC": "bitcoin",
  "ETH": "ethereum",
  "SOL": "solana",
  "DOGE": "dogecoin",
  "USDT": "tether",
  "USDC": "usd-coin",
  "BNB": "binancecoin",
  "XRP": "ripple",
  "ADA": "cardano",
  // Polygon rebrand: POL is "polygon-ecosystem-token" (formerly MATIC)
  "MATIC": "matic-network",
  "POL": "polygon-ecosystem-token",
};

// ------------------------ Helpers ------------------------
function normalizeSymbol(sym) {
  return String(sym || "").trim().toUpperCase().replace(/[_\s]+/g, "-");
}
function isCryptoSymbol(sym) {
  return /-USD$/i.test(sym) && /^[A-Z0-9]{2,15}-USD$/.test(sym);
}
function baseFromPair(sym) {
  // "ETH-USD" -> "ETH"
  return sym.replace(/-USD$/i, "");
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

// ------------------------ Equities (Stooq) ------------------------
async function fetchEquity(sym) {
  const stqSym = `${sym}.US`;
  const url = `${STQ_BASE}${encodeURIComponent(stqSym)}&f=sd2t2ohlcv&h&e=csv`;
  const text = await fetchText(url);

  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error(`Stooq ${sym} empty`);
  const row = lines[1].split(",");
  const [Symbol, DateStr, TimeStr, Open, High, Low, Close, Volume] = row;

  const price = parseFloat(Close);
  if (!isFinite(price)) throw new Error(`Stooq ${sym} bad price`);

  const open = parseFloat(Open);
  const change = isFinite(open) ? price - open : null;
  const changePercent = isFinite(open) && open !== 0 ? (change / open) * 100 : null;

  return {
    symbol: sym,
    name: sym,
    price,
    open: isFinite(open) ? open : null,
    high: isFinite(parseFloat(High)) ? parseFloat(High) : null,
    low: isFinite(parseFloat(Low)) ? parseFloat(Low) : null,
    volume: isFinite(parseFloat(Volume)) ? parseFloat(Volume) : null,
    change,
    changePercent,
    currency: "USD",
    source: "stooq",
    asOf: DateStr + (TimeStr ? ` ${TimeStr}` : ""),
  };
}

// ------------------------ Crypto (CoinGecko) ------------------------
async function loadCoinListMap() {
  const now = Date.now();
  // refresh every 24h
  if (COIN_LIST_CACHE.map && now - COIN_LIST_CACHE.at < 24 * 60 * 60 * 1000) {
    return COIN_LIST_CACHE.map;
  }
  const res = await fetch(CG_COIN_LIST, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`CG list ${res.status}`);
  const list = await res.json();
  // Build a map: SYMBOL_UPPER -> [id,id2,...]
  const map = new Map();
  for (const c of list || []) {
    const sym = (c?.symbol || "").toUpperCase();
    if (!sym || !c?.id) continue;
    if (!map.has(sym)) map.set(sym, []);
    map.get(sym).push(c.id);
  }
  COIN_LIST_CACHE = { at: now, map };
  return map;
}

function pickBestId(symbolUpper, candidates) {
  // If we have a manual override, always prefer it.
  const override = OVERRIDE_SYMBOL_TO_ID[symbolUpper];
  if (override && candidates.includes(override)) return override;
  if (override && candidates.length) return override;

  // Otherwise, a simple heuristic: prefer the shortest id (typically canonical).
  return candidates.sort((a, b) => a.length - b.length)[0] || null;
}

async function resolveCryptoIds(symbols /* like ["ETH-USD","POL-USD"] */) {
  const map = await loadCoinListMap();
  const out = new Map(); // "ETH-USD" -> "ethereum"
  for (const pair of symbols) {
    const base = baseFromPair(pair);     // "ETH"
    const upper = base.toUpperCase();    // "ETH"

    // Manual override first
    if (OVERRIDE_SYMBOL_TO_ID[upper]) {
      out.set(pair, OVERRIDE_SYMBOL_TO_ID[upper]);
      continue;
    }
    // From list
    const cands = map.get(upper) || [];
    const picked = pickBestId(upper, cands);
    if (picked) out.set(pair, picked);
  }
  return out; // Map(pair -> id)
}

async function fetchCryptoBatch(pairs /* ["ETH-USD","POL-USD"] */) {
  // Resolve to CoinGecko ids
  const idMap = await resolveCryptoIds(pairs);
  const idList = [...new Set([...idMap.values()])];
  if (!idList.length) {
    // nothing resolved
    return pairs.map((p) => ({ symbol: p, error: "No CoinGecko id found" }));
  }

  const url =
    `${CG_SIMPLE_PRICE}?ids=${encodeURIComponent(idList.join(","))}` +
    `&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) {
    const errTxt = await res.text().catch(() => "");
    return pairs.map((p) => ({ symbol: p, error: `CG ${res.status} ${errTxt}` }));
  }
  const json = await res.json();

  // Build results per requested pair
  const items = pairs.map((pair) => {
    const id = idMap.get(pair);
    const row = id ? json[id] : null;
    if (!row || typeof row.usd !== "number") {
      return { symbol: pair, error: `No data for ${pair}` };
    }
    const pct = typeof row.usd_24h_change === "number" ? row.usd_24h_change : null;
    return {
      symbol: pair,
      name: id,
      price: row.usd,
      // For UI: put percent into both changePercent and (if delta missing) change
      changePercent: pct,
      changePct24h: pct,
      currency: "USD",
      source: "coingecko",
      asOf: new Date().toISOString(),
    };
  });

  return items;
}

// ------------------------ Handler ------------------------
export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = searchParams.get("symbols") || "";
    const syms = raw.split(",").map(normalizeSymbol).filter(Boolean);

    if (!syms.length) {
      return new Response(JSON.stringify({ items: [], note: "Pass ?symbols=AAPL,MSFT,BTC-USD" }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
        status: 200,
      });
    }

    const equities = syms.filter((s) => !isCryptoSymbol(s));
    const cryptoPairs = syms.filter((s) => isCryptoSymbol(s));

    // Run in parallel: equities (per-symbol) + crypto (batched)
    const eqTasks = equities.map(async (s) => {
      try { return await fetchEquity(s); }
      catch (err) { return { symbol: s, error: String(err && err.message ? err.message : err) }; }
    });

    const cryptoTask = (async () => {
      if (!cryptoPairs.length) return [];
      try { return await fetchCryptoBatch(cryptoPairs); }
      catch (err) {
        return cryptoPairs.map((s) => ({ symbol: s, error: String(err && err.message ? err.message : err) }));
      }
    })();

    const [eqItems, crItems] = await Promise.all([
      Promise.all(eqTasks),
      cryptoTask,
    ]);

    const items = [...eqItems, ...crItems];

    return new Response(JSON.stringify({ items }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        // small CDN cache to smooth bursts
        "cache-control": "s-maxage=30, stale-while-revalidate=60",
      },
      status: 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 500,
    });
  }
}
