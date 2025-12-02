"use client";

import { useCallback, useState } from "react";
import { NUMERICAL_FEATURES_ORDER } from "@/lib/featureMapping";
import * as Meyda from "meyda";
import { transcribeWhisperWebFromFile } from "@/lib/whisperWebClient";
import { interpretOutput } from "@/lib/interpretation";
import nlp from "compromise";

// Lazy import to avoid SSR issues for embeddings
let embedderPromise = null;
async function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      try { console.debug("[useAssessment] embedder: loading transformers pipeline"); } catch (_) {}
      const { pipeline, env } = await import("@xenova/transformers");
      env.allowLocalModels = false;
      const p = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
      try { console.debug("[useAssessment] embedder: ready"); } catch (_) {}
      return p;
    })();
  }
  return embedderPromise;
}

async function decodeFileToAudioBuffer(file) {
  const arrayBuf = await file.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return await audioCtx.decodeAudioData(arrayBuf);
}

function getMonoPCM(buffer) {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels <= 1) {
    return new Float32Array(buffer.getChannelData(0));
  }
  const out = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) out[i] += data[i] / numberOfChannels;
  }
  return out;
}

function rms(arr) {
  let sumSq = 0;
  for (let i = 0; i < arr.length; i++) sumSq += arr[i] * arr[i];
  return Math.sqrt(sumSq / arr.length);
}

function slidingEnergyFeatures(channelData, sampleRate, frameSize = 2048, hop = 1024) {
  const energies = [];
  for (let i = 0; i + frameSize <= channelData.length; i += hop) {
    const frame = channelData.subarray(i, i + frameSize);
    const e = rms(frame);
    energies.push(e);
  }
  const mean = energies.reduce((a, b) => a + b, 0) / (energies.length || 1);
  const stdev = Math.sqrt(
    energies.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (energies.length || 1)
  );
  return { energies, mean, stdev };
}

// Convert linear energies to dB scale similar to librosa (amplitude -> dB)
function energiesToDb(energies) {
  const out = new Array(energies.length);
  const eps = 1e-12;
  for (let i = 0; i < energies.length; i++) {
    out[i] = 20 * Math.log10((energies[i] || 0) + eps);
  }
  return out;
}

// Detect prosodic prominences as peaks in RMS energy above a dynamic threshold
function computeProminences(energies, sampleRate, hop, k = 0.5) {
  if (!Array.isArray(energies) || energies.length < 3) {
    return { numPeaks: 0, distMean: 0, distStd: 0 };
  }
  const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
  const stdev = Math.sqrt(energies.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / energies.length);
  const thr = mean + k * stdev;
  const peaks = [];
  for (let i = 1; i < energies.length - 1; i++) {
    const prev = energies[i - 1], cur = energies[i], next = energies[i + 1];
    if (cur > prev && cur >= next && cur >= thr) {
      peaks.push(i);
    }
  }
  // compute distances (seconds) between consecutive peaks
  const frameDur = hop / (sampleRate || 1);
  const dists = [];
  for (let i = 1; i < peaks.length; i++) {
    dists.push((peaks[i] - peaks[i - 1]) * frameDur);
  }
  const numPeaks = peaks.length;
  const distMean = dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : 0;
  const distStd = dists.length
    ? Math.sqrt(dists.reduce((acc, v) => acc + Math.pow(v - distMean, 2), 0) / dists.length)
    : 0;
  return { numPeaks, distMean, distStd };
}

function estimatePauseFrequency(energies, sampleRate, hop, threshold = 0.01) {
  let pauses = 0;
  // Deprecated: counts frames. Use computePauseCount instead.
  for (const e of energies) if (e < threshold) pauses++;
  return pauses;
}
function computePauseCount(energies, sampleRate, hop, threshold = 0.01, minPauseMs = 300) {
  const frameDur = hop / (sampleRate || 1); // seconds
  const minFrames = Math.max(1, Math.floor((minPauseMs / 1000) / frameDur));
  let count = 0;
  let run = 0;
  for (let i = 0; i < energies.length; i++) {
    if (energies[i] < threshold) {
      run++;
    } else {
      if (run >= minFrames) count++;
      run = 0;
    }
  }
  if (run >= minFrames) count++;
  return count;
}

// Librosa-like long pause counter using top_db=30 and min pause of 0.5s by default
function computeLibrosaPauseCount(energies, sampleRate, hop, topDb = 30, minPauseSec = 0.5) {
  if (!energies || energies.length === 0) return 0;
  const db = energiesToDb(energies);
  const maxDb = Math.max(...db);
  const thr = maxDb - Math.abs(topDb);
  const frameDur = hop / (sampleRate || 1);
  // Non-silent mask
  const mask = db.map((v) => v >= thr);
  // Build contiguous non-silent intervals
  const intervals = [];
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      intervals.push([start, i]);
      start = -1;
    }
  }
  if (start !== -1) intervals.push([start, mask.length]);
  if (intervals.length < 2) return 0;
  let pauses = 0;
  for (let i = 1; i < intervals.length; i++) {
    const prevEnd = intervals[i - 1][1] * frameDur;
    const curStart = intervals[i][0] * frameDur;
    const gap = Math.max(0, curStart - prevEnd);
    if (gap > minPauseSec) pauses++;
  }
  return pauses;
}

