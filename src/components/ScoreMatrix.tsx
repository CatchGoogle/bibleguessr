import { formatPoints, formatReference } from '../game/scoring.ts'
import { teamLabel } from '../game/types.ts'
import type { GuessRow, HostState } from '../game/types.ts'

export function ScoreMatrix({
  state,
  onOpen,
  flagged,
}: {
  state: HostState
  onOpen: (guessId: string) => void
  flagged?: Set<string>
}) {
  const guessByCell = new Map<string, GuessRow>()
  for (const guess of state.guesses) guessByCell.set(`${guess.teamId}:${guess.roundNumber}`, guess)

  const teams = state.teams
    .filter((team) => team.active || state.guesses.some((guess) => guess.teamId === team.id))
    .sort((a, b) => Number(b.active) - Number(a.active))

  const throughRound = state.currentRound
  const totals = new Map<string, number>()
  for (const guess of state.guesses) {
    if (guess.roundNumber > throughRound) continue
    totals.set(guess.teamId, (totals.get(guess.teamId) ?? 0) + guess.score)
  }
  const best = Math.max(0, ...totals.values())

  if (teams.length === 0 || state.verses.length === 0) {
    return <p className="quiet">Scores appear here once teams join and rounds are added.</p>
  }

  return (
    <div className="matrix-scroll">
      <table className="score-matrix">
        <thead>
          <tr>
            <th scope="col">Round</th>
            {teams.map((team) => (
              <th scope="col" key={team.id} className={team.active ? '' : 'gone'}>
                <i style={{ background: team.color }} />
                {teamLabel(team.teammate1, team.teammate2)}
              </th>
            ))}
            <th scope="col">Avg</th>
          </tr>
        </thead>
        <tbody>
          {state.verses.map((verse) => {
            const cells = teams.map((team) => guessByCell.get(`${team.id}:${verse.roundNumber}`))
            const scored = cells.filter((cell): cell is GuessRow => Boolean(cell))
            const top = Math.max(0, ...scored.map((cell) => cell.score))
            const average = scored.length ? Math.round(scored.reduce((sum, cell) => sum + cell.score, 0) / scored.length) : null
            return (
              <tr key={verse.id} className={verse.roundNumber === state.currentRound ? 'current' : ''}>
                <th scope="row">
                  <strong>{verse.roundNumber}</strong>
                  <span>{formatReference(verse.book, verse.chapter, verse.verse)}</span>
                </th>
                {cells.map((cell, index) => (
                  <td key={teams[index].id}>
                    {cell ? (
                      <button
                        type="button"
                        className={`${cell.score === top && top > 0 ? 'cell top' : 'cell'}${
                          flagged?.has(`${teams[index].id}:${verse.roundNumber}`) ? ' flagged' : ''
                        }`}
                        onClick={() => onOpen(cell.id)}
                        title={`${cell.guessBook} ${cell.guessChapter}:${cell.guessVerse}`}
                      >
                        {formatPoints(cell.score)}
                      </button>
                    ) : (
                      <span className="empty">–</span>
                    )}
                  </td>
                ))}
                <td className="avg">{average == null ? '–' : formatPoints(average)}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{state.verses.some((verse) => verse.roundNumber > throughRound) ? `Through ${throughRound}` : 'Total'}</th>
            {teams.map((team) => {
              const total = totals.get(team.id) ?? 0
              return (
                <td key={team.id} className={total === best && best > 0 ? 'total leader' : 'total'}>
                  {formatPoints(total)}
                </td>
              )
            })}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export function downloadScoresCsv(state: HostState) {
  const lines = [['Round', 'Answer', 'Team', 'Guess', 'Book points', 'Chapter points', 'Verse points', 'Multiplier', 'Score']]
  for (const guess of state.guesses) {
    const team = state.teams.find((item) => item.id === guess.teamId)
    const verse = state.verses.find((item) => item.roundNumber === guess.roundNumber)
    lines.push([
      String(guess.roundNumber),
      verse ? formatReference(verse.book, verse.chapter, verse.verse) : '',
      team ? teamLabel(team.teammate1, team.teammate2) : 'Removed team',
      `${guess.guessBook} ${guess.guessChapter}:${guess.guessVerse}`,
      String(guess.bookScore),
      String(guess.chapterScore),
      String(guess.verseScore),
      guess.multiplier.toFixed(2),
      String(guess.score),
    ])
  }
  const csv = lines.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'bibleguessr-scores.csv'
  link.click()
  URL.revokeObjectURL(url)
}
