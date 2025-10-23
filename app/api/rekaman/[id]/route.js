import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabaseServer";

export async function PATCH(req, { params }) {
  try {
    const { id } = params || {};
    const body = await req.json().catch(() => ({}));
    const transkrip = typeof body?.transkrip === 'string' ? body.transkrip : null;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    if (transkrip === null) return NextResponse.json({ error: "Missing transkrip" }, { status: 400 });
  const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('rekaman_mahasiswa')
      .update({ transkrip })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ rekaman: data });
  } catch (e) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
