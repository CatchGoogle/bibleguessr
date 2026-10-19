import { bookIndex, canonicalBook } from './books.ts'

export type ScoreParts = {
  bookScore: number
  chapterScore: number
  verseScore: number
  baseScore: number
}

function bookPoints(distance: number, exact: boolean): number {
  if (exact) return 50
  if (distance <= 3) return 40
  if (distance <= 5) return 20
  if (distance <= 10) return 10
  return 0
}

function chapterPoints(distance: number): number {
  if (distance === 0) return 30
  if (distance <= 3) return 20
  if (distance <= 5) return 10
  if (distance <= 10) return 5
  return 0
}

function versePoints(distance: number): number {
  if (distance === 0) return 20
  if (distance <= 3) return 10
  if (distance <= 5) return 5
  if (distance <= 10) return 3
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

export function speedMultiplier(submissionOrder: number, teamCount: number): number {
  if (submissionOrder === teamCount) return 1
  return 1 + (0.1 * (teamCount - 1)) / submissionOrder
}

export function applyMultiplier(
  baseScore: number,
  submissionOrder: number,
  teamCount: number,
): number {
  return Math.round(baseScore * speedMultiplier(submissionOrder, teamCount))
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
