import { BOOKS, MAX_VERSE, chapterCount } from './books.ts'

export type NivPaste = {
  book: string | null
  chapter: number | null
  verse: number | null
  passage: string
}

const ABBREV: Record<string, string> = {
  gen: 'Genesis',
  ex: 'Exodus',
  exo: 'Exodus',
  lev: 'Leviticus',
  num: 'Numbers',
  deut: 'Deuteronomy',
  deu: 'Deuteronomy',
  josh: 'Joshua',
  jos: 'Joshua',
  judg: 'Judges',
  jdg: 'Judges',
  ru: 'Ruth',
  rut: 'Ruth',
  '1 sam': '1 Samuel',
  '1sa': '1 Samuel',
  '2 sam': '2 Samuel',
  '2sa': '2 Samuel',
  '1 kgs': '1 Kings',
  '1ki': '1 Kings',
  '2 kgs': '2 Kings',
  '2ki': '2 Kings',
  '1 chr': '1 Chronicles',
  '1ch': '1 Chronicles',
  '2 chr': '2 Chronicles',
  '2ch': '2 Chronicles',
  ezr: 'Ezra',
  neh: 'Nehemiah',
  est: 'Esther',
  ps: 'Psalm',
  psa: 'Psalm',
  psalm: 'Psalm',
  psalms: 'Psalm',
  prov: 'Proverbs',
  pro: 'Proverbs',
  eccl: 'Ecclesiastes',
  ecc: 'Ecclesiastes',
  'song of songs': 'Song of Solomon',
  'song of sol': 'Song of Solomon',
  song: 'Song of Solomon',
  sng: 'Song of Solomon',
  isa: 'Isaiah',
  jer: 'Jeremiah',
  lam: 'Lamentations',
  ezek: 'Ezekiel',
  ezk: 'Ezekiel',
  dan: 'Daniel',
  hos: 'Hosea',
  joel: 'Joel',
  jol: 'Joel',
  amos: 'Amos',
  amo: 'Amos',
  obad: 'Obadiah',
  oba: 'Obadiah',
  jonah: 'Jonah',
  jon: 'Jonah',
  mic: 'Micah',
  nah: 'Nahum',
  nam: 'Nahum',
  hab: 'Habakkuk',
  zeph: 'Zephaniah',
  zep: 'Zephaniah',
  hag: 'Haggai',
  zech: 'Zechariah',
  zec: 'Zechariah',
  mal: 'Malachi',
  matt: 'Matthew',
  mt: 'Matthew',
  mat: 'Matthew',
  mk: 'Mark',
  mrk: 'Mark',
  lk: 'Luke',
  luk: 'Luke',
  jn: 'John',
  jhn: 'John',
  'acts of the apostles': 'Acts',
  rom: 'Romans',
  '1 cor': '1 Corinthians',
  '1co': '1 Corinthians',
  '2 cor': '2 Corinthians',
  '2co': '2 Corinthians',
  gal: 'Galatians',
  eph: 'Ephesians',
  phil: 'Philippians',
  php: 'Philippians',
  col: 'Colossians',
  '1 thess': '1 Thessalonians',
  '1th': '1 Thessalonians',
  '2 thess': '2 Thessalonians',
  '2th': '2 Thessalonians',
  '1 tim': '1 Timothy',
  '1ti': '1 Timothy',
  '2 tim': '2 Timothy',
  '2ti': '2 Timothy',
  tit: 'Titus',
  phlm: 'Philemon',
  phm: 'Philemon',
  heb: 'Hebrews',
  jas: 'James',
  '1 pet': '1 Peter',
  '1pe': '1 Peter',
  '2 pet': '2 Peter',
  '2pe': '2 Peter',
  '1 jn': '1 John',
  '1jn': '1 John',
  '2 jn': '2 John',
  '2jn': '2 John',
  '3 jn': '3 John',
  '3jn': '3 John',
  rev: 'Revelation',
}

function normName(value: string): string {
  let name = value.toLowerCase().replace(/\./g, '').replace(/'/g, '').replace(/\s+/g, ' ').trim()
  name = name.replace(/^iii\b/, '3').replace(/^ii\b/, '2').replace(/^i\b/, '1')
  name = name.replace(/^first\b/, '1').replace(/^second\b/, '2').replace(/^third\b/, '3')
  return name
}

export function resolveBook(fragment: string): string | null {
  const name = normName(fragment)
  if (!name) return null
  if (ABBREV[name]) return ABBREV[name]
  const exact = BOOKS.find((book) => normName(book.name) === name)
  return exact?.name ?? null
}

function isBoilerplate(line: string): boolean {
  return /^(new international version|holy bible|niv)\b/i.test(line) || /biblica|copyright|©|all rights reserved|read full chapter/i.test(line)
}

function parseReference(line: string): { book: string; chapter: number; verse: number; matched: string } | null {
  const match = line.match(/^(.+?)\s+(\d{1,3})\s*:\s*(\d{1,3})(?:\s*[-–—]\s*\d{1,3})?(?:\s*\(?\s*niv\s*\)?)?/i)
  if (!match) return null
  const book = resolveBook(match[1])
  if (!book) return null
  const chapter = Number(match[2])
  const verse = Number(match[3])
  if (chapter < 1 || chapter > chapterCount(book) || verse < 1 || verse > MAX_VERSE) return null
  return { book, chapter, verse, matched: match[0] }
}

/** Drop NIV verse numbers and footnote markers like [a] or [1]. Keeps numbers that are part of the sentence. */
export function cleanPassage(text: string): string {
  let passage = text.replace(/\u00a0/g, ' ')
  passage = passage.replace(/\s*\[[a-zA-Z0-9]{1,3}\]/g, '')
  passage = passage.replace(/(^|\n)\s*\d{1,3}(?=\s+)/g, '$1')
  passage = passage.replace(/([.!?…"”'’])\s+\d{1,3}(?=\s+[A-Z“"‘'])/g, '$1')
  return passage.replace(/\s+/g, ' ').trim()
}

export function looksLikeNiv(text: string): boolean {
  return /\[[a-zA-Z0-9]{1,3}\]/.test(text) || /[A-Za-z.]+\s+\d+\s*:\s*\d+/.test(text) || /(^|\n)\s*\d{1,3}\s+[A-Z“"]/.test(text)
}

export function parseNivPaste(raw: string): NivPaste {
  const lines = raw.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean)
  let book: string | null = null
  let chapter: number | null = null
  let verse: number | null = null
  const body: string[] = []
  let inBody = false

  for (const line of lines) {
    if (/^(footnotes?|cross references?)\b/i.test(line)) break
    if (isBoilerplate(line)) continue
    if (!inBody) {
      const reference = parseReference(line)
      if (reference) {
        book = reference.book
        chapter = reference.chapter
        verse = reference.verse
        const rest = line.slice(reference.matched.length).trim()
        if (rest && !isBoilerplate(rest)) body.push(rest)
        continue
      }
    }
    inBody = true
    body.push(line)
  }

  return { book, chapter, verse, passage: cleanPassage(body.join('\n')) }
}
