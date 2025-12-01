I‑Speak (Next.js) — Automated Speech Assessment berbasis web.

Dokumen ini menjelaskan cara menjalankan, mengonfigurasi, dan menggunakan I‑Speak versi Next.js, termasuk alur penilaian, endpoint API model, dan integrasi Supabase. Untuk perbedaan vs implementasi Python (Streamlit), lihat bagian “Feature Parity”.

## Ringkasan

- Framework: Next.js App Router (Server/Client Components)
- ASR: Whisper Web dari Remotion (WASM) — preload saat aplikasi dibuka
- Embeddings: `@xenova/transformers` (all-MiniLM-L6-v2)
- Backend data: Supabase (auth, tabel mahasiswa/rekaman/score/tugas, storage untuk audio)
- Model penilaian: file JS hasil konversi (RandomForest dkk) di `public/model_js/*.js`
- CEFR: dihitung dari 7 skor sub‑construct server‑side, lalu dipetakan ke CEFR

## Prasyarat

- Node.js 18+ (disarankan 18 LTS atau 20 LTS)
- NPM/Yarn/PNPM/Bun (pilih salah satu)
- Akun Supabase + Project (untuk dashboard/penyimpanan audio)

## Menjalankan (Development)

1) Pasang dependensi

```bash
npm install
```

2) Jalankan dev server

```bash
npm run dev
```

3) Buka `http://localhost:3000`

Catatan:
- Aplikasi akan mem‑preload model Whisper (default `tiny.en`) dengan splash screen (progress sampai ±50%, sisanya lanjut di background).
- Perubahan file di `app/*` hot‑reload secara otomatis.

## Build & Production

```bash
npm run build
npm run start
```

Untuk Vercel/deploy lain, ikuti panduan Next.js standar. Pastikan variabel lingkungan (env) sudah benar di platform target.

## Konfigurasi Lingkungan (.env)

Set variabel berikut (contoh):

```
# Supabase (client)
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>

# Supabase (server, JANGAN diekspos ke client)
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE=<service-role-key>
SUPABASE_BUCKET=recordings

# Opsional (untuk fallback pemuatan model_js saat file system tidak tersedia)
NEXT_PUBLIC_SITE_URL=http://localhost:3000
# atau gunakan VERCEL_URL (disediakan otomatis di Vercel)
```

Penjelasan:
- `NEXT_PUBLIC_*` dipakai di browser (auth Supabase).
- `SUPABASE_SERVICE_ROLE` hanya untuk server/API routes (jangan pernah dipakai di client).
- Bucket default `recordings` dapat diubah via `SUPABASE_BUCKET`.

## Struktur Proyek (intisari)

- `app/` — Halaman Next.js (App Router), termasuk API routes di `app/api/*`
- `app/assessment/` — Layar pengambilan data mahasiswa, perekaman 6 tugas, dan pemrosesan
- `app/model/` — Demo halaman evaluasi cepat (dengan splash ringan)
- `lib/` — Utilitas (Whisper web, embeddings, Supabase client/server, model loader, feature mapping)
- `public/model_js/` — Model konversi JS untuk tiap sub‑construct + CEFR

## Alur Penilaian (singkat)

1) Perekaman audio per tugas (MediaRecorder) → tersimpan ke Supabase Storage dan row rekaman.
2) ASR di browser menggunakan Whisper Web (WASM) → transcript + segments.
3) Ekstraksi fitur (durasi, prosody, lexical, coherence, topic similarity, dsb.).
4) Panggil endpoint model sub‑construct (server) → skor numerik per sub‑construct.
5) 7 skor tersebut → endpoint `/api/cefr` → label CEFR akhir.
6) Hasil disimpan via API (`/api/score/batch`, dll) dan diringkas di UI.

Komponen kunci:
- `lib/whisperWebClient.js` — wrapper Whisper Web: preload + transcribe.
- `app/components/PreloadWhisper.jsx` — splash preload Whisper saat app start.
- `lib/featureMapping.js` — urutan fitur + pemetaan sub‑construct.
- `lib/modelLoader.js` — loader model JS + scaler (CEFR: placeholder mean/std, ganti dengan nilai training).

## Halaman Penting

- `/assessment` — Alur 6 tugas (form mahasiswa → rekam → proses → CEFR).
- `/model` — Halaman uji cepat (tanpa alur lengkap), memanaskan aset NLP.
- `/dashboard` — Admin (daftar mahasiswa, unduh, hapus, dsb.) jika diaktifkan.

## API Model (Server)

Seluruh endpoint menerima `POST` JSON `{ features: { <nama>: number, ... } }`. Urutan fitur per sub‑construct diatur di `lib/featureMapping.js`.

- `POST /api/fluency`
- `POST /api/pronunciation`
- `POST /api/prosody`
- `POST /api/coherence`
- `POST /api/topic-relevance`
- `POST /api/complexity`
- `POST /api/accuracy`
- `POST /api/cefr`

