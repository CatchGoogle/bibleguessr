import type { HostEvent } from '../game/types.ts'

const KIND_LABEL: Record<string, string> = {
  join: 'Joined',
  leave: 'Left',
  remove: 'Removed',
  edit: 'Edited',
  guess: 'Guess',
  phase: 'Round',
  reset: 'Reset',
}

export function ActivityLog({ events }: { events: HostEvent[] }) {
  if (events.length === 0) return <p className="quiet">Joins, guesses and round changes will appear here.</p>
  return (
    <ol className="activity-log">
      {events.map((event) => (
        <li key={event.id} className={`event ${event.kind}`}>
          <time dateTime={event.createdAt}>
            {new Date(event.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </time>
          <b>{KIND_LABEL[event.kind] ?? event.kind}</b>
          <span>{event.message}</span>
        </li>
      ))}
    </ol>
  )
}
