import type {
  GuessRow,
  HostEvent,
  HostState,
  MapPin,
  Phase,
  PublicGame,
  PublicSnapshot,
  PublicTeam,
  RevealResult,
  TeamRow,
  VerseRow,
} from '../game/types.ts'
import { serverNowMs, setServerTime } from './clock.ts'
import { getSupabase } from './supabase.ts'

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Unexpected server response')
  }
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function bool(value: unknown): boolean {
  return value === true
}

async function call(fn: string, args?: Record<string, unknown>): Promise<unknown> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Add Supabase keys to .env.local before opening the game.')
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}

function parseTeam(value: unknown): PublicTeam {
  const row = asRecord(value)
  return {
    id: text(row.id),
    teammate1: text(row.teammate1),
    teammate2: text(row.teammate2),
    color: text(row.color) || '#2f9e6b',
    submitted: bool(row.submitted),
  }
}

function parsePin(value: unknown): MapPin {
  const row = asRecord(value)
  return {
    teamId: text(row.teamId),
    teammate1: text(row.teammate1),
    teammate2: text(row.teammate2),
    color: text(row.color) || '#2f9e6b',
    book: text(row.book),
    chapter: num(row.chapter),
  }
}

function parseRevealResult(value: unknown): RevealResult {
  const row = asRecord(value)
  return {
    teamId: text(row.teamId),
    teammate1: text(row.teammate1),
    teammate2: text(row.teammate2),
    color: text(row.color) || '#2f9e6b',
    guessBook: row.guessBook == null ? null : text(row.guessBook),
    guessChapter: row.guessChapter == null ? null : num(row.guessChapter),
    guessVerse: row.guessVerse == null ? null : num(row.guessVerse),
    bookScore: num(row.bookScore),
    chapterScore: num(row.chapterScore),
    verseScore: num(row.verseScore),
    multiplier: num(row.multiplier),
    speedBonus: num(row.speedBonus),
    score: num(row.score),
    totalScore: num(row.totalScore),
  }
}

export function parseSnapshot(value: unknown): PublicSnapshot {
  const row = value && typeof value === 'object' ? asRecord(value) : {}
  const reveal = row.reveal
  let parsedReveal: PublicSnapshot['reveal'] = null
  if (reveal && typeof reveal === 'object') {
    const revealRow = asRecord(reveal)
    parsedReveal = {
      book: text(revealRow.book),
      chapter: num(revealRow.chapter),
      verse: num(revealRow.verse),
      results: asArray(revealRow.results).map(parseRevealResult),
      colorResults: asArray(revealRow.colorResults).map(parseRevealResult),
    }
  }
  const averageRow = row.average && typeof row.average === 'object' ? asRecord(row.average) : null
  const average =
    averageRow && num(averageRow.count) > 0
      ? { x: num(averageRow.x), y: num(averageRow.y), count: num(averageRow.count) }
      : null
  return {
    verseText: row.verseText == null ? null : text(row.verseText),
    verseRound: num(row.verseRound),
    teams: asArray(row.teams).map(parseTeam),
    pins: asArray(row.pins).map(parsePin).filter((pin) => pin.book && pin.chapter > 0),
    average,
    totalRounds: num(row.totalRounds),
    effects: row.effects !== false,
    standingsRevealed: row.standingsRevealed === true,
    upNext: row.upNext == null ? null : num(row.upNext),
    sittingOut: asArray(row.sittingOut).map(text),
    reveal: parsedReveal,
  }
}

function parseTimer(row: Record<string, unknown>) {
  return {
    timerDurationMs: num(row.timerDurationMs ?? row.timer_duration_ms),
    guessingEndsAt: (row.guessingEndsAt ?? row.guessing_ends_at) as string | null,
    timerPaused: bool(row.timerPaused ?? row.timer_paused),
    timerRemainingMs: num(row.timerRemainingMs ?? row.timer_remaining_ms),
  }
}

