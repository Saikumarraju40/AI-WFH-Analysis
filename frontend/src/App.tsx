import { useEffect, useState } from 'react'
import { CalendarDays, Check, ChevronDown, CircleAlert, ClipboardList, Clock3, FilePlus2, Gauge, LoaderCircle, Search, ShieldCheck, Sparkles, UserRound, X } from 'lucide-react'
import AuthScreen from './AuthScreen'
import type { AccountUser, AuthSession } from './authTypes'

type Usage = { month: string; previously_approved_days: number; requested_days: number; projected_total: number; limit: number; exceeds_limit: boolean }
type Review = { monthly_usage: Usage[]; reason_summary: string; policy_finding: { exceeds_limit: boolean; reference: string; finding: string }; ai_flag: string; explanation: string; suggested_next_action: string; automatic_decision: { rejected: boolean; code: string | null; message: string } }
type Request = { id: number; employee_id: string; employee_email: string; requested_dates: string[]; reason: string; status: string; lead_recommendation: string | null; manager_decision: string | null; review: Review; created_at: string }

const flagLabel: Record<string, string> = {
  STANDARD_REVIEW: 'Standard review',
  ADDITIONAL_CONSIDERATION: 'Additional consideration',
  CLARIFICATION_REQUIRED: 'Clarification needed',
  INVALID_REASON: 'Invalid work-from-home reason',
}

