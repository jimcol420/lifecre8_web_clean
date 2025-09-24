export const config = {
  runtime: "edge",
};

const STQ_BASE = "https://stooq.com/q/l/?s="; // e.g. AAPL.US, MSFT.US
const CG_BASE  = "https://api.coingecko.com/api/v3/simple/price";

function normalizeSymbol(sym) {
  const s = String(sym || "").trim().toUpperCase();
  // Treat hyphen/underscore as separators (BTC-USD, btc_usd)
  return s.replace(/[_\s]+/g, "-");
}

async function fetchEquity(sym) {
  // Stooq expects .US suffix for US stocks (AAPL -> AAPL.US)
  const stqSym = `${sym}.US`;
  const url = `${STQ_BASE}${encodeURIComponent(stqSym)}&f=sd2t2ohlcv&h&e=csv`;
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`Stooq ${sym} ${res.status}`);
  const text = await res.text();
  // CSV header: Symbol,Date,Time,Open,High,Low,Close,Volume
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error(`Stooq ${sym} empty`);
  const row = lines[1].split(",");
  const [Symbol, DateStr, TimeStr, Open, High, Low, Close, Volume] = row;
  const price = parseFloat(Close);
  if (!isFinite(price)) throw new Error(`Stooq ${sym} bad price`);
  return {
    symbol: sym,
    name: sym,
    price,
    open: parseFloat(Open),
    high: parseFloat(High),
    low: parseFloat(Low),
    volume: parseFloat(Volume),
    currency: "USD",
    source: "stooq",
    asOf: DateStr + (TimeStr ? ` ${TimeStr}` : ""),
  };
}

function mapCoinGeckoId(sym) {
  // Very small map; extend as needed
  const m = {
    "BTC-USD": "bitcoin",
    "ETH-USD": "ethereum",
    "SOL-USD": "solana",
    "DOGE-USD": "dogecoin",
  };
  return m[sym] || null;
}

async function fetchCrypto(sym) {
  const id = mapCoinGeckoId(sym);
  if (!id) throw new Error(`CoinGecko id missing for ${sym}`);
  const url = `${CG_BASE}?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`CG ${sym} ${res.status}`);
  const json = await res.json();
  const row = json[id];
  if (!row || typeof row.usd !== "number") throw new Error(`CG ${sym} bad body`);
  return {
    symbol: sym,
    name: id,
    price: row.usd,
    changePct24h: typeof row.usd_24h_change === "number" ? row.usd_24h_change : null,
    currency: "USD",
    source: "coingecko",
    asOf: new Date().toISOString(),
  };
}

function isCryptoSymbol(sym) {
  return /-USD$/i.test(sym) && /^[A-Z]{2,10}-USD$/.test(sym);
}

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

    const tasks = syms.map(async (s) => {
      try {
        if (isCryptoSymbol(s)) {
          return await fetchCrypto(s);
        }
        return await fetchEquity(s);
      } catch (err) {
        return { symbol: s, error: String(err && err.message ? err.message : err) };
      }
    });

    const items = await Promise.all(tasks);

    return new Response(JSON.stringify({ items }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        // allow short CDN caching to smooth bursts; client uses 2s polling anyway
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