export function parsePublicGame(value: unknown): PublicGame {
  const row = asRecord(value)
  const phase = text(row.phase) as Phase
  return {
    phase: phase === 'guessing' || phase === 'reveal' ? phase : 'lobby',
    currentRound: num(row.currentRound ?? row.current_round) || 1,
    updatedAt: text(row.updatedAt ?? row.updated_at) || null,
    snapshot: parseSnapshot(row.publicSnapshot ?? row.public_snapshot),
    ...parseTimer(row),
  }
}

function parseVerse(value: unknown): VerseRow {
  const row = asRecord(value)
  return {
    id: text(row.id),
    roundNumber: num(row.roundNumber),
    book: text(row.book),
    chapter: num(row.chapter),
    verse: num(row.verse),
    passage: text(row.passage),
  }
}

function parseHostTeam(value: unknown): TeamRow {
  const row = asRecord(value)
  return {
    id: text(row.id),
    teammate1: text(row.teammate1),
    teammate2: text(row.teammate2),
    color: text(row.color),
    active: row.active !== false,
    benched: row.benched === true,
    lastSeen: row.lastSeen == null ? null : text(row.lastSeen),
  }
}

function parseEvent(value: unknown): HostEvent {
  const row = asRecord(value)
  return {
    id: num(row.id),
    createdAt: text(row.createdAt),
    kind: text(row.kind),
    message: text(row.message),
  }
}

function parseGuess(value: unknown): GuessRow {
  const row = asRecord(value)
  return {
    id: text(row.id),
    teamId: text(row.teamId),
    roundNumber: num(row.roundNumber),
    guessBook: text(row.guessBook),
    guessChapter: num(row.guessChapter),
    guessVerse: num(row.guessVerse),
    bookScore: num(row.bookScore),
    chapterScore: num(row.chapterScore),
    verseScore: num(row.verseScore),
    score: num(row.score),
    submissionOrder: num(row.submissionOrder),
    multiplier: num(row.multiplier),
    speedBonus: num(row.speedBonus),
    adjustment: num(row.adjustment),
    adjustmentNote: row.adjustmentNote == null ? null : text(row.adjustmentNote),
    createdAt: text(row.createdAt),
  }
}

export function parseHostState(value: unknown): HostState {
  const row = asRecord(value)
  const phase = text(row.phase) as Phase
  return {
    phase: phase === 'guessing' || phase === 'reveal' ? phase : 'lobby',
    currentRound: num(row.currentRound) || 1,
    autoStartTimer: row.autoStartTimer !== false,
    revealWhenAllIn: row.revealWhenAllIn === true,
    effectsEnabled: row.effectsEnabled !== false,
    standingsRevealed: row.standingsRevealed === true,
    betweenRounds: row.betweenRounds === true,
    verseProfile: num(row.verseProfile) || 1,
    roundStartedAt: row.roundStartedAt == null ? null : text(row.roundStartedAt),
    flags: asArray(row.flags).map((item) => {
      const flag = asRecord(item)
      return {
        teamId: text(flag.teamId),
        roundNumber: num(flag.roundNumber),
        awayCount: num(flag.awayCount),
        awayMs: num(flag.awayMs),
      }
    }),
    serverNow: row.serverNow == null ? null : text(row.serverNow),
    events: asArray(row.events).map(parseEvent),
    verses: asArray(row.verses).map(parseVerse),
    teams: asArray(row.teams).map(parseHostTeam),
    guesses: asArray(row.guesses).map(parseGuess),
    ...parseTimer(row),
  }
}

export async function joinTeam(teammate1: string, teammate2: string, color: string) {
  const data = asRecord(
    await call('join_team', {
      p_teammate1: teammate1,
      p_teammate2: teammate2,
      p_color: color,
    }),
  )
  return {
    id: text(data.id),
    teammate1: text(data.teammate1),
    teammate2: text(data.teammate2),
    color: text(data.color),
  }
}

