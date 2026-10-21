let audio: AudioContext | null = null
let master: GainNode | null = null
let reverbSend: GainNode | null = null
let tickerUsers = 0
let tickerId: number | null = null
let tickStep = 0

// Notes in a pentatonic scale keep every sound consonant, whatever order they play in.
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51]

function impulse(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 1.6)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.6)
    }
  }
  return buffer
}

// One shared chain: a soft low-pass to take the edge off, plus a small room reverb.
function context(): AudioContext {
  if (audio) return audio
  const ctx = new AudioContext()
  const out = ctx.createGain()
  out.gain.value = 0.9
  const soften = ctx.createBiquadFilter()
  soften.type = 'lowpass'
  soften.frequency.value = 5200
  soften.Q.value = 0.4
  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.value = -16
  compressor.ratio.value = 3
  out.connect(soften)
  soften.connect(compressor)
  compressor.connect(ctx.destination)

  const reverb = ctx.createConvolver()
  reverb.buffer = impulse(ctx)
  const wet = ctx.createGain()
  wet.gain.value = 0.32
  reverbSend = ctx.createGain()
  reverbSend.connect(reverb)
  reverb.connect(wet)
  wet.connect(out)

  master = out
  audio = ctx
  return ctx
}

export function unlockSound(): void {
  const ctx = context()
  if (ctx.state === 'suspended') void ctx.resume()
}

type Voice = {
  freq: number
  at?: number
  length?: number
  gain?: number
  type?: OscillatorType
  glideFrom?: number
  attack?: number
  reverb?: number
  partials?: [ratio: number, level: number][]
}

// A single soft note with a gentle attack and a smooth fade, plus optional overtones.
function voice({ freq, at = 0, length = 0.4, gain = 0.1, type = 'sine', glideFrom, attack = 0.01, reverb = 0.5, partials = [] }: Voice) {
  const ctx = context()
  if (ctx.state !== 'running' || !master) return
  const start = ctx.currentTime + at
  const stop = start + length + 0.05
  const amp = ctx.createGain()
  amp.gain.setValueAtTime(0.0001, start)
  amp.gain.exponentialRampToValueAtTime(gain, start + attack)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + length)
  amp.connect(master)
  if (reverbSend && reverb > 0) {
    const send = ctx.createGain()
    send.gain.value = reverb
    amp.connect(send)
    send.connect(reverbSend)
  }

  const layers: [number, number][] = [[1, 1], ...partials]
  for (const [ratio, level] of layers) {
    const osc = ctx.createOscillator()
    const layer = ctx.createGain()
    osc.type = type
    if (glideFrom) {
      osc.frequency.setValueAtTime(glideFrom * ratio, start)
      osc.frequency.exponentialRampToValueAtTime(freq * ratio, start + Math.min(0.09, length / 2))
    } else {
      osc.frequency.setValueAtTime(freq * ratio, start)
    }
    // Overtones die away sooner than the fundamental, like a struck bell.
    layer.gain.setValueAtTime(level, start)
    if (ratio !== 1) layer.gain.exponentialRampToValueAtTime(0.0001, start + length * 0.6)
    osc.connect(layer)
    layer.connect(amp)
    osc.start(start)
    osc.stop(stop)
  }
}

const BELL: [number, number][] = [
  [2, 0.28],
  [3.01, 0.12],
  [4.2, 0.06],
]

// Last five seconds: a round, woody tap that rises a little each second.
export function playCountdown(second: number): void {
  const step = Math.min(5, Math.max(1, second))
  const freq = PENTATONIC[Math.min(PENTATONIC.length - 1, 5 - step)] * 0.5
  voice({ freq, length: 0.28, gain: 0.2, attack: 0.006, reverb: 0.35, partials: [[2, 0.18]] })
}

// Time is up: a low, soft gong rather than a buzzer.
export function playTimeUp(): void {
  voice({ freq: 196, length: 1.6, gain: 0.2, attack: 0.02, reverb: 0.8, partials: [[1.5, 0.2], [2.01, 0.16], [2.76, 0.08]] })
  voice({ freq: 98, length: 1.8, gain: 0.16, attack: 0.03, reverb: 0.6 })
}

// Score ticker: a very quiet glassy pluck that climbs a little scale.
export function playPointsTick(): void {
  const freq = PENTATONIC[tickStep % PENTATONIC.length] * 2
  tickStep += 1
  voice({ freq, length: 0.09, gain: 0.035, attack: 0.003, reverb: 0.15 })
}

// A perfect guess: bright bells rising through a major chord.
export function playPerfect(): void {
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51]
  notes.forEach((freq, index) => {
    voice({ freq, at: index * 0.09, length: 1.8, gain: 0.13, attack: 0.008, reverb: 0.9, partials: BELL })
  })
  voice({ freq: 130.81, length: 2.2, gain: 0.14, attack: 0.05, reverb: 0.6 })
  voice({ freq: 2093, at: 0.45, length: 1.4, gain: 0.05, reverb: 1, partials: [[1.5, 0.3]] })
}

// A new round: a warm two-note chime that rises into the clock.
export function playRoundStart(): void {
  voice({ freq: 392, length: 1.4, gain: 0.15, attack: 0.012, reverb: 0.8, partials: BELL })
  voice({ freq: 587.33, at: 0.16, length: 1.5, gain: 0.15, attack: 0.012, reverb: 0.8, partials: BELL })
  voice({ freq: 783.99, at: 0.34, length: 1.8, gain: 0.15, attack: 0.012, reverb: 0.9, partials: BELL })
  voice({ freq: 196, length: 1.6, gain: 0.1, attack: 0.06, reverb: 0.5 })
}

// A guess lands on the map: a soft bubble pop that varies a little each time.
export function playGuess(): void {
  const freq = PENTATONIC[Math.floor(Math.random() * 5) + 1]
  voice({ freq, glideFrom: freq * 0.62, length: 0.34, gain: 0.17, attack: 0.008, reverb: 0.6, partials: [[2, 0.12]] })
}

export function startTicker(): void {
  tickerUsers += 1
  if (tickerId != null) return
  tickStep = 0
  tickerId = window.setInterval(playPointsTick, 85)
}

export function stopTicker(): void {
  tickerUsers = Math.max(0, tickerUsers - 1)
  if (tickerUsers > 0 || tickerId == null) return
  window.clearInterval(tickerId)
  tickerId = null
}
