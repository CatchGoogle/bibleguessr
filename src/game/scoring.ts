import { BOOKS, bookIndex, canonicalBook, chapterCount } from './books.ts'
import { verseCount } from './verseCounts.ts'

export type ScoreParts = {
  bookScore: number
  chapterScore: number
  verseScore: number
  baseScore: number
}

// An exact book, chapter, and verse is 5,000.
// close / far are the color bands on the reveal: within 3 books, and any book points at all.
// Kept in sync with supabase/migrations/012_balanced_scores.sql.
export const SCORE = {
  book: { exact: 2500, close: 1600, far: 500 },
  chapter: { exact: 1500, close: 1000 },
  verse: { exact: 1000 },
} as const

const CHAPTER_BANDS: readonly (readonly [number, number])[] = [
  [5, 1250],
  [10, 1000],
  [20, 750],
  [35, 500],
  [50, 250],
]

const VERSE_BANDS: readonly (readonly [number, number])[] = [
  [5, 800],
  [10, 650],
  [20, 500],
  [35, 300],
  [50, 150],
]

const MATTHEW = BOOKS.findIndex((book) => book.name === 'Matthew')

export const PERFECT_SCORE = SCORE.book.exact + SCORE.chapter.exact + SCORE.verse.exact

export function isPerfectScore(bookScore: number, chapterScore: number, verseScore: number): boolean {
  return bookScore === SCORE.book.exact && chapterScore === SCORE.chapter.exact && verseScore === SCORE.verse.exact
}

export function formatPoints(value: number): string {
  return value.toLocaleString('en-US')
}

function sharePoints(
  numerator: number,
  denominator: number,
  bands: readonly (readonly [number, number])[],
): number {
  if (denominator <= 0) return 0
  for (const [percent, points] of bands) {
    if (numerator * 100 <= percent * denominator) return points
  }
  return 0
}

function bookPoints(distance: number, exact: boolean, sameTestament: boolean): number {
  if (exact) return SCORE.book.exact
  if (distance === 1) return 2000
  if (distance >= 2 && distance <= 8) return 1800 - (distance - 2) * 200
  if (sameTestament) return SCORE.book.far
  return 0
}

function chapterPoints(
  guessedBook: string,
  guessedChapter: number,
  answerBook: string,
  answerChapter: number,
): number {
  const delta = Math.abs(guessedChapter - answerChapter)
  if (guessedBook === answerBook && delta === 0) return SCORE.chapter.exact
  if (guessedBook === answerBook) {
    const score = sharePoints(delta, Math.max(chapterCount(answerBook) - 1, 1), CHAPTER_BANDS)
    return delta === 1 ? Math.max(score, SCORE.chapter.close) : score
  }
  const guessedChapters = chapterCount(guessedBook)
  const answerChapters = chapterCount(answerBook)
  const guessedSpan = Math.max(guessedChapters - 1, 1)
  const answerSpan = Math.max(answerChapters - 1, 1)
  const guessedPos = guessedChapters <= 1 ? 0 : guessedChapter - 1
  const answerPos = answerChapters <= 1 ? 0 : answerChapter - 1
  return sharePoints(
    Math.abs(guessedPos * answerSpan - answerPos * guessedSpan),
    guessedSpan * answerSpan,
    CHAPTER_BANDS,
  )
}

function versePoints(answerBook: string, answerChapter: number, guessedVerse: number, answerVerse: number): number {
  const delta = Math.abs(guessedVerse - answerVerse)
  if (delta === 0) return SCORE.verse.exact
  const score = sharePoints(delta, Math.max(verseCount(answerBook, answerChapter) - 1, 1), VERSE_BANDS)
  return delta === 1 ? Math.max(score, 500) : score
}

export function scoreGuess(
  guessedBook: string,
  guessedChapter: number,
  guessedVerse: number,
  answerBook: string,
  answerChapter: number,
  answerVerse: number,
): ScoreParts {
  const guessedName = canonicalBook(guessedBook)
  const answerName = canonicalBook(answerBook)
  const guessedIndex = bookIndex(guessedName)
  const answerIndex = bookIndex(answerName)
  const exact = guessedName === answerName && guessedIndex >= 0
  const bookDistance =
    guessedIndex < 0 || answerIndex < 0 ? 999 : Math.abs(guessedIndex - answerIndex)
  const sameTestament =
    guessedIndex >= 0 && answerIndex >= 0 && (guessedIndex < MATTHEW) === (answerIndex < MATTHEW)

  const bookScore =
    guessedIndex < 0 || answerIndex < 0 ? 0 : bookPoints(bookDistance, exact, sameTestament)
  let chapterScore = 0
  let verseScore = 0

  if (exact || bookDistance <= 3) {
    chapterScore = chapterPoints(guessedName, guessedChapter, answerName, answerChapter)
    verseScore = versePoints(answerName, answerChapter, guessedVerse, answerVerse)
  }

  return {
    bookScore,
    chapterScore,
    verseScore,
    baseScore: bookScore + chapterScore + verseScore,
  }
}

// Same amount for every team that still had this much clock left at the lock tap.
// Kept in sync with supabase/migrations/011_early_lock_bonus.sql.
export const EARLY_LOCK_MS = 15_000
export const EARLY_LOCK_BONUS = 150

export function earlyLockBonus(remainingMs: number): number {
  return remainingMs >= EARLY_LOCK_MS ? EARLY_LOCK_BONUS : 0
}

export function speedLabel(speedBonus: number, multiplier: number): string | null {
  if (speedBonus > 0) return `+${formatPoints(speedBonus)} early`
  if (multiplier > 1.001) return `×${multiplier.toFixed(2)} speed`
  return null
}

export function distanceLabel(
  guessedBook: string,
  guessedChapter: number,
  guessedVerse: number,
  answerBook: string,
  answerChapter: number,
  answerVerse: number,
): string {
  const guessedName = canonicalBook(guessedBook)
  const answerName = canonicalBook(answerBook)
  if (guessedName !== answerName) {
    const guessedIndex = bookIndex(guessedName)
    const answerIndex = bookIndex(answerName)
    if (guessedIndex < 0 || answerIndex < 0) return 'Different book'
    const distance = Math.abs(guessedIndex - answerIndex)
    return distance === 1 ? '1 book away' : `${distance} books away`
  }
  if (guessedChapter !== answerChapter) {
    const distance = Math.abs(guessedChapter - answerChapter)
    return distance === 1 ? '1 chapter away' : `${distance} chapters away`
  }
  if (guessedVerse !== answerVerse) {
    const distance = Math.abs(guessedVerse - answerVerse)
    return distance === 1 ? '1 verse away' : `${distance} verses away`
  }
  return 'Perfect!'
}

export function formatReference(book: string, chapter: number, verse: number): string {
  return `${canonicalBook(book)} ${chapter}:${verse}`
}
