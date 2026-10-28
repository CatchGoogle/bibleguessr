import { bookIndex, canonicalBook } from './books.ts'

export type ScoreParts = {
  bookScore: number
  chapterScore: number
  verseScore: number
  baseScore: number
}

// An exact book, chapter, and verse is 5,000. The bands keep the old proportions.
export const SCORE = {
  book: { exact: 2500, close: 2000, near: 1000, far: 500 },
  chapter: { exact: 1500, close: 1000, near: 500, far: 250 },
  verse: { exact: 1000, close: 500, near: 250, far: 150 },
} as const

export const PERFECT_SCORE = SCORE.book.exact + SCORE.chapter.exact + SCORE.verse.exact

export function isPerfectScore(bookScore: number, chapterScore: number, verseScore: number): boolean {
  return bookScore === SCORE.book.exact && chapterScore === SCORE.chapter.exact && verseScore === SCORE.verse.exact
}

export function formatPoints(value: number): string {
  return value.toLocaleString('en-US')
}

function bookPoints(distance: number, exact: boolean): number {
  if (exact) return SCORE.book.exact
  if (distance <= 3) return SCORE.book.close
  if (distance <= 5) return SCORE.book.near
  if (distance <= 10) return SCORE.book.far
  return 0
}

function chapterPoints(distance: number): number {
  if (distance === 0) return SCORE.chapter.exact
  if (distance <= 3) return SCORE.chapter.close
  if (distance <= 5) return SCORE.chapter.near
  if (distance <= 10) return SCORE.chapter.far
  return 0
}

function versePoints(distance: number): number {
  if (distance === 0) return SCORE.verse.exact
  if (distance <= 3) return SCORE.verse.close
  if (distance <= 5) return SCORE.verse.near
  if (distance <= 10) return SCORE.verse.far
  return 0
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

  const bookScore = guessedIndex < 0 || answerIndex < 0 ? 0 : bookPoints(bookDistance, exact)
  let chapterScore = 0
  let verseScore = 0

  if (exact || bookDistance <= 3) {
    chapterScore = chapterPoints(Math.abs(guessedChapter - answerChapter))
    verseScore = versePoints(Math.abs(guessedVerse - answerVerse))
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
