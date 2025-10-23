import { json, error } from "../../_utils/respond";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { loadCefrDict, mapWordsToCefr, countCefrDistribution } from "@/lib/datasets";

export async function POST(req) {
	try {
		const body = await req.json();
		const text = typeof body?.text === "string" ? body.text : "";
		if (!text) return json({ distribution: { A1:0,A2:0,B1:0,B2:0,C1:0,C2:0,UNKNOWN:0 }, wordLevels: {} });

		const host = req.headers.get('host') || '';
		const proto = req.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
		const baseUrl = host ? `${proto}://${host}` : undefined;

		const cefrMap = await loadCefrDict(baseUrl);
		const wordLevels = mapWordsToCefr(text, cefrMap);
		const dist = countCefrDistribution(wordLevels);
		return json({ distribution: dist, wordLevels });
	} catch (e) {
		console.error("[/api/data/cefr] error:", e);
		return error(e?.message || "CEFR processing error", 500);
	}
}