// Build speech segments (start,end in seconds) by splitting on pauses >= minPauseMs
function computeSpeechSegmentsFromEnergy(energies, sampleRate, hop, threshold = 0.01, minPauseMs = 300, minSegmentMs = 200) {
  const frameDur = hop / (sampleRate || 1); // seconds
  const minPauseFrames = Math.max(1, Math.floor((minPauseMs / 1000) / frameDur));
  const minSegFrames = Math.max(1, Math.floor((minSegmentMs / 1000) / frameDur));
  let segments = [];
  let segStartFrame = null; // frame index where voiced segment starts
  let silenceRun = 0;
  const N = energies.length;
  for (let i = 0; i < N; i++) {
    const voiced = energies[i] >= threshold;
    if (voiced) {
      if (segStartFrame === null) segStartFrame = i; // start a new segment
      silenceRun = 0;
    } else {
      // silent frame
      silenceRun++;
      if (segStartFrame !== null && silenceRun >= minPauseFrames) {
        // close current segment just before the silence run
        const segEndFrame = i - silenceRun + 1; // first silent frame index acts as boundary
        if (segEndFrame - segStartFrame >= minSegFrames) {
          segments.push([segStartFrame * frameDur, (segEndFrame * frameDur)]);
        }
        segStartFrame = null;
        silenceRun = 0;
      }
    }
  }
  // close trailing segment if audio ended while speaking
  if (segStartFrame !== null) {
    const lastFrame = N - 1;
    if (lastFrame - segStartFrame + 1 >= minSegFrames) {
      segments.push([segStartFrame * frameDur, ((lastFrame + 1) * frameDur)]);
    }
  }
  return segments;
}

function extractVoicedPCM(pcm, sampleRate, frameSize = 1024, hop = 512, threshold = 0.01, padFrames = 2, minFrames = 10) {
  if (!pcm || pcm.length === 0) return pcm;
  const frames = [];
  for (let i = 0; i + frameSize <= pcm.length; i += hop) {
    const frame = pcm.subarray(i, i + frameSize);
    frames.push({ i, voiced: rms(frame) >= threshold });
  }
  const segments = [];
  let start = -1;
  for (let idx = 0; idx < frames.length; idx++) {
    if (frames[idx].voiced && start === -1) start = idx;
    const endOfRun = (!frames[idx].voiced && start !== -1) || (idx === frames.length - 1 && start !== -1);
    if (endOfRun) {
      const endIdx = frames[idx].voiced ? idx : idx - 1;
      if (endIdx - start + 1 >= minFrames) {
        const s = Math.max(0, (start - padFrames) * hop);
        const e = Math.min(pcm.length, (endIdx * hop) + frameSize + padFrames * hop);
        segments.push({ s, e });
      }
      start = -1;
    }
  }
  if (segments.length === 0) return pcm;
  const totalLen = segments.reduce((acc, seg) => acc + (seg.e - seg.s), 0);
  const out = new Float32Array(totalLen);
  let offset = 0;
  for (const seg of segments) {
    out.set(pcm.subarray(seg.s, seg.e), offset);
    offset += (seg.e - seg.s);
  }
  return out;
}

