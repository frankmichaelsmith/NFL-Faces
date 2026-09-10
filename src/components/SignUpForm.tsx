import { useState, type FormEvent } from 'react'

interface Props {
  /** Resolves to an error message, or null on success. */
  onSubmit: (email: string, name: string) => Promise<string | null>
  title?: string
}

/** Email + display name gate (decision 0008). Shown once per device, after the first streak ends. */
export function SignUpForm({ onSubmit, title = 'Add your email to keep playing' }: Props) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const message = await onSubmit(email, name)
    setBusy(false)
    if (message) setError(message)
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 text-left" data-testid="signup">
      <p className="text-center text-base font-bold text-white">{title}</p>
      <p className="text-center text-xs text-white/60">
        Your streaks join today&apos;s leaderboard automatically. Play as many times as you like.
      </p>
      <label className="flex flex-col gap-1 text-xs uppercase tracking-widest text-white/50">
        Email
        <input
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="signup-email"
          className="min-h-[48px] rounded-xl border border-white/20 bg-black/30 px-3 text-base normal-case tracking-normal text-white outline-none focus:border-accent"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs uppercase tracking-widest text-white/50">
        Name on the board
        <input
          type="text"
          name="name"
          autoComplete="nickname"
          required
          minLength={2}
          maxLength={20}
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="signup-name"
          className="min-h-[48px] rounded-xl border border-white/20 bg-black/30 px-3 text-base normal-case tracking-normal text-white outline-none focus:border-accent"
        />
      </label>
      {error && (
        <p role="alert" data-testid="signup-error" className="text-sm text-miss">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        data-testid="signup-submit"
        className="min-h-[52px] rounded-2xl bg-accent px-4 text-lg font-black text-ink active:scale-95 disabled:opacity-60"
      >
        {busy ? 'Joining…' : 'Join the leaderboard'}
      </button>
      <p className="text-center text-[11px] leading-snug text-white/40">
        We use your email only for the leaderboard and news about Spin Streak. No spam, no
        sharing.
      </p>
    </form>
  )
}
