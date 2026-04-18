import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuthActions } from '@convex-dev/auth/react'

export const Route = createFileRoute('/signin')({ component: SignInPage })

type Mode = 'signIn' | 'signUp'

function SignInPage() {
  const { signIn } = useAuthActions()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('signIn')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleEmail = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const data = new FormData(e.currentTarget)
    data.set('flow', mode)
    try {
      await signIn('password', data)
      await navigate({ to: '/' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setSubmitting(false)
    }
  }

  const handleAnonymous = async () => {
    setError(null)
    setSubmitting(true)
    try {
      await signIn('anonymous')
      await navigate({ to: '/' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Guest sign-in failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 relative">
      <div className="pointer-events-none fixed inset-0 z-0 opacity-60"
        style={{
          background:
            'radial-gradient(600px 400px at 50% 30%, rgba(214,0,23,0.14), transparent 60%)',
        }}
      />
      <div className="w-full max-w-sm space-y-10 relative z-10">
        <header className="text-center space-y-3">
          <p className="kicker">visual learning</p>
          <h1 className="display-title text-7xl text-bone glitch-hover cursor-default">
            FIREFLY
          </h1>
          <p className="text-ash text-xs font-mono tracking-wide">
            your questions, lit up inside.
          </p>
        </header>

        <form onSubmit={handleEmail} className="space-y-3">
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="email"
            className="input-bmth"
          />
          <input
            name="password"
            type="password"
            required
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
            placeholder="password"
            minLength={8}
            className="input-bmth"
          />
          <button type="submit" disabled={submitting} className="btn-crimson w-full">
            {submitting ? '...' : mode === 'signIn' ? 'sign in' : 'create account'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}
          className="w-full text-[11px] uppercase tracking-[0.2em] text-ash hover:text-bone transition font-mono"
        >
          {mode === 'signIn' ? 'new here / create an account' : 'have one / sign in'}
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/5" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-void px-3 text-[10px] uppercase tracking-[0.28em] text-smoke font-mono">
              or
            </span>
          </div>
        </div>

        <button type="button" onClick={handleAnonymous} disabled={submitting} className="btn-ghost w-full">
          continue as guest · 1 free question
        </button>

        {error && (
          <p role="alert" className="text-xs text-ember text-center font-mono tracking-wide">
            {error}
          </p>
        )}

        <p className="text-center text-[10px] font-mono text-smoke tracking-[0.18em] uppercase">
          est. on a sunday
        </p>
      </div>
    </div>
  )
}
