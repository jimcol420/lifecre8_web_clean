// api/ai-search.js
// LifeCre8 — Assistant quick answer endpoint (no tiles)
// Returns a short, formatted message. No external keys needed.

export default async function handler(req, res) {
  try {
    const q = (req.query.q || req.body?.q || "").toString().trim();
    if (!q) return res.status(200).json({ message: "Ask me something specific and I’ll help." });

    // Tiny intent hints for nicer replies
    const low = q.toLowerCase();

    // If the user asked for “how to / recipe / guide”, nudge with a clear tip.
    if (/\b(recipe|how to|guide|tutorial|steps?)\b/.test(low)) {
      return res.status(200).json({
        message: `Here are good starting points:\n• Use the Add Tile box with your full request (e.g. “${q}”).\n• I’ll create a web search tile you can open or embed.\n• If you prefer videos, type “YouTube ${q}”.`
      });
    }

    // Travel: confirm Maps tile is the right choice
    if (/\b(retreat|spa|resort|hotel|air\s*bnb|airbnb|villa|wellness|yoga|stay|bnb|guesthouse|inn|aparthotel|holiday|holidays|near me)\b/.test(low)) {
      return res.status(200).json({
        message: `Travel query detected. Add Tile will create a Maps tile for “${q}” with quick links to Google Maps, Booking, and Tripadvisor.`
      });
    }

    // Default: short acknowledgement with tip
    return res.status(200).json({
      message: `Got it — try Add Tile with “${q}”. I’ll create the most useful single tile (Maps, Web, YouTube, Gallery, or News) depending on your request.`
    });
  } catch (e) {
    return res.status(200).json({ message: "Live search temporarily unavailable." });
  }
}
