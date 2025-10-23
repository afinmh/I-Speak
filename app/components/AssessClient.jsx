"use client";

import React from "react";
import useAssessment from "@/hooks/useAssessment";

export default function AssessClient() {
  const {
    file,
    setFile,
    refTopic,
    transcript,
    setTranscript,
    model,
    setModel,
    status,
    result,
    errors,
    onFile,
    run
  } = useAssessment();

  // Helpers
  const fmt = (n, d = 2) => (typeof n === 'number' && isFinite(n) ? n.toFixed(d) : String(n));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const levelColor = (label) => {
    const l = String(label).toLowerCase();
    // Map new 6-class labels and CEFR to colors
    if (l.includes('beginner') || l.includes('a1')) return 'bg-red-100 text-red-800 border-red-200';
    if (l.includes('elementary') || l.includes('a2')) return 'bg-orange-100 text-orange-800 border-orange-200';
    if (l.includes('intermediate') || l.includes('b1')) return 'bg-amber-100 text-amber-800 border-amber-200';
    if (l.includes('upper-intermediate') || l.includes('b2')) return 'bg-lime-100 text-lime-800 border-lime-200';
    if (l.includes('advanced') || l.includes('c1')) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (l.includes('master') || l.includes('c2')) return 'bg-teal-100 text-teal-800 border-teal-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };
  const Tag = ({ children, className = '' }) => (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${className}`}>{children}</span>
  );
  const StatCard = ({ title, value, subtitle }) => (
    <div className="rounded border p-3 bg-white">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="text-xl font-semibold text-black">{value}</div>
      {subtitle && <div className="text-xs text-gray-500">{subtitle}</div>}
    </div>
  );
  const Bar = ({ value }) => (
    <div className="w-full bg-gray-200 rounded h-2 overflow-hidden">
      <div className="bg-black h-2" style={{ width: `${clamp(value, 0, 100)}%` }} />
    </div>
  );
  const rawLabelsFor = (modelName) => {
    if ((modelName || '').toLowerCase() === 'cefr') return ['A1','A2','B1','B2','C1','C2'];
    // 6-class scale: 1..6 Beginner→Master
    return ['1 Beginner','2 Elementary','3 Intermediate','4 Upper-Intermediate','5 Advanced','6 Master'];
  };

  // Audio playback state
  const audioRef = React.useRef(null);
  const [audioUrl, setAudioUrl] = React.useState(null);
  const [isPlaying, setIsPlaying] = React.useState(false);

  React.useEffect(() => {
    // Create/revoke object URL when file changes
    if (!file) {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
      setIsPlaying(false);
      return;
    }
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setIsPlaying(false);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  React.useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
    };
  }, [audioUrl]);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
    } else {
      el.play();
    }
  };

  return (
    <div className="w-full max-w-screen-xl mx-auto text-black bg-white p-4 md:p-6 rounded-lg shadow">
      <div className="space-y-4">
        {/* Dropzone */}
        <div className="border-2 border-dashed rounded-lg p-4 md:p-6 bg-gray-50 hover:bg-gray-100 transition">
          <label className="block text-sm font-medium text-gray-800 mb-2">Audio file</label>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-gray-600">
              {file ? (
                <div>
                  <div className="font-medium text-black truncate">{file.name}</div>
                  <div className="text-xs">{(file.size/1024/1024).toFixed(2)} MB</div>
                </div>
              ) : (
                <span>Drag & drop file di sini atau klik Browse untuk memilih.</span>
              )}
            </div>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md border bg-white text-black cursor-pointer hover:bg-gray-50">
              <span className="text-sm">Browse</span>
              <input type="file" accept="audio/*" onChange={onFile} className="hidden" />
            </label>
          </div>
        </div>

        {/* Mode selection */}
        <div className="flex items-center gap-4">
          <div className="text-sm font-medium text-gray-800">Transcript source</div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" name="mode" value="skip" checked={model === 'skip'} onChange={() => setModel('skip')} />
            Manual/Provided
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" name="mode" value="whisper" checked={model === 'whisper'} onChange={() => setModel('whisper')} />
            Whisper (auto transcript only)
          </label>
        </div>

        {/* Transcript input */}
        <div>
          <label className="block text-sm font-medium text-gray-800 mb-1">Transcript</label>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Paste or type the transcript here..."
            className={`w-full border rounded-md p-2 min-h-28 ${model==='whisper' ? 'bg-gray-100' : ''}`}
            disabled={model === 'whisper'}
          />
          <div className="text-xs text-gray-500 mt-1">
            {model === 'whisper' ? 'Whisper akan menghasilkan transcript. Anda tidak perlu mengisi kotak ini.' : 'Teks ini akan digunakan untuk semua metrik berbasis teks (accuracy, complexity, topic, coherence, dll).'}
          </div>
        </div>

        {/* Fixed Reference topic */}
        <div>
          <label className="block text-sm font-medium text-gray-800 mb-1">Reference topic</label>
          <div className="w-full border rounded-md p-3 bg-gray-50 text-sm text-black whitespace-pre-wrap select-text">
            {refTopic}
          </div>
          <div className="text-xs text-gray-500 mt-1">Topik ini bersifat tetap untuk demo ini.</div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={run}
            disabled={!file || (model !== 'whisper' && !(transcript && transcript.trim().length > 0))}
            className="px-4 py-2 rounded-md bg-black text-white disabled:opacity-50"
          >
            Process Audio
          </button>
          {!transcript?.trim() && model !== 'whisper' && (
            <span className="text-xs text-red-600">Transcript diperlukan untuk menghitung metrik berbasis teks.</span>
          )}
          {result && status === "Done" && (
            <>
              <button
                onClick={togglePlay}
                disabled={!audioUrl}
                className="px-4 py-2 rounded-md border bg-white text-black hover:bg-gray-50 disabled:opacity-50"
                aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
              >
                {isPlaying ? 'Pause Audio' : 'Play Audio'}
              </button>
              <span className="inline-flex items-center px-2 py-1 rounded border bg-green-100 text-green-800 border-green-200 text-xs">
                Done
              </span>
            </>
          )}
          <div className="flex-1 text-sm text-gray-800 flex items-center gap-3">
            {status && status !== "Done" && (
              <div className="flex items-center gap-2 w-full">
                <div className="w-40 h-2 bg-gray-200 rounded overflow-hidden">
                  <div className="h-2 bg-black animate-pulse" style={{ width: `${/([0-9]{1,3})%/.test(status) ? Math.max(5, Math.min(100, Number(status.match(/([0-9]{1,3})%/)[1]))) : 40}%` }} />
                </div>
                <span className="text-xs">{status}</span>
              </div>
            )}
          </div>
        </div>
        {/* Hidden audio element for playback */}
        <audio ref={audioRef} src={audioUrl || undefined} className="hidden" preload="metadata" />
        {Object.keys(errors || {}).length > 0 && (
          <div className="text-sm text-red-600">
            <div className="font-semibold">Errors</div>
            <pre className="bg-red-50 p-2 rounded text-xs text-black overflow-auto">{JSON.stringify(errors, null, 2)}</pre>
          </div>
        )}
      </div>

      {result && (
        <div className="mt-6 space-y-6">
          {/* Transcript */}
          <section className="space-y-2">
            <h3 className="font-semibold">Transcript</h3>
            <div className="rounded border p-3 bg-gray-50 text-black whitespace-pre-wrap">{result.transcript || "(empty)"}</div>
          </section>

          {/* Quick Stats */}
          <section className="space-y-2">
            <h3 className="font-semibold">Quick Stats</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard title="Duration" value={`${fmt(result.features["Durasi (s)"], 1)} s`} />
              <StatCard title="WPM" value={fmt(result.features["WPM"], 1)} />
              <StatCard title="Total Words" value={fmt(result.features["Total Words"], 0)} />
              <StatCard title="TTR" value={fmt(result.features["TTR"], 2)} subtitle="Type/Token Ratio" />
              <StatCard title="Coherence" value={`${fmt(result.features["Semantic Coherence (%)"], 1)} %`} />
              <StatCard title="Topic Similarity" value={`${fmt(result.features["Topic Similarity (%)"], 1)} %`} />
              <StatCard title="Idioms Found" value={fmt(result.features["Idioms Found"], 0)} />
              <StatCard title="Grammar Errors" value={fmt(result.features["Grammar Errors"], 0)} />
            </div>
          </section>

          {/* Interpreted Results */}
          <section className="space-y-2">
            <h3 className="font-semibold">Interpreted Results</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(result.interpreted || {}).map(([name, iv]) => (
                <div key={name} className="rounded border p-3 bg-white">
                  <div className="text-xs text-gray-500 mb-1">{name}</div>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-sm ${levelColor(iv?.label)} px-2 py-0.5 rounded border`}>{iv?.label}</span>
                    <span className="text-xs text-gray-600">{typeof iv?.value === 'number' ? (Number(iv.value) + 1) : ''}</span>
                  </div>
                  <div className="flex gap-1">
                    {[1,2,3,4,5,6].map((i) => (
                      <div key={i} className={`h-1 w-full ${i <= clamp((Number(iv?.value) || 0) + 1, 1, 6) ? 'bg-black' : 'bg-gray-200'}`} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Model Outputs (Raw as bars) */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Model Outputs</h3>
              <details>
                <summary className="cursor-pointer text-sm text-gray-600">Show raw JSON</summary>
                <pre className="bg-gray-100 p-3 rounded text-xs overflow-auto text-black mt-2">{JSON.stringify(result.outputs, null, 2)}</pre>
              </details>
            </div>
            <div className="space-y-3">
              {Object.entries(result.outputs || {}).map(([key, o]) => (
                <div key={key} className="rounded border p-3 bg-white">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium">{o?.model || key}</div>
                    <div className="text-xs text-gray-500">{Array.isArray(o?.result) ? 'prob' : 'value'}</div>
                  </div>
                  {Array.isArray(o?.result) ? (
                    <div className="space-y-1">
                      {o.result.map((p, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <div className="w-24 text-xs text-gray-600 truncate">{rawLabelsFor(o?.model)[idx] ?? idx}</div>
                          <Bar value={Number(p) * 100} />
                          <div className="w-10 text-right text-xs">{fmt(Number(p) * 100, 1)}%</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm">{String(o?.result ?? '')}</div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Linguistic Extras */}
          <section className="space-y-2">
            <h3 className="font-semibold">Linguistic Extras</h3>
            <div className="space-y-3">
              {/* Idioms */}
              <div>
                <div className="text-sm font-medium mb-1">Idioms</div>
                <div className="flex flex-wrap gap-2">
                  {(result.dataExtras?.idioms || []).length > 0 ? (
                    result.dataExtras.idioms.map((id, i) => (
                      <Tag key={`${id}-${i}`} className="bg-indigo-50 text-indigo-800 border-indigo-200">{id}</Tag>
                    ))
                  ) : (
                    <span className="text-xs text-gray-500">None</span>
                  )}
                </div>
              </div>
              {/* Bundles */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <div className="text-sm font-medium mb-1">Bigrams</div>
                  <div className="flex flex-wrap gap-2">
                    {(result.dataExtras?.bundles?.bigrams || []).map((b, i) => (
                      <Tag key={`bi-${i}`} className="bg-gray-100 text-gray-800 border-gray-200">{b}</Tag>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium mb-1">Trigrams</div>
                  <div className="flex flex-wrap gap-2">
                    {(result.dataExtras?.bundles?.trigrams || []).map((b, i) => (
                      <Tag key={`tri-${i}`} className="bg-gray-100 text-gray-800 border-gray-200">{b}</Tag>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium mb-1">Fourgrams</div>
                  <div className="flex flex-wrap gap-2">
                    {(result.dataExtras?.bundles?.fourgrams || []).map((b, i) => (
                      <Tag key={`four-${i}`} className="bg-gray-100 text-gray-800 border-gray-200">{b}</Tag>
                    ))}
                  </div>
                </div>
              </div>
              {/* CEFR Words */}
              <div>
                <div className="text-sm font-medium mb-1">CEFR Words</div>
                <div className="max-h-56 overflow-auto rounded border">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="text-left px-3 py-2">Word</th>
                        <th className="text-left px-3 py-2">Level</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(result.dataExtras?.cefrWords || {}).map(([w, lvl]) => (
                        <tr key={`${w}-${lvl}`} className="border-t">
                          <td className="px-3 py-1 text-black">{w}</td>
                          <td className="px-3 py-1"><span className={`px-2 py-0.5 rounded border text-xs ${levelColor(lvl)}`}>{lvl}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
