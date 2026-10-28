import { bookPosition, chapterPosition } from './books.ts'
import type { MapAverage, MapPin, PublicGame, RevealResult } from './types.ts'
import { TEAM_COLORS } from './types.ts'

const previewTeams = [
  { id: 'a', teammate1: 'Anna', teammate2: 'Ben', color: TEAM_COLORS[0], submitted: true },
  { id: 'b', teammate1: 'Chloe', teammate2: 'Dan', color: TEAM_COLORS[1], submitted: true },
  { id: 'c', teammate1: 'Eve', teammate2: 'Felix', color: TEAM_COLORS[2], submitted: false },
  { id: 'd', teammate1: 'Grace', teammate2: 'Hugo', color: TEAM_COLORS[0], submitted: true },
]

const previewResults: RevealResult[] = [
  {
    teamId: 'a',
    teammate1: 'Anna',
    teammate2: 'Ben',
    color: TEAM_COLORS[0],
    guessBook: 'John',
    guessChapter: 3,
    guessVerse: 16,
    bookScore: 2500,
    chapterScore: 1500,
    verseScore: 1000,
    multiplier: 1,
    speedBonus: 150,
    score: 5150,
    totalScore: 15500,
  },
  {
    teamId: 'd',
    teammate1: 'Grace',
    teammate2: 'Hugo',
    color: TEAM_COLORS[0],
    guessBook: 'John',
    guessChapter: 1,
    guessVerse: 1,
    bookScore: 2500,
    chapterScore: 1000,
    verseScore: 0,
    multiplier: 1,
    speedBonus: 150,
    score: 3650,
    totalScore: 9500,
  },
  {
    teamId: 'b',
    teammate1: 'Chloe',
    teammate2: 'Dan',
    color: TEAM_COLORS[1],
    guessBook: 'Luke',
    guessChapter: 2,
    guessVerse: 14,
    bookScore: 2000,
    chapterScore: 1000,
    verseScore: 250,
    multiplier: 1,
    speedBonus: 0,
    score: 3250,
    totalScore: 7500,
  },
  {
    teamId: 'c',
    teammate1: 'Eve',
    teammate2: 'Felix',
    color: TEAM_COLORS[2],
    guessBook: null,
    guessChapter: null,
    guessVerse: null,
    bookScore: 0,
    chapterScore: 0,
    verseScore: 0,
    multiplier: 0,
    speedBonus: 0,
    score: 0,
    totalScore: 6000,
  },
]

export type PreviewPhase = 'lobby' | 'guessing' | 'crowd' | 'reveal' | 'finalwait' | 'final'

const crowdNames: [string, string][] = [
  ['Anna', 'Ben'],
  ['Chloe', 'Dan'],
  ['Eve', 'Felix'],
  ['Grace', 'Hugo'],
  ['Ivy', 'Jack'],
  ['Kira', 'Leo'],
  ['Maya', 'Noah'],
  ['Opal', 'Pete'],
  ['Quinn', 'Ravi'],
  ['Sofia', 'Tom'],
  ['Uma', 'Victor'],
  ['Wren', 'Xavier'],
]
const crowdColors = TEAM_COLORS
const crowdSpots: [string, number][] = [
  ['John', 3],
  ['John', 3],
  ['John', 1],
  ['John', 4],
  ['Luke', 2],
  ['Matthew', 5],
  ['Psalm', 23],
  ['Genesis', 1],
  ['Romans', 8],
  ['John', 2],
]

function crowdTeams() {
  return crowdNames.map(([a, b], index) => ({
    id: `t${index}`,
    teammate1: a,
    teammate2: b,
    color: crowdColors[index % crowdColors.length],
    submitted: index < crowdSpots.length,
  }))
}

function crowdPins(): MapPin[] {
  return crowdSpots.map(([book, chapter], index) => ({
    teamId: `t${index}`,
    teammate1: crowdNames[index][0],
    teammate2: crowdNames[index][1],
    color: crowdColors[index % crowdColors.length],
    book,
    chapter,
  }))
}

function averageOf(pins: MapPin[]): MapAverage | null {
  if (pins.length === 0) return null
  const x = pins.reduce((sum, pin) => sum + bookPosition(pin.book), 0) / pins.length
  const y = pins.reduce((sum, pin) => sum + chapterPosition(pin.book, pin.chapter), 0) / pins.length
  return { x, y, count: pins.length }
}

export function previewGame(phase: PreviewPhase): PublicGame {
  const revealing = phase === 'reveal' || phase === 'final' || phase === 'finalwait'
  const lobby = phase === 'lobby'
  const crowd = phase === 'crowd'
  const pinsFromResults = previewResults.flatMap((result): MapPin[] =>
    result.guessBook && result.guessChapter != null
      ? [
          {
            teamId: result.teamId,
            teammate1: result.teammate1,
            teammate2: result.teammate2,
            color: result.color,
            book: result.guessBook,
            chapter: result.guessChapter,
          },
        ]
      : [],
  )

  return {
    phase: lobby ? 'lobby' : revealing ? 'reveal' : 'guessing',
    currentRound: phase === 'final' || phase === 'finalwait' ? 8 : 3,
    updatedAt: null,
    timerDurationMs: 60000,
    guessingEndsAt: phase === 'guessing' || crowd ? new Date(Date.now() + 42000).toISOString() : null,
    timerPaused: revealing,
    timerRemainingMs: revealing ? 18000 : 60000,
    snapshot: {
      verseText: lobby
        ? null
        : 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
      teams: crowd ? crowdTeams() : previewTeams,
      pins: lobby || !revealing ? [] : pinsFromResults,
      average: lobby ? null : averageOf(crowd ? crowdPins() : pinsFromResults),
      verseRound: phase === 'final' || phase === 'finalwait' ? 8 : 3,
      totalRounds: 8,
      effects: true,
      standingsRevealed: phase === 'final',
      upNext: null,
      sittingOut: [],
      reveal: revealing ? { book: 'John', chapter: 3, verse: 16, results: previewResults, colorResults: previewResults.filter((result) => result.teamId !== 'd') } : null,
    },
  }
}