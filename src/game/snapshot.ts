import type { PublicGame, PublicSnapshot } from './types.ts'

export type SeenPassage = { round: number; text: string | null }

// A slower poll or an earlier round-change must not paint over a newer one.
export function preferNewerGame(current: PublicGame | null, next: PublicGame): PublicGame {
  if (!current?.updatedAt || !next.updatedAt) return next
  const nextMs = Date.parse(next.updatedAt)
  const currentMs = Date.parse(current.updatedAt)
  if (!Number.isFinite(nextMs) || !Number.isFinite(currentMs)) return next
  if (nextMs !== currentMs) return nextMs > currentMs ? next : current
  const nextMatches = next.snapshot.verseRound === 0 || next.snapshot.verseRound === next.currentRound
  const currentMatches = current.snapshot.verseRound === 0 || current.snapshot.verseRound === current.currentRound
  if (currentMatches && !nextMatches) return current
  return next
}

function blankStale(game: PublicGame): PublicGame {
  const snapshot: PublicSnapshot = {
    ...game.snapshot,
    verseText: null,
    pins: [],
    reveal: null,
    teams: game.snapshot.teams.map((team) => ({ ...team, submitted: false })),
  }
  return { ...game, snapshot }
}

// The round number can change before the snapshot that holds its passage.
// Until they match, keep the previous verse off the screen.
export function withCurrentPassage(
  game: PublicGame,
  seen: SeenPassage,
): { game: PublicGame; seen: SeenPassage } {
  if (game.phase === 'lobby') return { game, seen }

  const tagged = game.snapshot.verseRound
  const text = game.snapshot.verseText
  const taggedStale = tagged > 0 && tagged !== game.currentRound
  const untaggedStale =
    tagged === 0 &&
    seen.round !== 0 &&
    seen.round !== game.currentRound &&
    text != null &&
    text === seen.text

  if (taggedStale || untaggedStale) return { game: blankStale(game), seen }
  return { game, seen: { round: game.currentRound, text } }
}
