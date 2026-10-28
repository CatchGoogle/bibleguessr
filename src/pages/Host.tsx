import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ActivityLog } from '../components/ActivityLog.tsx'
import { ConnectionBadge } from '../components/ConnectionBadge.tsx'
import { ConfirmDialog, Modal } from '../components/Modal.tsx'
import { downloadScoresCsv, ScoreMatrix } from '../components/ScoreMatrix.tsx'
import { Wordmark } from '../components/Wordmark.tsx'
import { BOOKS, chapterCount, MAX_VERSE } from '../game/books.ts'
import { cleanPassage, looksLikeNiv, lookupNiv, parseAddress, parseNivPaste } from '../game/niv.ts'
import { integritySignals, worstSeverity } from '../game/integrity.ts'
import type { Severity, Signal } from '../game/integrity.ts'
import { formatPoints, formatReference, speedLabel } from '../game/scoring.ts'
import { TEAM_COLORS, TEAM_COLOR_NAMES, formatClock, remainingMs, teamLabel, timerState } from '../game/types.ts'
import type { HostState, TeamRow, TimerState } from '../game/types.ts'
import { hostApi } from '../lib/api.ts'
import { siteUrl } from '../lib/site.ts'
import { supabaseConfigured } from '../lib/supabase.ts'
import { useHostGame, useNow } from '../lib/useGame.ts'

type Draft = {
  book: string
  chapter: string
  verse: string
  passage: string
}

type Dialog =
  | { kind: 'stop' }
  | { kind: 'reset' }
  | { kind: 'small-start' }
  | { kind: 'skip' }
  | { kind: 'verse'; round: number }
  | { kind: 'team'; teamId: string }
  | { kind: 'delete-team'; teamId: string }
  | { kind: 'guess'; guessId: string }
  | { kind: 'delete-guess'; guessId: string }

type Action = { label: string; onClick: () => void; disabled?: boolean }

const emptyDraft: Draft = { book: 'John', chapter: '3', verse: '16', passage: '' }
const VERSE_PROFILES = [
  { id: 1, label: 'Official' },
  { id: 2, label: 'Practice A' },
  { id: 3, label: 'Practice B' },
]
const ONLINE_WINDOW_MS = 40_000

