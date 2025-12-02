# I‑Speak Feature Parity Tracker

Dokumen ini untuk memantau kesetaraan fitur antara implementasi Python (Streamlit) dan Next.js (web). Gunakan checklist ini sebagai progress board.

Legenda status:
- ✅ Selesai/Setara
- 🟡 Parsial/Beda pendekatan
- ❌ Belum

## Ringkasan

| Area | Python | Next.js | Status | Catatan |
|---|---|---|:--:|---|
| ASR (Whisper) | openai-whisper (PyTorch) | Remotion Whisper Web (wasm/cpp) | 🟡 | Engine berbeda; kualitas/segmentasi bisa beda.
| Semantic Coherence | SBERT (sentence-transformers) | Xenova all-MiniLM-L6-v2 | ✅ | Hasil fungsi setara; engine beda.
| Topic Similarity (%) | SBERT | Xenova | ✅ | Diaktifkan bila ref topic diisi.
| MFCC (%) | MFCC vs TTS cosine | MFCC vs TTS cosine | ✅ | TTS (google-tts-api) + cosine MFCC mean.
| Pause metrics | Long pauses (durasi) | Long pauses (durasi) + Pause Freq | ✅ | Menambahkan Long Pause (s) via energy threshold.
| Articulation Rate | Dari segmen whisper | Dari segmen whisper (fallback energy) | ✅ | Menggunakan segments Whisper bila ada; fallback energi.
| MLR | Dari segmen whisper | Dari segmen whisper (fallback energy) | ✅ | MLR = totalWords / jumlah segmen.
| Prosody (mean/stdev pitch/energy) | Ada | Ada | ✅ | Sudah.
| Prosody prominences | Peak energy + jarak | RMS peak count + mean/std dist | ✅ | Deteksi puncak RMS di energy frames; jarak antar peak (s).
| Grammar Errors | TextBlob | Heuristik ringan | 🟡 | Heuristik: kapital/pungtuasi, kata berulang, a/an, SVA dasar.
| Synonym Variations | WordNet | Lemma diversity (compromise) | ✅ | Hitung ragam lemma konten (noun/verb/adj/adv) via compromise.
| Avg/Max Tree Depth | Proxy (panjang kalimat) | Rata/max kata per kalimat | ✅ | Proxy kedalaman pohon = avg/max panjang kalimat.
| Lexical Bundles | valid bi/tri/fourgrams | Endpoint bundles | ✅ | Fungsional.
| Idioms | Matching list | Endpoint idioms | ✅ | Fungsional.
| CEFR per kata | CSV | CSV | ✅ | Sudah.
| CEFR final model | 7 skor subconstruct → CEFR | 7 skor subconstruct → CEFR | ✅ | Sudah diseragamkan dan lengkap.
| Feature scaling | StandardScaler | StandardScaler (JSON) | ✅ | Scaler dimuat dari file JSON training.

## Detail Checklist per Fitur

- ASR (transkripsi)
  - [🟡] Implementasi berbeda (wasm vs PyTorch). Perlu validasi kualitas segmen untuk fitur berbasis waktu.
- MFCC (%)
  - [✅] Menggunakan TTS (Google) → decode → mean MFCC (13-d) dan cosine ke user MFCC.
- Pause metrics
  - [✅] Menambahkan Long Pause (s) berbasis threshold energi dan min durasi.
- Articulation Rate
  - [✅] Hitung dari total kata / total durasi segmen (Whisper segments bila ada; fallback energi).
- MLR
  - [✅] MLR = total kata / jumlah segmen (Whisper segments atau fallback energi).
- Prosody prominences
  - [✅] Deteksi peak RMS; simpan jumlah peak dan mean/std jarak (detik).
- Grammar Errors
  - [✅] Enhanced heuristic dengan 10+ aturan: kapitalisasi, pungtuasi, kata berulang, a/an, SVA lengkap, word confusion, missing articles, double negatives, modal verbs, comparatives, than/then.
- Synonym Variations
  - [✅] Ragam lemma konten via compromise (nouns/verbs/adjs/advs).
- Avg/Max Tree Depth
  - [✅] Proxy: rata-rata dan maksimum kata per kalimat.
- Topic Similarity / Coherence
  - [✅] Sudah (Xenova); hasil setara konsepnya.
- Lexical Bundles / Idioms
  - [✅] Sudah.
- CEFR final model
  - [✅] Sudah diseragamkan: CEFR menerima 7 skor subconstruct.
- Feature scaling
  - [✅] Semua model menggunakan scaler dari file JSON (mean, scale) yang dihasilkan dari training Python.

## Action Items (Prioritas)

1) ✅ Feature scaling: DONE — Semua model menggunakan scaler JSON dari training Python.
2) ✅ Pipeline CEFR: DONE — endpoint CEFR memakai 7 skor subconstruct sebagai input.
3) ✅ Prosody prominences dari RMS/peaks: DONE.
4) ✅ Grammar Errors: Enhanced heuristic dengan 10+ aturan grammar.
5) ✅ Tree Depth proxy: Rata-rata dan maksimum kata per kalimat.
6) ✅ MFCC vs TTS: Implementasi cosine similarity dengan TTS reference.

## Catatan Teknis

- Perbedaan engine (Whisper, SBERT) wajar di web. Fokus samakan pipeline fitur (urutan, skala, definisi metrik) agar hasil lebih konsisten.
- Tinggal tambahkan scaler (mean/std)
