export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { event, data } = body || {};
    const time = new Date().toISOString();
    // Print to server terminal
    // Using console.log so it always appears in most environments
    console.log(`[debug:${time}]`, event || "(no-event)", data || {});
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  } catch (e) {
    console.error("/api/debug error", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
}
