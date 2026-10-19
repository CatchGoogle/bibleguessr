import { BAND_COLORS } from './types.ts'
import type { RevealResult } from './types.ts'

export type Band = keyof typeof BAND_COLORS

export function bandFor(result: RevealResult): Band | null {
  if (!result.guessBook) return null
  if (result.bookScore === 50 && result.chapterScore === 30 && result.verseScore === 20) return 'perfect'
  if (result.bookScore === 50 && result.chapterScore >= 20) return 'excellent'
  if (result.bookScore >= 40) return 'good'
  if (result.bookScore >= 10) return 'ok'
  return 'poor'
}

export type StandingRow = {
  result: RevealResult
  rank: number
  previousTotal: number
  change: number
}

// Rank teams by total score and work out how far each moved this round.
export function standings(results: RevealResult[]): StandingRow[] {
  const order = new Map(results.map((result, index) => [result.teamId, index]))
  const byTotal = (value: (result: RevealResult) => number) =>
    [...results].sort(
      (a, b) => value(b) - value(a) || (order.get(a.teamId) ?? 0) - (order.get(b.teamId) ?? 0),
    )

  const now = byTotal((result) => result.totalScore)
  const before = byTotal((result) => result.totalScore - result.score)
  const previousRank = new Map(before.map((result, index) => [result.teamId, index + 1]))

  return now.map((result, index) => ({
    result,
    rank: index + 1,
    previousTotal: result.totalScore - result.score,
    change: (previousRank.get(result.teamId) ?? index + 1) - (index + 1),
  }))
}