export async function submitGuess(
  teamId: string,
  book: string,
  chapter: number,
  verse: number,
  lockedAt = new Date(serverNowMs()).toISOString(),
): Promise<void> {
  // Captured before the request, on the server's clock, so upload delay is not part of the speed order.
  const guess = {
    p_team_id: teamId,
    p_book: book,
    p_chapter: chapter,
    p_verse: verse,
  }
  try {
    await call('submit_guess', { ...guess, p_locked_at: lockedAt })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (!message.includes('p_locked_at') && !message.includes('schema cache')) throw err
    await call('submit_guess', guess)
  }
}

export async function fetchHostState(): Promise<HostState> {
  const sentAt = Date.now()
  const state = parseHostState(await call('host_get_state'))
  setServerTime(state.serverNow, sentAt)
  return state
}

// Returns false when the server no longer knows this team (removed or left).
export async function teamHeartbeat(teamId: string): Promise<boolean> {
  return (await call('team_heartbeat', { p_team_id: teamId })) === true
}

// Fire-and-forget report of time spent away from the page during a round.
export async function reportAway(teamId: string, round: number, count: number, ms: number): Promise<void> {
  await call('report_away', { p_team_id: teamId, p_round: round, p_count: count, p_ms: ms })
}

export async function leaveTeam(teamId: string): Promise<void> {
  await call('leave_team', { p_team_id: teamId })
}

function hostCall(fn: string, args: Record<string, unknown> = {}) {
  return call(fn, args).then(parseHostState)
}

export const hostApi = {
  addVerse: (verse: { book: string; chapter: number; verse: number; passage: string }) =>
    hostCall('host_add_verse', {
      p_book: verse.book,
      p_chapter: verse.chapter,
      p_verse: verse.verse,
      p_passage: verse.passage,
    }),
  updateVerse: (round: number, verse: { book: string; chapter: number; verse: number; passage: string }) =>
    hostCall('host_update_verse', {
      p_round: round,
      p_book: verse.book,
      p_chapter: verse.chapter,
      p_verse: verse.verse,
      p_passage: verse.passage,
    }),
  deleteVerse: (round: number) => hostCall('host_delete_verse', { p_round: round }),
  moveVerse: (round: number, direction: -1 | 1) =>
    hostCall('host_move_verse', { p_round: round, p_direction: direction }),
  setPhase: (phase: Phase) => hostCall('host_set_phase', { p_phase: phase }),
  prepareRound: (round: number) => hostCall('host_prepare_round', { p_round: round }),
  setStandings: (show: boolean) => hostCall('host_reveal_standings', { p_show: show }),
  setRound: (round: number) => hostCall('host_set_round', { p_round: round }),
  setProfile: (profile: number) => hostCall('host_set_profile', { p_profile: profile }),
  timer: (action: 'start' | 'pause' | 'reset' | 'duration', durationMs?: number) =>
    hostCall('host_timer', { p_action: action, p_duration_ms: durationMs ?? null }),
  updateTeam: (teamId: string, teammate1: string, teammate2: string, color: string) =>
    hostCall('host_update_team', {
      p_team_id: teamId,
      p_teammate1: teammate1,
      p_teammate2: teammate2,
      p_color: color,
    }),
  setTeamBenched: (teamId: string, benched: boolean) =>
    hostCall('host_set_team_benched', { p_team_id: teamId, p_benched: benched }),
  deleteTeam: (teamId: string) => hostCall('host_delete_team', { p_team_id: teamId }),
  adjustGuess: (guessId: string, adjustment: number, note: string) =>
    hostCall('host_adjust_guess', { p_guess_id: guessId, p_adjustment: adjustment, p_note: note }),
  deleteGuess: (guessId: string) => hostCall('host_delete_guess', { p_guess_id: guessId }),
  resetScores: () => hostCall('host_reset_scores'),
  setSettings: (settings: { autoStart: boolean; revealWhenAllIn: boolean; effects: boolean }) =>
    hostCall('host_set_settings', {
      p_auto_start: settings.autoStart,
      p_reveal_when_all_in: settings.revealWhenAllIn,
      p_effects: settings.effects,
    }),
}
