/* =========================================================
   LifeCre8 — api/quote.js  v2.0
   - Key-free quotes:
     • Stocks: Stooq CSV
     • Crypto: CoinGecko simple price
   - Always returns 200 with as many symbols as it could resolve.
   - Output: { quotes: [{ symbol, price, change, changePct, source }] }
   ========================================================= */

export default async function handler(req, res) {
  try {
    const raw = (req.query.symbols || "").toString().trim();
    const symbols = raw
      .split(",")
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 20); // be nice

    if (!symbols.length) return ok(res, { quotes: [] });

    const stockSyms  = symbols.filter(s => !s.includes("-USD"));
    const cryptoSyms = symbols.filter(s => s.includes("-USD"));

    const [stocks, crypto] = await Promise.allSettled([
      fetchStocks(stockSyms),
      fetchCrypto(cryptoSyms)
    ]);

    const quotes = [
      ...(stocks.status === "fulfilled" ? stocks.value : []),
      ...(crypto.status === "fulfilled" ? crypto.value : [])
    ];

    return ok(res, { quotes });
  } catch (e) {
    console.error("[/api/quote] FATAL:", e?.message || e);
    // Keep UI smooth even on failure.
    return ok(res, { quotes: [] });
  }
}

function ok(res, body) {
  res.setHeader("Cache-Control", "no-store, s-maxage=15, stale-while-revalidate=60");
  res.status(200).json(body);
}

/* --------------------- Stocks (Stooq CSV) --------------------- */
// Docs-ish: https://stooq.com/q/l/?s=aapl,msft&f=sd2t2ohlc&h&e=csv
async function fetchStocks(symbols) {
  if (!symbols.length) return [];
  const query = symbols.map(s => s.toLowerCase()).join(",");
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(query)}&f=sd2t2ohlc&h&e=csv`;

  const r = await fetch(url, { headers: { "User-Agent": "lifecre8/1.0" } });
  const csv = await r.text();

  // Parse CSV quickly (very small)
  const lines = csv.trim().split(/\r?\n/);
  // Header: Symbol,Date,Time,Open,High,Low,Close
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const [sym, , , open, , , close] = cols;
    const o = toNum(open);
    const c = toNum(close);
    if (!sym || !Number.isFinite(c)) continue;

    const change = Number.isFinite(o) ? (c - o) : null;
    const changePct = Number.isFinite(o) && o !== 0 ? (change / o) * 100 : null;

    out.push({
      symbol: sym.toUpperCase(),
      price: round2(c),
      change: change === null ? null : round2(change),
      changePct: changePct === null ? null : round2(changePct),
      source: "stooq"
    });
  }
  // maintain the order of requested symbols
  return symbols.map(s => out.find(q => q.symbol === s) || { symbol: s, price: null, change: null, changePct: null, source: "stooq" });
}

function splitCsvLine(line) {
  // minimal CSV splitter (no embedded quotes expected from Stooq for these fields)
  return line.split(",").map(s => s.trim());
}

/* --------------------- Crypto (CoinGecko) --------------------- */
const CG_MAP = {
  "BTC-USD": "bitcoin",
  "ETH-USD": "ethereum",
  "SOL-USD": "solana",
  "DOGE-USD": "dogecoin",
  "ADA-USD": "cardano",
  "XRP-USD": "ripple",
  "LTC-USD": "litecoin",
  "BNB-USD": "binancecoin",
  "AVAX-USD": "avalanche-2",
  "MATIC-USD": "matic-network"
};

async function fetchCrypto(symbols) {
  if (!symbols.length) return [];
  const ids = symbols.map(s => CG_MAP[s]).filter(Boolean);
  if (!ids.length) {
    // Unknown tickers return nulls
    return symbols.map(s => ({ symbol: s, price: null, change: null, changePct: null, source: "coingecko" }));
  }

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd`;
  const r = await fetch(url, { headers: { "User-Agent": "lifecre8/1.0", "Accept": "application/json" } });
  const data = await r.json();

  const out = symbols.map(s => {
    const id = CG_MAP[s];
    const price = id && data?.[id]?.usd;
    return {
      symbol: s,
      price: Number.isFinite(price) ? round2(price) : null,
      change: null,
      changePct: null,
      source: "coingecko"
    };
  });
  return out;
}

/* --------------------- helpers --------------------- */
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const round2 = (n) => Math.round(n * 100) / 100;
