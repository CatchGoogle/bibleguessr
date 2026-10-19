import type { MapPin, PublicGame, RevealResult } from './types.ts'

const previewTeams = [
  { id: 'a', teammate1: 'Anna', teammate2: 'Ben', color: '#2f9e6b', submitted: true },
  { id: 'b', teammate1: 'Chloe', teammate2: 'Dan', color: '#3b82f6', submitted: true },
  { id: 'c', teammate1: 'Eve', teammate2: 'Felix', color: '#e0a100', submitted: false },
  { id: 'd', teammate1: 'Grace', teammate2: 'Hugo', color: '#e15a3a', submitted: true },
]

const previewResults: RevealResult[] = [
  {
    teamId: 'a',
    teammate1: 'Anna',
    teammate2: 'Ben',
    color: '#2f9e6b',
    guessBook: 'John',
    guessChapter: 3,
    guessVerse: 16,
    bookScore: 2500,
    chapterScore: 1500,
    verseScore: 1000,
    multiplier: 1.3,
    score: 6500,
    totalScore: 15500,
  },
  {
    teamId: 'd',
    teammate1: 'Grace',
    teammate2: 'Hugo',
    color: '#e15a3a',
    guessBook: 'John',
    guessChapter: 1,
    guessVerse: 1,
    bookScore: 2500,
    chapterScore: 1000,
    verseScore: 0,
    multiplier: 1.15,
    score: 4025,
    totalScore: 9500,
  },
  {
    teamId: 'b',
    teammate1: 'Chloe',
    teammate2: 'Dan',
    color: '#3b82f6',
    guessBook: 'Luke',
    guessChapter: 2,
    guessVerse: 14,
    bookScore: 2000,
    chapterScore: 1000,
    verseScore: 250,
    multiplier: 1.1,
    score: 3575,
    totalScore: 7500,
  },
  {
    teamId: 'c',
    teammate1: 'Eve',
    teammate2: 'Felix',
    color: '#e0a100',
    guessBook: null,
    guessChapter: null,
    guessVerse: null,
    bookScore: 0,
    chapterScore: 0,
    verseScore: 0,
    multiplier: 0,
    score: 0,
    totalScore: 4000,
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
const crowdColors = ['#2f9e6b', '#3b82f6', '#e0a100', '#e15a3a', '#a855f7', '#14b8c4', '#f07316', '#ec4899', '#84a30d', '#d4a017', '#6366f1', '#0ea5e9']
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
    color: crowdColors[index],
    submitted: index < crowdSpots.length,
  }))
}

function crowdPins(): MapPin[] {
  return crowdSpots.map(([book, chapter], index) => ({
    teamId: `t${index}`,
    teammate1: crowdNames[index][0],
    teammate2: crowdNames[index][1],
    color: crowdColors[index],
    book,
    chapter,
  }))
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
      pins: lobby ? [] : crowd ? crowdPins() : pinsFromResults,
      verseRound: phase === 'final' || phase === 'finalwait' ? 8 : 3,
      totalRounds: 8,
      effects: true,
      standingsRevealed: phase === 'final',
      upNext: null,
      reveal: revealing ? { book: 'John', chapter: 3, verse: 16, results: previewResults } : null,
    },
  }
}