function tokenize(text) {
  return (text.toLowerCase().match(/\b[a-z']+\b/g) || []);
}

function countLinkingDiscourseFilled(text) {
  const linking_words = new Set([
    "and", "but", "or", "so", "yet", "for", "nor",
    "because", "since", "as", "due to", "as a result", "therefore", "thus", "hence", "consequently",
    "although", "though", "even though", "whereas", "while", "however", "nevertheless", "nonetheless",
    "on the other hand", "in contrast", "alternatively", "instead",
    "in addition", "furthermore", "moreover", "also", "besides", "not only that", "as well as",
    "indeed", "in fact", "especially", "significantly", "particularly", "above all", "notably",
    "for example", "for instance", "such as", "like", "including", "to illustrate",
    "then", "after that", "before that", "meanwhile", "subsequently", "eventually",
    "at the same time", "finally", "firstly", "secondly", "thirdly", "next", "lastly", "ultimately"
  ]);
  const discourse_markers = [
    "you know", "i mean", "like", "well", "actually", "basically", "anyway",
    "to be honest", "frankly", "seriously", "believe me", "i suppose", "i guess",
    "first of all", "secondly", "finally", "to begin with", "in conclusion",
    "on the one hand", "on the other hand", "next", "then", "after that",
    "eventually", "at the same time", "meanwhile", "in the meantime",
    "in fact", "as a matter of fact", "indeed", "certainly", "definitely"
  ];
  const filled_pauses = [
    "um", "uh", "er", "ah", "eh", "hmm", "mm", "umm", "uhh", "ehm",
    "uh-huh", "mm-hmm", "mhm", "huh", "ugh", "tsk"
  ];

  const tokens = tokenize(text);
  const joined = tokens.join(" ");
  const cleaned = (text || "").toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

  const linking_found = new Set(tokens.filter((w) => linking_words.has(w)));
  // robust multi-word detection with word-boundary regex allowing flexible spaces
  const phraseToRegex = (p) => new RegExp("\\b" + p.split(" ").filter(Boolean).join("\\s+") + "\\b", "i");
  const discourse_found = discourse_markers.filter((m) => phraseToRegex(m).test(cleaned));
  const filled_found = filled_pauses.filter((f) => new RegExp(`\\b${f}\\b`, "i").test(joined));

  return {
    linking_count: linking_found.size,
    discourse_count: discourse_found.length,
    filled_count: filled_found.length
  };
}

async function embedSentences(sentences) {
  const embedder = await getEmbedder();
  const vectors = [];
  for (const s of sentences) {
    const out = await embedder(s, { pooling: "mean", normalize: true });
    vectors.push(out.data);
  }
  return vectors;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function computeSemanticCoherence(text) {
  const sents = text.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 12);
  if (sents.length < 2) return 0;
  const vecs = await embedSentences(sents);
  let sum = 0, count = 0;
  for (let i = 0; i < vecs.length - 1; i++) {
    sum += cosine(vecs[i], vecs[i + 1]);
    count++;
  }
  return (sum / count) * 100;
}

// Heuristic grammar error counter: enhanced with more rules
function computeGrammarErrors(text) {
  if (!text || typeof text !== "string") return 0;
  let errors = 0;
  const sents = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  
  // sentence capitalization & end punctuation
  for (const s of sents) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    const firstWord = (trimmed.match(/^[A-Za-z']+/) || [""])[0];
    // Ignore proper nouns/acronyms for capitalization check
    if (/^[a-z]/.test(firstWord) && !/^[A-Z]{2,}$/.test(firstWord)) errors++;
    if (!/[.!?]$/.test(trimmed)) errors++; // missing end punctuation
  }
  
  const tokens = tokenize(text);
  const words = tokens;
  
  // repeated adjacent words
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === tokens[i - 1]) errors++;
  }
  
  // double or more spaces
  const multiSpaceMatches = text.match(/ {2,}/g);
  if (multiSpaceMatches) errors += multiSpaceMatches.length;
  
  // a/an mismatch (rough heuristic, ignore some exceptions)
  const vowels = new Set(["a","e","i","o","u"]);
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i], next = words[i + 1] || "";
    const firstChar = next[0] || "";
    if (w === "a" && vowels.has(firstChar)) {
      // exceptions like 'a university', 'a unicorn' (yoo sound)
      if (!/^uni|^euro|^u[bcdfghjklmnpqrstvwxyz]/.test(next)) errors++;
    }
    if (w === "an" && !vowels.has(firstChar)) {
      // exception like 'an hour'
      if (!/^hour/.test(next)) errors++;
    }
  }
  
  // Enhanced subject-verb agreement checks
  const singularSubjects = new Set(["he", "she", "it"]);
  const pluralSubjects = new Set(["they", "we"]);
  const bareVerbs = new Set(["go","make","do","say","eat","play","run","walk","need","want","have","take","get","see","know","think","come","give","use","find","tell","ask","work","seem","feel","try","leave","call","write","read","bring","begin","keep","hold","hear","meet","show","help","talk","turn","follow","start","live","believe","watch","learn","change","lead","understand","happen","develop","speak","spend","teach","require","lose","become","reach"]);
  const singularVerbs = new Set(["goes","makes","does","says","eats","plays","runs","walks","needs","wants","has","takes","gets","sees","knows","thinks","comes","gives","uses","finds","tells","asks","works","seems","feels","tries","leaves","calls","writes","reads","brings","begins","keeps","holds","hears","meets","shows","helps","talks","turns","follows","starts","lives","believes","watches","learns","changes","leads","understands","happens","develops","speaks","spends","teaches","requires","loses","becomes","reaches"]);
  
  for (let i = 0; i < words.length - 1; i++) {
    const subj = words[i], verb = words[i + 1];
    // Singular subject + bare verb (should be singular verb)
    if (singularSubjects.has(subj) && bareVerbs.has(verb)) errors++;
    // Plural subject + singular verb (should be bare verb)
    if (pluralSubjects.has(subj) && singularVerbs.has(verb)) errors++;
    // "I" with singular verb
    if (subj === "i" && singularVerbs.has(verb) && verb !== "was") errors++;
  }
  
  // Common word confusions
  const confusionPairs = {
    "your": ["you're", /\byour\s+(is|are|was|were|have|has)\b/i],
    "their": ["they're", /\btheir\s+(is|are|was|were|have|has)\b/i],
    "its": ["it's", /\bits\s+(is|are|was|were|have|has)\b/i],
  };
  for (const [word, [correct, pattern]] of Object.entries(confusionPairs)) {
    if (pattern.test(text)) errors++;
  }
  
  // Missing articles before singular countable nouns
  const articles = new Set(["a", "an", "the"]);
  const prepositions = new Set(["in","on","at","to","for","with","from","by","about","of"]);
  const commonNouns = new Set(["book","car","house","dog","cat","person","thing","way","time","day","year","place","problem","question","student","teacher","university","course","computer","phone","idea","experience","opportunity","challenge"]);
  
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1];
    const curr = words[i];
    // Check if noun appears after preposition without article
    if (prepositions.has(prev) && commonNouns.has(curr)) {
      // Check if there's no article in previous 2 positions
      const hasPrevArticle = i >= 2 && articles.has(words[i - 2]);
      if (!hasPrevArticle) errors++;
    }
  }
  
  // Double negatives
  const negatives = new Set(["no", "not", "never", "nothing", "nobody", "none", "neither", "nowhere", "hardly", "scarcely", "barely"]);
  for (let i = 0; i < words.length - 3; i++) {
    const window = words.slice(i, i + 4);
    const negCount = window.filter(w => negatives.has(w)).length;
    if (negCount >= 2) errors++;
  }
  
  // Wrong verb forms after modal verbs
  const modals = new Set(["will", "would", "can", "could", "should", "must", "may", "might"]);
  for (let i = 0; i < words.length - 1; i++) {
    const modal = words[i];
    const next = words[i + 1];
    if (modals.has(modal)) {
      // Next word should be bare infinitive, not -ing or -ed form
      if (/ing$/.test(next) || (/ed$/.test(next) && !bareVerbs.has(next))) errors++;
    }
  }
  
  // Incomplete comparatives (more/less without adjective)
  for (let i = 0; i < words.length - 1; i++) {
    if ((words[i] === "more" || words[i] === "less") && 
        (words[i + 1] === "than" || words[i + 1] === "then")) {
      errors++;
    }
  }
  
  // "Than" vs "then" confusion in comparisons
  const comparatives = new Set(["better", "worse", "more", "less", "greater", "smaller", "bigger", "faster", "slower"]);
  for (let i = 0; i < words.length - 1; i++) {
    if (comparatives.has(words[i]) && words[i + 1] === "then") errors++;
  }
  
  // Cap the total to avoid over-penalizing long texts
  const cap = Math.max(5, Math.round(tokens.length * 0.15));
  return Math.min(errors, cap);
}

