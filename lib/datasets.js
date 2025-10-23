import path from "node:path";
import fs from "node:fs/promises";

// Simple in-memory caches
let cefrCache = null; // Map<headword(lowercase), level string>
let idiomsCache = null; // Array<string>

function resolveAtParents(...segments) {
  // Resolve file under the Next app, but allow reading from parent repo root.
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, ...segments),
    path.join(cwd, "..", ...segments),
    path.join(cwd, "..", "..", ...segments)
  ];
  return candidates;
}

async function readFirstExisting(paths, baseUrlOverride) {
  for (const p of paths) {
    try {
      const data = await fs.readFile(p, "utf8");
      return { path: p, data };
    } catch (_) {
      // try next
    }
  }
  // If filesystem lookup fails (e.g., Vercel serverless), try fetching from public URLs
  const baseUrl = baseUrlOverride || (() => {
    if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
    if (process.env.SITE_URL) return process.env.SITE_URL;
    return "http://localhost:3000";
  })();
  const publicCandidates = [];
  for (const p of paths) {
    // Convert local absolute path candidates into plausible public paths under /model_js or /
    const filename = path.basename(p);
    publicCandidates.push(`/model_js/${filename}`);
    publicCandidates.push(`/data/${filename}`);
    publicCandidates.push(`/${filename}`);
  }
  for (const rel of publicCandidates) {
    try {
      const url = new URL(rel, baseUrl).toString();
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.text();
        return { path: url, data };
      }
    } catch (_) {
      // try next
    }
  }
  throw new Error(`File not found in any path or public URL:\nPaths tried:\n${paths.join("\n")}\nPublic tried (base ${baseUrl}):\n${publicCandidates.join("\n")}`);
}

function parseCSV(text) {
  // Auto-detect delimiter between comma, semicolon, or tab.
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [], hasHeader: false };
  const sample = lines[0];
  const counts = [
    { delim: ",", count: (sample.match(/,/g) || []).length },
    { delim: ";", count: (sample.match(/;/g) || []).length },
    { delim: "\t", count: (sample.match(/\t/g) || []).length }
  ];
  counts.sort((a, b) => b.count - a.count);
  const delim = counts[0].count > 0 ? counts[0].delim : ",";
  const splitLine = (line) => line.split(delim).map((v) => v.replace(/^\s*"|"\s*$/g, "").trim());

  let headers = splitLine(lines[0]);
  let dataLines = lines.slice(1);
  // Detect header presence: look for known header names or non-alpha tokens
  const headerStr = headers.join("|").toLowerCase();
  const looksLikeHeader = /headword|word|cefr|level/.test(headerStr);
  if (!looksLikeHeader) {
    // Treat the first line as data instead of headers
    dataLines = lines;
    headers = [];
  }
  const rows = dataLines.map(splitLine);
  return { headers, rows, hasHeader: looksLikeHeader };
}

export async function loadCefrDict(baseUrl) {
  if (cefrCache) return cefrCache;
  // Prefer a copy inside the app if provided, fall back to repo root
  const { data } = await readFirstExisting(
    resolveAtParents("public", "data", "English_CEFR_Words.csv")
      .concat(resolveAtParents("public", "model_js", "English_CEFR_Words.csv"))
      .concat(resolveAtParents("English_CEFR_Words.csv"))
  , baseUrl);
  const { headers, rows, hasHeader } = parseCSV(data);
  // Determine columns
  let headIdx = -1, levelIdx = -1;
  if (hasHeader) {
    headIdx = headers.findIndex((h) => /headword|word/i.test(h));
    levelIdx = headers.findIndex((h) => /cefr|level/i.test(h));
  }
  // If no header or not found, assume first two columns are [word, level]
  if (headIdx === -1 || levelIdx === -1) {
    headIdx = 0;
    levelIdx = 1;
  }
  const map = new Map();
  for (const row of rows) {
    if (!row || row.length === 0) continue;
    const w = (row[headIdx] || "").toString().trim().toLowerCase();
    let lvl = (row[levelIdx] || "UNKNOWN").toString().trim().toUpperCase();
    // Normalize level strings like 'a1 ' -> 'A1', allow values like 'A1', 'B2', etc.
    if (!/^A[12]$|^B[12]$|^C[12]$/.test(lvl)) {
      // If something like 'A1,' or 'A1;extra' appears, extract A?/B?/C? digit
      const m = lvl.match(/[ABC][12]/i);
      if (m) lvl = m[0].toUpperCase(); else lvl = "UNKNOWN";
    }
    if (w) map.set(w, lvl);
  }
  cefrCache = map;
  return map;
}

export async function loadIdiomsList(baseUrl) {
  if (idiomsCache) return idiomsCache;
  const { data } = await readFirstExisting(
    resolveAtParents("public", "data", "idioms_english.csv")
      .concat(resolveAtParents("public", "model_js", "idioms_english.csv"))
      .concat(resolveAtParents("idioms_english.csv"))
  , baseUrl);
  const { headers, rows } = parseCSV(data);
  // Try detect column named 'idiom' else take first column
  let idiomIdx = headers.findIndex((h) => /idiom/i.test(h));
  if (idiomIdx === -1) idiomIdx = 0;
  const list = [];
  for (const row of rows) {
    const v = (row[idiomIdx] || "").trim();
    if (v) list.push(v.toLowerCase());
  }
  idiomsCache = list;
  return list;
}

export function tokenizeAlpha(text) {
  // Split into lowercase alphabetic tokens, allow apostrophes inside words (e.g., don't -> dont)
  const raw = (text.toLowerCase().match(/[a-z']+/g) || []);
  return raw.map((t) => t.replace(/'+/g, "")).filter(Boolean);
}

export function mapWordsToCefr(text, cefrMap) {
  const tokens = tokenizeAlpha(text);
  const wordLevels = {};
  for (const w of tokens) {
    const lvl = cefrMap.get(w) || "UNKNOWN";
    wordLevels[w] = lvl;
  }
  return wordLevels;
}

export function countCefrDistribution(wordLevels) {
  const levels = ["A1", "A2", "B1", "B2", "C1", "C2", "UNKNOWN"];
  const dist = Object.values(wordLevels).reduce((acc, lvl) => {
    acc[lvl] = (acc[lvl] || 0) + 1;
    return acc;
  }, {});
  const ordered = {};
  for (const l of levels) ordered[l] = dist[l] || 0;
  return ordered;
}

export function findIdioms(text, idioms) {
  const t = text.toLowerCase();
  const found = [];
  for (const idiom of idioms) {
    if (!idiom) continue;
    const pattern = new RegExp(`\\b${idiom.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(t)) found.push(idiom);
  }
  return found;
}
