import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { standings } from '../game/standings.ts'
import type { StandingRow } from '../game/standings.ts'
import { formatPoints } from '../game/scoring.ts'
import { startTicker, stopTicker } from '../game/sounds.ts'
import { colorName, teamLabel } from '../game/types.ts'
import type { RevealResult } from '../game/types.ts'

const RACE_MS = 2600

export function CountUp({
  from,
  to,
  ms = 1300,
  delay = 0,
  ticker = false,
  onComplete,
}: {
  from: number
  to: number
  ms?: number
  delay?: number
  ticker?: boolean
  onComplete?: () => void
}) {
  const [value, setValue] = useState(from)
  const done = useRef(onComplete)
  done.current = onComplete
  useEffect(() => {
    let frame = 0
    let ticking = false
    const stop = () => {
      if (!ticking) return
      ticking = false
      if (ticker) stopTicker()
    }
    const begin = () => {
      if (ticker) {
        ticking = true
        startTicker()
      }
      const start = performance.now()
      const tick = (time: number) => {
        const progress = Math.min(1, ms <= 0 ? 1 : (time - start) / ms)
        setValue(Math.round(from + (to - from) * (1 - Math.pow(1 - progress, 3))))
        if (progress < 1) frame = requestAnimationFrame(tick)
        else {
          stop()
          done.current?.()
        }
      }
      frame = requestAnimationFrame(tick)
    }
    const wait = window.setTimeout(begin, delay)
    return () => {
      window.clearTimeout(wait)
      cancelAnimationFrame(frame)
      stop()
    }
  }, [from, to, ms, delay, ticker])
  return <>{formatPoints(value)}</>
}

function shownScore(row: StandingRow, progress: number): number {
  return Math.round(row.previousTotal + (row.result.totalScore - row.previousTotal) * progress)
}

function previousRank(row: StandingRow): number {
  return row.rank + row.change
}

function orderByProgress(rows: StandingRow[], progress: number): StandingRow[] {
  return [...rows].sort((a, b) => {
    const diff = shownScore(b, progress) - shownScore(a, progress)
    if (diff !== 0) return diff
    return previousRank(a) - previousRank(b)
  })
}

function Change({ change }: { change: number }) {
  if (change > 0) return <span className="move up">▲ {change}</span>
  if (change < 0) return <span className="move down">▼ {-change}</span>
  return <span className="move same">–</span>
}

function rowLabel(result: RevealResult, grouped: boolean): string {
  return grouped ? colorName(result.color) : teamLabel(result.teammate1, result.teammate2)
}

export function Standings({ results, final, grouped = false }: { results: RevealResult[]; final: boolean; grouped?: boolean }) {
  const rows = useMemo(() => standings(results), [results])
  const reduce = useRef(typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches).current
  const [progress, setProgress] = useState(reduce ? 1 : 0)
  const [podiumOn, setPodiumOn] = useState(Boolean(reduce && final))

  // Play once per visit. The viewer replaces the results array every few seconds
  // while this round stays on screen; tying the race to that array restarts the count.
  useEffect(() => {
    if (reduce) return
    let frame = 0
    let ticking = true
    startTicker()
    const start = performance.now()
    const tick = (time: number) => {
      const next = Math.min(1, (time - start) / RACE_MS)
      setProgress(next)
      if (next < 1) frame = requestAnimationFrame(tick)
      else if (ticking) {
        ticking = false
        stopTicker()
      }
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      if (ticking) {
        ticking = false
        stopTicker()
      }
    }
  }, [reduce])

  useEffect(() => {
    if (!final || progress < 1) return
    const id = window.setTimeout(() => setPodiumOn(true), reduce ? 0 : 450)
    return () => window.clearTimeout(id)
  }, [final, progress, reduce])

  const ordered = useMemo(() => orderByProgress(rows, progress), [rows, progress])

  if (final && podiumOn) return <Podium rows={orderByProgress(rows, 1)} grouped={grouped} />

  return <Race rows={ordered} progress={progress} final={final} grouped={grouped} />
}

function Race({ rows, progress, final, grouped }: { rows: StandingRow[]; progress: number; final: boolean; grouped: boolean }) {
  const itemRefs = useRef(new Map<string, HTMLLIElement>())
  const tops = useRef(new Map<string, number>())
  const order = rows.map((row) => row.result.teamId).join('|')

  useLayoutEffect(() => {
    const next = new Map<string, number>()
    for (const [id, el] of itemRefs.current) {
      const top = el.getBoundingClientRect().top
      const before = tops.current.get(id)
      next.set(id, top)
      if (before == null) continue
      const dy = before - top
      if (Math.abs(dy) < 1) continue
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], {
        duration: 420,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      })
    }
    tops.current = next
  }, [order])

  return (
    <div className="standings">
      <p className="answer-kicker">{final ? 'Final standings' : 'Standings'}</p>
      <ol className={rows.length > 8 ? 'standing-list race dense' : grouped ? 'standing-list race grouped' : 'standing-list race'}>
        {rows.map((row, index) => {
          const liveRank = index + 1
          return (
            <li
              key={row.result.teamId}
              ref={(node) => {
                if (node) itemRefs.current.set(row.result.teamId, node)
                else itemRefs.current.delete(row.result.teamId)
              }}
              className={liveRank === 1 ? 'lead' : undefined}
            >
              <b className="rank">{liveRank}</b>
              <i style={{ background: row.result.color }} />
              <strong>{rowLabel(row.result, grouped)}</strong>
              <Change change={previousRank(row) - liveRank} />
              <em>{formatPoints(shownScore(row, progress))}</em>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Podium({ rows, grouped }: { rows: StandingRow[]; grouped: boolean }) {
  const podium = rows.slice(0, 3)
  const rest = rows.slice(3)

  return (
    <div className="standings">
      <p className="answer-kicker">Final standings</p>
      {podium.length > 0 && (
        <div className={grouped ? 'podium grouped' : 'podium'}>
          {[1, 0, 2]
            .filter((slot) => podium[slot])
            .map((slot) => {
              const row = podium[slot]
              return (
                <div key={row.result.teamId} className={`podium-slot place-${row.rank}`} style={{ animationDelay: `${(2 - slot) * 0.12}s` }}>
                  <strong>{rowLabel(row.result, grouped)}</strong>
                  <span className="podium-score">{formatPoints(row.result.totalScore)}</span>
                  <div className="podium-block" style={{ background: row.result.color }}>
                    {row.rank}
                  </div>
                </div>
              )
            })}
        </div>
      )}
      {rest.length > 0 && (
        <ol className={rows.length > 8 ? 'standing-list dense' : grouped ? 'standing-list grouped' : 'standing-list'}>
          {rest.map((row) => (
            <li key={row.result.teamId}>
              <b className="rank">{row.rank}</b>
              <i style={{ background: row.result.color }} />
              <strong>{rowLabel(row.result, grouped)}</strong>
              <Change change={row.change} />
              <em>{formatPoints(row.result.totalScore)}</em>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
