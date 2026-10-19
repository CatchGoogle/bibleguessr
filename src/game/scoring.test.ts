import { describe, expect, it } from 'vitest'
import { BOOKS } from './books.ts'
import { applyMultiplier, distanceLabel, scoreGuess, speedMultiplier } from './scoring.ts'

const john = BOOKS.findIndex((book) => book.name === 'John')

describe('scoreGuess', () => {
  it('awards 100 for an exact verse', () => {
    expect(scoreGuess('John', 3, 16, 'John', 3, 16)).toEqual({
      bookScore: 50,
      chapterScore: 30,
      verseScore: 20,
      baseScore: 100,
    })
  })

  it('treats Psalm and Psalms as the same book', () => {
    expect(scoreGuess('Psalms', 23, 1, 'Psalm', 23, 1).baseScore).toBe(100)
  })

  it('gives nearby books partial credit and still scores chapter and verse', () => {
    const neighbor = BOOKS[john - 1].name
    expect(scoreGuess(neighbor, 3, 16, 'John', 3, 16)).toEqual({
      bookScore: 40,
      chapterScore: 30,
      verseScore: 20,
      baseScore: 90,
    })
  })

  it('stops awarding chapter and verse points once the book is 4 away', () => {
    const book = BOOKS[john - 4].name
    expect(scoreGuess(book, 3, 16, 'John', 3, 16)).toEqual({
      bookScore: 20,
      chapterScore: 0,
      verseScore: 0,
      baseScore: 20,
    })
  })

  it('uses the book distance bands', () => {
    expect(scoreGuess(BOOKS[john - 3].name, 1, 1, 'John', 9, 9).bookScore).toBe(40)
    expect(scoreGuess(BOOKS[john - 5].name, 1, 1, 'John', 9, 9).bookScore).toBe(20)
    expect(scoreGuess(BOOKS[john - 10].name, 1, 1, 'John', 9, 9).bookScore).toBe(10)
    expect(scoreGuess(BOOKS[john - 11].name, 1, 1, 'John', 9, 9).bookScore).toBe(0)
  })

  it('uses the chapter and verse bands inside a close book', () => {
    expect(scoreGuess('John', 6, 19, 'John', 3, 16)).toMatchObject({
      chapterScore: 20,
      verseScore: 10,
    })
    expect(scoreGuess('John', 8, 21, 'John', 3, 16)).toMatchObject({
      chapterScore: 10,
      verseScore: 5,
    })
    expect(scoreGuess('John', 9, 26, 'John', 3, 16)).toMatchObject({
      chapterScore: 5,
      verseScore: 3,
    })
    expect(scoreGuess('John', 14, 40, 'John', 3, 16)).toMatchObject({
      chapterScore: 0,
      verseScore: 0,
    })
  })

  it('scores an unknown book as zero', () => {
    expect(scoreGuess('Nowhere', 1, 1, 'John', 1, 1).baseScore).toBe(0)
  })
})

describe('speed multiplier', () => {
  it('matches the previous submission-order formula', () => {
    expect(speedMultiplier(1, 4)).toBeCloseTo(1.3)
    expect(speedMultiplier(2, 4)).toBeCloseTo(1.15)
    expect(speedMultiplier(4, 4)).toBe(1)
    expect(applyMultiplier(100, 1, 4)).toBe(130)
    expect(applyMultiplier(100, 2, 4)).toBe(115)
    expect(applyMultiplier(55, 2, 3)).toBe(61)
    expect(applyMultiplier(100, 1, 1)).toBe(100)
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
