export type PortalRole = 'employee' | 'manager'

export type AccountUser = {
  id: number
  email: string
  display_name: string
  role: PortalRole
  job_title: string
  department: string
  team: string
  manager_name: string | null
  manager_email: string | null
}

export type AuthSession = {
  access_token: string
  user: AccountUser
}
