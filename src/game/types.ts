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

export type PublicSnapshot = {
  verseText: string | null
  verseRound: number
  teams: PublicTeam[]
  pins: MapPin[]
  totalRounds: number
  effects: boolean
  standingsRevealed: boolean
  upNext: number | null
  reveal: null | {
    book: string
    chapter: number
    verse: number
    results: RevealResult[]
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
  roundStartedAt: string | null
  flags: RoundFlag[]
  serverNow: string | null
  events: HostEvent[]
  verses: VerseRow[]
  teams: TeamRow[]
  guesses: GuessRow[]
}

export const TEAM_COLORS = [
  '#2f9e6b',
  '#3b82f6',
  '#e0a100',
  '#e15a3a',
  '#a855f7',
  '#14b8c4',
  '#f07316',
  '#ec4899',
  '#84a30d',
  '#d4a017',
] as const

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
