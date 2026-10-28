import { describe, expect, it } from 'vitest'
import { preferNewerGame, withCurrentPassage } from './snapshot.ts'
import type { PublicGame } from './types.ts'

function game(round: number, text: string, verseRound = 0, updatedAt = '2026-01-01T00:00:00Z'): PublicGame {
  return {
    phase: 'guessing',
    currentRound: round,
    updatedAt,
    timerDurationMs: 60000,
    guessingEndsAt: null,
    timerPaused: false,
    timerRemainingMs: 60000,
    snapshot: {
      verseText: text,
      verseRound,
      teams: [],
      pins: [],
      average: null,
      totalRounds: 8,
      effects: true,
      standingsRevealed: false,
      upNext: null,
      reveal: null,
    },
  }
}

describe('withCurrentPassage', () => {
  it('hides a passage that still belongs to the previous round', () => {
    const seen = { round: 3, text: 'In the beginning' }
    const shown = withCurrentPassage(game(4, 'In the beginning', 3), seen)
    expect(shown.game.snapshot.verseText).toBeNull()
    expect(shown.seen).toEqual(seen)
  })

  it('shows the passage once it is tagged for the new round', () => {
    const shown = withCurrentPassage(game(4, 'For God so loved', 4), { round: 3, text: 'In the beginning' })
    expect(shown.game.snapshot.verseText).toBe('For God so loved')
    expect(shown.seen).toEqual({ round: 4, text: 'For God so loved' })
  })

  it('hides an untagged repeat of the previous passage when the round changes', () => {
    const shown = withCurrentPassage(game(4, 'In the beginning'), { round: 3, text: 'In the beginning' })
    expect(shown.game.snapshot.verseText).toBeNull()
  })
})

describe('preferNewerGame', () => {
  it('keeps the newer round when an older fetch arrives late', () => {
    const current = game(4, 'For God so loved', 4, '2026-01-01T00:00:02Z')
    const late = game(3, 'In the beginning', 3, '2026-01-01T00:00:01Z')
    expect(preferNewerGame(current, late).currentRound).toBe(4)
  })

  it('keeps the object already on screen when a newer copy looks the same', () => {
    const current = game(4, 'For God so loved', 4, '2026-01-01T00:00:01Z')
    const repeat = game(4, 'For God so loved', 4, '2026-01-01T00:00:09Z')
    expect(preferNewerGame(current, repeat)).toBe(current)
  })
})
