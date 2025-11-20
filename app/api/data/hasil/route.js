import path from "node:path";
import fs from "node:fs/promises";
import { NextResponse } from "next/server";

async function readFirstExisting(paths) {
  for (const p of paths) {
    try {
      const data = await fs.readFile(p, "utf8");
      return { path: p, data };
    } catch (_) {
      // try next
    }
  }
  return null;
}

export async function GET() {
  try {
    const cwd = process.cwd();
    const candidates = [
      path.join(cwd, "public", "hasil.json"),
      path.join(cwd, "..", "hasil.json"),
      path.join(cwd, "..", "..", "hasil.json")
    ];
    const found = await readFirstExisting(candidates);
    if (!found) {
      return NextResponse.json({ items: [], message: "hasil.json not found" }, { status: 200 });
    }
    const arr = JSON.parse(found.data);
    if (!Array.isArray(arr)) {
      return NextResponse.json({ items: [], message: "Invalid hasil.json format" }, { status: 200 });
    }
    return NextResponse.json({ items: arr }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ items: [], message: e?.message || String(e) }, { status: 200 });
  }
}
