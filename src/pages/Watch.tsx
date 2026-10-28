import { useEffect, useMemo, useRef, useState } from 'react'
import { ConnectionBadge } from '../components/ConnectionBadge.tsx'
import { CountUp, Standings } from '../components/Standings.tsx'
import { PERFECT_HOLD_MS, PerfectScore } from '../components/PerfectScore.tsx'
import { Timeline } from '../components/Timeline.tsx'
import { Wordmark } from '../components/Wordmark.tsx'
import { FittedQuote } from '../components/FittedQuote.tsx'
import { previewGame } from '../game/preview.ts'
import type { PreviewPhase } from '../game/preview.ts'
import { distanceLabel, formatReference, isPerfectScore, speedLabel } from '../game/scoring.ts'
import { playCountdown, playGuess, playRoundStart, playTimeUp, unlockSound } from '../game/sounds.ts'
import { bandFor } from '../game/standings.ts'
import { BAND_COLORS, formatClock, remainingMs, teamLabel, timerState } from '../game/types.ts'
import type { Phase, PublicGame, TimerState } from '../game/types.ts'
import { sitePath } from '../lib/site.ts'
import { useNow, usePublicGame } from '../lib/useGame.ts'

const STAGE_WIDTH = 3200
const STAGE_HEIGHT = 1080
const INTRO_MS = 2400

export function Watch({ preview = false }: { preview?: boolean }) {
  const live = usePublicGame(!preview)
  const [previewPhase, setPreviewPhase] = useState<PreviewPhase>('guessing')
  const fixture = useMemo(() => previewGame(previewPhase), [previewPhase])
  const game = preview ? fixture : live.game
  const scale = useStageScale()
  useAutoSound()

  return (
    <div className="watch-root">
      <div className="watch-fit" style={{ width: STAGE_WIDTH * scale, height: STAGE_HEIGHT * scale }}>
        <div className="watch-stage" style={{ zoom: scale }}>
          {preview && <PreviewSwitch phase={previewPhase} onChange={setPreviewPhase} />}
          {!preview && live.loading && !live.game && <p className="watch-message">Opening the game…</p>}
          {!preview && live.error && !live.game && <p className="watch-message">{live.error}</p>}
          {!preview && live.game && <ConnectionBadge connection={live.connection} dark />}
          {game && <Stage game={game} />}
        </div>
      </div>
    </div>
  )
}

function Stage({ game }: { game: PublicGame }) {
  const now = useNow(game.phase === 'guessing' && timerState(game, Date.now()) === 'running')
  const effects = game.snapshot.effects
  const intro = useRoundIntro(game.phase, game.currentRound, effects)
  const shaking = usePinShake(game, effects)
  const reveal = game.phase === 'reveal' ? game.snapshot.reveal : null
  const celebrate = reveal?.results.some((result) => isPerfectScore(result.bookScore, result.chapterScore, result.verseScore)) ?? false
  const stage = useRevealStage(Boolean(reveal), `${game.currentRound}:${reveal?.book}:${reveal?.chapter}`, celebrate)

  const total = game.snapshot.totalRounds
  const roundLabel = total > 0 ? `Round ${game.currentRound} of ${total}` : `Round ${game.currentRound}`

  let body
  if (game.phase === 'lobby') {
    body = <Lobby game={game} />
  } else if (reveal) {
    body = <RevealView game={game} reveal={reveal} stage={stage} roundLabel={roundLabel} />
  } else {
    body = <GuessingView game={game} now={now} roundLabel={roundLabel} />
  }

  return (
    <div className={shaking ? 'stage-layout-wrap shaking' : 'stage-layout-wrap'}>
      {body}
      {intro !== null && (
        <div className="round-intro" key={intro}>
          <p>Round</p>
          <strong>{intro}</strong>
          {total > 0 && <span>of {total}</span>}
        </div>
      )}
    </div>
  )
}

function Lobby({ game }: { game: PublicGame }) {
  const teams = game.snapshot.teams
  return (
    <div className="stage-layout lobby-view">
      <Wordmark />
      <p className="join-line">
        Join on your phone at <strong>{window.location.host}{sitePath() === '/' ? '' : sitePath()}</strong>
      </p>
      {teams.length === 0 ? (
        <p className="quiet">Waiting for the first team…</p>
      ) : (
        <ul className={teams.length > 8 ? 'roster dense' : 'roster'}>
          {teams.map((team, index) => (
            <li key={team.id} style={{ animationDelay: `${Math.min(index, 10) * 0.06}s` }}>
              <i style={{ background: team.color }} />
              {teamLabel(team.teammate1, team.teammate2)}
            </li>
          ))}
        </ul>
      )}
      <p className="lobby-note">
        {teams.length} {teams.length === 1 ? 'team' : 'teams'} ready. Waiting for the host to start.
      </p>
    </div>
  )
}

