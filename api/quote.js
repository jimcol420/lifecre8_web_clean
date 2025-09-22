// api/quote.js  — v1.10.2
export default async function handler(req, res) {
  // Allow your web app to call this from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const symbolsParam = (req.query.symbols || '').toString();
    const symbols = symbolsParam
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);

    if (!symbols.length) {
      return res.status(400).json({ error: 'symbols query required' });
    }

    // Simple split: crypto “XYZ-USD” vs everything else as stock/etf
    const isCrypto = s => /-USD$/.test(s);
    const stockSyms  = symbols.filter(s => !isCrypto(s));
    const cryptoSyms = symbols.filter(isCrypto);

    // --- STOCKS via Yahoo Finance (no key) ---
    let stockResults = [];
    if (stockSyms.length) {
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(stockSyms.join(','))}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Yahoo quote failed: ${r.status}`);
      const json = await r.json();
      stockResults = (json?.quoteResponse?.result || []).map(q => ({
        symbol: (q.symbol || '').toUpperCase(),
        price: typeof q.regularMarketPrice === 'number' ? q.regularMarketPrice : null,
        ts: q.regularMarketTime ? q.regularMarketTime * 1000 : Date.now(),
        source: 'yahoo'
      }));
    }

    // --- CRYPTO via CoinGecko simple/price (no key) ---
    // map “BTC-USD” -> “bitcoin”, “ETH-USD” -> “ethereum”
    const cgMap = {
      'BTC-USD': 'bitcoin',
      'ETH-USD': 'ethereum',
      'SOL-USD': 'solana',
      'ADA-USD': 'cardano',
      'XRP-USD': 'ripple',
      'DOGE-USD': 'dogecoin',
      'MATIC-USD': 'matic-network',
      'DOT-USD': 'polkadot'
    };
    const ids = cryptoSyms.map(s => cgMap[s]).filter(Boolean);
    let cryptoResults = [];
    if (ids.length) {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd`;
      const r = await fetch(url, { headers: { 'Accept': 'application/json' }});
      if (!r.ok) throw new Error(`CoinGecko failed: ${r.status}`);
      const json = await r.json();
      cryptoResults = cryptoSyms.map(sym => ({
        symbol: sym,
        price: json[cgMap[sym]]?.usd ?? null,
        ts: Date.now(),
        source: 'coingecko'
      }));
    }

    // Merge, preserve request order
    const bySymbol = Object.fromEntries(
      [...stockResults, ...cryptoResults].map(x => [x.symbol, x])
    );
    const ordered = symbols.map(s => bySymbol[s] || { symbol: s, price: null, ts: Date.now(), source: 'none' });

    res.status(200).json({ ok: true, data: ordered });
  } catch (err) {
    console.error('quote error:', err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
