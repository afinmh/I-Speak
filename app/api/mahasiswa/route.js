import { NextRequest } from "next/server";
import { json, error } from "../_utils/respond";
import { getServiceClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function boolFromGender(input) {
  // Accept "L"/"P", "laki-laki"/"perempuan", true/false
  if (typeof input === "boolean") return input;
  const s = String(input || "").trim().toLowerCase();
  if (["l", "laki", "laki-laki", "male", "m"].includes(s)) return true;
  if (["p", "perempuan", "female", "f"].includes(s)) return false;
  return undefined;
}

export async function POST(req /** @type {NextRequest} */) {
  try {
    const body = await req.json();
    const { nama, program_studi, umur, jenis_kelamin, kota } = body || {};
    if (!nama || !program_studi || typeof umur !== "number" || umur <= 0 || !kota) {
      return error("Field wajib: nama, program_studi, umur(number>0), jenis_kelamin, kota", 400);
    }
    const jk = boolFromGender(jenis_kelamin);
    if (typeof jk !== "boolean") return error("jenis_kelamin harus boolean atau 'laki-laki'/'perempuan'", 400);

    const supa = getServiceClient();
    const { data, error: dberr } = await supa
      .from("mahasiswa")
      .insert([{ nama, program_studi, umur, jenis_kelamin: jk, kota }])
      .select("*")
      .single();
    if (dberr) return error(dberr.message, 500);
    return json({ ok: true, mahasiswa: data }, 201);
  } catch (e) {
    return error(e?.message || "Insert mahasiswa gagal", 500);
  }
}

export async function GET(req /** @type {NextRequest} */) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const nama = searchParams.get("nama");
  try {
    const supa = getServiceClient();
    let query = supa.from("mahasiswa").select("*");
    if (id) query = query.eq("id", Number(id)).single();
    else if (nama) query = query.ilike("nama", nama);
    const { data, error: dberr } = await query;
    if (dberr) return error(dberr.message, 500);
    return json({ ok: true, mahasiswa: data });
  } catch (e) {
    return error(e?.message || "Query mahasiswa gagal", 500);
  }
}