Contoh payload generik:

```json
{
  "features": {
    "Durasi (s)": 12.3,
    "MFCC (%)": 55.1,
    "Semantic Coherence (%)": 72.0,
    "Pause Freq": 0.18,
    "Token Count": 120,
    "Type Count": 80,
    "TTR": 0.66,
    "Pitch Range (Hz)": 110.5,
    "Articulation Rate": 3.4,
    "MLR": 5.2,
    "Mean Pitch": 180.0,
    "Stdev Pitch": 25.0,
    "Mean Energy": 0.12,
    "Stdev Energy": 0.03,
    "Num Prominences": 7,
    "Prominence Dist Mean": 0.45,
    "Prominence Dist Std": 0.11,
    "WPM": 120,
    "WPS": 2.0,
    "Total Words": 150,
    "Linking Count": 5,
    "Discourse Count": 2,
    "Filled Pauses": 3,
    "Long Pause (s)": 0.9,
    "Topic Similarity (%)": 65.0,
    "Grammar Errors": 4,
    "Idioms Found": 1,
    "CEFR A1": 10,
    "CEFR A2": 8,
    "CEFR B1": 6,
    "CEFR B2": 4,
    "CEFR C1": 2,
    "CEFR C2": 0,
    "CEFR UNKNOWN": 3,
    "Bigram Count": 20,
    "Trigram Count": 10,
    "Fourgram Count": 5,
    "Synonym Variations": 12,
    "Avg Tree Depth": 2.1,
    "Max Tree Depth": 6
  }
}
```

Catatan penting:
- Setiap sub‑construct memakai subset fitur sesuai `lib/featureMapping.js` (diurutkan ketat).
- `/api/cefr` TIDAK membutuhkan fitur mentah: endpoint ini otomatis menghitung 7 skor sub‑construct (urutan fix: `[Fluency, Pronunciation, Prosody, Coherence and Cohesion, Topic Relevance, Complexity, Accuracy]`), lalu memberi input ke model CEFR. Skaler CEFR dibaca dari `lib/modelLoader.js` (saat ini placeholder — isi nilai mean/std training Python untuk parity terbaik).
- Berkas model di `public/model_js/*.js` harus mengekspor fungsi `score()` atau fungsi default. Loader sudah menangani beberapa variasi ekspor umum.

Contoh panggilan:

```js
await fetch("/api/fluency", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ features })
});
```

## Integrasi Supabase (opsional tapi direkomendasikan)

- Client: `lib/supabaseClient.js` menggunakan `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` untuk autentikasi dan sesi.
- Server/API: `lib/supabaseServer.js` menyediakan `getServiceClient()` (service role) dan `getAnonClient()`.
- Storage bucket default: `recordings` (konfigurable via `SUPABASE_BUCKET`).
- Endpoint terkait data (contoh): `/api/mahasiswa`, `/api/rekaman`, `/api/score/batch`, `/api/tugas`, `/api/media/*`, `/api/dashboard/*`.

Pastikan aturan RLS dan kebijakan bucket disetel sesuai kebutuhan keamanan Anda. Jangan pernah mengekspos `SUPABASE_SERVICE_ROLE` di client.

## Feature Parity

Perbandingan lengkap antara implementasi Python (Streamlit) dan Next.js, termasuk status dan catatan teknis, ada di dokumen berikut:

- Lihat `FEATURE_PARITY.md` (wajib baca untuk menyamakan pipeline, skala fitur, dan definisi metrik).

Poin penting saat ini:
- CEFR scaler masih placeholder di `lib/modelLoader.js` → isi mean/std dari training Python untuk mengurangi bias.
- Engine berbeda (Whisper wasm vs PyTorch, SBERT vs Xenova) sehingga nilai absolut dapat sedikit berbeda; yang utama adalah pipeline dan skala konsisten.

## Troubleshooting

- Whisper tidak jalan / splash tidak selesai: pastikan browser mendukung WebAssembly dan mic; coba Chrome terbaru. Cek log konsol untuk pesan dari `@remotion/whisper-web`.
- Model JS tidak ditemukan di serverless: set `NEXT_PUBLIC_SITE_URL` atau pastikan file tersedia di `public/model_js` dan dapat diakses publik.
- Supabase auth gagal: verifikasi `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` di client, serta `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE` di server.
- Unduh/unggah lambat: periksa jaringan, ukuran berkas audio, dan gunakan server dekat region pengguna.

## Pengembangan Lanjutan

- Lengkapi nilai scaler CEFR (mean/std) agar hasil lebih konsisten dengan Python.
- Tambah indeks DB untuk kueri dashboard cepat (count/pagination).
- Standarisasi komponen modal/loader/toast di UI.

—

I‑Speak Next.js siap dikembangkan dan dideploy. Untuk detail parity dan roadmap teknis, silakan rujuk `FEATURE_PARITY.md`.