// Synonym variation proxy: unique lemma count of content words via compromise
function computeSynonymVariations(text) {
  try {
    const doc = nlp(text || "");
    const nouns = doc.nouns().out("normal");
    const verbs = doc.verbs().out("normal");
    const adjs = doc.adjectives().out("normal");
    const advs = doc.adverbs().out("normal");
    const content = [...nouns, ...verbs, ...adjs, ...advs].filter(Boolean);
    return new Set(content).size;
  } catch {
    // fallback: type count as proxy
    return new Set(tokenize(text || "")).size;
  }
}

// Tree depth proxy: sentence length stats (avg/max words per sentence)
function computeTreeDepthProxy(text) {
  const sents = (text || "").split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  if (sents.length === 0) return { avg: 0, max: 0 };
  const lengths = sents.map((s) => (s.match(/\b[a-z']+\b/gi) || []).length);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const max = Math.max(...lengths);
  return { avg, max };
}

function estimatePitchACF(frame, sampleRate, fmin = 75, fmax = 500) {
  const n = frame.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += frame[i];
  mean /= n || 1;
  const win = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    win[i] = (frame[i] - mean) * w;
  }
  const kmin = Math.max(1, Math.floor(sampleRate / (fmax || 500)));
  const kmax = Math.min(n - 1, Math.floor(sampleRate / (fmin || 75)));
  let bestLag = -1;
  let bestVal = -Infinity;
  for (let k = kmin; k <= kmax; k++) {
    let sum = 0;
    for (let i = 0; i < n - k; i++) sum += win[i] * win[i + k];
    if (sum > bestVal) {
      bestVal = sum;
      bestLag = k;
    }
  }
  let r0 = 0;
  for (let i = 0; i < n; i++) r0 += win[i] * win[i];
  const norm = r0 > 0 ? bestVal / r0 : 0;
  if (bestLag <= 0 || norm < 0.3) return null;
  return sampleRate / bestLag;
}

function computeMeydaFeatures(channelData, sampleRate, frameSize = 2048, hop = 1024) {
  const mfccMagnitudes = [];
  const pitches = [];
  for (let i = 0; i + frameSize <= channelData.length; i += hop) {
    const frame = channelData.subarray(i, i + frameSize);
    const mfcc = Meyda.extract("mfcc", frame, { sampleRate, bufferSize: frameSize, numberOfMFCCCoefficients: 13 });
    if (mfcc && mfcc.length) {
      const mag = mfcc.reduce((a, v) => a + Math.abs(v), 0) / mfcc.length;
      mfccMagnitudes.push(mag);
    } else {
      mfccMagnitudes.push(0);
    }
    const p = estimatePitchACF(frame, sampleRate);
    if (p && isFinite(p)) pitches.push(p);
  }
  const mfccMean = mfccMagnitudes.reduce((a, b) => a + b, 0) / (mfccMagnitudes.length || 1);
  const mfccMax = Math.max(1e-6, ...mfccMagnitudes);
  const mfccPct = Math.max(0, Math.min(100, (mfccMean / mfccMax) * 100));

  let pitchMean = 0, pitchStd = 0, pitchRange = 0;
  if (pitches.length > 0) {
    pitchMean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
    const varp = pitches.reduce((acc, v) => acc + Math.pow(v - pitchMean, 2), 0) / pitches.length;
    pitchStd = Math.sqrt(varp);
    pitchRange = Math.max(...pitches) - Math.min(...pitches);
  }
  return { mfccPct, pitchMean, pitchStd, pitchRange };
}

// Compute MFCC frame matrix: rows = frames, cols = K coefficients
function computeMFCCMatrix(channelData, sampleRate, frameSize = 2048, hop = 1024, K = 13, maxDurationSec = null) {
  const rows = [];
  const maxSamples = maxDurationSec ? Math.max(0, Math.floor(maxDurationSec * (sampleRate || 1))) : channelData.length;
  for (let i = 0; i + frameSize <= Math.min(channelData.length, maxSamples); i += hop) {
    const frame = channelData.subarray(i, i + frameSize);
    const mfcc = Meyda.extract("mfcc", frame, { sampleRate, bufferSize: frameSize, numberOfMFCCCoefficients: K });
    if (mfcc && mfcc.length === K) rows.push(mfcc.slice());
  }
  return rows;
}

// Standardize each coefficient column to mean 0, std 1
function standardizeColumns(matrix) {
  if (!matrix || matrix.length === 0) return [];
  const rows = matrix.length, cols = matrix[0].length;
  const means = new Array(cols).fill(0);
  const stds = new Array(cols).fill(0);
  for (let c = 0; c < cols; c++) {
    let sum = 0;
    for (let r = 0; r < rows; r++) sum += matrix[r][c];
    means[c] = sum / rows;
    let varSum = 0;
    for (let r = 0; r < rows; r++) varSum += Math.pow(matrix[r][c] - means[c], 2);
    stds[c] = Math.sqrt(varSum / rows) || 1;
  }
  const out = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const row = new Array(cols);
    for (let c = 0; c < cols; c++) row[c] = (matrix[r][c] - means[c]) / stds[c];
    out[r] = row;
  }
  return out;
}

function padRowsTo(matrix, targetRows) {
  const rows = matrix.length, cols = rows ? matrix[0].length : 13;
  if (rows === targetRows) return matrix;
  const out = new Array(targetRows);
  for (let r = 0; r < targetRows; r++) {
    if (r < rows) out[r] = matrix[r];
    else out[r] = new Array(cols).fill(0);
  }
  return out;
}

function flatten2D(matrix) {
  const out = [];
  for (let r = 0; r < matrix.length; r++) out.push(...matrix[r]);
  return out;
}

// Robust MFCC% fallback: compute per-frame MFCC magnitude on voiced frames, then scale mean using 5th-95th percentile window
function computeRobustMfccPercent(channelData, sampleRate, frameSize = 2048, hop = 1024, energyThr = 0.01) {
  const mags = [];
  for (let i = 0; i + frameSize <= channelData.length; i += hop) {
    const frame = channelData.subarray(i, i + frameSize);
    if (rms(frame) < energyThr) continue; // skip unvoiced
    const mfcc = Meyda.extract("mfcc", frame, { sampleRate, bufferSize: frameSize, numberOfMFCCCoefficients: 13 });
    if (mfcc && mfcc.length) {
      const mag = mfcc.reduce((a, v) => a + Math.abs(v), 0) / mfcc.length;
      mags.push(mag);
    }
  }
  if (mags.length === 0) return 0;
  mags.sort((a, b) => a - b);
  const idx = (q) => mags[Math.min(mags.length - 1, Math.max(0, Math.floor((q/100) * mags.length)))];
  const lo = idx(5), hi = Math.max(idx(95), lo + 1e-6);
  const mean = mags.reduce((a, b) => a + b, 0) / mags.length;
  const pct = Math.max(0, Math.min(100, ((mean - lo) / (hi - lo)) * 100));
  return pct;
}

// Compute long pause duration (in seconds) using energy threshold and minimum duration
function computeLongPauseDuration(energies, sampleRate, hop, threshold = 0.01, minPauseMs = 300) {
  const frameDur = hop / sampleRate; // seconds
  const minFrames = Math.max(1, Math.floor((minPauseMs / 1000) / frameDur));
  let totalPauseFrames = 0;
  let run = 0;
  for (const e of energies) {
    if (e < threshold) {
      run++;
    } else {
      if (run >= minFrames) totalPauseFrames += run;
      run = 0;
    }
  }
  if (run >= minFrames) totalPauseFrames += run;
  return totalPauseFrames * frameDur;
}

// Fetch TTS audio and return PCM + metadata for MFCC processing
async function mfccFramesFromTTS(transcript) {
  try {
    const txt = (transcript || "").trim();
    if (!txt) return null;
    // Limit length for public TTS
    const ttsText = txt.slice(0, 160);
    const res = await fetch("/api/data/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: ttsText })
    });
    if (!res.ok) return null;
    const j = await res.json();
    const base64 = j?.audioBase64;
    if (!base64) return null;
    const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bin], { type: j?.contentType || "audio/mpeg" });
    const file = new File([blob], "tts.mp3", { type: blob.type });
    const buf = await decodeFileToAudioBuffer(file);
  const pcm = getMonoPCM(buf);
  return { pcm, sampleRate: buf.sampleRate, durationSec: buf.duration };
  } catch (_) {
    return null;
  }
}

