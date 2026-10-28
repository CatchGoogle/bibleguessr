import { BOOKS, bookPosition, chapterPosition, testamentDividerPercent } from '../game/books.ts'
import { teamLabel } from '../game/types.ts'
import type { MapAverage, MapPin } from '../game/types.ts'

type Answer = {
  book: string
  chapter: number
}

export type BestGuess = {
  teamId: string
  color: string
  book: string
  chapter: number
}

// Landmark books only. Sixty-six names cannot be read from across a room.
const AXIS_BOOKS = ['Genesis', '1 Kings', 'Psalm', 'Daniel', 'Matthew', 'Revelation']

function axisLabel(name: string): string {
  return name === 'Psalm' ? 'Psalms' : name
}

// Pins on the very same spot fan out by a few pixels so every color stays visible.
// Pins on different spots are never moved, so an exact guess sits on the answer.
const FAN_PX = 9

function spread(pins: MapPin[]) {
  const placed: { x: number; y: number }[] = []
  return pins.map((pin) => {
    const x = bookPosition(pin.book)
    const y = chapterPosition(pin.book, pin.chapter)
    let crowd = 0
    for (const other of placed) {
      if (Math.abs(other.x - x) < 0.01 && Math.abs(other.y - y) < 0.01) crowd++
    }
    placed.push({ x, y })
    const angle = crowd * 2.4
    const radius = crowd === 0 ? 0 : FAN_PX + Math.floor((crowd - 1) / 6) * 6
    return { x, y, dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius }
  })
}

export function Timeline({
  pins,
  answer,
  showAnswer,
  average = null,
  bestGuesses = [],
}: {
  pins: MapPin[]
  answer: Answer | null
  showAnswer: boolean
  average?: MapAverage | null
  // One per team color: the guess that counts. A line joins each to the answer.
  bestGuesses?: BestGuess[]
}) {
  const spots = spread(pins)

  return (
    <div className="timeline">
      <div className="plot">
        <span className="axis axis-bottom">Chapter 1</span>
        <div className="testament-split" style={{ left: `${testamentDividerPercent()}%` }}>
          <span className="split-ot">Old Testament</span>
          <span className="split-nt">New Testament</span>
        </div>
        {showAnswer && answer && bestGuesses.length > 0 && (
          <svg className="best-lines" aria-hidden="true">
            {bestGuesses.map((guess, index) => {
              const x1 = `${bookPosition(guess.book)}%`
              const y1 = `${chapterPosition(guess.book, guess.chapter)}%`
              const x2 = `${bookPosition(answer.book)}%`
              const y2 = `${chapterPosition(answer.book, answer.chapter)}%`
              const delay = `${0.5 + index * 0.25}s`
              return (
                <g key={guess.teamId}>
                  <line className="best-line shade" x1={x1} y1={y1} x2={x2} y2={y2} pathLength={1} style={{ animationDelay: delay }} />
                  <line className="best-line" x1={x1} y1={y1} x2={x2} y2={y2} pathLength={1} stroke={guess.color} style={{ animationDelay: delay }} />
                </g>
              )
            })}
          </svg>
        )}
        {pins.map((pin, index) => (
          <div
            key={pin.teamId}
            className="map-dot guess-dot"
            style={{
              left: `calc(${spots[index].x}% + ${spots[index].dx}px)`,
              top: `calc(${spots[index].y}% + ${spots[index].dy}px)`,
              background: pin.color,
              animationDelay: `${Math.min(index, 8) * 0.12}s`,
            }}
            title={teamLabel(pin.teammate1, pin.teammate2)}
            aria-label={teamLabel(pin.teammate1, pin.teammate2)}
          />
        ))}
        {average && (
          <div
            className="avg-dot"
            style={{ left: `${average.x}%`, top: `${average.y}%` }}
            title="Average guess"
            aria-label="Average guess"
          >
            <span>Avg</span>
          </div>
        )}
        {showAnswer && answer && (
          <div
            className="map-dot answer-dot"
            style={{
              left: `${bookPosition(answer.book)}%`,
              top: `${chapterPosition(answer.book, answer.chapter)}%`,
            }}
          >
            <span className="answer-ring" />
          </div>
        )}
      </div>
      <div className="book-axis">
        <div className="book-ticks">
          {BOOKS.map((book) => (
            <i key={book.name} style={{ left: `${bookPosition(book.name)}%` }} />
          ))}
        </div>
        <div className="book-labels">
          {AXIS_BOOKS.map((name) => (
            <span key={name} style={{ left: `${bookPosition(name)}%` }}>
              {axisLabel(name)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