function GuessingView({ game, now, roundLabel }: { game: PublicGame; now: number; roundLabel: string }) {
  const remaining = remainingMs(game, now)
  const state = timerState(game, now)
  const tone = state === 'idle' ? '' : remaining <= 10_000 ? ' danger' : remaining <= 30_000 ? ' warn' : ''
  const teams = game.snapshot.teams
  const locked = teams.filter((team) => team.submitted).length
  useCountdownChime(remaining, game.phase, state, game.currentRound)

  return (
    <div className="stage-layout">
      <aside className="rail">
        <Wordmark />
        <p className="round-label">{roundLabel}</p>
        <p className={`stage-clock${tone}`}>{formatClock(remaining)}</p>
        {state === 'ended' && <p className="timesup-label">Time’s up</p>}
      </aside>
      <section className="passage-pane">
        <FittedQuote text={game.snapshot.verseText ?? 'Waiting for a passage.'} max={96} min={30} />
      </section>
      <aside className={teams.length > 8 ? 'rail teams-rail dense' : 'rail teams-rail'}>
        <h2>
          Teams <small>{locked}/{teams.length} locked in</small>
        </h2>
        <ul>
          {teams.map((team) => (
            <li key={team.id} className={team.submitted ? 'locked' : ''}>
              <i style={{ background: team.color }} />
              <span>{teamLabel(team.teammate1, team.teammate2)}</span>
              <em>{team.submitted ? 'Locked in' : 'Thinking…'}</em>
            </li>
          ))}
        </ul>
        {teams.length === 0 && <p className="quiet">Teams join on their phones.</p>}
      </aside>
      <section className="map-band">
        <p className="map-count">Guesses show up here when the answer is revealed</p>
        <Timeline pins={[]} answer={null} showAnswer={false} />
      </section>
    </div>
  )
}

