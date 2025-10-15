// api/football.js — v1.0 (Edge)
// Live-ish football fixtures for today from public ESPN endpoints (no key).
// Poll this every 60s from the client.

export const config = { runtime: "edge" };

const ESPN_LEAGUES = [
  "eng.1",       // Premier League
  "esp.1",       // LaLiga
  "ita.1",       // Serie A
  "ger.1",       // Bundesliga
  "fra.1",       // Ligue 1
  "uefa.champions", // Champions League
];

function todayRangeUTC() {
  const now = new Date();
  const d0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const d1 = new Date(d0.getTime() + 24 * 3600 * 1000);
  return { start: d0.toISOString(), end: d1.toISOString() };
}

function mapEvent(e) {
  const comp = e?.competitions?.[0];
  const status = comp?.status?.type?.name || "SCHEDULED";
  const ks = comp?.status?.type?.shortDetail || "";
  const startISO = e?.date || "";
  const home = comp?.competitors?.find((c) => c.homeAway === "home");
  const away = comp?.competitors?.find((c) => c.homeAway === "away");
  return {
    id: e?.id || "",
    league: e?.league?.name || e?.shortName || "",
    kickoff: startISO,
    status,            // SCHEDULED, IN, FINAL etc.
    statusText: ks,    // e.g. "90', 2nd Half" or "FT" or "20:00"
    home: { name: home?.team?.shortDisplayName || home?.team?.name || "", score: Number(home?.score || 0) },
    away: { name: away?.team?.shortDisplayName || away?.team?.name || "", score: Number(away?.score || 0) },
  };
}

async function fetchLeague(league) {
  const url = `https://site.api.espn.com/apis/v2/sports/soccer/${encodeURIComponent(league)}/scoreboard`;
  const r = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error(`${league} ${r.status}`);
  const j = await r.json();
  const events = j?.events || [];
  return events.map(mapEvent);
}

export default async function handler(req) {
  try {
    const tasks = ESPN_LEAGUES.map((lg) => fetchLeague(lg).catch(() => []));
    const all = (await Promise.all(tasks)).flat();

    // Sort: live first, then upcoming soonest
    const live = all.filter((m) => /IN|1st|2nd|HALFTIME|LIVE/i.test(m.statusText));
    const upcoming = all
      .filter((m) => !/IN|HALFTIME|LIVE|FT|FINAL/i.test(m.statusText))
      .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
    const finished = all.filter((m) => /FT|FINAL/i.test(m.statusText));

    const out = [...live, ...upcoming, ...finished].slice(0, 40);

    return new Response(JSON.stringify({ matches: out, ts: new Date().toISOString() }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ matches: [], error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
