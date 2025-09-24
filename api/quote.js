/* =========================================================
   LifeCre8 — api/quote.js  v1.10.2
   Purpose: Return current prices for symbols (e.g., AAPL, MSFT, BTC-USD)
   - Tries Yahoo Finance first for everything
   - For crypto (BTC-USD, ETH-USD) also tries CoinGecko
   - Never 502s: returns a safe fallback if all sources fail
   - Verbose logs in Vercel “Logs” to diagnose upstream issues
   ========================================================= */

export default async function handler(req, res) {
  const startedAt = Date.now();
  try {
    const raw = (req.query.symbols || "").toString();
    const symbols = raw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    console.log("[/api/quote] symbols:", symbols);

    if (!symbols.length) {
      return ok(res, { results: [], errors: ["No symbols provided"] });
    }

    // 1) Try Yahoo for all symbols in one request
    const yahoo = await getFromYahoo(symbols);

    // 2) For common crypto, fill gaps via CoinGecko if Yahoo missed them
    const missing = symbols.filter((s) => yahoo[s] == null);
    let gecko = {};
    if (missing.some((s) => isCryptoSym(s))) {
      gecko = await getFromCoinGecko(missing.filter(isCryptoSym));
    }

    // 3) Combine and add safe fallbacks for anything still missing
    const results = {};
    const errors = [];
    for (const sym of symbols) {
      if (yahoo[sym] != null) {
        results[sym] = yahoo[sym];
      } else if (gecko[sym] != null) {
        results[sym] = gecko[sym];
      } else {
        // Safe fallback so UI never breaks
        const fallback = mockPrice(sym);
        results[sym] = fallback.value;
        errors.push(`Fallback used for ${sym}: ${fallback.note}`);
      }
    }

    const ms = Date.now() - startedAt;
    console.log(`[/api/quote] done in ${ms}ms results=`, results, "errors=", errors);

    return ok(res, { results, errors });
  } catch (err) {
    // Absolute safety: even if something unexpected happens, we still return 200
    console.error("[/api/quote] UNCAUGHT:", err?.message || err);
    return ok(res, {
      results: {},
      errors: ["Uncaught error in /api/quote: " + (err?.message || String(err))]
    });
  }
}

/* ------------------ Yahoo Finance ------------------ */

async function getFromYahoo(symbols) {
  // Yahoo endpoint (no key needed, but can be temp flaky / rate-limited)
  const url =
    "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" +
    encodeURIComponent(symbols.join(","));

  try {
    console.log("[Yahoo] GET", url);
    const r = await fetch(url, { headers: { "User-Agent": "lifecre8/1.0" } });
    const text = await r.text();

    if (!r.ok) {
      console.error("[Yahoo] HTTP", r.status, "BODY:", text.slice(0, 200));
      return {};
    }

    // Yahoo sometimes returns invalid JSON if blocked by edge. Guard parse.
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.error("[Yahoo] JSON parse error:", e?.message, "BODY:", text.slice(0, 200));
      return {};
    }

    const out = {};
    const arr = json?.quoteResponse?.result || [];
    for (const row of arr) {
      const sym = (row?.symbol || "").toUpperCase();
      const price =
        row?.regularMarketPrice ??
        row?.postMarketPrice ??
        row?.preMarketPrice ??
        null;
      if (sym && isFinite(price)) {
        out[sym] = Number(price);
      }
    }
    console.log("[Yahoo] parsed:", out);
    return out;
  } catch (err) {
    console.error("[Yahoo] EXCEPTION:", err?.message || err);
    return {};
  }
}

/* ------------------ CoinGecko (crypto) ------------------ */

const GECKO_MAP = {
  "BTC-USD": "bitcoin",
  "ETH-USD": "ethereum"
};

function isCryptoSym(sym) {
  return GECKO_MAP[sym] != null;
}

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

/* ------------------ Helpers ------------------ */

function ok(res, body) {
  // cache a tiny bit on the edge (Vercel) but not in the browser
  res.setHeader("Cache-Control", "no-store, s-maxage=10, stale-while-revalidate=30");
  res.status(200).json(body);
}

function mockPrice(sym) {
  // Gentle, believable fallback value
  let base = 100;
  if (/BTC/.test(sym)) base = 65000;
  else if (/ETH/.test(sym)) base = 3200;

  const jitter = base * 0.0025 * (Math.random() - 0.5) * 2; // ±0.25%
  return {
    value: Number((base + jitter).toFixed(2)),
    note: "Upstream failed; using safe fallback"
  };
}
