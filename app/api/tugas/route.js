import { NextRequest } from "next/server";
import { json, error } from "../_utils/respond";
import { getServiceClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req /** @type {NextRequest} */) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const judul = searchParams.get("judul");
    const index = searchParams.get("index"); // 1-based index like 1..6

    const supa = getServiceClient();
    let q = supa.from("tugas").select("*").order("id", { ascending: true });
    if (id) q = q.eq("id", Number(id)).single();
    else if (judul) q = q.eq("judul", judul).single();
    else if (index) {
      const { data, error: err } = await q;
      if (err) return error(err.message, 500);
      const idx = Math.max(1, Number(index));
      const item = Array.isArray(data) ? data[idx - 1] : undefined;
      if (!item) return error("Tugas tidak ditemukan", 404);
      return json({ ok: true, tugas: item });
    }
    const { data, error: dberr } = await q;
    if (dberr) return error(dberr.message, 500);
    return json({ ok: true, tugas: data });
  } catch (e) {
    return error(e?.message || "Gagal mengambil tugas", 500);
  }
}
