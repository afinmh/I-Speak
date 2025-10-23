import { json, error } from "../../_utils/respond";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { loadIdiomsList, findIdioms } from "@/lib/datasets";

export async function POST(req) {
	try {
		const body = await req.json();
		const text = typeof body?.text === "string" ? body.text : "";
		if (!text) return json({ count: 0, idioms: [] });

		const host = req.headers.get('host') || '';
		const proto = req.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
		const baseUrl = host ? `${proto}://${host}` : undefined;

		const idioms = await loadIdiomsList(baseUrl);
		const found = findIdioms(text, idioms);
		return json({ count: found.length, idioms: found });
	} catch (e) {
		console.error("[/api/data/idioms] error:", e);
		return error(e?.message || "Idioms processing error", 500);
	}
}

