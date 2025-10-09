// /api/ai-chat.js — v1.2 (adds optional web search)
export const config = { runtime: "edge" };

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY ||
  process.env.OPEN_API_KEY ||
  process.env.OPENAI_KEY;

const TAVILY_API_KEY = process.env.TAVILY_API_KEY; // optional

function toOpenAIMessages(history = [], latestText = "") {
  const msgs = [
    {
      role: "system",
      content:
        "You are a concise, helpful assistant inside a personal dashboard. Prefer short, accurate answers. Use one or two short paragraphs unless the user asks for more.",
    },
  ];
  for (const m of history) {
    if (!m || !m.role || !m.text) continue;
    msgs.push({ role: m.role === "ai" ? "assistant" : "user", content: m.text });
  }
  if (latestText) msgs.push({ role: "user", content: latestText });
  return msgs;
}

function needsWeb(q=""){
  const s = q.toLowerCase();
  if (/(^|\s)\/search\s+/.test(s)) return true;
  if (/\b(latest|today|this week|this month|breaking|news|update|price now|score|schedule)\b/.test(s)) return true;
  if (/\b20(2[3-9]|3\d)\b/.test(s)) return true; // explicit recent years
  return false;
}

async function webSearch(query){
  if (!TAVILY_API_KEY) return { ok:false, reason:"no-key", results:[] };
  const res = await fetch("https://api.tavily.com/search", {
    method:"POST",
    headers:{ "Content-Type":"application/json", "Authorization": `Bearer ${TAVILY_API_KEY}` },
    body: JSON.stringify({ query, max_results: 5 })
  });
  if (!res.ok) return { ok:false, reason:`http ${res.status}`, results:[] };
  const j = await res.json().catch(()=>null);
  const results = j?.results?.map(r=>({ title:r.title, url:r.url, snippet:r.content })).slice(0,5) || [];
  return { ok:true, results };
}

async function callOpenAI(messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, temperature: 0.3 })
  });
  if (!res.ok) {
    const detail = await res.text().catch(()=> "");
    return { status: 500, body: JSON.stringify({ message: "Chat failed.", detail }) };
  }
  const data = await res.json().catch(()=> null);
  const message = data?.choices?.[0]?.message?.content?.trim() || "I couldn't generate a reply just now.";
  return { status: 200, body: JSON.stringify({ message }) };
}

export default async function handler(req) {
  try {
    if (req.method === "POST") {
      const { q, messages: history } = await req.json();
      const userQ = (q || "").trim();

      // If web is needed, fetch results and summarize
      if (needsWeb(userQ) && OPENAI_API_KEY) {
        const query = userQ.replace(/^\/search\s+/i,'');
        const web = await webSearch(query);
        if (web.ok && web.results.length) {
          const context = web.results.map((r,i)=>`[${i+1}] ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
          const msgs = [
            { role:"system", content:"Summarize the findings briefly and cite by bracket number like [1], [2]. If asked for actions, provide quick bullet points." },
            { role:"user", content:`Question: ${query}\n\nSources:\n${context}` }
          ];
          const result = await callOpenAI(msgs);
          const body = JSON.parse(result.body);
          return new Response(JSON.stringify({ message: body.message }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (!web.ok && web.reason === "no-key") {
          // Explain clearly that live search is off
          const msgs = toOpenAIMessages(Array.isArray(history) ? history : [], `${userQ}\n\n(Note: Web search isn't enabled on this server.)`);
          const result = await callOpenAI(msgs);
          return new Response(result.body, { status: result.status, headers: { "Content-Type": "application/json" } });
        }
        // If web failed for another reason, continue with normal LLM
      }

      // Normal LLM flow
      const msgs = toOpenAIMessages(Array.isArray(history) ? history : [], userQ);
      const result = await callOpenAI(msgs);
      return new Response(result.body, { status: result.status, headers: { "Content-Type": "application/json" } });
    }

    // GET ping / single-shot
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";
    const msgs = toOpenAIMessages([], q);
    const result = await callOpenAI(msgs);
    return new Response(result.body, { status: result.status, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ message: "Chat crashed.", error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
