/**
 * Alert sounds, made rather than shipped.
 *
 * Four short sounds synthesized with the Web Audio API — a chime, a bell, a
 * pulse, a tick — so there is nothing to download and nothing the service
 * worker has to cache. Browsers only let a page make sound after a person
 * has touched it, so the audio context is unlocked on the first pointer or
 * key event and kept; a timer that runs out an hour later can still ring.
 */

export type SoundId = "chime" | "bell" | "pulse" | "tick";

export const SOUNDS: ReadonlyArray<{ id: SoundId; label: string }> = [
  { id: "chime", label: "Chime" },
  { id: "bell", label: "Bell" },
  { id: "pulse", label: "Pulse" },
  { id: "tick", label: "Tick" },
];

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  return context;
}

/** Let sound happen: call from any user gesture. Safe to call often. */
export function unlockAudio(): void {
  const ctx = audio();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
}

if (typeof window !== "undefined") {
  const once = () => {
    unlockAudio();
    window.removeEventListener("pointerdown", once);
    window.removeEventListener("keydown", once);
  };
  window.addEventListener("pointerdown", once, { passive: true });
  window.addEventListener("keydown", once);
}

function tone(ctx: AudioContext, at: number, hz: number, seconds: number, gain: number, type: OscillatorType, out: GainNode) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(hz, at);
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain, at + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(env);
  env.connect(out);
  osc.start(at);
  osc.stop(at + seconds + 0.05);
}

/** Play a sound at a volume from 0 to 1. Silent when the browser has no audio. */
export function play(id: SoundId, volume = 0.6): void {
  const ctx = audio();
  if (!ctx) return;
  unlockAudio();
  const out = ctx.createGain();
  out.gain.value = Math.max(0, Math.min(1, volume));
  out.connect(ctx.destination);
  const t = ctx.currentTime + 0.02;
  switch (id) {
    case "chime":
      tone(ctx, t, 880, 0.5, 0.5, "sine", out);
      tone(ctx, t + 0.18, 1174.66, 0.7, 0.45, "sine", out);
      tone(ctx, t + 0.36, 1567.98, 1.0, 0.4, "sine", out);
      break;
    case "bell":
      tone(ctx, t, 659.25, 1.6, 0.5, "triangle", out);
      tone(ctx, t, 1318.5, 1.0, 0.18, "sine", out);
      tone(ctx, t, 1975.5, 0.6, 0.08, "sine", out);
      break;
    case "pulse":
      for (let i = 0; i < 3; i++) tone(ctx, t + i * 0.22, 740, 0.12, 0.45, "square", out);
      break;
    case "tick":
      tone(ctx, t, 1500, 0.05, 0.35, "triangle", out);
      break;
  }
  if (typeof navigator !== "undefined" && "vibrate" in navigator && id !== "tick") {
    try {
      navigator.vibrate(id === "pulse" ? [80, 60, 80, 60, 80] : 120);
    } catch {
      /* not a phone */
    }
  }
}
