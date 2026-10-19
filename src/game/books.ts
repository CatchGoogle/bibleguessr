export type Testament = 'OT' | 'NT'

export type CanonBook = {
  name: string
  chapters: number
  testament: Testament
  label: string
}

export const BOOKS: readonly CanonBook[] = [
  { name: 'Genesis', chapters: 50, testament: 'OT', label: 'Gen' },
  { name: 'Exodus', chapters: 40, testament: 'OT', label: 'Exo' },
  { name: 'Leviticus', chapters: 27, testament: 'OT', label: 'Lev' },
  { name: 'Numbers', chapters: 36, testament: 'OT', label: 'Num' },
  { name: 'Deuteronomy', chapters: 34, testament: 'OT', label: 'Deu' },
  { name: 'Joshua', chapters: 24, testament: 'OT', label: 'Jos' },
  { name: 'Judges', chapters: 21, testament: 'OT', label: 'Jdg' },
  { name: 'Ruth', chapters: 4, testament: 'OT', label: 'Rut' },
  { name: '1 Samuel', chapters: 31, testament: 'OT', label: '1Sa' },
  { name: '2 Samuel', chapters: 24, testament: 'OT', label: '2Sa' },
  { name: '1 Kings', chapters: 22, testament: 'OT', label: '1Ki' },
  { name: '2 Kings', chapters: 25, testament: 'OT', label: '2Ki' },
  { name: '1 Chronicles', chapters: 29, testament: 'OT', label: '1Ch' },
  { name: '2 Chronicles', chapters: 36, testament: 'OT', label: '2Ch' },
  { name: 'Ezra', chapters: 10, testament: 'OT', label: 'Ezr' },
  { name: 'Nehemiah', chapters: 13, testament: 'OT', label: 'Neh' },
  { name: 'Esther', chapters: 10, testament: 'OT', label: 'Est' },
  { name: 'Job', chapters: 42, testament: 'OT', label: 'Job' },
  { name: 'Psalm', chapters: 150, testament: 'OT', label: 'Psa' },
  { name: 'Proverbs', chapters: 31, testament: 'OT', label: 'Pro' },
  { name: 'Ecclesiastes', chapters: 12, testament: 'OT', label: 'Ecc' },
  { name: 'Song of Solomon', chapters: 8, testament: 'OT', label: 'Sng' },
  { name: 'Isaiah', chapters: 66, testament: 'OT', label: 'Isa' },
  { name: 'Jeremiah', chapters: 52, testament: 'OT', label: 'Jer' },
  { name: 'Lamentations', chapters: 5, testament: 'OT', label: 'Lam' },
  { name: 'Ezekiel', chapters: 48, testament: 'OT', label: 'Ezk' },
  { name: 'Daniel', chapters: 12, testament: 'OT', label: 'Dan' },
  { name: 'Hosea', chapters: 14, testament: 'OT', label: 'Hos' },
  { name: 'Joel', chapters: 3, testament: 'OT', label: 'Jol' },
  { name: 'Amos', chapters: 9, testament: 'OT', label: 'Amo' },
  { name: 'Obadiah', chapters: 1, testament: 'OT', label: 'Oba' },
  { name: 'Jonah', chapters: 4, testament: 'OT', label: 'Jon' },
  { name: 'Micah', chapters: 7, testament: 'OT', label: 'Mic' },
  { name: 'Nahum', chapters: 3, testament: 'OT', label: 'Nam' },
  { name: 'Habakkuk', chapters: 3, testament: 'OT', label: 'Hab' },
  { name: 'Zephaniah', chapters: 3, testament: 'OT', label: 'Zep' },
  { name: 'Haggai', chapters: 2, testament: 'OT', label: 'Hag' },
  { name: 'Zechariah', chapters: 14, testament: 'OT', label: 'Zec' },
  { name: 'Malachi', chapters: 4, testament: 'OT', label: 'Mal' },
  { name: 'Matthew', chapters: 28, testament: 'NT', label: 'Mat' },
  { name: 'Mark', chapters: 16, testament: 'NT', label: 'Mrk' },
  { name: 'Luke', chapters: 24, testament: 'NT', label: 'Luk' },
  { name: 'John', chapters: 21, testament: 'NT', label: 'Jhn' },
  { name: 'Acts', chapters: 28, testament: 'NT', label: 'Act' },
  { name: 'Romans', chapters: 16, testament: 'NT', label: 'Rom' },
  { name: '1 Corinthians', chapters: 16, testament: 'NT', label: '1Co' },
  { name: '2 Corinthians', chapters: 13, testament: 'NT', label: '2Co' },
  { name: 'Galatians', chapters: 6, testament: 'NT', label: 'Gal' },
  { name: 'Ephesians', chapters: 6, testament: 'NT', label: 'Eph' },
  { name: 'Philippians', chapters: 4, testament: 'NT', label: 'Php' },
  { name: 'Colossians', chapters: 4, testament: 'NT', label: 'Col' },
  { name: '1 Thessalonians', chapters: 5, testament: 'NT', label: '1Th' },
  { name: '2 Thessalonians', chapters: 3, testament: 'NT', label: '2Th' },
  { name: '1 Timothy', chapters: 6, testament: 'NT', label: '1Ti' },
  { name: '2 Timothy', chapters: 4, testament: 'NT', label: '2Ti' },
  { name: 'Titus', chapters: 3, testament: 'NT', label: 'Tit' },
  { name: 'Philemon', chapters: 1, testament: 'NT', label: 'Phm' },
  { name: 'Hebrews', chapters: 13, testament: 'NT', label: 'Heb' },
  { name: 'James', chapters: 5, testament: 'NT', label: 'Jas' },
  { name: '1 Peter', chapters: 5, testament: 'NT', label: '1Pe' },
  { name: '2 Peter', chapters: 3, testament: 'NT', label: '2Pe' },
  { name: '1 John', chapters: 5, testament: 'NT', label: '1Jn' },
  { name: '2 John', chapters: 1, testament: 'NT', label: '2Jn' },
  { name: '3 John', chapters: 1, testament: 'NT', label: '3Jn' },
  { name: 'Jude', chapters: 1, testament: 'NT', label: 'Jud' },
  { name: 'Revelation', chapters: 22, testament: 'NT', label: 'Rev' },
]

export const MAX_VERSE = 176

export function canonicalBook(book: string): string {
  if (book === 'Psalms' || book === 'Psalm') return 'Psalm'
  return book
}

export function bookIndex(book: string): number {
  const name = canonicalBook(book)
  return BOOKS.findIndex((entry) => entry.name === name)
}

export function chapterCount(book: string): number {
  const index = bookIndex(book)
  if (index < 0) return 1
  return BOOKS[index].chapters
}

export function bookPosition(book: string): number {
  const index = bookIndex(book)
  if (index < 0) return 0
  return (index / (BOOKS.length - 1)) * 100
}

export function chapterPosition(book: string, chapter: number): number {
  const max = chapterCount(book)
  if (max <= 1) return 50
  const normalized = Math.min(Math.max(chapter, 1), max)
  return ((max - normalized) / (max - 1)) * 80 + 10
}

export function testamentDividerPercent(): number {
  const matthew = bookIndex('Matthew')
  return ((matthew - 0.5) / (BOOKS.length - 1)) * 100
}
