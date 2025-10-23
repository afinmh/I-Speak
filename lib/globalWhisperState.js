// Simple global store for Whisper download state
// Allows components to subscribe and update a shared progress/loaded status

let state = {
  downloading: false,
  loaded: false,
  progress: 0, // 0..100
  status: "Idle"
};

const listeners = new Set();

export function getWhisperState() {
  return state;
}

export function subscribeWhisper(listener) {
  listeners.add(listener);
  // push current state immediately
  try { listener(state); } catch {}
  return () => listeners.delete(listener);
}

export function updateWhisperState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((cb) => {
    try { cb(state); } catch {}
  });
}
