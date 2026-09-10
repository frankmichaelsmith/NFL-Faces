import { useLayoutEffect, useState } from 'react'
import { poolOf, type Bundle, type PoolKey, type ProBowlCategory } from '../game/bundle'
import { describeValue, type ProBowlRound } from '../game/probowl'
import type { Slot } from '../game/select'
import type { GameState } from '../state/machine'

interface Props {
  bundle: Bundle
  round: ProBowlRound
  state: GameState
  onTap: (slot: Slot) => void
  onPainted: () => void
  assetBaseUrl: string
  poolKey?: PoolKey
}

type Look = 'neutral' | 'correct' | 'wrong'

function lookFor(state: GameState, slot: Slot): Look {
  if (state.phase !== 'correct' && state.phase !== 'gameover') return 'neutral'
  if (slot === state.round?.answerSlot) return 'correct'
  if (slot === state.tappedSlot) return 'wrong'
  return 'neutral'
}

/** Image file for a value, or null when the category is rendered as text. */
export function optionImage(category: ProBowlCategory, value: string, base: string): string | null {
  if (category === 'alma') return `${base}colleges/${value}.png`
  if (category === 'draft') return `${base}tiles/${value}.png`
  if (category === 'country') return `${base}flags/${value}.png`
  return null
}

/**
 * Pro Bowl Mode cards: a college logo, a draft-team tile, a big number, or a
 * position. Names of values appear only after a tap (the tapped card, and the
 * answer after a miss), mirroring the face cards.
 */
export function OptionCards({
  bundle,
  round,
  state,
  onTap,
  onPainted,
  assetBaseUrl,
  poolKey = 'probowl',
}: Props) {
  useLayoutEffect(() => {
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(onPainted)
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.roundIndex])

  const active = state.phase === 'awaiting' && state.revealAt !== null
  const settled = state.phase === 'correct' || state.phase === 'gameover'
  const [broken, setBroken] = useState<Record<string, true>>({})
  const section = poolOf(bundle, poolKey)!
  const category = round.combo.category

  return (
    <div className="grid grid-cols-3 gap-3" data-testid="faces" data-round={state.roundIndex}>
      {round.options.map((value, i) => {
        const slot = i as Slot
        const look = lookFor(state, slot)
        const isAnswer = slot === round.answerSlot
        const img = broken[value] ? null : optionImage(category, value, assetBaseUrl)
        const label = describeValue(section, category, value)
        // A caption only helps when the card is a picture; "#80" under "80" is noise (Frank, 2026-09-09).
        const captioned = category === 'alma' || category === 'draft' || category === 'country'
        const showName =
          captioned &&
          settled &&
          (slot === state.tappedSlot || (state.phase === 'gameover' && isAnswer))
        return (
          <button
            key={`${state.roundIndex}-${slot}`}
            type="button"
            data-testid={`face-${slot}`}
            data-look={look}
            data-value={value}
            aria-label={`Option ${slot + 1}`}
            disabled={!active}
            onPointerDown={(e) => {
              e.preventDefault()
              if (active) onTap(slot)
            }}
            className={
              'group relative flex min-h-[44px] flex-col items-stretch overflow-hidden rounded-xl border-4 bg-card text-left transition-colors ' +
              (look === 'correct'
                ? 'card-correct border-accent'
                : look === 'wrong'
                  ? 'card-wrong border-miss'
                  : 'border-white/10 active:border-white/40')
            }
          >
            <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden p-2">
              {img ? (
                <img
                  src={img}
                  alt=""
                  draggable={false}
                  onError={() => setBroken((b) => ({ ...b, [value]: true }))}
                  className="h-full w-full object-contain"
                />
              ) : category === 'number' ? (
                <span className="font-display text-6xl font-black text-white">{value}</span>
              ) : (
                <span className="font-display text-center text-3xl font-black uppercase leading-tight text-white">
                  {label}
                </span>
              )}
              {look !== 'neutral' && (
                <div
                  className={
                    'absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full text-lg font-black text-ink ' +
                    (look === 'correct' ? 'bg-accent' : 'bg-miss')
                  }
                  aria-hidden
                >
                  {look === 'correct' ? '✓' : '✕'}
                </div>
              )}
            </div>
            <div className="h-9 px-1 py-1 text-center text-xs font-semibold leading-tight">
              {showName ? (
                <span data-testid={isAnswer ? 'answer-name' : 'tapped-name'}>{label}</span>
              ) : null}
            </div>
          </button>
        )
      })}
    </div>
  )
}
