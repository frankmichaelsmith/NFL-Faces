import { useEffect, useLayoutEffect } from 'react'
import type { Bundle } from '../game/bundle'
import { hueFor, initials } from '../game/people'
import type { Round, Slot } from '../game/select'
import type { GameState } from '../state/machine'

interface Props {
  bundle: Bundle
  round: Round
  state: GameState
  onTap: (slot: Slot) => void
  /** Called once the cards are painted; starts the timer. */
  onPainted: () => void
  imageBaseUrl: string
}

type Look = 'neutral' | 'correct' | 'wrong'

function lookFor(state: GameState, slot: Slot): Look {
  if (state.phase !== 'correct' && state.phase !== 'gameover') return 'neutral'
  if (slot === state.round?.answerSlot) return 'correct'
  if (slot === state.tappedSlot) return 'wrong'
  return 'neutral'
}

export function FaceCards({ bundle, round, state, onTap, onPainted, imageBaseUrl }: Props) {
  // Two frames after mount the cards are on screen; that is when the 5 s starts.
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

  // Ignore any pointer event that isn't a first tap during AWAITING.
  const active = state.phase === 'awaiting' && state.revealAt !== null
  useEffect(() => {
    if (!active) return
    const block = (e: TouchEvent) => e.preventDefault()
    document.addEventListener('touchmove', block, { passive: false })
    return () => document.removeEventListener('touchmove', block)
  }, [active])

  const revealName = state.phase === 'gameover'
  return (
    <div className="grid grid-cols-3 gap-3" data-testid="faces" data-round={state.roundIndex}>
      {round.faces.map((id, i) => {
        const slot = i as Slot
        const person = bundle.people[id]!
        const look = lookFor(state, slot)
        const isAnswer = slot === round.answerSlot
        return (
          <button
            key={`${state.roundIndex}-${slot}`}
            type="button"
            data-testid={`face-${slot}`}
            data-look={look}
            aria-label={`Face ${slot + 1}`}
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
            <div className="relative aspect-square w-full overflow-hidden">
              {person.photo ? (
                <img
                  src={imageBaseUrl + person.photo}
                  alt=""
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center text-4xl font-black text-white/80"
                  style={{ background: `hsl(${hueFor(id)} 35% 30%)` }}
                >
                  {initials(person.name)}
                </div>
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
              {revealName && isAnswer ? <span data-testid="answer-name">{person.name}</span> : null}
            </div>
          </button>
        )
      })}
    </div>
  )
}
