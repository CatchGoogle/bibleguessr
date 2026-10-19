import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { CountUp } from './Standings.tsx'
import { formatPoints, PERFECT_SCORE } from '../game/scoring.ts'
import { teamLabel } from '../game/types.ts'
import type { RevealResult } from '../game/types.ts'

const SPARKS = Array.from({ length: 20 }, (_, index) => index)

export function PerfectScore({ teams }: { teams: RevealResult[] }) {
  const reduce = useRef(typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches).current
  const [hit, setHit] = useState(reduce)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setGone(true), reduce ? 2400 : 5600)
    return () => window.clearTimeout(id)
  }, [reduce])

  if (gone) return null

  return (
    <div className={hit ? `perfect-overlay hit${reduce ? ' brief' : ''}` : 'perfect-overlay'} aria-live="polite">
      <div className="perfect-rays" />
      <div className="perfect-flash" />
      <div className="perfect-ring" />
      {SPARKS.map((index) => (
        <span
          key={index}
          className={index % 2 ? 'perfect-spark shard' : 'perfect-spark'}
          style={{ '--a': `${index * 18}deg` } as CSSProperties}
        />
      ))}
      <div className="perfect-copy">
        <p className="perfect-kicker">{teams.length > 1 ? `${teams.length} perfect` : 'Perfect'}</p>
        <p className="perfect-figure">
          {reduce ? (
            formatPoints(PERFECT_SCORE)
          ) : (
            <CountUp from={0} to={PERFECT_SCORE} ms={1500} onComplete={() => setHit(true)} />
          )}
        </p>
        <ul className="perfect-teams">
          {teams.map((team, index) => (
            <li key={team.teamId} style={{ animationDelay: `${0.15 + index * 0.12}s` }}>
              <i style={{ background: team.color }} />
              <span>{teamLabel(team.teammate1, team.teammate2)}</span>
              {team.score > PERFECT_SCORE && <em>{formatPoints(team.score)} with speed</em>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
