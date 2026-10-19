const teamKey = 'bibleguessr.team'

export type StoredTeam = {
  id: string
  teammate1: string
  teammate2: string
  color: string
}

export function readTeam(): StoredTeam | null {
  const raw = localStorage.getItem(teamKey)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredTeam
    if (!parsed.id || !parsed.teammate1 || !parsed.teammate2) return null
    return parsed
  } catch {
    return null
  }
}

export function writeTeam(team: StoredTeam): void {
  localStorage.setItem(teamKey, JSON.stringify(team))
}

export function clearTeam(): void {
  localStorage.removeItem(teamKey)
}
