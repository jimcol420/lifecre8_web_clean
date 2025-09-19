// /api/quote.js — fetch live quotes from Yahoo Finance and return simplified JSON
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!symbols.length) {
    return new Response(JSON.stringify({ error: 'Missing symbols' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  const yahooURL = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`;

  try {
    const resp = await fetch(yahooURL, { headers: { 'user-agent': 'Mozilla/5.0 (LifeCre8 Markets)' } });
    if (!resp.ok) throw new Error(`Yahoo ${resp.status}`);
    const data = await resp.json();

    const quotes = (data?.quoteResponse?.result || []).map(q => ({
      symbol: q.symbol,
      price: q.regularMarketPrice ?? null,
      change: q.regularMarketChange ?? null,
      changePercent: q.regularMarketChangePercent ?? null,
      currency: q.currency || null,
      exchange: q.fullExchangeName || q.exchange || null
    }));

    return new Response(JSON.stringify({ quotes }), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 's-maxage=15, stale-while-revalidate=15'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 502, headers: { 'content-type': 'application/json' } });
  }
}
