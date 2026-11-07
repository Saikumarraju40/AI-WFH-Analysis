import { useState, type FormEvent } from 'react'
import { ArrowRight, BriefcaseBusiness, KeyRound, ShieldCheck, UserRound } from 'lucide-react'
import type { AuthSession, PortalRole } from './authTypes'

type AuthScreenProps = { onLogin: (session: AuthSession) => void }

export default function AuthScreen({ onLogin }: AuthScreenProps) {
  const [role, setRole] = useState<PortalRole>('employee')
  const [bootstrap, setBootstrap] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    const payload: Record<string, string> = {
      email: String(form.get('email')),
      password: String(form.get('password')),
    }
    if (bootstrap) {
      payload.display_name = String(form.get('display_name'))
      payload.bootstrap_key = String(form.get('bootstrap_key'))
    }
    try {
      const response = await fetch(bootstrap ? '/api/auth/bootstrap-manager' : '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok) {
        if (response.status >= 500) {
          throw new Error('The login API is unavailable. Start FastAPI and ensure PostgreSQL is running, then try again.')
        }
        const detail = typeof result?.detail === 'string' ? result.detail : ''
        throw new Error(detail || `Could not sign in (HTTP ${response.status}).`)
      }
      if (!result?.user || !result?.access_token) {
        throw new Error('The login service returned an empty response. Check that the API and PostgreSQL are running.')
      }
      if (result.user.role !== role) throw new Error('This account belongs to the other portal. Choose its matching login.')
      onLogin({ access_token: result.access_token, user: result.user })
    } catch (issue) {
      const message = issue instanceof Error ? issue.message : ''
      setError(message === 'Failed to fetch' || message.includes('NetworkError')
        ? 'Cannot reach the login API. Start the API and PostgreSQL, then try again.'
        : message || 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-brand"><span className="brand-mark">W</span><span>workplace<span className="brand-dot">.</span></span></div>
      <section className="auth-layout">
        <div className="auth-intro">
          <span className="eyebrow">WORK-FROM-HOME REQUESTS</span>
          <h1>Good work starts with a clear plan.</h1>
          <p>Submit requests, review policy usage, and keep every decision with the people responsible for it.</p>
          <div className="auth-promise"><ShieldCheck size={17} /><span>Private employee and manager workspaces</span></div>
        </div>
        <div className="auth-form-panel">
          <div className="portal-switch" role="tablist" aria-label="Choose portal">
            <button type="button" className={role === 'employee' ? 'selected' : ''} onClick={() => { setRole('employee'); setBootstrap(false); setError('') }}><UserRound size={15} />Employee</button>
            <button type="button" className={role === 'manager' ? 'selected' : ''} onClick={() => { setRole('manager'); setError('') }}><BriefcaseBusiness size={15} />Manager</button>
          </div>
          <div className="auth-heading"><span className="eyebrow">{bootstrap ? 'INITIAL SETUP' : `${role.toUpperCase()} PORTAL`}</span><h2>{bootstrap ? 'Create manager account' : `Sign in as ${role}`}</h2><p>{bootstrap ? 'Use the one-time setup key configured by your administrator.' : 'Enter your work email and password to continue.'}</p></div>
          <form className="auth-form" onSubmit={submit}>
            {bootstrap && <label>Full name<input name="display_name" autoComplete="name" required maxLength={120} /></label>}
            {bootstrap && <label>Job title<input name="job_title" placeholder="People Manager" maxLength={120} /></label>}
            {bootstrap && <label>Department<input name="department" maxLength={120} /></label>}
            {bootstrap && <label>Team<input name="team" maxLength={120} /></label>}
            <label>Work email<input type="email" name="email" autoComplete="username" required maxLength={254} /></label>
            <label>Password<input type="password" name="password" autoComplete={bootstrap ? 'new-password' : 'current-password'} required minLength={bootstrap ? 12 : 1} maxLength={256} /></label>
            {bootstrap && <label>One-time setup key<input type="password" name="bootstrap_key" autoComplete="off" required /></label>}
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Please wait…' : bootstrap ? 'Create manager account' : 'Sign in'}<ArrowRight size={16} /></button>
          </form>
          {role === 'manager' && <button className="auth-mode" onClick={() => { setBootstrap((current) => !current); setError('') }}><KeyRound size={14} />{bootstrap ? 'Back to manager sign in' : 'First-time manager setup'}</button>}
        </div>
      </section>
      <footer className="auth-footer">AI findings are advisory. People make all request decisions.</footer>
    </main>
  )
}