export function Host() {
  const { state, setState, error, setError, loading, connection } = useHostGame()
  const now = useNow()
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingRound, setEditingRound] = useState<number | null>(null)
  const [seconds, setSeconds] = useState(60)
  const [durationDirty, setDurationDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const [nivQuery, setNivQuery] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  const editorRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (state && !durationDirty) setSeconds(Math.round(state.timerDurationMs / 1000))
  }, [state, durationDirty])

  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), 2200)
    return () => window.clearTimeout(id)
  }, [notice])

  async function run(action: () => Promise<HostState | null>, done?: string) {
    setBusy(true)
    setError(null)
    try {
      const next = await action()
      if (next) setState(next)
      if (done) setNotice(done)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That action failed.')
    } finally {
      setBusy(false)
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      setNotice(`${label} copied`)
    } catch {
      setNotice(`Copy failed. The address is ${value}`)
    }
  }

  if (!supabaseConfigured()) {
    return (
      <main className="page">
        <p className="notice">Add Supabase keys to .env.local, then reload this page.</p>
      </main>
    )
  }

  const maxRound = state?.verses.at(-1)?.roundNumber ?? 0
  const currentVerse = state?.verses.find((verse) => verse.roundNumber === state.currentRound)
  const activeTeams = state?.teams.filter((team) => team.active && !team.benched) ?? []
  const lockedIds = new Set(
    state?.guesses.filter((guess) => guess.roundNumber === state.currentRound).map((guess) => guess.teamId) ?? [],
  )
  const lockedCount = activeTeams.filter((team) => lockedIds.has(team.id)).length
  const allIn = activeTeams.length > 0 && lockedCount === activeTeams.length
  const clock = state ? timerState(state, now) : 'idle'
  const signals = state ? integritySignals(state).filter((item) => !dismissed.has(item.id)) : []
  const flaggedCells = new Set(signals.filter((item) => item.roundNumber > 0).map((item) => `${item.teamId}:${item.roundNumber}`))

  const chapterMax = chapterCount(draft.book)

  function loadVerse(round: number) {
    const verse = state?.verses.find((item) => item.roundNumber === round)
    if (!verse) return
    setEditingRound(round)
    setPasteNote(null)
    setNivQuery(`${verse.book} ${verse.chapter}:${verse.verse}`)
    setDraft({
      book: verse.book,
      chapter: String(verse.chapter),
      verse: String(verse.verse),
      passage: verse.passage,
    })
    editorRef.current?.scrollIntoView({ block: 'nearest' })
  }

  function applyNiv(raw: string) {
    const parsed = parseNivPaste(raw)
    if (!parsed.passage && !parsed.book) {
      setPasteNote('No verse text found in that paste.')
      return
    }
    setDraft((current) => ({
      book: parsed.book ?? current.book,
      chapter: parsed.chapter != null ? String(parsed.chapter) : current.chapter,
      verse: parsed.verse != null ? String(parsed.verse) : current.verse,
      passage: parsed.passage || current.passage,
    }))
    if (parsed.book) setNivQuery(`${parsed.book} ${parsed.chapter}:${parsed.verse}`)
    setPasteNote(
      parsed.book
        ? `Filled ${parsed.book} ${parsed.chapter}:${parsed.verse}.`
        : 'Cleaned the passage.',
    )
  }

  async function findNiv(raw = nivQuery) {
    const query = raw.trim()
    if (!query) return
    if (query.includes('\n') || (looksLikeNiv(query) && !parseAddress(query))) {
      applyNiv(query)
      return
    }
    setLookingUp(true)
    setPasteNote(null)
    try {
      const found = await lookupNiv(query)
      setDraft({
        book: found.book,
        chapter: String(found.chapter),
        verse: String(found.verse),
        passage: found.passage,
      })
      const range = found.endVerse > found.verse ? `-${found.endVerse}` : ''
      setNivQuery(`${found.book} ${found.chapter}:${found.verse}${range}`)
      setPasteNote(`Loaded ${found.book} ${found.chapter}:${found.verse}${range} (NIV).`)
    } catch (err) {
      setPasteNote(err instanceof Error ? err.message : 'Could not load that verse.')
    } finally {
      setLookingUp(false)
    }
  }

  async function saveVerse(event: FormEvent) {
    event.preventDefault()
    const payload = {
      book: draft.book,
      chapter: Number(draft.chapter),
      verse: Number(draft.verse),
      passage: cleanPassage(draft.passage),
    }
    await run(() =>
      editingRound ? hostApi.updateVerse(editingRound, payload) : hostApi.addVerse(payload),
    )
    if (!editingRound) {
      setDraft({ ...emptyDraft, passage: '' })
      setNivQuery('')
      setPasteNote(null)
    }
  }

  function controls(current: HostState): { primary: Action; secondary: Action[]; label: string } {
    const startRound = () => {
      if (activeTeams.length < 2) setDialog({ kind: 'small-start' })
      else void run(() => hostApi.setPhase('guessing'))
    }
    const reveal = () => void run(() => hostApi.setPhase('reveal'))
    const hasVerse = Boolean(currentVerse)

    if (current.phase === 'lobby') {
      return {
        label: 'Lobby. Teams are joining.',
        primary: {
          label: hasVerse ? `Start round ${current.currentRound}` : 'Add a passage first',
          onClick: startRound,
          disabled: !hasVerse,
        },
        secondary: [],
      }
    }

    if (current.phase === 'reveal') {
      const last = current.currentRound >= maxRound
      const replay = {
        label: 'Replay this round',
        onClick: () => void run(() => hostApi.setRound(current.currentRound)),
      }
      if (last) {
        return current.standingsRevealed
          ? {
              label: 'Final standings are on the projector.',
              primary: { label: 'End game', onClick: () => setDialog({ kind: 'stop' }) },
              secondary: [
                { label: 'Hide standings', onClick: () => void run(() => hostApi.setStandings(false)) },
                replay,
              ],
            }
          : {
              label: 'Answer revealed. Final standings are hidden until you show them.',
              primary: {
                label: 'Reveal final standings',
                onClick: () => void run(() => hostApi.setStandings(true)),
              },
              secondary: [replay],
            }
      }
      return {
        label: 'Answer revealed.',
        primary: {
          label: `Next round (${current.currentRound + 1})`,
          onClick: () => void run(() => hostApi.setRound(current.currentRound + 1)),
        },
        secondary: [
          {
            label: 'Previous round',
            onClick: () => void run(() => hostApi.setRound(current.currentRound - 1)),
            disabled: current.currentRound <= 1,
          },
          replay,
        ],
      }
    }

    const restart = () =>
      void run(async () => {
        await hostApi.timer('reset')
        return hostApi.timer('start')
      })
    const byState: Record<TimerState, { label: string; primary: Action; secondary: Action[] }> = {
      idle: {
        label: 'Guessing is open. The clock has not started.',
        primary: { label: 'Start the clock', onClick: () => void run(() => hostApi.timer('start')) },
        secondary: [{ label: 'Reveal now', onClick: reveal }],
      },
      running: {
        label: allIn ? 'Every team is locked in.' : 'Guessing. The clock is running.',
        primary: { label: 'Reveal answer', onClick: reveal },
        secondary: [{ label: 'Pause clock', onClick: () => void run(() => hostApi.timer('pause')) }],
      },
      paused: {
        label: 'The clock is paused.',
        primary: { label: 'Resume clock', onClick: () => void run(() => hostApi.timer('start')) },
        secondary: [{ label: 'Reveal now', onClick: reveal }],
      },
      ended: {
        label: 'Time’s up. Guesses are closed.',
        primary: { label: 'Reveal answer', onClick: reveal },
        secondary: [{ label: 'Restart the clock', onClick: restart }],
      },
    }
    return byState[clock]
  }

  const ui = state ? controls(state) : null
  const canEditDuration = state ? state.phase === 'lobby' || clock === 'idle' : false

  const dialogGuess =
    dialog && (dialog.kind === 'guess' || dialog.kind === 'delete-guess')
      ? state?.guesses.find((guess) => guess.id === dialog.guessId)
      : undefined

  return (
    <main className="page host-page">
      <header className="topbar">
        <Wordmark />
        <div className="room-chip">
          <button type="button" className="btn tiny" onClick={() => void copy(siteUrl(), 'Team link')}>
            Copy team link
          </button>
          <button
            type="button"
            className="btn tiny"
            onClick={() => void copy(siteUrl('view'), 'Projector link')}
          >
            Copy projector link
          </button>
        </div>
      </header>

      <ConnectionBadge connection={connection} />
      {error && <p className="notice error">{error}</p>}
      {loading && !state && <p>Loading…</p>}
      {notice && <p className="toast floating">{notice}</p>}

      {state && ui && (
        <div className="host-board">
          <div className="host-col">
            <section className="panel control-bar">
              <div className="control-head">
                <div>
                  <p className="eyebrow">
                    Round {state.currentRound}
                    {maxRound ? ` of ${maxRound}` : ''}
                  </p>
                  <p className={`clock ${clock === 'ended' ? 'ended' : ''}`}>
                    {state.phase === 'lobby' ? '--:--' : formatClock(remainingMs(state, now))}
                  </p>
                  <p className="state-line">{ui.label}</p>
                </div>
                <div className={allIn ? 'submission-banner complete' : 'submission-banner'}>
                  <strong>
                    {lockedCount} / {activeTeams.length}
                  </strong>
                  <span>teams locked in</span>
                </div>
              </div>

              <div className="button-row">
                <button className="btn primary big" type="button" disabled={busy || ui.primary.disabled} onClick={ui.primary.onClick}>
                  {ui.primary.label}
                </button>
                {ui.secondary.map((action) => (
                  <button key={action.label} className="btn" type="button" disabled={busy || action.disabled} onClick={action.onClick}>
                    {action.label}
                  </button>
                ))}
                {state.phase !== 'lobby' && (
                  <button className="btn danger" type="button" disabled={busy} onClick={() => setDialog({ kind: 'stop' })}>
                    Stop game
                  </button>
                )}
              </div>

              <details className="more-controls">
                <summary>Rounds, clock length and options</summary>
                <div className="button-row">
                  <button
                    className="btn"
                    type="button"
                    disabled={busy || state.currentRound <= 1}
                    onClick={() => run(() => hostApi.setRound(state.currentRound - 1))}
                  >
                    Previous round
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy || state.currentRound >= maxRound}
                    onClick={() => {
                      if (state.phase === 'reveal') void run(() => hostApi.setRound(state.currentRound + 1))
                      else setDialog({ kind: 'skip' })
                    }}
                  >
                    Skip to next round
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy || state.phase === 'lobby'}
                    onClick={() => run(() => hostApi.timer('reset'))}
                  >
                    Reset clock
                  </button>
                </div>
                <div className="timer-row">
                  <label>
                    Clock length (seconds)
                    <input
                      type="number"
                      min={10}
                      max={300}
                      value={seconds}
                      onChange={(event) => {
                        setDurationDirty(true)
                        setSeconds(Number(event.target.value))
                      }}
                    />
                  </label>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy || !canEditDuration || seconds < 10 || seconds > 300}
                    title={canEditDuration ? '' : 'Reset the clock first to change its length.'}
                    onClick={() =>
                      run(async () => {
                        const next = await hostApi.timer('duration', seconds * 1000)
                        setDurationDirty(false)
                        return next
                      })
                    }
                  >
                    Set length
                  </button>
                </div>
                <div className="toggles">
                  <Toggle
                    label="Start the clock automatically when a round begins"
                    checked={state.autoStartTimer}
                    disabled={busy}
                    onChange={(value) =>
                      run(() =>
                        hostApi.setSettings({
                          autoStart: value,
                          revealWhenAllIn: state.revealWhenAllIn,
                          effects: state.effectsEnabled,
                        }),
                      )
                    }
                  />
                  <Toggle
                    label="Reveal as soon as every team is locked in"
                    checked={state.revealWhenAllIn}
                    disabled={busy}
                    onChange={(value) =>
                      run(() =>
                        hostApi.setSettings({
                          autoStart: state.autoStartTimer,
                          revealWhenAllIn: value,
                          effects: state.effectsEnabled,
                        }),
                      )
                    }
                  />
                  <Toggle
                    label="Projector effects (ripples and screen shake)"
                    checked={state.effectsEnabled}
                    disabled={busy}
                    onChange={(value) =>
                      run(() =>
                        hostApi.setSettings({
                          autoStart: state.autoStartTimer,
                          revealWhenAllIn: state.revealWhenAllIn,
                          effects: value,
                        }),
                      )
                    }
                  />
                </div>
              </details>
            </section>

            <section className="panel">
              <h2>This passage</h2>
              {currentVerse ? (
                <>
                  <p className="reference">
                    {formatReference(currentVerse.book, currentVerse.chapter, currentVerse.verse)}
                  </p>
                  <p className="passage">{currentVerse.passage}</p>
                </>
              ) : (
                <p>No passage for round {state.currentRound} yet.</p>
              )}
            </section>

            <section className="panel">
              <h2>Teams</h2>
              {state.teams.length === 0 && <p>Teams appear here after they join.</p>}
              <ul className="team-cards">
                {[...state.teams]
                  .sort((a, b) => Number(b.active) - Number(a.active))
                  .map((team) => (
                    <TeamCard
                      key={team.id}
                      team={team}
                      online={isOnline(team, now)}
                      locked={lockedIds.has(team.id)}
                      guessText={guessText(state, team.id)}
                      severity={worstSeverity(signals.filter((item) => item.teamId === team.id))}
                      showGuess
                      onEdit={() => setDialog({ kind: 'team', teamId: team.id })}
                    />
                  ))}
              </ul>
            </section>

            <IntegrityPanel
              state={state}
              signals={signals}
              onOpen={(guessId) => setDialog({ kind: 'guess', guessId })}
              onDismiss={(id) => setDismissed((current) => new Set(current).add(id))}
              onDismissAll={() => setDismissed((current) => new Set([...current, ...signals.map((item) => item.id)]))}
            />

            <section className="panel">
              <div className="section-head">
                <h2>Scores</h2>
                <div className="button-row">
                  <button className="btn tiny" type="button" onClick={() => downloadScoresCsv(state)} disabled={state.guesses.length === 0}>
                    Export CSV
                  </button>
                  <button className="btn danger tiny" type="button" onClick={() => setDialog({ kind: 'reset' })}>
                    Reset scores
                  </button>
                </div>
              </div>
              <ScoreMatrix state={state} flagged={flaggedCells} onOpen={(guessId) => setDialog({ kind: 'guess', guessId })} />
            </section>

            <section className="panel">
              <details open>
                <summary className="log-summary">Activity</summary>
                <ActivityLog events={state.events} />
              </details>
            </section>
          </div>

          <div className="host-col">
            <section className="panel verse-editor" ref={editorRef}>
              <div className="section-head">
                <h2>{editingRound ? `Editing round ${editingRound}` : 'Add a round'}</h2>
                {editingRound && (
                  <button
                    type="button"
                    className="btn tiny"
                    onClick={() => {
                      setEditingRound(null)
                      setDraft(emptyDraft)
                      setPasteNote(null)
                      setNivQuery('')
                    }}
                  >
                    Add a new round instead
                  </button>
                )}
              </div>
              <form className="stack" onSubmit={saveVerse}>
                <label>
                  NIV address (or paste a verse)
                  <div className="lookup-row">
                    <input
                      value={nivQuery}
                      placeholder="romans 8:28 or 1 peter 2:9-10"
                      onChange={(event) => setNivQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        void findNiv()
                      }}
                      onPaste={(event) => {
                        const text = event.clipboardData.getData('text')
                        if (!text.trim()) return
                        event.preventDefault()
                        setNivQuery(text)
                        void findNiv(text)
                      }}
                    />
                    <button
                      className="btn"
                      type="button"
                      disabled={lookingUp || !nivQuery.trim()}
                      onClick={() => void findNiv()}
                    >
                      {lookingUp ? 'Loading…' : 'Get NIV'}
                    </button>
                  </div>
                </label>
                {pasteNote && <p className="notice">{pasteNote}</p>}
                <div className="editor-fields">
                  <label>
                    Book
                    <select
                      value={draft.book}
                      onChange={(event) => {
                        const book = event.target.value
                        const max = chapterCount(book)
                        setDraft((currentDraft) => ({
                          ...currentDraft,
                          book,
                          chapter: String(Math.min(Number(currentDraft.chapter) || 1, max)),
                        }))
                      }}
                    >
                      {BOOKS.map((book) => (
                        <option key={book.name} value={book.name}>
                          {book.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Chapter
                    <input
                      type="number"
                      min={1}
                      max={chapterMax}
                      value={draft.chapter}
                      onChange={(event) => setDraft({ ...draft, chapter: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    Verse
                    <input
                      type="number"
                      min={1}
                      max={MAX_VERSE}
                      value={draft.verse}
                      onChange={(event) => setDraft({ ...draft, verse: event.target.value })}
                      required
                    />
                  </label>
                </div>
                <label>
                  Passage players will see
                  <textarea
                    value={draft.passage}
                    onChange={(event) => setDraft({ ...draft, passage: event.target.value })}
                    onPaste={(event) => {
                      const text = event.clipboardData.getData('text')
                      if (!looksLikeNiv(text)) return
                      event.preventDefault()
                      applyNiv(text)
                    }}
                    rows={5}
                    required
                  />
                </label>
                <div className="button-row">
                  <button className="btn primary" type="submit" disabled={busy}>
                    {editingRound ? 'Save round' : 'Add round'}
                  </button>
                </div>
              </form>
            </section>

            <section className="panel">
              <div className="section-head">
                <h2>Rounds</h2>
              </div>
              <div className="button-row profile-row">
                {VERSE_PROFILES.map((item) => (
                  <button
                    key={item.id}
                    className={state.verseProfile === item.id ? 'btn tiny primary' : 'btn tiny'}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (state.verseProfile === item.id) return
                      if (!window.confirm(`Switch to ${item.label}? The projector returns to the lobby.`)) return
                      void run(() => hostApi.setProfile(item.id))
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="quiet">
                {state.verseProfile === 1
                  ? 'This is the official list. Practice lists keep their own passages and scores.'
                  : 'Official verses are hidden. Guesses here stay on this list.'}
              </p>
              <ol className="round-list">
                {state.verses.map((verse) => (
                  <li
                    key={verse.id}
                    className={[
                      verse.roundNumber === state.currentRound ? 'current' : '',
                      editingRound === verse.roundNumber ? 'editing' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <button type="button" className="round-select" onClick={() => loadVerse(verse.roundNumber)}>
                      <strong>{verse.roundNumber}.</strong> {formatReference(verse.book, verse.chapter, verse.verse)}
                      {verse.roundNumber === state.currentRound && <em> · live</em>}
                      {editingRound === verse.roundNumber && <em> · editing</em>}
                    </button>
                    <span className="icon-buttons">
                      <button
                        type="button"
                        aria-label={`Move round ${verse.roundNumber} up`}
                        disabled={busy || verse.roundNumber === 1}
                        onClick={() => run(() => hostApi.moveVerse(verse.roundNumber, -1))}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move round ${verse.roundNumber} down`}
                        disabled={busy || verse.roundNumber === maxRound}
                        onClick={() => run(() => hostApi.moveVerse(verse.roundNumber, 1))}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="del"
                        aria-label={`Delete round ${verse.roundNumber}`}
                        onClick={() => setDialog({ kind: 'verse', round: verse.roundNumber })}
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
              {state.verses.length === 0 && (
                <p>{state.verseProfile === 1 ? 'Add the first passage with the form above.' : 'Add a practice passage with the form above.'}</p>
              )}
              <p className="quiet">Click a round to edit it. The green outline is the round currently on screen.</p>
            </section>
          </div>
        </div>
      )}

      {state && dialog?.kind === 'stop' && (
        <ConfirmDialog
          title="Stop the game?"
          body="Everyone returns to the lobby. Scores are kept."
          confirmLabel="Stop game"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            void run(() => hostApi.setPhase('lobby'))
          }}
        />
      )}
      {state && dialog?.kind === 'reset' && (
        <ConfirmDialog
          title="Reset scores for this list?"
          body="This deletes the guesses on the verse list you have open. The other lists are kept."
          confirmLabel="Reset scores"
          requireText="reset"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            void run(() => hostApi.resetScores(), 'Scores reset. Back to round 1.')
          }}
        />
      )}
      {state && dialog?.kind === 'skip' && (
        <ConfirmDialog
          title={`Skip round ${state.currentRound}?`}
          body="This round is still in progress. Skipping starts the next round now. Guesses already locked in for this round are kept."
          confirmLabel="Skip round"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const round = state.currentRound + 1
            setDialog(null)
            void run(() => hostApi.setRound(round))
          }}
        />
      )}
      {state && dialog?.kind === 'small-start' && (
        <ConfirmDialog
          title="Only a few teams have joined"
          body={`${activeTeams.length} ${activeTeams.length === 1 ? 'team has' : 'teams have'} joined. Start the round anyway?`}
          confirmLabel="Start anyway"
          danger={false}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            void run(() => hostApi.setPhase('guessing'))
          }}
        />
      )}
      {state && dialog?.kind === 'verse' && (
        <ConfirmDialog
          title={`Delete round ${dialog.round}?`}
          body={
            state.guesses.some((guess) => guess.roundNumber === dialog.round)
              ? 'This removes the passage and the guesses for this round. Later rounds move up.'
              : 'Later rounds move up to fill the gap.'
          }
          confirmLabel="Delete round"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const round = dialog.round
            setDialog(null)
            void run(() => hostApi.deleteVerse(round))
          }}
        />
      )}
      {state && dialog?.kind === 'team' && state.teams.some((team) => team.id === dialog.teamId) && (
        <Modal title="Edit team" onClose={() => setDialog(null)}>
          <TeamEditor
            team={state.teams.find((team) => team.id === dialog.teamId)!}
            busy={busy}
            onCancel={() => setDialog(null)}
            onDelete={() => setDialog({ kind: 'delete-team', teamId: dialog.teamId })}
            onToggleBenched={() => {
              const target = state.teams.find((team) => team.id === dialog.teamId)!
              setDialog(null)
              void run(() => hostApi.setTeamBenched(target.id, !target.benched))
            }}
            onSave={(teammate1, teammate2, color) => {
              const teamId = dialog.teamId
              setDialog(null)
              void run(() => hostApi.updateTeam(teamId, teammate1, teammate2, color))
            }}
          />
        </Modal>
      )}
      {state && dialog?.kind === 'delete-team' && (
        <ConfirmDialog
          title="Remove this team?"
          body="Their guesses are deleted and the other teams’ speed bonuses are recalculated."
          confirmLabel="Remove team"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const teamId = dialog.teamId
            setDialog(null)
            void run(() => hostApi.deleteTeam(teamId))
          }}
        />
      )}
      {state && dialog?.kind === 'guess' && dialogGuess && (
        <GuessDetail
          state={state}
          guessId={dialogGuess.id}
          onClose={() => setDialog(null)}
          onDelete={() => setDialog({ kind: 'delete-guess', guessId: dialogGuess.id })}
        />
      )}
      {state && dialog?.kind === 'delete-guess' && dialogGuess && (
        <ConfirmDialog
          title="Delete this guess?"
          body="The team can lock in a new guess if guessing is still open."
          confirmLabel="Delete guess"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const guessId = dialogGuess.id
            setDialog(null)
            void run(() => hostApi.deleteGuess(guessId))
          }}
        />
      )}
    </main>
  )
}

function isOnline(team: TeamRow, now: number): boolean {
  if (!team.active || !team.lastSeen) return false
  return now - new Date(team.lastSeen).getTime() < ONLINE_WINDOW_MS
}

function guessText(state: HostState, teamId: string): string | null {
  const guess = state.guesses.find((item) => item.teamId === teamId && item.roundNumber === state.currentRound)
  return guess ? `${guess.guessBook} ${guess.guessChapter}:${guess.guessVerse}` : null
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function TeamCard({
  team,
  online,
  locked,
  guessText: guess,
  showGuess,
  severity,
  onEdit,
}: {
  team: TeamRow
  online: boolean
  locked: boolean
  guessText: string | null
  showGuess: boolean
  severity: Severity | null
  onEdit: () => void
}) {
  return (
    <li className={team.active && !team.benched ? 'team-card' : 'team-card gone'}>
      <i style={{ background: team.color }} />
      <div className="team-card-main">
        <strong>{teamLabel(team.teammate1, team.teammate2)}</strong>
        <span className="chips">
          {!team.active ? (
            <em className="chip off">Left</em>
          ) : team.benched ? (
            <em className="chip off">Inactive</em>
          ) : (
            <em className={online ? 'chip on' : 'chip off'}>{online ? 'Online' : 'Offline'}</em>
          )}
          {team.active && locked && <em className="chip locked">Locked in</em>}
          {showGuess && guess && <em className="chip guess">{guess}</em>}
          {severity && <em className={`chip flag ${severity}`}>Check</em>}
        </span>
      </div>
      <button type="button" className="btn tiny" onClick={onEdit}>
        Edit
      </button>
    </li>
  )
}

function IntegrityPanel({
  state,
  signals,
  onOpen,
  onDismiss,
  onDismissAll,
}: {
  state: HostState
  signals: Signal[]
  onOpen: (guessId: string) => void
  onDismiss: (id: string) => void
  onDismissAll: () => void
}) {
  const nameOf = (teamId: string) => {
    const team = state.teams.find((item) => item.id === teamId)
    return team ? teamLabel(team.teammate1, team.teammate2) : 'Removed team'
  }
  return (
    <section className={signals.length ? 'panel integrity has-flags' : 'panel integrity'}>
      <div className="section-head">
        <h2>
          Fair play {signals.length > 0 && <span className="count-badge">{signals.length}</span>}
        </h2>
        {signals.length > 0 && (
          <button className="btn tiny" type="button" onClick={onDismissAll}>
            Dismiss all
          </button>
        )}
      </div>
      {signals.length === 0 ? (
        <p className="quiet">
          Nothing suspicious. Phones report when a team leaves the page during a round, and very fast lock-ins are flagged here.
        </p>
      ) : (
        <ul className="signal-list">
          {signals.map((signal) => (
            <li key={signal.id} className={`signal ${signal.severity}`}>
              <div>
                <strong>{nameOf(signal.teamId)}</strong>
                <span className="signal-title">
                  {signal.title}
                  {signal.roundNumber > 0 && ` · round ${signal.roundNumber}`}
                </span>
                <span className="signal-detail">{signal.detail}</span>
              </div>
              <div className="signal-actions">
                {signal.guessId && (
                  <button className="btn tiny" type="button" onClick={() => onOpen(signal.guessId!)}>
                    View
                  </button>
                )}
                <button className="btn tiny" type="button" onClick={() => onDismiss(signal.id)}>
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function GuessDetail({
  state,
  guessId,
  onClose,
  onDelete,
}: {
  state: HostState
  guessId: string
  onClose: () => void
  onDelete: () => void
}) {
  const guess = state.guesses.find((item) => item.id === guessId)
  if (!guess) return null
  const team = state.teams.find((item) => item.id === guess.teamId)
  const verse = state.verses.find((item) => item.roundNumber === guess.roundNumber)
  const base = guess.bookScore + guess.chapterScore + guess.verseScore
  return (
    <Modal title={`Round ${guess.roundNumber} guess`} onClose={onClose}>
      <p>
        <strong>{team ? teamLabel(team.teammate1, team.teammate2) : 'Removed team'}</strong>
      </p>
      <dl className="detail-list">
        <dt>Guess</dt>
        <dd>
          {guess.guessBook} {guess.guessChapter}:{guess.guessVerse}
        </dd>
        <dt>Answer</dt>
        <dd>{verse ? formatReference(verse.book, verse.chapter, verse.verse) : '–'}</dd>
        <dt>Book</dt>
        <dd>{formatPoints(guess.bookScore)}</dd>
        <dt>Chapter</dt>
        <dd>{formatPoints(guess.chapterScore)}</dd>
        <dt>Verse</dt>
        <dd>{formatPoints(guess.verseScore)}</dd>
        <dt>Speed bonus</dt>
        <dd>
          {speedLabel(guess.speedBonus, guess.multiplier)
            ? `${formatPoints(base)} ${speedLabel(guess.speedBonus, guess.multiplier)}`
            : 'None'}
        </dd>
        <dt>Score</dt>
        <dd>
          <strong>{formatPoints(guess.score)}</strong>
        </dd>
      </dl>
      <div className="button-row">
        <button className="btn danger" type="button" onClick={onDelete}>
          Delete guess
        </button>
        <button className="btn" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}

function TeamEditor({
  team,
  busy,
  onSave,
  onDelete,
  onToggleBenched,
  onCancel,
}: {
  team: TeamRow
  busy: boolean
  onSave: (teammate1: string, teammate2: string, color: string) => void
  onDelete: () => void
  onToggleBenched: () => void
  onCancel: () => void
}) {
  const [teammate1, setTeammate1] = useState(team.teammate1)
  const [teammate2, setTeammate2] = useState(team.teammate2)
  const [color, setColor] = useState(team.color)

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault()
        onSave(teammate1, teammate2, color)
      }}
    >
      {team.benched && (
        <p>Inactive: scores are kept, but they are hidden on the big screen and nobody waits for them.</p>
      )}
      <div className="split">
        <input value={teammate1} onChange={(event) => setTeammate1(event.target.value)} maxLength={24} required aria-label="First name" />
        <input value={teammate2} onChange={(event) => setTeammate2(event.target.value)} maxLength={24} required aria-label="Second name" />
      </div>
      <div className="swatches">
        {TEAM_COLORS.map((swatch, index) => (
          <button
            key={swatch}
            type="button"
            className={color === swatch ? 'swatch selected' : 'swatch'}
            style={{ background: swatch }}
            onClick={() => setColor(swatch)}
            aria-label={TEAM_COLOR_NAMES[index]}
            aria-pressed={color === swatch}
          />
        ))}
      </div>
      <div className="button-row">
        <button className="btn primary" type="submit" disabled={busy}>
          Save team
        </button>
        {team.active && (
          <button className="btn" type="button" onClick={onToggleBenched} disabled={busy}>
            {team.benched ? 'Mark active' : 'Mark inactive'}
          </button>
        )}
        <button className="btn danger" type="button" onClick={onDelete}>
          Remove team
        </button>
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
