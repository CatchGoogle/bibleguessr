import { BOOKS, bookPosition, chapterPosition, testamentDividerPercent } from '../game/books.ts'
import { teamLabel } from '../game/types.ts'
import type { MapPin } from '../game/types.ts'

type Answer = {
  book: string
  chapter: number
}

// Landmark books only. Sixty-six names cannot be read from across a room.
const AXIS_BOOKS = ['Genesis', '1 Kings', 'Psalm', 'Daniel', 'Matthew', 'Revelation']

function axisLabel(name: string): string {
  return name === 'Psalm' ? 'Psalms' : name
}

// Nudge pins that would land on top of each other so every team color stays visible.
function spread(pins: MapPin[]) {
  const placed: { x: number; y: number }[] = []
  return pins.map((pin) => {
    const x = bookPosition(pin.book)
    const y = chapterPosition(pin.book, pin.chapter)
    let crowd = 0
    for (const other of placed) {
      if (Math.abs(other.x - x) < 1.4 && Math.abs(other.y - y) < 8) crowd++
    }
    placed.push({ x, y })
    const angle = crowd * 2.4
    const radius = crowd === 0 ? 0 : 26 + Math.floor(crowd / 6) * 16
    return { x, y, dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius }
  })
}

export function Timeline({
  pins,
  answer,
  showAnswer,
}: {
  pins: MapPin[]
  answer: Answer | null
  showAnswer: boolean
}) {
  const spots = spread(pins)

  return (
    <div className="timeline">
      <div className="plot">
        <span className="axis axis-top">Last chapter</span>
        <span className="axis axis-bottom">Chapter 1</span>
        <div className="testament-split" style={{ left: `${testamentDividerPercent()}%` }}>
          <span className="split-ot">Old Testament</span>
          <span className="split-nt">New Testament</span>
        </div>
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
