import { describe, expect, it } from 'vitest'
import { cleanPassage, parseNivPaste } from './niv.ts'

describe('parseNivPaste', () => {
  it('reads a Bible Gateway style paste and drops verse numbers and footnotes', () => {
    const parsed = parseNivPaste(`1 Peter 2:9-10
New International Version

9 But you are a chosen people, a royal priesthood, a holy nation, God’s special possession, that you may declare the praises of him who called you out of darkness into his wonderful light. [a] 10 Once you were not a people, but now you are the people of God.

Footnotes
a. 1 Peter 2:9 Or a chosen generation`)

    expect(parsed.book).toBe('1 Peter')
    expect(parsed.chapter).toBe(2)
    expect(parsed.verse).toBe(9)
    expect(parsed.passage).toBe(
      'But you are a chosen people, a royal priesthood, a holy nation, God’s special possession, that you may declare the praises of him who called you out of darkness into his wonderful light. Once you were not a people, but now you are the people of God.',
    )
  })

  it('accepts a one-line NIV reference and keeps numbers that belong to the sentence', () => {
    const parsed = parseNivPaste('Jonah 3:4 NIV 4 Jonah began by going a day’s journey into the city, proclaiming, “Forty more days and Nineveh will be overthrown.” [b]')
    expect(parsed).toMatchObject({ book: 'Jonah', chapter: 3, verse: 4 })
    expect(parsed.passage).toContain('Forty more days')
    expect(parsed.passage).not.toContain('[b]')
    expect(parsed.passage.startsWith('Jonah began')).toBe(true)
  })

  it('maps Psalms to Psalm', () => {
    const parsed = parseNivPaste('Psalms 23:1\n1 The Lord is my shepherd, I lack nothing.')
    expect(parsed.book).toBe('Psalm')
    expect(parsed.passage).toBe('The Lord is my shepherd, I lack nothing.')
  })
})

describe('cleanPassage', () => {
  it('removes bracket footnotes without touching ordinary brackets of one letter only when marked', () => {
    expect(cleanPassage('called you [x] out of darkness')).toBe('called you out of darkness')
  })
})
