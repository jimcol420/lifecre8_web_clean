/* =========================================================
   LifeCre8 — api/quote.js  v1.11
   Stocks via Stooq (no key) + Crypto via CoinGecko (no key)
   - Never throws 502; always returns 200 with results/errors
   - Verbose logs for easy debugging in Vercel Logs
   ========================================================= */

export default async function handler(req, res) {
  const t0 = Date.now();
  try {
    const raw = (req.query.symbols || "").toString();
    const symbols = raw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    console.log("[/api/quote] symbols:", symbols);
    if (!symbols.length) return ok(res, { results: {}, errors: ["No symbols provided"] });

    const { equities, cryptos } = splitSymbols(symbols);

    // 1) Equities from Stooq
    const stooqMap = equities.length ? await getFromStooq(equities) : {};

    // 2) Crypto from CoinGecko
    const geckoMap = cryptos.length ? await getFromCoinGecko(cryptos) : {};

    // 3) Merge + fallbacks
    const results = {};
    const errors = [];

    for (const s of symbols) {
      const v = stooqMap[s] ?? geckoMap[s];
      if (isFinite(v)) {
        results[s] = Number(v);
      } else {
        const fb = mockPrice(s);
        results[s] = fb.value;
        errors.push(`Fallback used for ${s}: ${fb.note}`);
      }
    }

    const ms = Date.now() - t0;
    console.log(`[/api/quote] done in ${ms}ms results=`, results, "errors=", errors);
    return ok(res, { results, errors });
  } catch (err) {
    console.error("[/api/quote] UNCAUGHT:", err?.message || err);
    return ok(res, { results: {}, errors: ["Uncaught error: " + (err?.message || String(err))] });
  }
}

/* ------------------ Routing helpers ------------------ */

function splitSymbols(all) {
  const equities = [];
  const cryptos = [];
  for (const s of all) {
    if (/-USD$/.test(s)) cryptos.push(s);
    else equities.push(s);
  }
  return { equities, cryptos };
}

/* ------------------ Stooq (equities) ------------------ */
/*
  API: https://stooq.com/q/l/?s=aapl.us,msft.us&f=sd2t2ohlcv&h&e=csv
  - We’ll map ticker -> ticker.us (US listing) by default.
  - Returns CSV; we read Close as the price.
*/
async function getFromStooq(symbols) {
  try {
    // Convert to Stooq format: aapl -> aapl.us, vod -> vod.uk, etc.
    // For now assume US: ticker.us (works for AAPL, MSFT, etc.)
    const stooqSyms = symbols
      .map((s) => `${s.toLowerCase()}.us`)
      .join(",");

    const url =
      "https://stooq.com/q/l/?s=" +
      encodeURIComponent(stooqSyms) +
      "&f=sd2t2ohlcv&h&e=csv";

    console.log("[Stooq] GET", url);
    const r = await fetch(url, { headers: { "User-Agent": "lifecre8/1.0" } });
    const text = await r.text();

    if (!r.ok) {
      console.error("[Stooq] HTTP", r.status, "BODY:", text.slice(0, 200));
      return {};
    }

    // Parse CSV (very small): Symbol,Date,Time,Open,High,Low,Close,Volume
    const lines = text.trim().split(/\r?\n/);
    const out = {};
    // Skip header if present
    const start = lines[0].toLowerCase().startsWith("symbol,") ? 1 : 0;

    for (let i = start; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const symbolStooq = (cols[0] || "").toUpperCase(); // e.g., AAPL.US
      const close = Number(cols[6]); // Close column

      // Map back to original (strip .US)
      const base = symbolStooq.replace(/\.US$/, "");
      // Only set if it was requested
      const wanted = symbols.find((s) => s.toUpperCase() === base);
      if (wanted && isFinite(close)) {
        out[wanted] = close;
      }
    }

    console.log("[Stooq] parsed:", out);
    return out;
  } catch (err) {
    console.error("[Stooq] EXCEPTION:", err?.message || err);
    return {};
  }
}

/* ------------------ CoinGecko (crypto) ------------------ */

const GECKO_MAP = {
  "BTC-USD": "bitcoin",
  "ETH-USD": "ethereum"
  // add more mappings here if you need them later
};

async function getFromCoinGecko(cryptoSymbols) {
  const ids = cryptoSymbols
    .map((s) => GECKO_MAP[s])
    .filter(Boolean);

  if (!ids.length) return {};

  const url =
    "https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=" +
    encodeURIComponent(ids.join(","));

  try {
    console.log("[CoinGecko] GET", url);
    const r = await fetch(url, { headers: { "User-Agent": "lifecre8/1.0" } });
    const text = await r.text();

    if (!r.ok) {
      console.error("[CoinGecko] HTTP", r.status, "BODY:", text.slice(0, 200));
      return {};
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.error("[CoinGecko] JSON parse error:", e?.message, "BODY:", text.slice(0, 200));
      return {};
    }

    const out = {};
    for (const sym of cryptoSymbols) {
      const id = GECKO_MAP[sym];
      const v = json?.[id]?.usd;
      if (isFinite(v)) out[sym] = Number(v);
    }
    console.log("[CoinGecko] parsed:", out);
    return out;
  } catch (err) {
    console.error("[CoinGecko] EXCEPTION:", err?.message || err);
    return {};
  }
}

/* ------------------ Response & Fallback ------------------ */

function ok(res, body) {
  res.setHeader("Cache-Control", "no-store, s-maxage=15, stale-while-revalidate=60");
  res.status(200).json(body);
}

function mockPrice(sym) {
  let base = 100;
  if (/BTC/.test(sym)) base = 65000;
  else if (/ETH/.test(sym)) base = 3200;

  const jitter = base * 0.0025 * (Math.random() - 0.5) * 2; // ±0.25%
  return {
    value: Number((base + jitter).toFixed(2)),
    note: "Upstream unavailable; using safe fallback"
  };
}
