import { useEffect, useMemo, useRef, useState } from 'react'
import { ConnectionBadge } from '../components/ConnectionBadge.tsx'
import { FittedQuote } from '../components/FittedQuote.tsx'
import { Wordmark } from '../components/Wordmark.tsx'
import { BOOKS, chapterCount, MAX_VERSE } from '../game/books.ts'
import { distanceLabel, formatPoints, formatReference } from '../game/scoring.ts'
import { TEAM_COLORS, TEAM_COLOR_NAMES, formatClock, guessesOpen, remainingMs, teamLabel, timerState } from '../game/types.ts'
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

  const compact = Boolean(game && team && game.phase === 'guessing')

  return (
    <main className={compact ? 'page narrow play-page play-compact' : 'page narrow play-page'}>
      {!compact && (
        <header className="topbar">
          <Wordmark />
        </header>
      )}
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
            aria-label={TEAM_COLOR_NAMES[index]}
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
  const guessing = game.phase === 'guessing'

  return (
    <section className={guessing ? 'guess-screen' : 'stack'}>
      {game.phase === 'lobby' && (
        <p className="eyebrow">
          {teamLabel(team.teammate1, team.teammate2)} · Round {game.currentRound}
        </p>
      )}
      {game.phase !== 'lobby' && (
        <div className="guess-status">
          <p className="guess-who">{teamLabel(team.teammate1, team.teammate2)}</p>
          <p className="guess-meta">
            <span>Round {game.currentRound}</span>
            <span className={clockClass}>{formatClock(remaining)}</span>
            {guessing ? (
              <span>
                {lockedCount} of {game.snapshot.teams.length}
              </span>
            ) : (
              <span />
            )}
          </p>
        </div>
      )}
      {game.phase === 'lobby' && (
        <p className="panel waiting">Waiting for the host to start the round. Keep this page open.</p>
      )}
      {game.phase !== 'lobby' && (
        <FittedQuote
          className="passage passage-scroll"
          text={game.snapshot.verseText ?? 'The host has not entered this passage yet.'}
          max={18}
          min={13}
        />
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

function useKeyboardLift() {
  const [lift, setLift] = useState(0)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop
      setLift(covered > 80 ? Math.round(covered) : 0)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])
  return lift
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
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const chapterRef = useRef<HTMLInputElement>(null)
  const verseRef = useRef<HTMLInputElement>(null)
  const lift = useKeyboardLift()

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
  const reference = valid ? formatReference(book, chapterNumber, verseNumber) : ''

  function pickBook(name: string) {
    setBook(name)
    if (chapter && Number(chapter) > chapterCount(name)) setChapter(String(chapterCount(name)))
    setArmed(false)
    chapterRef.current?.focus()
    chapterRef.current?.select()
  }

  function lockIn() {
    if (!valid || busy) return
    if (!armed) {
      setArmed(true)
      return
    }
    setBusy(true)
    onError(null)
    void submitGuess(teamId, book, chapterNumber, verseNumber)
      .then(onLocked)
      .catch((err: unknown) => {
        onError(err instanceof Error ? err.message : 'Could not submit.')
        setArmed(false)
      })
      .finally(() => setBusy(false))
  }

  return (
    <form
      className="guess-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        lockIn()
      }}
    >
      <div className="guess-pick">
        {book ? (
          <div className="chosen-book">
            <strong>{book}</strong>
            <button
              type="button"
              className="change"
              onClick={() => {
                setBook('')
                setArmed(false)
              }}
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <div className="book-tools">
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
                enterKeyHint="search"
              />
            </div>
            <ul className="book-grid">
              {books.map((item) => (
                <li key={item.name}>
                  <button type="button" onClick={() => pickBook(item.name)}>
                    {item.name}
                  </button>
                </li>
              ))}
              {books.length === 0 && <li className="quiet">No book matches that search.</li>}
            </ul>
          </>
        )}
      </div>

      <div className="guess-dock" style={lift ? { transform: `translateY(-${lift}px)` } : undefined}>
        <label>
          Chapter
          <input
            ref={chapterRef}
            type="number"
            inputMode="numeric"
            enterKeyHint="next"
            min={1}
            max={maxChapter || undefined}
            placeholder={book ? `1–${maxChapter}` : '—'}
            value={chapter}
            onChange={(event) => {
              setChapter(event.target.value)
              setArmed(false)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              verseRef.current?.focus()
              verseRef.current?.select()
            }}
            aria-invalid={Boolean(chapter) && !chapterOk}
            required
          />
        </label>
        <label>
          Verse
          <input
            ref={verseRef}
            type="number"
            inputMode="numeric"
            enterKeyHint="done"
            min={1}
            max={MAX_VERSE}
            placeholder={book ? `1–${MAX_VERSE}` : '—'}
            value={verse}
            onChange={(event) => {
              setVerse(event.target.value)
              setArmed(false)
            }}
            aria-invalid={Boolean(verse) && !verseOk}
            required
          />
        </label>
        {book && chapter && !chapterOk && (
          <p className="field-error span">Chapters only go to {maxChapter}.</p>
        )}
        {armed && valid && <p className="quiet span">Tap again. You can’t change this after it’s locked in.</p>}
        <button className={armed ? 'btn primary span armed' : 'btn primary span'} type="submit" disabled={!valid || busy}>
          {busy ? 'Locking in…' : armed ? 'Lock it in' : reference ? `Lock in ${reference}` : 'Lock in'}
        </button>
      </div>
    </form>
  )
}
