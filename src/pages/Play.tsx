import { useEffect, useMemo, useRef, useState } from 'react'
import { ConnectionBadge } from '../components/ConnectionBadge.tsx'
import { Wordmark } from '../components/Wordmark.tsx'
import { BOOKS, chapterCount, MAX_VERSE } from '../game/books.ts'
import { distanceLabel, formatPoints, formatReference } from '../game/scoring.ts'
import { TEAM_COLORS, formatClock, guessesOpen, remainingMs, teamLabel, timerState } from '../game/types.ts'
import type { PublicGame } from '../game/types.ts'
import { joinTeam, reportAway, submitGuess, teamHeartbeat } from '../lib/api.ts'
import { clearTeam, readTeam, writeTeam } from '../lib/storage.ts'
import type { StoredTeam } from '../lib/storage.ts'
import { supabaseConfigured } from '../lib/supabase.ts'
import { useNow, usePublicGame } from '../lib/useGame.ts'

const REVEAL_DELAY_MS = 1900

export function Play() {
  const { game, error, loading, connection } = usePublicGame()
  const now = useNow()
  const [team, setTeam] = useState<StoredTeam | null>(() => readTeam())
  const [formError, setFormError] = useState<string | null>(null)

  // Tell the server we are still here, and notice if the host removed this team.
  useEffect(() => {
    if (!team || !supabaseConfigured()) return
    let cancelled = false
    const ping = () => {
      teamHeartbeat(team.id)
        .then((known) => {
          if (cancelled || known) return
          clearTeam()
          setTeam(null)
          setFormError('This team is no longer in the game. Join again to keep playing.')
        })
        .catch(() => {
          // Offline blips are handled by the connection badge.
        })
    }
    ping()
    const id = window.setInterval(ping, 15_000)
    const wake = () => {
      if (document.visibilityState === 'visible') ping()
    }
    document.addEventListener('visibilitychange', wake)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [team])

  if (!supabaseConfigured()) {
    return (
      <main className="page narrow">
        <p className="notice">Add Supabase keys to .env.local, then reload this page.</p>
      </main>
    )
  }

  return (
    <main className="page narrow play-page">
      <header className="topbar">
        <Wordmark />
      </header>
      <ConnectionBadge connection={connection} />
      {(error || formError) && <p className="notice error">{error || formError}</p>}
      {loading && !game && <p>Loading the game…</p>}
      {game && !team && (
        <JoinForm
          onJoin={async (next) => {
            setFormError(null)
            try {
              const saved = await joinTeam(next.teammate1, next.teammate2, next.color)
              writeTeam(saved)
              setTeam(saved)
            } catch (err) {
              setFormError(err instanceof Error ? err.message : 'Could not join.')
            }
          }}
        />
      )}
      {game && team && (
        <GuessScreen game={game} team={team} now={now} onError={setFormError} />
      )}
    </main>
  )
}

function JoinForm({ onJoin }: { onJoin: (team: StoredTeam) => Promise<void> }) {
  const [teammate1, setTeammate1] = useState('')
  const [teammate2, setTeammate2] = useState('')
  const [color, setColor] = useState<string>(TEAM_COLORS[0])
  const [busy, setBusy] = useState(false)

  return (
    <form
      className="stack panel"
      onSubmit={(event) => {
        event.preventDefault()
        setBusy(true)
        void onJoin({ id: '', teammate1, teammate2, color }).finally(() => setBusy(false))
      }}
    >
      <h1>Join as a team</h1>
      <label>
        First name
        <input value={teammate1} onChange={(event) => setTeammate1(event.target.value)} maxLength={24} required />
      </label>
      <label>
        Second name
        <input value={teammate2} onChange={(event) => setTeammate2(event.target.value)} maxLength={24} required />
      </label>
      <div className="swatches" role="group" aria-label="Team color">
        {TEAM_COLORS.map((swatch, index) => (
          <button
            key={swatch}
            type="button"
            className={color === swatch ? 'swatch selected' : 'swatch'}
            style={{ background: swatch }}
            onClick={() => setColor(swatch)}
            aria-label={`Color ${index + 1}`}
            aria-pressed={color === swatch}
          />
        ))}
      </div>
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'Joining…' : 'Join game'}
      </button>
    </form>
  )
}