export default function useAssessment() {
  const [file, setFile] = useState(null);
  // Fixed reference topic for /model demo (non-editable)
  const [refTopic, setRefTopic] = useState("Discuss the course you enjoyed most at university, describe a course you found challenging, and explain whether you think universities should focus more on practical skills or theoretical knowledge.");
  // External transcript provided by user (Web Speech or manual)
  const [transcript, setTranscript] = useState("");
  // Mode: "skip" uses provided transcript; "whisper" uses Whisper to generate transcript only
  const [model, setModel] = useState("skip");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);
  const [errors, setErrors] = useState({});

  // const SUPPORTED_MODELS = new Set(["tiny.en", "tiny", "base.en", "base", "small.en", "small"]);

  const onFile = useCallback((e) => {
    setFile(e.target.files?.[0] || null);
  }, []);

  const run = useCallback(async (options = {}) => {
    const { skipModels = false, file: fileOverride, transcript: transcriptOverride, model: modelOverride } = options || {};
    const f = fileOverride || file;
    const modelUsed = modelOverride || model;
    const transcriptUsedInitial = (typeof transcriptOverride === "string" ? transcriptOverride : transcript) || "";
    if (!f) return;
    setResult(null);
    setErrors({});
    setStatus("Decoding audio...");
  try { console.time("[useAssessment] run"); console.log("[useAssessment] start", { model, fileName: file?.name }); } catch (_) {}
  const buffer = await decodeFileToAudioBuffer(f);
    const duration = buffer.duration;
    const channelData = buffer.getChannelData(0);
  try { console.timeLog("[useAssessment] run", "decoded", { duration, sampleRate: buffer.sampleRate }); } catch (_) {}

    if (!isFinite(duration) || duration < 0.8) {
      setErrors((prev) => ({ ...prev, asr: `Audio too short (${duration?.toFixed?.(2) || 0}s). Please record at least 1–2 seconds.` }));
    }

  setStatus("Computing energy, MFCC & pitch features...");
    const frameSize = 2048, hop = 1024;
    const { energies, mean: meanEnergy, stdev: stdevEnergy } = slidingEnergyFeatures(channelData, buffer.sampleRate, frameSize, hop);
  // Pause frequency: count long pauses (>0.5s) using librosa-like top_db=30 threshold
  const pauseFreq = computeLibrosaPauseCount(energies, buffer.sampleRate, hop, 30, 0.5);
    const { mfccPct, pitchMean, pitchStd, pitchRange } = computeMeydaFeatures(channelData, buffer.sampleRate, frameSize, hop);
  const longPauseSec = computeLongPauseDuration(energies, buffer.sampleRate, hop, 0.01, 300);
  try { console.timeLog("[useAssessment] run", "basic features"); } catch (_) {}

    // Transcript source: Whisper or provided text
    let segments = null; // we won't use for features
    let transcriptUsed = (transcriptUsedInitial || "").trim();
    if (modelUsed === "whisper") {
      setStatus("Transcribing with Whisper (text only)...");
      try {
        const res = await transcribeWhisperWebFromFile(f, { model: "tiny.en", returnSegments: false });
        if (typeof res === "string") transcriptUsed = res;
        else if (res && res.text) transcriptUsed = res.text;
      } catch (e) {
        setErrors((prev) => ({ ...prev, asr: e?.message || String(e) }));
      }
    }
    if (modelUsed !== "whisper" && (!transcriptUsed || transcriptUsed.trim().length === 0)) {
      setErrors((prev) => ({ ...prev, transcript: "Transcript is required when Whisper is disabled." }));
      setStatus("Transcript required");
      try { console.timeEnd("[useAssessment] run"); } catch (_) {}
      return;
    }

  const tokens = tokenize(transcriptUsed || "");
    const totalWords = tokens.length;
    // Articulation/MLR: build segment boundaries from Whisper or energy fallback
    let segmentBoundaries = [];
    // Build segments: prefer ASR segments; else split by energy-based pauses >=300ms
    if (Array.isArray(segments) && segments.length > 0) {
      for (const s of segments) {
        const st = Number(s?.start ?? s?.from ?? s?.ts ?? NaN);
        const en = Number(s?.end ?? s?.to ?? NaN);
        if (isFinite(st) && isFinite(en) && en > st) segmentBoundaries.push([st, en]);
      }
    }
    if (segmentBoundaries.length === 0) {
      segmentBoundaries = computeSpeechSegmentsFromEnergy(energies, buffer.sampleRate, hop, 0.01, 300, 200);
      if (segmentBoundaries.length === 0) {
        // fallback single segment
        segmentBoundaries.push([0, duration]);
      }
    }
    const totalSegDur = segmentBoundaries.reduce((acc, [s, e]) => acc + Math.max(0, e - s), 0);
    const wordsPerSegSecond = totalSegDur > 0 ? totalWords / totalSegDur : 0;
    const wps = duration > 0 ? totalWords / duration : 0;
    const segCount = Math.max(1, segmentBoundaries.length);
    // Mean Length of Run (words per speech run). Without per-word timestamps, approximate
    // by distributing words proportionally to segment duration.
    let wordsPerSeg = [];
    if (totalSegDur > 0 && totalWords > 0) {
      for (const [s, e] of segmentBoundaries) {
        const dur = Math.max(0, e - s);
        wordsPerSeg.push((dur / totalSegDur) * totalWords);
      }
    } else {
      wordsPerSeg = Array(segCount).fill(totalWords / segCount);
    }
    const mlr = wordsPerSeg.length > 0 ? (wordsPerSeg.reduce((a, b) => a + b, 0) / wordsPerSeg.length) : totalWords;
    const wpm = wps * 60;
    const typeCount = new Set(tokens).size;
    const ttr = totalWords > 0 ? typeCount / totalWords : 0;
  const { linking_count, discourse_count, filled_count } = countLinkingDiscourseFilled(transcriptUsed);

  setStatus("Embedding for coherence...");
  try { console.timeLog("[useAssessment] run", "embedding start"); } catch (_) {}
  const coherencePct = await computeSemanticCoherence(transcriptUsed);
  try { console.timeLog("[useAssessment] run", "embedding done"); } catch (_) {}

    // MFCC vs TTS cosine (optional)
  setStatus("Synthesizing TTS for MFCC comparison...");
  try { console.timeLog("[useAssessment] run", "tts compare start"); } catch (_) {}
    let mfccCosine = null;
    // Compute MFCC frame matrices for both user audio and TTS, trimming to common min duration (like Python)
  const ttsFrames = await mfccFramesFromTTS(transcriptUsed);
    if (ttsFrames) {
      const minDur = Math.max(0, Math.min(buffer.duration, ttsFrames.durationSec || 0));
      const userMFCC = computeMFCCMatrix(channelData, buffer.sampleRate, 2048, 1024, 13, minDur);
      const ttsMFCC = computeMFCCMatrix(ttsFrames.pcm, ttsFrames.sampleRate, 2048, 1024, 13, minDur);
      if (userMFCC.length > 0 && ttsMFCC.length > 0) {
      const userStd = standardizeColumns(userMFCC);
      const ttsStd = standardizeColumns(ttsMFCC);
      if (userStd.length > 0 && ttsStd.length > 0) {
        const maxRows = Math.max(userStd.length, ttsStd.length);
        const userPad = padRowsTo(userStd, maxRows);
        const ttsPad = padRowsTo(ttsStd, maxRows);
        const v1 = flatten2D(userPad);
        const v2 = flatten2D(ttsPad);
        mfccCosine = cosine(v1, v2) * 100;
      }
      }
    }
  try { console.timeLog("[useAssessment] run", "tts compare done"); } catch (_) {}

  const features = Object.fromEntries(NUMERICAL_FEATURES_ORDER.map((k) => [k, 0]));
    features["Durasi (s)"] = duration;
  let mfccPercent = mfccCosine !== null ? mfccCosine : mfccPct;
  if (mfccCosine === null) {
    // Use robust voiced-only percentile scaling when TTS comparison unavailable
    mfccPercent = computeRobustMfccPercent(channelData, buffer.sampleRate, frameSize, hop, 0.01);
  }
  features["MFCC (%)"] = mfccPercent;
    features["Semantic Coherence (%)"] = coherencePct;
  features["Pause Freq"] = pauseFreq;
    features["Token Count"] = totalWords;
    features["Type Count"] = typeCount;
    features["TTR"] = ttr;
  // Replace naive pitch range with robust estimate below
    // Pitch stats similar to Python: range = max-min over 50-400 Hz
    const voicedPitches = [];
    for (let i = 0; i + frameSize <= channelData.length; i += hop) {
      const frame = channelData.subarray(i, i + frameSize);
      if (rms(frame) >= 0.01) {
        const p = estimatePitchACF(frame, buffer.sampleRate);
        if (p && isFinite(p) && p >= 50 && p <= 400) voicedPitches.push(p);
      }
    }
    let pr = 0, pMean = 0, pStd = 0;
    if (voicedPitches.length > 0) {
      const pmin = Math.min(...voicedPitches);
      const pmax = Math.max(...voicedPitches);
      pr = Math.max(0, pmax - pmin);
      pMean = voicedPitches.reduce((a,b)=>a+b,0)/voicedPitches.length;
      const pVar = voicedPitches.reduce((a,v)=>a+Math.pow(v - pMean,2),0)/voicedPitches.length;
      pStd = Math.sqrt(pVar);
    }
    features["Pitch Range (Hz)"] = pr;
  features["Articulation Rate"] = wordsPerSegSecond;
  features["Articulation Rate"] = wordsPerSegSecond;
  features["MLR"] = mlr;
    // Use voiced-only stats for pitch mean/std to mirror Python behavior
    features["Mean Pitch"] = pMean;
    features["Stdev Pitch"] = pStd;
    features["Mean Energy"] = meanEnergy;
    features["Stdev Energy"] = stdevEnergy;
    // Prosody prominences: recompute energies with hop=512 (librosa default) and use k=1.0 threshold
    const energy512 = slidingEnergyFeatures(channelData, buffer.sampleRate, 2048, 512);
    const { numPeaks, distMean, distStd } = computeProminences(energy512.energies, buffer.sampleRate, 512, 1.0);
    features["Num Prominences"] = numPeaks;
    features["Prominence Dist Mean"] = distMean;
    features["Prominence Dist Std"] = distStd;
    features["WPM"] = wpm;
    features["WPS"] = wps;
    features["Total Words"] = totalWords;
    features["Linking Count"] = linking_count;
    features["Discourse Count"] = discourse_count;
    features["Filled Pauses"] = filled_count;
  features["Long Pause (s)"] = longPauseSec;
    features["Topic Similarity (%)"] = 0;
    // Grammar errors heuristic
  features["Grammar Errors"] = computeGrammarErrors(transcriptUsed);
    features["Idioms Found"] = 0;
    features["CEFR A1"] = 0;
    features["CEFR A2"] = 0;
    features["CEFR B1"] = 0;
    features["CEFR B2"] = 0;
    features["CEFR C1"] = 0;
    features["CEFR C2"] = 0;
    features["CEFR UNKNOWN"] = 0;
    features["Bigram Count"] = 0;
    features["Trigram Count"] = 0;
    features["Fourgram Count"] = 0;
  // Synonym variations (lemma diversity) and tree depth proxies
  // Use the effective transcriptUsed for synonym & tree depth (was using stale state before)
  features["Synonym Variations"] = computeSynonymVariations(transcriptUsed);
  const td = computeTreeDepthProxy(transcriptUsed);
  features["Avg Tree Depth"] = td.avg;
  features["Max Tree Depth"] = td.max;

  setStatus("Querying data endpoints...");
  try { console.timeLog("[useAssessment] run", "data endpoints start"); } catch (_) {}
    const dataCalls = [];
    const apiErrors = {};
    dataCalls.push(
      fetch("/api/data/idioms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: transcriptUsed })
      }).then((r) => r.ok ? r.json() : r.json().catch(() => ({})).then((j)=> Promise.reject(new Error(j?.message||"idioms api failed"))) )
       .catch((e) => { apiErrors.idioms = e?.message || String(e); return { count: 0, idioms: [] }; })
    );
    dataCalls.push(
      fetch("/api/data/cefr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: transcriptUsed })
      }).then((r) => r.ok ? r.json() : r.json().catch(() => ({})).then((j)=> Promise.reject(new Error(j?.message||"cefr api failed"))) )
       .catch((e) => { apiErrors.cefr = e?.message || String(e); return { distribution: {}, wordLevels: {} }; })
    );
    dataCalls.push(
      fetch("/api/data/bundles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: transcriptUsed })
      }).then((r) => r.ok ? r.json() : r.json().catch(() => ({})).then((j)=> Promise.reject(new Error(j?.message||"bundles api failed"))) )
       .catch((e) => { apiErrors.bundles = e?.message || String(e); return { bigram_count: 0, trigram_count: 0, fourgram_count: 0, bigram_matches: [], trigram_matches: [], fourgram_matches: [] }; })
    );
    if (refTopic && refTopic.trim().length > 0) {
      dataCalls.push(
        fetch("/api/data/topic-similarity", {
          method: "POST",
          headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: transcriptUsed, reference: refTopic })
        }).then((r) => r.ok ? r.json() : r.json().catch(() => ({})).then((j)=> Promise.reject(new Error(j?.message||"topic-sim api failed"))) )
         .catch((e) => { apiErrors.topicSim = e?.message || String(e); return { similarityPercent: 0 }; })
      );
    } else {
      dataCalls.push(Promise.resolve({ similarityPercent: 0 }));
    }
  const [idiomsRes, cefrRes, bundlesRes, topicRes] = await Promise.all(dataCalls);
  try { console.timeLog("[useAssessment] run", "data endpoints done"); } catch (_) {}

    features["Idioms Found"] = Number(idiomsRes?.count || 0);
    const dist = cefrRes?.distribution || {};
    features["CEFR A1"] = Number(dist.A1 || 0);
    features["CEFR A2"] = Number(dist.A2 || 0);
    features["CEFR B1"] = Number(dist.B1 || 0);
    features["CEFR B2"] = Number(dist.B2 || 0);
    features["CEFR C1"] = Number(dist.C1 || 0);
    features["CEFR C2"] = Number(dist.C2 || 0);
    features["CEFR UNKNOWN"] = Number(dist.UNKNOWN || 0);
    features["Bigram Count"] = Number(bundlesRes?.bigram_count || 0);
    features["Trigram Count"] = Number(bundlesRes?.trigram_count || 0);
    features["Fourgram Count"] = Number(bundlesRes?.fourgram_count || 0);
    features["Topic Similarity (%)"] = Number(topicRes?.similarityPercent || 0);

  if (!skipModels) {
    setStatus("Calling model APIs...");
    try { console.timeLog("[useAssessment] run", "models start"); } catch (_) {}
    async function call(name, url) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ features })
        });
        if (!res.ok) {
          const msg = await res.json().catch(()=>({}));
          throw new Error(msg?.message || `${name} failed`);
        }
        return await res.json();
      } catch (e) {
        apiErrors[name] = e?.message || String(e);
        return { error: true, message: apiErrors[name] };
      }
    }

    const [flu, pro, proso, coh, topic, comp, acc, cefr] = await Promise.all([
      call("Fluency", "/api/fluency"),
      call("Pronunciation", "/api/pronunciation"),
      call("Prosody", "/api/prosody"),
      call("Coherence", "/api/coherence"),
      call("Topic", "/api/topic-relevance"),
      call("Complexity", "/api/complexity"),
      call("Accuracy", "/api/accuracy"),
      call("CEFR", "/api/cefr")
    ]);

    const interpreted = {
      Fluency: flu?.error ? { label: "Error", value: null } : interpretOutput("Fluency", flu?.result ?? flu),
      Pronunciation: pro?.error ? { label: "Error", value: null } : interpretOutput("Pronunciation", pro?.result ?? pro),
      Prosody: proso?.error ? { label: "Error", value: null } : interpretOutput("Prosody", proso?.result ?? proso),
      "Coherence and Cohesion": coh?.error ? { label: "Error", value: null } : interpretOutput("Coherence and Cohesion", coh?.result ?? coh),
      "Topic Relevance": topic?.error ? { label: "Error", value: null } : interpretOutput("Topic Relevance", topic?.result ?? topic),
      Complexity: comp?.error ? { label: "Error", value: null } : interpretOutput("Complexity", comp?.result ?? comp),
      Accuracy: acc?.error ? { label: "Error", value: null } : interpretOutput("Accuracy", acc?.result ?? acc),
      CEFR: cefr?.error ? { label: "Error", value: null } : interpretOutput("CEFR", cefr?.result ?? cefr)
    };

    setResult({
      transcript: transcriptUsed,
      features,
      outputs: { flu, pro, proso, coh, topic, comp, acc, cefr },
      interpreted,
      dataExtras: {
        idioms: idiomsRes?.idioms || [],
        bundles: {
          bigrams: bundlesRes?.bigram_matches || [],
          trigrams: bundlesRes?.trigram_matches || [],
          fourgrams: bundlesRes?.fourgram_matches || []
        },
        cefrWords: cefrRes?.wordLevels || {}
      }
    });
    try { console.timeLog("[useAssessment] run", "models done"); console.timeEnd("[useAssessment] run"); } catch (_) {}
    setErrors((prev) => ({ ...prev, ...apiErrors }));
    setStatus("Done");
  } else {
    // Skip model API calls, but still return features and dataExtras
    setResult({
      transcript: transcriptUsed,
      features,
      outputs: null,
      interpreted: null,
      dataExtras: {
        idioms: idiomsRes?.idioms || [],
        bundles: {
          bigrams: bundlesRes?.bigram_matches || [],
          trigrams: bundlesRes?.trigram_matches || [],
          fourgrams: bundlesRes?.fourgram_matches || []
        },
        cefrWords: cefrRes?.wordLevels || {}
      }
    });
    try { console.timeEnd("[useAssessment] run"); } catch (_) {}
    setErrors((prev) => ({ ...prev, ...apiErrors }));
    setStatus("Done");
  }
  }, [file, refTopic, model]);

  return {
    file,
    setFile,
    refTopic,
    setRefTopic,
    transcript,
    setTranscript,
    model,
    setModel,
    status,
    result,
    errors,
    onFile,
    run
  };
}