function RevealView({
  game,
  reveal,
  stage,
  roundLabel,
}: {
  game: PublicGame
  reveal: NonNullable<PublicGame['snapshot']['reveal']>
  stage: number
  roundLabel: string
}) {
  const total = game.snapshot.totalRounds
  const final = total > 0 && game.currentRound >= total
  const perfects = reveal.results.filter((result) => isPerfectScore(result.bookScore, result.chapterScore, result.verseScore))
  // The host decides when the final standings appear; other rounds show them on a timer.
  const showStandings = final ? game.snapshot.standingsRevealed && stage >= 2 : stage >= 3
  const showCards = !showStandings && (stage === 2 || (final && stage >= 3))

  if (final && showStandings) {
    return (
      <div className="stage-layout finals">
        <Standings results={reveal.results} final />
      </div>
    )
  }

  return (
    <div className="stage-layout reveal">
      <section className="map-pane">
        <div className="stage-kicker">
          <Wordmark />
          <span>{roundLabel}</span>
        </div>
        <Timeline
          pins={game.snapshot.pins}
          answer={stage >= 1 ? { book: reveal.book, chapter: reveal.chapter } : null}
          showAnswer={stage >= 1}
        />
      </section>
      <section className="result-pane">
        {stage === 0 && (
          <>
            <p className="answer-kicker">Guesses are in</p>
            <h2 className="drumroll">And the answer is…</h2>
            <ul className="result-list simple">
              {game.snapshot.teams.map((team) => (
                <li key={team.id}>
                  <i style={{ background: team.color }} />
                  <strong>{teamLabel(team.teammate1, team.teammate2)}</strong>
                  <span>{team.submitted ? 'Locked in' : 'No guess'}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {stage === 1 && (
          <div className="answer-card">
            <p className="answer-kicker">Correct answer</p>
            <h2 className="answer-ref">{formatReference(reveal.book, reveal.chapter, reveal.verse)}</h2>
            <blockquote>{game.snapshot.verseText}</blockquote>
          </div>
        )}
        {showCards && (
          <>
            <p className="answer-kicker">Correct answer</p>
            <h2 className="answer-ref small">{formatReference(reveal.book, reveal.chapter, reveal.verse)}</h2>
            <ul className={reveal.results.length > 8 ? 'result-list cards dense' : 'result-list cards'}>
              {reveal.results.map((result, index) => {
                const band = bandFor(result)
                const speed = speedLabel(result.speedBonus, result.multiplier)
                return (
                  <li key={result.teamId} className={band === 'perfect' ? 'perfect-row' : undefined} style={{ animationDelay: `${index * 0.14}s` }}>
                    <i style={{ background: result.color }} />
                    <div className="rc-main">
                      <strong>{teamLabel(result.teammate1, result.teammate2)}</strong>
                      <span className="rc-guess">
                        {result.guessBook
                          ? `${result.guessBook} ${result.guessChapter}:${result.guessVerse}`
                          : 'No guess'}
                      </span>
                    </div>
                    <div className="rc-band">
                      {band && <span className="band-dot" style={{ background: BAND_COLORS[band] }} />}
                      {result.guessBook
                        ? distanceLabel(
                            result.guessBook,
                            result.guessChapter ?? 0,
                            result.guessVerse ?? 0,
                            reveal.book,
                            reveal.chapter,
                            reveal.verse,
                          )
                        : '–'}
                    </div>
                    <div className="rc-score">
                      <em>
                        {result.guessBook ? (
                          <>
                            +
                            <CountUp
                              from={0}
                              to={result.score}
                              ms={1500}
                              delay={perfects.length > 0 ? PERFECT_HOLD_MS : 0}
                              ticker
                            />
                          </>
                        ) : (
                          '–'
                        )}
                      </em>
                      {result.guessBook && speed && <small>{speed}</small>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
        {showStandings && <Standings results={reveal.results} final={final} />}
        {final && !showStandings && stage >= 2 && <p className="standings-hold">Final standings coming up…</p>}
      </section>
      {perfects.length > 0 && stage >= 2 && !showStandings && (
        <PerfectScore key={`${game.currentRound}:${reveal.book}:${reveal.verse}`} teams={perfects} />
      )}
    </div>
  )
}

// A full-screen "Round N" when a round begins. Matches the server's short pause before the clock starts.
// The veil is decided during render, not after paint, so the new passage never shows uncovered.
function useRoundIntro(phase: Phase, round: number, effects: boolean): number | null {
  const [tracked, setTracked] = useState({ phase, round })
  const [intro, setIntro] = useState<number | null>(null)

  if (tracked.phase !== phase || tracked.round !== round) {
    setTracked({ phase, round })
    const starting = phase === 'guessing' && (tracked.phase !== 'guessing' || tracked.round !== round)
    setIntro(starting ? round : null)
  }

  useEffect(() => {
    if (intro === null) return
    playRoundStart()
    const id = window.setTimeout(() => setIntro(null), effects ? INTRO_MS : 1400)
    return () => window.clearTimeout(id)
  }, [intro, effects])

  return intro
}

// A brief shake each time another team locks in.
function usePinShake(game: PublicGame, effects: boolean): boolean {
  const [shaking, setShaking] = useState(false)
  const count = game.snapshot.teams.filter((team) => team.submitted).length
  const previous = useRef({ round: game.currentRound, count, phase: game.phase })

  useEffect(() => {
    const before = previous.current
    previous.current = { round: game.currentRound, count, phase: game.phase }
    if (game.phase !== 'guessing') return
    if (before.round !== game.currentRound || before.phase !== 'guessing') return
    if (count <= before.count) return
    playGuess()
    if (!effects) return
    setShaking(true)
    const id = window.setTimeout(() => setShaking(false), 500)
    return () => window.clearTimeout(id)
  }, [count, game.currentRound, game.phase, effects])

  return shaking
}

// Reveal in beats: guesses are in, the answer lands, round results, then standings.
function useRevealStage(active: boolean, resetKey: string, celebrate: boolean): number {
  const [stage, setStage] = useState(0)

  useEffect(() => {
    setStage(0)
    if (!active) return
    const ids = [
      window.setTimeout(() => setStage(1), 1900),
      window.setTimeout(() => setStage(2), 4600),
      window.setTimeout(() => setStage(3), celebrate ? 15_400 : 11_600),
    ]
    return () => ids.forEach((id) => window.clearTimeout(id))
  }, [active, resetKey, celebrate])

  return stage
}

const PREVIEW_PHASES: { value: PreviewPhase; label: string }[] = [
  { value: 'lobby', label: 'Lobby' },
  { value: 'guessing', label: 'Guessing' },
  { value: 'crowd', label: '12 teams' },
  { value: 'reveal', label: 'Reveal' },
  { value: 'finalwait', label: 'Final (held)' },
  { value: 'final', label: 'Final' },
]

function useCountdownChime(remaining: number, phase: Phase, state: TimerState, round: number) {
  const last = useRef<number | null>(null)
  const roundSeen = useRef(round)
  const second = Math.ceil(remaining / 1000)

  useEffect(() => {
    if (roundSeen.current !== round) {
      roundSeen.current = round
      last.current = null
    }
    if (phase !== 'guessing' || state === 'idle') {
      last.current = null
      return
    }
    if (state === 'paused') return
    if (last.current === null) {
      last.current = second
      return
    }
    if (second === last.current) return
    if (second > last.current) {
      last.current = second
      return
    }
    const previous = last.current
    last.current = second
    if (second >= 1 && second <= 5) playCountdown(second)
    if (previous > 0 && second <= 0) playTimeUp()
  }, [second, phase, state, round])
}

function useAutoSound() {
  useEffect(() => {
    unlockSound()
    const open = () => unlockSound()
    window.addEventListener('pointerdown', open)
    window.addEventListener('keydown', open)
    document.addEventListener('visibilitychange', open)
    return () => {
      window.removeEventListener('pointerdown', open)
      window.removeEventListener('keydown', open)
      document.removeEventListener('visibilitychange', open)
    }
  }, [])
}

function PreviewSwitch({ phase, onChange }: { phase: PreviewPhase; onChange: (phase: PreviewPhase) => void }) {
  return (
    <div className="preview-switch">
      {PREVIEW_PHASES.map((item) => (
        <button key={item.value} type="button" className={phase === item.value ? 'on' : ''} onClick={() => onChange(item.value)}>
          {item.label}
        </button>
      ))}
    </div>
  )
}

function useStageScale() {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  return scale
}
