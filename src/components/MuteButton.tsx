interface Props {
  muted: boolean
  onToggle: () => void
  className?: string
}

/** Sound + haptics toggle. Off by default (spec §15); the state persists. */
export function MuteButton({ muted, onToggle, className = '' }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={!muted}
      aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
      data-testid="mute"
      className={
        'flex h-11 w-11 items-center justify-center rounded-full border border-white/15 text-lg text-white/70 active:scale-95 ' +
        className
      }
    >
      <span aria-hidden>{muted ? '🔇' : '🔊'}</span>
    </button>
  )
}