// While a guess is still open, tell the server how long this phone spent on another app or tab.
// The host sees it as a hint, not a verdict: people also answer a text message.
function useAwayReporter(teamId: string, round: number, active: boolean) {
  useEffect(() => {
    if (!active) return
    let count = 0
    let totalMs = 0
    let leftAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null

    const send = () => {
      void reportAway(teamId, round, count, totalMs).catch(() => undefined)
    }
    const leave = () => {
      if (leftAt !== null) return
      leftAt = Date.now()
    }
    const back = () => {
      if (leftAt === null) return
      const spent = Date.now() - leftAt
      leftAt = null
      if (spent < 2000) return
      count += 1
      totalMs += spent
      send()
    }
    const onVisibility = () => (document.visibilityState === 'hidden' ? leave() : back())
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', leave)
    window.addEventListener('focus', back)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', leave)
      window.removeEventListener('focus', back)
      back()
    }
  }, [teamId, round, active])
}

function GuessScreen({
  game,
  team,
  now,
  onError,
}: {
  game: PublicGame
  team: StoredTeam
  now: number
  onError: (message: string | null) => void
}) {
  const [lockedLocally, setLockedLocally] = useState(false)
  const roundRef = useRef(game.currentRound)
  const open = guessesOpen(game, now)
  const state = timerState(game, now)
  const remaining = remainingMs(game, now)
  const mine = game.snapshot.teams.find((item) => item.id === team.id)
  const locked = lockedLocally || Boolean(mine?.submitted)
  const reveal = game.snapshot.reveal
  const mineResult = reveal?.results.find((result) => result.teamId === team.id)
  const lockedCount = game.snapshot.teams.filter((item) => item.submitted).length

  // Hold the answer back so the projector gets to reveal it first.
  const [answerShown, setAnswerShown] = useState(false)
  useEffect(() => {
    if (!reveal) {
      setAnswerShown(false)
      return
    }
    const id = window.setTimeout(() => setAnswerShown(true), REVEAL_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [reveal, game.currentRound])

  useEffect(() => {
    if (roundRef.current === game.currentRound) return
    roundRef.current = game.currentRound
    setLockedLocally(false)
  }, [game.currentRound])

  useAwayReporter(team.id, game.currentRound, game.phase === 'guessing' && !locked && open)

  const clockClass = remaining <= 10_000 && game.phase === 'guessing' && state !== 'idle' ? 'clock urgent' : 'clock'

  return (
    <section className="stack">
      <p className="eyebrow">
        {teamLabel(team.teammate1, team.teammate2)} · Round {game.currentRound}
      </p>
      {game.phase !== 'lobby' && <p className={clockClass}>{formatClock(remaining)}</p>}
      {game.phase === 'guessing' && (
        <p className="quiet">
          {lockedCount} of {game.snapshot.teams.length} teams locked in
        </p>
      )}
      {game.phase === 'lobby' && (
        <p className="panel waiting">Waiting for the host to start the round. Keep this page open.</p>
      )}
      {game.phase !== 'lobby' && (
        <blockquote className="passage">
          {game.snapshot.verseText ?? 'The host has not entered this passage yet.'}
        </blockquote>
      )}
      {game.phase === 'reveal' && reveal && !answerShown && <p className="panel waiting">Revealing the answer…</p>}
      {game.phase === 'reveal' && reveal && answerShown && (
        <div className="panel">
          <p className="reference">{formatReference(reveal.book, reveal.chapter, reveal.verse)}</p>
          {mineResult?.guessBook ? (
            <p>
              {distanceLabel(
                mineResult.guessBook,
                mineResult.guessChapter ?? 0,
                mineResult.guessVerse ?? 0,
                reveal.book,
                reveal.chapter,
                reveal.verse,
              )}{' '}
              · <strong>{formatPoints(mineResult.score)} points</strong>
            </p>
          ) : (
            <p>No guess locked in.</p>
          )}
        </div>
      )}
      {game.phase === 'guessing' && locked && (
        <p className="panel locked">Guess locked in. Watch the big screen for the reveal.</p>
      )}
      {game.phase === 'guessing' && !locked && !open && <p className="panel timesup">Time’s up. Guesses are closed.</p>}
      {game.phase === 'guessing' && !locked && open && (
        <GuessForm
          key={game.currentRound}
          teamId={team.id}
          onLocked={() => setLockedLocally(true)}
          onError={onError}
        />
      )}
    </section>
  )
}

function GuessForm({
  teamId,
  onLocked,
  onError,
}: {
  teamId: string
  onLocked: () => void
  onError: (message: string | null) => void
}) {
  const [testament, setTestament] = useState<'all' | 'OT' | 'NT'>('all')
  const [query, setQuery] = useState('')
  const [book, setBook] = useState('')
  const [chapter, setChapter] = useState('')
  const [verse, setVerse] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const books = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return BOOKS.filter((item) => {
      if (testament !== 'all' && item.testament !== testament) return false
      return !needle || item.name.toLowerCase().includes(needle)
    })
  }, [query, testament])

  const maxChapter = book ? chapterCount(book) : 0
  const chapterNumber = Number(chapter)
  const verseNumber = Number(verse)
  const chapterOk = Number.isInteger(chapterNumber) && chapterNumber >= 1 && chapterNumber <= maxChapter
  const verseOk = Number.isInteger(verseNumber) && verseNumber >= 1 && verseNumber <= MAX_VERSE
  const valid = Boolean(book) && chapterOk && verseOk

  if (confirming && valid) {
    return (
      <div className="stack panel confirm-guess">
        <p className="eyebrow">Ready to lock in?</p>
        <p className="reference">{formatReference(book, chapterNumber, verseNumber)}</p>
        <p className="quiet">You can’t change this once it’s locked in.</p>
        <button
          className="btn primary"
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            onError(null)
            void submitGuess(teamId, book, chapterNumber, verseNumber)
              .then(onLocked)
              .catch((err: unknown) => {
                onError(err instanceof Error ? err.message : 'Could not submit.')
                setConfirming(false)
              })
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Locking in…' : 'Lock it in'}
        </button>
        <button className="btn" type="button" disabled={busy} onClick={() => setConfirming(false)}>
          Change my guess
        </button>
      </div>
    )
  }

  return (
    <form
      className="stack panel"
      onSubmit={(event) => {
        event.preventDefault()
        if (valid) setConfirming(true)
      }}
    >
      <div className="chosen">
        <span className="eyebrow">Your guess</span>
        <strong>{book ? `${book} ${chapter || '–'}:${verse || '–'}` : 'Pick a book'}</strong>
      </div>

      <div className="tabs" role="tablist" aria-label="Testament">
        {(['all', 'OT', 'NT'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={testament === value}
            className={testament === value ? 'tab on' : 'tab'}
            onClick={() => setTestament(value)}
          >
            {value === 'all' ? 'All' : value === 'OT' ? 'Old' : 'New'}
          </button>
        ))}
      </div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search books"
        aria-label="Search books"
        autoComplete="off"
      />
      <ul className="book-grid">
        {books.map((item) => (
          <li key={item.name}>
            <button
              type="button"
              className={item.name === book ? 'selected' : ''}
              onClick={() => {
                setBook(item.name)
                if (chapter && Number(chapter) > chapterCount(item.name)) setChapter(String(chapterCount(item.name)))
              }}
            >
              {item.name}
            </button>
          </li>
        ))}
        {books.length === 0 && <li className="quiet">No book matches that search.</li>}
      </ul>

      <div className="split">
        <label>
          Chapter
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={maxChapter || undefined}
            value={chapter}
            onChange={(event) => setChapter(event.target.value)}
            disabled={!book}
            aria-invalid={Boolean(chapter) && !chapterOk}
            required
          />
        </label>
        <label>
          Verse
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_VERSE}
            value={verse}
            onChange={(event) => setVerse(event.target.value)}
            disabled={!book}
            aria-invalid={Boolean(verse) && !verseOk}
            required
          />
        </label>
      </div>
      {book && <p className="quiet">{book} has {maxChapter} {maxChapter === 1 ? 'chapter' : 'chapters'}.</p>}
      {Boolean(chapter) && book && !chapterOk && <p className="field-error">Choose a chapter from 1 to {maxChapter}.</p>}
      <button className="btn primary" type="submit" disabled={!valid}>
        Review guess
      </button>
    </form>
  )
}
