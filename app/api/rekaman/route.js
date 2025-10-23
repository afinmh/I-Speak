import { NextRequest } from "next/server";
import { json, error } from "../_utils/respond";
import { getServiceClient, getBucketName } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req /** @type {NextRequest} */) {
  try {
    const form = await req.formData();
    const mahasiswa_id = Number(form.get("mahasiswa_id"));
    const tugas_id = Number(form.get("tugas_id"));
    const file = form.get("file");
    const transkrip = (form.get("transkrip") || "").toString();
    if (!mahasiswa_id || !tugas_id || !file) return error("Form fields: mahasiswa_id, tugas_id, file wajib", 400);

    const supa = getServiceClient();
    const bucket = getBucketName();
    const ts = Date.now();
    const filename = `mhs_${mahasiswa_id}/tugas_${tugas_id}/${ts}_${file.name || "audio.webm"}`;
    // Upload
    const { error: uerr } = await supa.storage
      .from(bucket)
      .upload(filename, file, { contentType: file.type || "audio/webm" });
    if (uerr && uerr.message && !uerr.message.includes("The resource already exists")) {
      return error(uerr.message, 500);
    }

    const { data: pub } = supa.storage.from(bucket).getPublicUrl(filename);
    const audio_url = pub?.publicUrl || `${bucket}/${filename}`;

    // Insert rekaman
    const { data, error: derr } = await supa
      .from("rekaman_mahasiswa")
      .insert([{ mahasiswa_id, tugas_id, audio_url, transkrip: transkrip || null }])
      .select("*")
      .single();
    if (derr) return error(derr.message, 500);
    return json({ ok: true, rekaman: data });
  } catch (e) {
    return error(e?.message || "Upload rekaman gagal", 500);
  }
}
