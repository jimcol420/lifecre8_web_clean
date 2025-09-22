// api/quote.js
// LifeCre8 v1.10.1 — Robust quote API with graceful fallbacks
//
// - Equities via Yahoo Finance (server-side; no API key needed)
// - Crypto via CoinGecko (server-side; no API key needed)
// - If upstream fails, returns a simulated "random-walk" tick so UI never breaks.

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');

  try {
    const raw = (req.query.symbols || '').toString();
    const symbols = raw
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);

    if (!symbols.length) {
      return res.status(200).json({ quotes: [] });
    }

    // Split into "equities" (e.g., AAPL, MSFT) and "crypto" (e.g., BTC-USD)
    const isCrypto = s => /-USD$/.test(s);
    const eq = symbols.filter(s => !isCrypto(s));
    const cr = symbols.filter(isCrypto);

    // --- Helpers
    const fetchJSON = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`);
      return r.json();
    };

    // --- 1) Equities via Yahoo Finance (v7 quote)
    // Works fine from a serverless function; no API key needed
    const equities = [];
    if (eq.length) {
      const yURL = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(eq.join(','))}`;
      try {
        const data = await fetchJSON(yURL);
        const items = data?.quoteResponse?.result || [];
        for (const it of items) {
          const sym = (it.symbol || '').toUpperCase();
          const price = Number(it.regularMarketPrice ?? it.postMarketPrice ?? it.bid ?? it.ask);
          const prev  = Number(it.regularMarketPreviousClose ?? it.previousClose ?? price);
          equities.push({
            symbol: sym,
            price,
            change: price - prev,
            changePct: prev ? ((price - prev) / prev) * 100 : 0
          });
        }
      } catch (err) {
        // If Yahoo fails, fall back to simulation for each equity
        for (const s of eq) equities.push(simulatedQuote(s));
      }
    }

    // --- 2) Crypto via CoinGecko
    const crypto = [];
    if (cr.length) {
      // Map "BTC-USD" -> "bitcoin", "ETH-USD" -> "ethereum"
      const idMap = {
        'BTC-USD': 'bitcoin',
        'ETH-USD': 'ethereum',
        'SOL-USD': 'solana',
        'ADA-USD': 'cardano',
        'DOGE-USD': 'dogecoin'
      };
      const needed = cr.map(s => idMap[s]).filter(Boolean);
      if (needed.length) {
        const cgURL = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(needed.join(','))}&vs_currencies=usd&include_24hr_change=true`;
        try {
          const data = await fetchJSON(cgURL);
          for (const [sym, id] of Object.entries(idMap)) {
            if (!cr.includes(sym)) continue;
            const row = data[id];
            if (row && typeof row.usd === 'number') {
              const price = Number(row.usd);
              const pct = Number(row.usd_24h_change || 0);
              const prev = price / (1 + pct / 100);
              crypto.push({
                symbol: sym,
                price,
                change: price - prev,
                changePct: pct
              });
            } else {
              crypto.push(simulatedQuote(sym));
            }
          }
        } catch {
          for (const s of cr) crypto.push(simulatedQuote(s));
        }
      } else {
        // Unknown crypto symbol → simulate
        for (const s of cr) crypto.push(simulatedQuote(s));
      }
    }

    const quotes = [...equities, ...crypto];

    return res.status(200).json({ quotes });
  } catch (err) {
    console.error('quote error:', err);
    // Final global fallback: simulate everything requested
    const raw = (req.query.symbols || '').toString();
    const symbols = raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const quotes = symbols.map(simulatedQuote);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ quotes, note: 'fallback' });
  }
}

function simulatedQuote(symbol) {
  const base = seed(symbol);
  const price = step(base);
  const prev = base;
  const delta = price - prev;
  const pct = prev ? (delta / prev) * 100 : 0;
  return { symbol, price: round2(price), change: round2(delta), changePct: round2(pct) };
}

// small deterministic-ish seed from symbol
function seed(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const isCrypto = /-USD$/.test(s);
  if (isCrypto) {
    if (s.startsWith('BTC')) return 65000 + (h % 5000);
    if (s.startsWith('ETH')) return 3200 + (h % 400);
    return 100 + (h % 2000);
  }
  return 80 + (h % 220);
}
function step(p) {
  const drift = (Math.random() - 0.5) * (p * 0.005);
  return Math.max(0.01, p + drift);
}
function round2(n) { return Math.round(n * 100) / 100; }
