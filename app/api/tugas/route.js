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

export async function PATCH(req /** @type {NextRequest} */) {
  try {
    const body = await req.json();
    const { id, judul, kategori, teks, prep_time, record_time } = body;
    
    if (!id) return error("ID tugas diperlukan", 400);

    const supa = getServiceClient();
    const updates = {};
    if (judul !== undefined) updates.judul = judul;
    if (kategori !== undefined) updates.kategori = kategori;
    if (teks !== undefined) updates.teks = teks;
    if (prep_time !== undefined) updates.prep_time = Number(prep_time);
    if (record_time !== undefined) updates.record_time = Number(record_time);

    const { data, error: dberr } = await supa
      .from("tugas")
      .update(updates)
      .eq("id", Number(id))
      .select()
      .single();

    if (dberr) return error(dberr.message, 500);
    return json({ ok: true, tugas: data });
  } catch (e) {
    return error(e?.message || "Gagal mengupdate tugas", 500);
  }
}
