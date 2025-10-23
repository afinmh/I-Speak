import { json, error } from "../../_utils/respond";
import { getServiceClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req, { params }) {
  try {
    const id = Number(params?.id);
    if (!id) return error("Invalid rekaman id", 400);
    const body = await req.json().catch(() => ({}));
    const transkrip = (body?.transkrip || body?.transcript || "").trim();
    if (!transkrip) return error("Body.wajib: transkrip", 400);

    const supa = getServiceClient();
    const { data, error: dberr } = await supa
      .from("rekaman_mahasiswa")
      .update({ transkrip })
      .eq("id", id)
      .select("*")
      .single();
    if (dberr) return error(dberr.message, 500);
    return json({ ok: true, rekaman: data });
  } catch (e) {
    return error(e?.message || "Failed to update transcript", 500);
  }
}
