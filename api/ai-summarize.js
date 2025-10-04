// /api/ai-summarize.js
// Summarize a web page (via ?url=...) or raw text (?text=...)
// Env: OPENAI_API_KEY

const MODEL = 'gpt-4o-mini';

// Simple HTML -> text
function stripHtml(html = '') {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|h\d|li|br|section|article)>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Clamp length for token safety
function clampText(t, max = 15000) {
  if (!t) return '';
  return t.length <= max ? t : t.slice(0, max) + '\n…';
}

module.exports = async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || process.env.OPEN_AI_KEY || process.env.OPEN_API_KEY;
    if (!apiKey) return res.status(200).json({ message: "No API key configured on server.", diag: { hasKey: false }});

    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const url = urlObj.searchParams.get('url');
    const textParam = urlObj.searchParams.get('text');
    const titleHint = urlObj.searchParams.get('title') || '';
    let sourceText = '';

    if (textParam) {
      sourceText = textParam;
    } else if (url) {
      // Fetch raw page
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (LifeCre8 Summarizer; +https://example.com)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      if (!r.ok) return res.status(502).json({ error: 'fetch_failed', status: r.status });
      const html = await r.text();
      sourceText = stripHtml(html);
    } else {
      return res.status(400).json({ error: 'missing url or text' });
    }

    sourceText = clampText(sourceText, 16000);
    const sys = `
You are a crisp, objective summarizer.
Return a concise, skimmable summary with:
- 5–8 bullet key points
- A one-line TL;DR
- 2–4 suggested next actions (links if relevant)
Keep it neutral, avoid fluff, keep each bullet to one line.
If content seems thin or paywalled, say so briefly.
`.trim();

    const user = `
TITLE: ${titleHint || (url || 'Untitled')}
${url ? `URL: ${url}` : ''}

CONTENT:
${sourceText}
`.trim();

    const r2 = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user }
        ]
      })
    });

    if (!r2.ok) {
      const details = await r2.text();
      return res.status(500).json({ error: 'openai_error', details });
    }

    const data = await r2.json();
    const summary = (data?.choices?.[0]?.message?.content || '').trim();
    return res.status(200).json({ summary });
  } catch (err) {
    return res.status(500).json({ error: 'server_error', details: String(err) });
  }
};
