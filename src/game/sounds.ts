let audio: AudioContext | null = null
let tickerUsers = 0
let tickerId: number | null = null

function context(): AudioContext {
  if (!audio) audio = new AudioContext()
  return audio
}

export function unlockSound(): void {
  const ctx = context()
  if (ctx.state === 'suspended') void ctx.resume()
}

function tone(freq: number, duration: number, type: OscillatorType, gain: number, delay = 0) {
  const ctx = context()
  if (ctx.state !== 'running') return
  const start = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  amp.gain.setValueAtTime(0.0001, start)
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(amp)
  amp.connect(ctx.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

export function playCountdown(second: number): void {
  const step = Math.min(5, Math.max(1, second))
  tone(520 + (5 - step) * 90, 0.11, 'square', 0.07)
}

export function playTimeUp(): void {
  tone(196, 0.42, 'sawtooth', 0.08)
  tone(146, 0.55, 'square', 0.05, 0.1)
}

export function playPointsTick(): void {
  tone(980, 0.028, 'square', 0.03)
}

export function playPerfect(): void {
  ;[523, 659, 784, 1047].forEach((freq, index) => tone(freq, 0.42, 'triangle', 0.11, index * 0.07))
}

export function startTicker(): void {
  tickerUsers += 1
  if (tickerId != null) return
  tickerId = window.setInterval(playPointsTick, 70)
}

export function stopTicker(): void {
  tickerUsers = Math.max(0, tickerUsers - 1)
  if (tickerUsers > 0 || tickerId == null) return
  window.clearInterval(tickerId)
  tickerId = null
}
