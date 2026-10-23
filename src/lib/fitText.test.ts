import { describe, expect, it } from 'vitest'
import { searchFit } from './fitText.ts'

describe('searchFit', () => {
  it('keeps the largest size when the passage already fits', () => {
    expect(searchFit(96, 30, () => true)).toEqual({ size: 96, uncap: false })
  })

  it('picks the largest size that still fits', () => {
    expect(searchFit(96, 30, (px) => px <= 47)).toEqual({ size: 47, uncap: false })
  })

  it('uses the smallest size and lets the box grow when nothing fits', () => {
    expect(searchFit(96, 30, () => false)).toEqual({ size: 30, uncap: true })
  })
})