function App() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [requests, setRequests] = useState<Request[]>([])
  const [employees, setEmployees] = useState<AccountUser[]>([])
  const [monthlyLimit, setMonthlyLimit] = useState(5)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [view, setView] = useState<'queue' | 'submit' | 'accounts' | 'directory' | 'profile'>('queue')
  const [loading, setLoading] = useState(true)
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [accountCreated, setAccountCreated] = useState('')
  const selected = requests.find((request) => request.id === selectedId) ?? requests[0]

  useEffect(() => {
    const stored = localStorage.getItem('wfh-session')
    if (!stored) {
      setAuthReady(true)
      return
    }
    try {
      const saved: AuthSession = JSON.parse(stored)
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${saved.access_token}` } })
        .then(async (response) => {
          if (!response.ok) throw new Error('Session expired')
          const user = await response.json()
          const validSession = { ...saved, user }
          setSession(validSession)
          localStorage.setItem('wfh-session', JSON.stringify(validSession))
        })
        .catch(() => localStorage.removeItem('wfh-session'))
        .finally(() => setAuthReady(true))
    } catch {
      localStorage.removeItem('wfh-session')
      setAuthReady(true)
    }
  }, [])

  async function refresh(token = session?.access_token) {
    if (!token) return
    try {
      const headers = { Authorization: `Bearer ${token}` }
      const response = await fetch('/api/requests', { headers })
      if (!response.ok) throw new Error('The request service is unavailable.')
      const data: Request[] = await response.json()
      setRequests(data)
      const policyResponse = await fetch('/api/policy', { headers })
      if (policyResponse.ok) setMonthlyLimit((await policyResponse.json()).monthly_wfh_limit)
      setSelectedId((current) => current && data.some((item) => item.id === current) ? current : data[0]?.id ?? null)
      setError('')
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not load requests.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (session) void refresh(session.access_token) }, [session?.access_token])

  useEffect(() => {
    if (view !== 'directory' || session?.user.role !== 'manager') return
    setDirectoryLoading(true)
    fetch('/api/auth/users', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail ?? 'Could not load employee details.')
        setEmployees(result)
      })
      .catch((issue) => setError(issue instanceof Error ? issue.message : 'Could not load employee details.'))
      .finally(() => setDirectoryLoading(false))
  }, [view, session?.access_token, session?.user.role])

  function signIn(nextSession: AuthSession) {
    localStorage.setItem('wfh-session', JSON.stringify(nextSession))
    setSession(nextSession)
    setView('queue')
  }

  function signOut() {
    localStorage.removeItem('wfh-session')
    setSession(null)
    setRequests([])
    setSelectedId(null)
    setView('queue')
  }

  async function submitRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          requested_dates: String(form.get('requested_dates')).split(',').map((day) => day.trim()).filter(Boolean),
          reason: form.get('reason'),
        }),
      })
      if (!response.ok) throw new Error((await response.json()).detail ?? 'Request could not be submitted.')
      const created: Request = await response.json()
      await refresh()
      setSelectedId(created.id)
      setView('queue')
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Request could not be submitted.')
    } finally {
      setBusy(false)
    }
  }

  async function decision(kind: 'lead' | 'manager', value: string) {
    if (!selected) return
    setBusy(true)
    try {
      const payload = kind === 'lead' ? { recommendation: value } : { decision: value }
      const response = await fetch(`/api/requests/${selected.id}/${kind}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error((await response.json()).detail ?? 'Could not save decision.')
      await refresh()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not save decision.')
    } finally {
      setBusy(false)
    }
  }

  async function createEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setBusy(true)
    setAccountCreated('')
    setError('')
    try {
      const response = await fetch('/api/auth/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          email: form.get('email'),
          display_name: form.get('display_name'),
          job_title: form.get('job_title'),
          department: form.get('department'),
          team: form.get('team'),
          password: form.get('password'),
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail ?? 'Could not create employee account.')
      setAccountCreated(`Employee account created for ${result.display_name}.`)
      formElement.reset()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not create employee account.')
    } finally {
      setBusy(false)
    }
  }

  const pendingCount = requests.filter((request) => !request.manager_decision && request.status !== 'auto_rejected').length
  const exceedCount = requests.filter((request) => request.review?.policy_finding.exceeds_limit).length

  if (!authReady) return <div className="auth-loading"><LoaderCircle className="spin" size={20} />Checking your session</div>
  if (!session) return <AuthScreen onLogin={signIn} />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="Workplace home"><span className="brand-mark">W</span><span>workplace<span className="brand-dot">.</span></span></a>
        <div className="workspace-label">PEOPLE OPERATIONS</div>
        <nav className="nav-list" aria-label="Main navigation">
          <button className={`nav-item ${view === 'queue' ? 'active' : ''}`} onClick={() => setView('queue')}><ClipboardList size={17} />{session.user.role === 'manager' ? 'Review queue' : 'My requests'}<span className="nav-count">{pendingCount}</span></button>
          {session.user.role === 'employee' ? <button className={`nav-item ${view === 'submit' ? 'active' : ''}`} onClick={() => setView('submit')}><FilePlus2 size={17} />New request</button> : <button className={`nav-item ${view === 'accounts' ? 'active' : ''}`} onClick={() => setView('accounts')}><UserRound size={17} />Employee access</button>}
          {session.user.role === 'manager' && <button className={`nav-item ${view === 'directory' ? 'active' : ''}`} onClick={() => setView('directory')}><ClipboardList size={17} />Employee directory</button>}
          <button className={`nav-item ${view === 'profile' ? 'active' : ''}`} onClick={() => setView('profile')}><UserRound size={17} />My details</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="limit-card"><div className="limit-icon"><Gauge size={16} /></div><div><span>Monthly guideline</span><strong>{monthlyLimit} WFH days</strong></div><ChevronDown size={14} /></div>
          <div className="profile"><div className="avatar">{session.user.display_name.slice(0, 2).toUpperCase()}</div><div><strong>{session.user.display_name}</strong><span>{session.user.role} portal</span></div><button className="signout-button" onClick={signOut}>Sign out</button></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div className="breadcrumb">People <span>/</span> Work-from-home</div><div className="topbar-actions"><span className="today-label">{session.user.role === 'manager' ? 'Manager portal' : 'Employee portal'}</span><button className="avatar small" aria-label="Signed in account">{session.user.display_name.slice(0, 2).toUpperCase()}</button></div></header>
        {view === 'profile' ? (
          <section className="content profile-view">
            <div className="page-heading"><div><div className="eyebrow">ACCOUNT / PROFILE</div><h1>My details</h1><p>Your workplace profile and account information.</p></div></div>
            <div className="profile-sheet">
              <div className="profile-identity"><div className="profile-large-avatar">{session.user.display_name.slice(0, 2).toUpperCase()}</div><div><h2>{session.user.display_name}</h2><span>{session.user.job_title || (session.user.role === 'manager' ? 'Manager' : 'Employee')}</span></div><span className="role-chip">{session.user.role}</span></div>
              <div className="profile-data-grid">
                <ProfileField label="Work email" value={session.user.email} />
                <ProfileField label="Department" value={session.user.department || 'Not set'} />
                <ProfileField label="Team" value={session.user.team || 'Not set'} />
                <ProfileField label="Job title" value={session.user.job_title || 'Not set'} />
              </div>
              {session.user.role === 'employee' && <div className="manager-contact"><div className="section-title">REPORTING MANAGER</div>{session.user.manager_name ? <><strong>{session.user.manager_name}</strong><a href={`mailto:${session.user.manager_email}`}>{session.user.manager_email}</a></> : <span>Manager details are not assigned.</span>}</div>}
              {session.user.role === 'manager' && <div className="manager-contact"><div className="section-title">MANAGER ACCESS</div><strong>People manager</strong><span>You can review employee requests and manage employee accounts.</span></div>}
            </div>
          </section>
        ) : view === 'directory' && session.user.role === 'manager' ? (
          <section className="content directory-view">
            <div className="page-heading"><div><div className="eyebrow">MANAGER / PEOPLE</div><h1>Employee directory</h1><p>Work profiles and assigned manager details for your employees.</p></div><button className="primary-button" onClick={() => setView('accounts')}><UserRound size={16} />Add employee</button></div>
            {error && <div className="error-message global-error"><CircleAlert size={16} />{error}</div>}
            <div className="directory-panel"><div className="directory-header"><div><h2>Employees</h2><span>{employees.length} account{employees.length === 1 ? '' : 's'}</span></div></div>
              {directoryLoading ? <div className="empty-state"><LoaderCircle className="spin" size={20} />Loading employee details</div> : employees.length === 0 ? <div className="empty-state"><UserRound size={22} /><span>No employee accounts yet</span></div> : <div className="directory-table-wrap"><table className="directory-table"><thead><tr><th>Employee</th><th>Work details</th><th>Department / team</th><th>Manager</th></tr></thead><tbody>{employees.map((employee) => <tr key={employee.id}><td><strong>{employee.display_name}</strong><a href={`mailto:${employee.email}`}>{employee.email}</a></td><td>{employee.job_title || 'Not set'}</td><td>{[employee.department, employee.team].filter(Boolean).join(' · ') || 'Not set'}</td><td>{employee.manager_name ? <><strong>{employee.manager_name}</strong><a href={`mailto:${employee.manager_email}`}>{employee.manager_email}</a></> : 'Not assigned'}</td></tr>)}</tbody></table></div>}
            </div>
          </section>
        ) : view === 'accounts' && session.user.role === 'manager' ? (
          <section className="content submit-view">
            <div className="page-heading"><div><div className="eyebrow">MANAGER / ACCESS</div><h1>Create employee access</h1><p>Set up an employee account for the separate request portal.</p></div></div>
            <form className="request-form" onSubmit={createEmployee}>
              <label>Employee name<input name="display_name" autoComplete="name" required maxLength={120} /></label>
              <label>Work email<input type="email" name="email" autoComplete="email" required maxLength={254} /></label>
              <label>Job title<input name="job_title" placeholder="e.g. Analyst" maxLength={120} /></label>
              <label>Department<input name="department" placeholder="e.g. Operations" maxLength={120} /></label>
              <label>Team<input name="team" placeholder="e.g. Customer Support" maxLength={120} /></label>
              <label>Temporary password<input type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={256} /><span className="field-note">At least 12 characters. Share it securely with the employee.</span></label>
              {error && <div className="error-message"><CircleAlert size={16} />{error}</div>}
              {accountCreated && <div className="success-message"><ShieldCheck size={16} />{accountCreated}</div>}
              <div className="form-footer"><span>Only managers can create employee accounts.</span><button className="primary-button" disabled={busy}><UserRound size={16} />Create account</button></div>
            </form>
          </section>
        ) : view === 'submit' && session.user.role === 'employee' ? (
          <section className="content submit-view">
            <div className="page-heading"><div><div className="eyebrow">EMPLOYEE PORTAL</div><h1>Request work from home</h1><p>Share the dates and a brief work-related reason for your request.</p></div><button className="icon-button" onClick={() => setView('queue')} aria-label="Close request form"><X size={18} /></button></div>
            <form className="request-form" onSubmit={submitRequest}>
              <label>Requested dates <span className="field-note">Use YYYY-MM-DD, separate multiple dates with commas</span><input name="requested_dates" placeholder="2026-11-12, 2026-11-13" required /></label>
              <label>Reason<textarea name="reason" placeholder="Briefly describe the work-related reason for your request." required minLength={3} maxLength={2000} rows={5} /><span className="privacy-note"><ShieldCheck size={14} />Do not include diagnoses or sensitive medical details.</span></label>
              {error && <div className="error-message"><CircleAlert size={16} />{error}</div>}
              <div className="form-footer"><span>Requests are assessed by a person before a final decision.</span><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <FilePlus2 size={16} />}Submit request</button></div>
            </form>
          </section>
        ) : (
          <section className="content">
            <div className="page-heading"><div><div className="eyebrow">{session.user.role === 'manager' ? 'MANAGER / INBOX' : 'EMPLOYEE / REQUESTS'}</div><h1>{session.user.role === 'manager' ? 'WFH review queue' : 'My WFH requests'}</h1><p>{session.user.role === 'manager' ? 'Automated checks screen requests; managers decide eligible cases.' : 'Track requests, automated checks, and manager outcomes.'}</p></div>{session.user.role === 'employee' && <button className="primary-button" onClick={() => setView('submit')}><FilePlus2 size={16} />New request</button>}</div>
            {error && <div className="error-message global-error"><CircleAlert size={16} />{error}</div>}
            <div className="metric-row">
              <div className="metric"><div className="metric-icon olive"><ClipboardList size={17} /></div><div><span>{session.user.role === 'manager' ? 'Open requests' : 'In progress'}</span><strong>{pendingCount.toString().padStart(2, '0')}</strong></div><span className="metric-foot">{session.user.role === 'manager' ? 'awaiting final decision' : 'awaiting a final decision'}</span></div>
              {session.user.role === 'manager' ? <><div className="metric"><div className="metric-icon amber"><CircleAlert size={17} /></div><div><span>Policy-limit hits</span><strong>{exceedCount.toString().padStart(2, '0')}</strong></div><span className="metric-foot">automatically rejected by policy check</span></div><div className="metric"><div className="metric-icon green"><ShieldCheck size={17} /></div><div><span>Manager reviews</span><strong>{pendingCount.toString().padStart(2, '0')}</strong></div><span className="metric-foot">final decisions remain human</span></div></> : <div className="metric employee-metric"><div className="metric-icon green"><ShieldCheck size={17} /></div><div><span>Review path</span><strong>Screened</strong></div><span className="metric-foot">eligible requests go to a manager</span></div>}
            </div>
            <div className="review-layout">
              <section className="queue-panel">
                <div className="panel-header"><div><h2>{session.user.role === 'manager' ? 'Review queue' : 'Your requests'}</h2><span>{requests.length} total submissions</span></div><button className="icon-button" aria-label="Search requests"><Search size={17} /></button></div>
                {loading ? <div className="empty-state"><LoaderCircle className="spin" size={20} />Loading requests</div> : requests.length === 0 ? <div className="empty-state"><ClipboardList size={22} /><span>No requests yet</span></div> : <div className="request-list">{requests.map((request) => <button key={request.id} className={`request-row ${selected?.id === request.id ? 'selected' : ''}`} onClick={() => setSelectedId(request.id)}><div className="row-avatar">{request.employee_id.slice(0, 2).toUpperCase()}</div><div className="row-main"><strong>{request.employee_id}</strong><span>{request.requested_dates.length} day{request.requested_dates.length === 1 ? '' : 's'} · {new Date(request.created_at).toLocaleDateString()} · {request.status.replaceAll('_', ' ')}</span></div><span className={`status-dot ${request.status === 'auto_rejected' || request.manager_decision ? 'done' : request.lead_recommendation ? 'lead' : ''}`} title={request.status} /></button>)}</div>}
              </section>
              {selected ? <RequestDetail request={selected} busy={busy} canManage={session.user.role === 'manager'} onLead={(value) => void decision('lead', value)} onManager={(value) => void decision('manager', value)} /> : <section className="detail-panel no-selection"><div><ClipboardList size={28} /><h2>{session.user.role === 'manager' ? 'Select a request' : 'No requests yet'}</h2><p>Assessment details and request history will appear here.</p></div></section>}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return <div className="profile-data-item"><span>{label}</span><strong>{value}</strong></div>
}

