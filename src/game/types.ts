export type Phase = 'lobby' | 'guessing' | 'reveal'

export type PublicTeam = {
  id: string
  teammate1: string
  teammate2: string
  color: string
  submitted: boolean
}

export type RevealResult = {
  teamId: string
  teammate1: string
  teammate2: string
  color: string
  guessBook: string | null
  guessChapter: number | null
  guessVerse: number | null
  bookScore: number
  chapterScore: number
  verseScore: number
  multiplier: number
  speedBonus: number
  score: number
  totalScore: number
}

export type MapPin = {
  teamId: string
  teammate1: string
  teammate2: string
  color: string
  book: string
  chapter: number
}

// Mean position of every locked-in guess, in the map's 0-100 space.
export type MapAverage = {
  x: number
  y: number
  count: number
}

export type PublicSnapshot = {
  verseText: string | null
  verseRound: number
  teams: PublicTeam[]
  pins: MapPin[]
  average: MapAverage | null
  totalRounds: number
  effects: boolean
  standingsRevealed: boolean
  upNext: number | null
  // Duos the host marked inactive. The projector never shows them; the player page uses this.
  sittingOut: string[]
  reveal: null | {
    book: string
    chapter: number
    verse: number
    results: RevealResult[]
    // One row per team color, holding the better duo's guess. Empty before the server sends it.
    colorResults: RevealResult[]
  }
}

export type TimerFields = {
  timerDurationMs: number
  guessingEndsAt: string | null
  timerPaused: boolean
  timerRemainingMs: number
}

export type PublicGame = TimerFields & {
  phase: Phase
  currentRound: number
  updatedAt: string | null
  snapshot: PublicSnapshot
}

export type VerseRow = {
  id: string
  roundNumber: number
  book: string
  chapter: number
  verse: number
  passage: string
}

export type TeamRow = {
  id: string
  teammate1: string
  teammate2: string
  color: string
  active: boolean
  // Inactive duo: keeps scores, hidden on the projector, not waited for.
  benched: boolean
  lastSeen: string | null
}

export type HostEvent = {
  id: number
  createdAt: string
  kind: string
  message: string
}

export type GuessRow = {
  id: string
  teamId: string
  roundNumber: number
  guessBook: string
  guessChapter: number
  guessVerse: number
  bookScore: number
  chapterScore: number
  verseScore: number
  score: number
  submissionOrder: number
  multiplier: number
  speedBonus: number
  createdAt: string
}

export type RoundFlag = {
  teamId: string
  roundNumber: number
  awayCount: number
  awayMs: number
}

export type HostState = TimerFields & {
  phase: Phase
  currentRound: number
  autoStartTimer: boolean
  revealWhenAllIn: boolean
  effectsEnabled: boolean
  standingsRevealed: boolean
  betweenRounds: boolean
  verseProfile: number
  roundStartedAt: string | null
  flags: RoundFlag[]
  serverNow: string | null
  events: HostEvent[]
  verses: VerseRow[]
  teams: TeamRow[]
  guesses: GuessRow[]
}

export const TEAM_COLORS = ['#0073ff', '#fff824', '#ff2424'] as const
export const TEAM_COLOR_NAMES = ['Blue', 'Yellow', 'Red'] as const

export function colorName(color: string): string {
  const index = TEAM_COLORS.findIndex((swatch) => swatch.toLowerCase() === color.toLowerCase())
  return index >= 0 ? TEAM_COLOR_NAMES[index] : 'Team'
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function remainingMs(timer: TimerFields, now = Date.now()): number {
  const full = Math.max(0, timer.timerDurationMs)
  if (timer.timerPaused) return Math.min(full, Math.max(0, timer.timerRemainingMs))
  if (timer.guessingEndsAt) {
    // The server adds a short intro before the clock starts counting down.
    return Math.min(full, Math.max(0, new Date(timer.guessingEndsAt).getTime() - now))
  }
  return full
}

export type TimerState = 'idle' | 'running' | 'paused' | 'ended'

export function timerState(timer: TimerFields, now = Date.now()): TimerState {
  if (timer.timerPaused) return timer.timerRemainingMs > 0 ? 'paused' : 'ended'
  if (timer.guessingEndsAt) {
    return new Date(timer.guessingEndsAt).getTime() > now ? 'running' : 'ended'
  }
  return 'idle'
}

export const BAND_COLORS = {
  perfect: '#22c55e',
  excellent: '#3b82f6',
  good: '#eab308',
  ok: '#f97316',
  poor: '#ef4444',
} as const

export function guessesOpen(game: Pick<PublicGame, 'phase' | keyof TimerFields>, now = Date.now()): boolean {
  if (game.phase !== 'guessing') return false
  if (game.timerPaused) return game.timerRemainingMs > 0
  if (game.guessingEndsAt) return new Date(game.guessingEndsAt).getTime() > now
  return true
}

export function teamLabel(teammate1: string, teammate2: string): string {
  return `${teammate1} & ${teammate2}`
}
