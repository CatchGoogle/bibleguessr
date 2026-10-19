import { getSupabase } from './supabase.ts'

// Difference between the server's clock and this device's clock, in ms.
let offsetMs = 0

export function clockOffset(): number {
  return offsetMs
}

export function serverNowMs(): number {
  return Date.now() + offsetMs
}

export function setServerTime(serverIso: string | null | undefined, requestedAt?: number) {
  if (!serverIso) return
  const server = new Date(serverIso).getTime()
  if (!Number.isFinite(server)) return
  const sentAt = requestedAt ?? Date.now()
  const midpoint = (sentAt + Date.now()) / 2
  offsetMs = server - midpoint
}

export async function syncClock(): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  const sentAt = Date.now()
  const { data, error } = await supabase.rpc('server_now')
  if (error || typeof data !== 'string') return
  setServerTime(data, sentAt)
}