function RequestDetail({ request, busy, canManage, onLead, onManager }: { request: Request; busy: boolean; canManage: boolean; onLead: (value: string) => void; onManager: (value: string) => void }) {
  const review = request.review
  return <section className="detail-panel">
    <div className="detail-heading"><div><div className="eyebrow">REQUEST #{String(request.id).padStart(4, '0')}</div><h2>{request.employee_id}</h2><span className="submitted"><Clock3 size={13} />Submitted {new Date(request.created_at).toLocaleString()}</span></div><span className={`decision-state ${request.manager_decision || request.status === 'auto_rejected' ? 'complete' : ''}`}>{request.status === 'auto_rejected' ? 'Auto-rejected' : request.manager_decision ?? 'In review'}</span></div>
    <div className="date-strip"><CalendarDays size={16} /><div>{request.requested_dates.map((day) => <span key={day}>{new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>)}</div></div>
    <div className="detail-section"><div className="section-title">MONTHLY USAGE <span>Calendar month</span></div><div className="usage-table"><div className="usage-header"><span>Month</span><span>Previously approved</span><span>Requested</span><span>Projected</span></div>{review.monthly_usage.map((usage) => <div className="usage-row" key={usage.month}><strong>{new Date(`${usage.month}-02`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</strong><span>{usage.previously_approved_days}</span><span>{usage.requested_days}</span><strong className={usage.exceeds_limit ? 'over-limit' : ''}>{usage.projected_total}<small> / {usage.limit}</small></strong></div>)}</div></div>
    <div className="detail-section reason-section"><div className="section-title">EMPLOYEE REASON</div><blockquote>{request.reason}</blockquote></div>
    <div className="assessment-block"><div className="assessment-top"><div className="ai-mark"><Sparkles size={15} /></div><div><div className="section-title">AI ASSESSMENT <span>Advisory only</span></div><strong className="flag-label">{flagLabel[review.ai_flag] ?? review.ai_flag}</strong></div></div><p>{review.reason_summary}</p><p className="assessment-explanation">{review.explanation}</p><div className="suggested-action">Suggested next action: <strong>{review.suggested_next_action}</strong></div></div>
    <div className={`policy-note ${review.policy_finding.exceeds_limit ? 'policy-over' : ''}`}><div className="policy-icon">{review.policy_finding.exceeds_limit ? <CircleAlert size={16} /> : <Check size={16} />}</div><div><strong>{review.policy_finding.finding}</strong><p>{review.policy_finding.reference}</p></div></div>
    {review.automatic_decision?.rejected && <div className="auto-decision-note"><div className="policy-icon"><CircleAlert size={16} /></div><div><strong>Automatically rejected</strong><p>{review.automatic_decision.message}</p><span>Reason flag: {flagLabel[review.ai_flag] ?? review.ai_flag}</span></div></div>}
    <div className={`decision-controls ${canManage && request.status !== 'auto_rejected' ? '' : 'employee-hidden'}`}><div className="section-title">MANAGER REVIEW <span>For requests that pass automatic checks</span></div>{request.manager_decision ? <div className="final-result"><Check size={16} />Manager decision: <strong>{request.manager_decision}</strong></div> : <><div className="button-row"><button className="secondary-button" disabled={busy} onClick={() => onLead('request_clarification')}>Ask for clarification</button><button className="secondary-button" disabled={busy} onClick={() => onLead('consider_exception')}>Consider exception</button><button className="primary-button" disabled={busy} onClick={() => onLead('recommend_approval')}>Recommend approval</button></div>{request.lead_recommendation && <div className="manager-row"><span>Lead recommendation: <strong>{request.lead_recommendation.replaceAll('_', ' ')}</strong></span><div className="button-row"><button className="secondary-button danger" disabled={busy} onClick={() => onManager('rejected')}>Reject</button><button className="primary-button" disabled={busy} onClick={() => onManager('approved')}>Approve</button></div></div>}</>}</div>
    {!request.manager_decision && request.status !== 'auto_rejected' && canManage && <div className="lead-rejection-action"><button className="secondary-button danger" disabled={busy} onClick={() => onLead('recommend_rejection')}>Recommend rejection</button></div>}
  </section>
}

export default App
