/**
 * Sound and haptics (spec §15). Off by default; one toggle controls both.
 *
 * Sounds are synthesized with Web Audio rather than shipped as files: a tick
 * per wheel stop, a rising chime on correct, a low thud on a miss. Frank can
 * swap in recorded files later by replacing the three `synth*` functions.
 * The AudioContext is created on the first user gesture (`unlock`), which is
 * what mobile browsers require.
 */

export type Cue = 'tick' | 'correct' | 'miss'

export interface FeedbackDeps {
  createContext?: () => AudioContext | null
  vibrate?: (pattern: number | number[]) => unknown
}

export interface Feedback {
  /** Create/resume the audio context. Call from a user gesture (the Start tap). */
  unlock(): void
  play(cue: Cue): void
  setMuted(muted: boolean): void
  muted(): boolean
}

const HAPTIC: Record<Cue, number | number[] | null> = { tick: 10, correct: null, miss: 150 }

export function createFeedback(initialMuted: boolean, deps: FeedbackDeps = {}): Feedback {
  let muted = initialMuted
  let ctx: AudioContext | null = null
  const createContext =
    deps.createContext ??
    (() => {
      try {
        const Ctor = (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext) as typeof AudioContext | undefined
        return Ctor ? new Ctor() : null
      } catch {
        return null
      }
    })
  const vibrate =
    deps.vibrate ??
    ((pattern: number | number[]) => {
      try {
        return typeof navigator !== 'undefined' && navigator.vibrate?.(pattern)
      } catch {
        return false
      }
    })

  const unlock = () => {
    if (muted) return
    ctx ??= createContext()
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {})
  }

  const play = (cue: Cue) => {
    if (muted) return
    const h = HAPTIC[cue]
    if (h !== null) {
      try {
        vibrate(h)
      } catch {
        /* no haptics here */
      }
    }
    unlock()
    if (!ctx) return
    try {
      const t = ctx.currentTime
      if (cue === 'tick') synthTick(ctx, t)
      else if (cue === 'correct') synthChime(ctx, t)
      else synthThud(ctx, t)
    } catch {
      /* audio must never break play */
    }
  }

  return {
    unlock,
    play,
    setMuted: (m) => {
      muted = m
    },
    muted: () => muted,
  }
}

function tone(
  ctx: AudioContext,
  type: OscillatorType,
  freq: number,
  start: number,
  duration: number,
  gain: number,
  freqEnd?: number,
) {
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(freqEnd, start + duration)
  g.gain.setValueAtTime(gain, start)
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(g).connect(ctx.destination)
  osc.start(start)
  osc.stop(start + duration)
}

/** Short mechanical click: a fast-decaying high square blip. */
function synthTick(ctx: AudioContext, t: number) {
  tone(ctx, 'square', 1800, t, 0.03, 0.12, 900)
}

/** Rising two-note chime. */
function synthChime(ctx: AudioContext, t: number) {
  tone(ctx, 'sine', 660, t, 0.12, 0.18)
  tone(ctx, 'sine', 990, t + 0.09, 0.22, 0.18)
}

/** Low thud: a sine sweep down with a quick decay. */
function synthThud(ctx: AudioContext, t: number) {
  tone(ctx, 'sine', 140, t, 0.32, 0.35, 45)
}
