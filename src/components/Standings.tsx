import { useEffect, useState } from 'react'
import { standings } from '../game/standings.ts'
import { teamLabel } from '../game/types.ts'
import type { RevealResult } from '../game/types.ts'

export function CountUp({ from, to, ms = 1300 }: { from: number; to: number; ms?: number }) {
  const [value, setValue] = useState(from)
  useEffect(() => {
    let frame = 0
    const start = performance.now()
    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / ms)
      setValue(Math.round(from + (to - from) * (1 - Math.pow(1 - progress, 3))))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [from, to, ms])
  return <>{value}</>
}

function Change({ change }: { change: number }) {
  if (change > 0) return <span className="move up">▲ {change}</span>
  if (change < 0) return <span className="move down">▼ {-change}</span>
  return <span className="move same">–</span>
}

export function Standings({ results, final }: { results: RevealResult[]; final: boolean }) {
  const rows = standings(results)
  const podium = final ? rows.slice(0, 3) : []
  const rest = final ? rows.slice(3) : rows

  return (
    <div className="standings">
      <p className="answer-kicker">{final ? 'Final standings' : 'Standings'}</p>
      {final && podium.length > 0 && (
        <div className="podium">
          {[1, 0, 2]
            .filter((slot) => podium[slot])
            .map((slot) => {
              const row = podium[slot]
              return (
                <div key={row.result.teamId} className={`podium-slot place-${row.rank}`} style={{ animationDelay: `${(2 - slot) * 0.5}s` }}>
                  <strong>{teamLabel(row.result.teammate1, row.result.teammate2)}</strong>
                  <span className="podium-score">
                    <CountUp from={row.previousTotal} to={row.result.totalScore} />
                  </span>
                  <div className="podium-block" style={{ background: row.result.color }}>
                    {row.rank}
                  </div>
                </div>
              )
            })}
        </div>
      )}
      <ol className={rows.length > 8 ? 'standing-list dense' : 'standing-list'}>
        {rest.map((row, index) => (
          <li
            key={row.result.teamId}
            className={row.rank === 1 ? 'lead' : undefined}
            style={{ animationDelay: `${index * 0.08}s` }}
          >
            <b className="rank">{row.rank}</b>
            <i style={{ background: row.result.color }} />
            <strong>{teamLabel(row.result.teammate1, row.result.teammate2)}</strong>
            <Change change={row.change} />
            <em>
              <CountUp from={row.previousTotal} to={row.result.totalScore} />
            </em>
          </li>
        ))}
      </ol>
    </div>
  )
}
