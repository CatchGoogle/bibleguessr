import { describe, expect, it } from 'vitest'
import { BOOKS } from './books.ts'
import { distanceLabel, earlyLockBonus, isPerfectScore, scoreGuess, speedLabel } from './scoring.ts'
import { VERSE_COUNTS } from './verseCounts.ts'

const john = BOOKS.findIndex((book) => book.name === 'John')

describe('scoreGuess', () => {
  it('awards 5000 for an exact verse', () => {
    const exact = scoreGuess('John', 3, 16, 'John', 3, 16)
    expect(exact).toEqual({
      bookScore: 2500,
      chapterScore: 1500,
      verseScore: 1000,
      baseScore: 5000,
    })
    expect(isPerfectScore(exact.bookScore, exact.chapterScore, exact.verseScore)).toBe(true)
  })

  it('treats Psalm and Psalms as the same book', () => {
    expect(scoreGuess('Psalms', 23, 1, 'Psalm', 23, 1).baseScore).toBe(5000)
  })

  it('gives a neighboring book credit without calling the chapter exact', () => {
    const neighbor = BOOKS[john - 1].name
    expect(scoreGuess(neighbor, 3, 16, 'John', 3, 16)).toEqual({
      bookScore: 2000,
      chapterScore: 1250,
      verseScore: 1000,
      baseScore: 4250,
    })
  })

  it('stops awarding chapter and verse points once the book is 4 away', () => {
    const book = BOOKS[john - 4].name
    expect(scoreGuess(book, 3, 16, 'John', 3, 16)).toEqual({
      bookScore: 1400,
      chapterScore: 0,
      verseScore: 0,
      baseScore: 1400,
    })
  })

  it('steps book points down, then uses the testament', () => {
    expect(scoreGuess(BOOKS[john - 1].name, 1, 1, 'John', 9, 9).bookScore).toBe(2000)
    expect(scoreGuess(BOOKS[john - 2].name, 1, 1, 'John', 9, 9).bookScore).toBe(1800)
    expect(scoreGuess(BOOKS[john - 3].name, 1, 1, 'John', 9, 9).bookScore).toBe(1600)
    expect(scoreGuess(BOOKS[john - 5].name, 1, 1, 'John', 9, 9).bookScore).toBe(1200)
    expect(scoreGuess(BOOKS[john - 8].name, 1, 1, 'John', 9, 9).bookScore).toBe(600)
    expect(scoreGuess(BOOKS[john + 9].name, 1, 1, 'John', 9, 9).bookScore).toBe(500)
    expect(scoreGuess('Genesis', 1, 1, 'Malachi', 1, 1).bookScore).toBe(500)
    expect(scoreGuess('Genesis', 1, 1, 'Matthew', 1, 1).bookScore).toBe(0)
  })

  it('scales chapter and verse points by the length of the passage', () => {
    expect(scoreGuess('Psalm', 24, 1, 'Psalm', 23, 1).chapterScore).toBe(1250)
    expect(scoreGuess('Psalm', 33, 1, 'Psalm', 23, 1).chapterScore).toBe(1000)
    expect(scoreGuess('Psalm', 63, 1, 'Psalm', 23, 1).chapterScore).toBe(500)
    expect(scoreGuess('Psalm', 98, 1, 'Psalm', 23, 1).chapterScore).toBe(0)
    expect(scoreGuess('Jonah', 2, 1, 'Jonah', 1, 1).chapterScore).toBe(1000)
    expect(scoreGuess('Jonah', 3, 1, 'Jonah', 1, 1).chapterScore).toBe(0)
    expect(scoreGuess('John', 3, 17, 'John', 3, 16).verseScore).toBe(800)
    expect(scoreGuess('John', 3, 26, 'John', 3, 16).verseScore).toBe(300)
    expect(scoreGuess('Psalm', 119, 11, 'Psalm', 119, 1).verseScore).toBe(650)
  })

  it('keeps a chapter score off 1500 when only the position matches', () => {
    expect(scoreGuess('Proverbs', 16, 1, 'Psalm', 75, 1).chapterScore).toBe(1250)
  })

  it('scores an unknown book as zero', () => {
    expect(scoreGuess('Nowhere', 1, 1, 'John', 1, 1).baseScore).toBe(0)
  })

  it('has a verse count for every chapter', () => {
    expect(VERSE_COUNTS).toHaveLength(BOOKS.length)
    BOOKS.forEach((book, index) => expect(VERSE_COUNTS[index]).toHaveLength(book.chapters))
    const verses = VERSE_COUNTS.reduce((sum, chapters) => sum + chapters.reduce((inner, count) => inner + count, 0), 0)
    expect(verses).toBe(31102)
  })
})

describe('early lock bonus', () => {
  it('pays 150 once when 15 seconds or more are left', () => {
    expect(earlyLockBonus(15_000)).toBe(150)
    expect(earlyLockBonus(60_000)).toBe(150)
    expect(earlyLockBonus(14_999)).toBe(0)
    expect(earlyLockBonus(0)).toBe(0)
  })

  it('labels the flat bonus, and older multiplied scores keep their old label', () => {
    expect(speedLabel(150, 1)).toBe('+150 early')
    expect(speedLabel(0, 1.3)).toBe('×1.30 speed')
    expect(speedLabel(0, 1)).toBeNull()
  })
})

describe('distanceLabel', () => {
  it('describes book, chapter, verse, and perfect guesses', () => {
    expect(distanceLabel('Luke', 1, 1, 'John', 3, 16)).toBe('1 book away')
    expect(distanceLabel('Genesis', 1, 1, 'John', 3, 16)).toBe('42 books away')
    expect(distanceLabel('John', 5, 16, 'John', 3, 16)).toBe('2 chapters away')
    expect(distanceLabel('John', 3, 17, 'John', 3, 16)).toBe('1 verse away')
    expect(distanceLabel('Psalms', 23, 1, 'Psalm', 23, 1)).toBe('Perfect!')
  })
})
