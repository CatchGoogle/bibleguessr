import { useCallback, useEffect, useRef, useState } from 'react'
import { preferNewerGame, withCurrentPassage } from '../game/snapshot.ts'
import type { SeenPassage } from '../game/snapshot.ts'
import type { HostState, PublicGame } from '../game/types.ts'
import { fetchHostState, parsePublicGame } from './api.ts'
import { serverNowMs, syncClock } from './clock.ts'
import { getSupabase } from './supabase.ts'

export type Connection = 'connecting' | 'live' | 'reconnecting'

// Current time on the server's clock. One tick per second, and only while a clock is running,
// so a projector left on the standings is not repainting several times a second.
export function useNow(active = true): number {
  const [now, setNow] = useState(() => serverNowMs())
  const [wasActive, setWasActive] = useState(active)
  if (active !== wasActive) {
    setWasActive(active)
    if (active) setNow(serverNowMs())
  }
  useEffect(() => {
    if (!active) return
    let timer = 0
    const tick = () => {
      const next = serverNowMs()
      setNow(next)
      timer = window.setTimeout(tick, Math.max(250, 1000 - (next % 1000) + 30))
    }
    timer = window.setTimeout(tick, Math.max(250, 1000 - (serverNowMs() % 1000) + 30))
    return () => window.clearTimeout(timer)
  }, [active])
  return now
}

type LiveOptions<T> = {
  enabled: boolean
  channelName: string
  fetcher: () => Promise<T>
  // Called with a realtime row so the screen can update without waiting for a fetch.
  fromPayload?: (row: unknown) => T
  // Drop a late or in-flight result when a newer one is already on screen.
  merge?: (current: T | null, next: T) => T
  pollMs: number
}

function useLive<T>({ enabled, channelName, fetcher, fromPayload, merge, pollMs }: LiveOptions<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [connection, setConnection] = useState<Connection>('connecting')
  const fetcherRef = useRef(fetcher)
  const payloadRef = useRef(fromPayload)
  const mergeRef = useRef(merge)
  fetcherRef.current = fetcher
  payloadRef.current = fromPayload
  mergeRef.current = merge

  const refresh = useCallback(async () => {
    try {
      const next = await fetcherRef.current()
      setData((current) => (mergeRef.current ? mergeRef.current(current, next) : next))
      setError(null)
      setLoading(false)
      setConnection((current) => (current === 'reconnecting' ? 'live' : current))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the game.')
      setLoading(false)
      setConnection('reconnecting')
      return false
    }
  }, [])

  useEffect(() => {
    const supabase = getSupabase()
    if (!enabled) {
      setLoading(false)
      return
    }
    if (!supabase) {
      setError('Add Supabase keys to .env.local before opening the game.')
      setLoading(false)
      return
    }

    let cancelled = false

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_state', filter: 'id=eq.1' },
        (payload) => {
          if (cancelled) return
          if (payloadRef.current && payload.new && Object.keys(payload.new).length > 0) {
            try {
              const parsed = payloadRef.current(payload.new)
              setData((current) => (mergeRef.current ? mergeRef.current(current, parsed) : parsed))
              setError(null)
              return
            } catch {
              // Fall through to a full fetch.
            }
          }
          void refresh()
        },
      )
      .subscribe((status) => {
        if (cancelled) return
        if (status === 'SUBSCRIBED') {
          setConnection('live')
          void refresh()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnection('reconnecting')
        }
      })

    void syncClock()
    void refresh()

    // Safety net: realtime can drop silently on a sleeping phone or a flaky venue network.
    const poll = window.setInterval(() => void refresh(), pollMs)
    const clockTimer = window.setInterval(() => void syncClock(), 60_000)

    const wake = () => {
      if (document.visibilityState === 'hidden') return
      void syncClock()
      void refresh()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    window.addEventListener('focus', wake)

    return () => {
      cancelled = true
      window.clearInterval(poll)
      window.clearInterval(clockTimer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      window.removeEventListener('focus', wake)
      void supabase.removeChannel(channel)
    }
  }, [enabled, channelName, pollMs, refresh])

  return { data, setData, error, setError, loading, connection, refresh }
}

async function fetchPublicGame(): Promise<PublicGame> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Add Supabase keys to .env.local before opening the game.')
  const { data, error } = await supabase
    .from('game_state')
    .select(
      'phase, current_round, updated_at, timer_duration_ms, guessing_ends_at, timer_paused, timer_remaining_ms, public_snapshot',
    )
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('The game has not been set up yet.')
  return parsePublicGame(data)
}

export function usePublicGame(enabled = true) {
  const { data, error, loading, connection } = useLive<PublicGame>({
    enabled,
    channelName: 'bibleguessr-game',
    fetcher: fetchPublicGame,
    fromPayload: parsePublicGame,
    merge: preferNewerGame,
    pollMs: 6000,
  })
  const seen = useRef<SeenPassage>({ round: 0, text: null })
  const game = data ? withCurrentPassage(data, seen.current) : null
  if (game) seen.current = game.seen
  return { game: game?.game ?? null, error, loading, connection }
}

export function useHostGame() {
  const { data, setData, error, setError, loading, connection, refresh } = useLive<HostState>({
    enabled: true,
    channelName: 'bibleguessr-host',
    fetcher: fetchHostState,
    pollMs: 2500,
  })
  return { state: data, setState: setData, error, setError, loading, connection, refresh }
}
