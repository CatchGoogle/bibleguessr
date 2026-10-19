import type { Connection } from '../lib/useGame.ts'

export function ConnectionBadge({ connection, dark = false }: { connection: Connection; dark?: boolean }) {
  if (connection === 'live') return null
  return (
    <p className={dark ? 'connection-badge dark' : 'connection-badge'} role="status">
      <i />
      {connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
    </p>
  )
}
