import { Link } from 'react-router-dom'
import { Wordmark } from '../components/Wordmark.tsx'
import { supabaseConfigured } from '../lib/supabase.ts'

export function Home() {
  const configured = supabaseConfigured()

  return (
    <main className="home-shell">
      <section className="home-card">
        <Wordmark />
        <p className="lede">Guess the book, chapter, and verse. The projector keeps score.</p>
        {!configured && (
          <p className="notice">
            Copy <code>.env.example</code> to <code>.env.local</code>, add your Supabase URL and anon key,
            and run the files in <code>supabase/migrations</code> in order (001, 002, 003) in the SQL editor.
          </p>
        )}
        <div className="home-actions">
          <Link className="btn primary" to="/play">
            Play
          </Link>
          <Link className="btn" to="/watch">
            Projector
          </Link>
          <Link className="text-link" to="/watch/preview">
            Projector layout preview
          </Link>
        </div>
      </section>
    </main>
  )
}
