import { isPerfectScore } from './scoring.ts'
import type { HostState } from './types.ts'

export type Severity = 'low' | 'medium' | 'high'

export type Signal = {
  id: string
  teamId: string
  roundNumber: number
  severity: Severity
  title: string
  detail: string
  guessId?: string
}

const QUICK_LOCK_MS = 6000
const LONG_AWAY_MS = 10_000

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`
}

// Soft hints that something is off. None of these prove anything, so the host decides.
export function integritySignals(state: HostState): Signal[] {
  const signals: Signal[] = []

  for (const flag of state.flags) {
    if (flag.awayCount < 1) continue
    const severity: Severity = flag.awayMs >= LONG_AWAY_MS * 3 || flag.awayCount >= 3 ? 'high' : flag.awayMs >= LONG_AWAY_MS || flag.awayCount >= 2 ? 'medium' : 'low'
    signals.push({
      id: `away:${flag.teamId}:${flag.roundNumber}`,
      teamId: flag.teamId,
      roundNumber: flag.roundNumber,
      severity,
      title: 'Left the page',
      detail: `Left the page ${flag.awayCount}× for ${seconds(flag.awayMs)} before locking in`,
    })
  }

  const startedAt = state.roundStartedAt ? new Date(state.roundStartedAt).getTime() : null
  if (startedAt !== null) {
    for (const guess of state.guesses) {
      if (guess.roundNumber !== state.currentRound) continue
      const elapsed = new Date(guess.createdAt).getTime() - startedAt
      if (elapsed >= 0 && elapsed < QUICK_LOCK_MS) {
        signals.push({
          id: `quick:${guess.id}`,
          teamId: guess.teamId,
          roundNumber: guess.roundNumber,
          severity: 'low',
          title: 'Very fast lock-in',
          detail: `Locked in ${seconds(elapsed)} after the round began`,
          guessId: guess.id,
        })
      }
    }
  }

  const exactByTeam = new Map<string, number>()
  for (const guess of state.guesses) {
    if (isPerfectScore(guess.bookScore, guess.chapterScore, guess.verseScore)) exactByTeam.set(guess.teamId, (exactByTeam.get(guess.teamId) ?? 0) + 1)
  }
  for (const [teamId, count] of exactByTeam) {
    if (count >= 3) {
      signals.push({
        id: `exact:${teamId}`,
        teamId,
        roundNumber: 0,
        severity: 'medium',
        title: 'Streak of perfect guesses',
        detail: `${count} rounds with book, chapter and verse all exact`,
      })
    }
  }

  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
  return signals.sort((a, b) => order[a.severity] - order[b.severity] || b.roundNumber - a.roundNumber)
}

export function worstSeverity(signals: Signal[]): Severity | null {
  if (signals.some((item) => item.severity === 'high')) return 'high'
  if (signals.some((item) => item.severity === 'medium')) return 'medium'
  return signals.length > 0 ? 'low' : null
}
