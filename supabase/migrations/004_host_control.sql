-- BibleGuessr 004: host-controlled flow, hidden final standings, integrity signals, reset fix.
-- Run after 003. Safe to re-run; it does not drop tables or data.

alter table game_state
  add column if not exists standings_revealed boolean not null default false,
  add column if not exists between_rounds boolean not null default false,
  add column if not exists round_started_at timestamptz;

-- Per team, per round: how often the player left the page while guessing.
create table if not exists round_flags (
  team_id uuid not null references teams(id) on delete cascade,
  round_number integer not null,
  away_count integer not null default 0,
  away_ms integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (team_id, round_number)
);
alter table round_flags enable row level security;
revoke all on round_flags from anon, authenticated;

-- Phase or round changes always hide the standings again; leaving the lobby ends "between rounds".
create or replace function trg_game_state_flow()
returns trigger
language plpgsql
as $$
begin
  if new.phase is distinct from old.phase or new.current_round is distinct from old.current_round then
    new.standings_revealed := false;
  end if;
  if new.phase <> 'lobby' then
    new.between_rounds := false;
  end if;
  return new;
end;
$$;

drop trigger if exists game_state_flow on game_state;
create trigger game_state_flow
  before update on game_state
  for each row execute function trg_game_state_flow();

-- The round clock origin, used to spot suspiciously quick lock-ins.
create or replace function begin_guessing_timer()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update game_state
    set guessing_ends_at = case
          when auto_start_timer then now() + (timer_duration_ms + 2600) * interval '1 millisecond'
          else null
        end,
        round_started_at = now(),
        updated_at = now()
  where id = 1;
end;
$$;

-- Reset scores. The old version used a bare DELETE, which Supabase's API refuses.
create or replace function host_reset_scores()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from round_flags where true;
  delete from guesses where true;
  perform reset_timer();
  update game_state
    set phase = 'lobby',
        current_round = 1,
        between_rounds = false,
        standings_revealed = false,
        round_started_at = null,
        updated_at = now()
  where id = 1;
  perform log_event('reset', 'All guesses and scores were reset. Back to round 1.');
  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

-- Move to the next round without starting it. The host starts it when everyone is ready.
create or replace function host_prepare_round(p_round int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from verses where round_number = p_round) then
    raise exception 'That round does not exist';
  end if;
  perform reset_timer();
  update game_state
    set current_round = p_round,
        phase = 'lobby',
        between_rounds = true,
        standings_revealed = false,
        round_started_at = null,
        updated_at = now()
  where id = 1;
  perform log_event('phase', 'Round ' || p_round || ' is next');
  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

-- Show or hide the standings on the projector.
create or replace function host_reveal_standings(p_show boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update game_state set standings_revealed = p_show, updated_at = now() where id = 1;
  perform log_event('phase', case when p_show then 'Standings revealed' else 'Standings hidden' end);
  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

-- Phones report time spent away from the page while a round is open.
create or replace function report_away(p_team_id uuid, p_round int, p_count int, p_ms int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  gs game_state%rowtype;
  label text;
  had boolean;
begin
  select * into gs from game_state where id = 1;
  if gs.phase <> 'guessing' or gs.current_round <> p_round then
    return false;
  end if;
  select teammate1 || ' & ' || teammate2 into label from teams where id = p_team_id and active;
  if label is null then
    return false;
  end if;
  -- A team that already locked in has nothing to gain from looking things up.
  if exists (select 1 from guesses where team_id = p_team_id and round_number = p_round) then
    return true;
  end if;

  select exists (select 1 from round_flags where team_id = p_team_id and round_number = p_round) into had;
  insert into round_flags (team_id, round_number, away_count, away_ms)
  values (p_team_id, p_round, least(greatest(p_count, 0), 999), least(greatest(p_ms, 0), 3600000))
  on conflict (team_id, round_number) do update
    set away_count = greatest(round_flags.away_count, excluded.away_count),
        away_ms = greatest(round_flags.away_ms, excluded.away_ms),
        updated_at = now();

  if not had then
    perform log_event('flag', label || ' left the page during round ' || p_round, p_team_id);
  end if;
  -- Nudge the host's screen through realtime.
  update game_state set updated_at = now() where id = 1;
  return true;
end;
$$;

-- Public snapshot: hides final totals until revealed, and tells screens what is up next.
create or replace function rebuild_public_snapshot()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  gs game_state%rowtype;
  passage text;
  ans_book text;
  ans_chapter int;
  ans_verse int;
  teams_json jsonb;
  pins_json jsonb;
  reveal_json jsonb;
  rounds int;
  hide_totals boolean;
begin
  select * into gs from game_state where id = 1;

  select v.passage, v.book, v.chapter, v.verse
    into passage, ans_book, ans_chapter, ans_verse
  from verses v
  where v.round_number = gs.current_round;

  select count(*) into rounds from verses;
  hide_totals := rounds > 0 and gs.current_round >= rounds and not gs.standings_revealed;

  select coalesce(jsonb_agg(item), '[]'::jsonb) into teams_json
  from (
    select jsonb_build_object(
      'id', t.id,
      'teammate1', t.teammate1,
      'teammate2', t.teammate2,
      'color', t.color,
      'submitted', exists (
        select 1 from guesses g
        where g.team_id = t.id and g.round_number = gs.current_round
      )
    ) as item
    from teams t
    where t.active
    order by t.created_at
  ) teams_ordered;
  teams_json := coalesce(teams_json, '[]'::jsonb);

  select coalesce(jsonb_agg(item), '[]'::jsonb) into pins_json
  from (
    select jsonb_build_object(
      'teamId', t.id,
      'teammate1', t.teammate1,
      'teammate2', t.teammate2,
      'color', t.color,
      'book', g.guess_book,
      'chapter', g.guess_chapter
    ) as item
    from guesses g
    join teams t on t.id = g.team_id
    where g.round_number = gs.current_round and t.active
    order by g.created_at
  ) pins_ordered;
  pins_json := coalesce(pins_json, '[]'::jsonb);

  reveal_json := null;
  if gs.phase = 'reveal' and ans_book is not null then
    select coalesce(jsonb_agg(item), '[]'::jsonb) into reveal_json
    from (
      select jsonb_build_object(
        'teamId', t.id,
        'teammate1', t.teammate1,
        'teammate2', t.teammate2,
        'color', t.color,
        'guessBook', g.guess_book,
        'guessChapter', g.guess_chapter,
        'guessVerse', g.guess_verse,
        'bookScore', coalesce(g.book_score, 0),
        'chapterScore', coalesce(g.chapter_score, 0),
        'verseScore', coalesce(g.verse_score, 0),
        'multiplier', coalesce(g.multiplier, 0),
        'score', coalesce(g.score, 0),
        'totalScore', case
          when hide_totals then 0
          else (select coalesce(sum(g2.score), 0) from guesses g2 where g2.team_id = t.id)
        end
      ) as item
      from teams t
      left join guesses g on g.team_id = t.id and g.round_number = gs.current_round
      where t.active
      order by g.score desc nulls last, g.submission_order nulls last, t.created_at
    ) results_ordered;

    reveal_json := jsonb_build_object(
      'book', ans_book,
      'chapter', ans_chapter,
      'verse', ans_verse,
      'results', coalesce(reveal_json, '[]'::jsonb)
    );
  end if;

  update game_state
    set public_snapshot = jsonb_build_object(
          'verseText', case when gs.phase = 'lobby' then null else passage end,
          'teams', teams_json,
          'pins', pins_json,
          'totalRounds', rounds,
          'effects', gs.effects_enabled,
          'standingsRevealed', gs.standings_revealed,
          'upNext', case when gs.phase = 'lobby' and gs.between_rounds then gs.current_round else null end,
          'reveal', reveal_json
        ),
        updated_at = now()
  where id = 1;
end;
$$;

-- Host state: adds the flow flags, lock-in times, and away reports.
create or replace function host_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  gs game_state%rowtype;
begin
  select * into gs from game_state where id = 1;
  return jsonb_build_object(
    'phase', gs.phase,
    'currentRound', gs.current_round,
    'timerDurationMs', gs.timer_duration_ms,
    'guessingEndsAt', gs.guessing_ends_at,
    'timerPaused', gs.timer_paused,
    'timerRemainingMs', gs.timer_remaining_ms,
    'autoStartTimer', gs.auto_start_timer,
    'revealWhenAllIn', gs.reveal_when_all_in,
    'effectsEnabled', gs.effects_enabled,
    'standingsRevealed', gs.standings_revealed,
    'betweenRounds', gs.between_rounds,
    'roundStartedAt', gs.round_started_at,
    'serverNow', now(),
    'verses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'roundNumber', round_number, 'book', book,
        'chapter', chapter, 'verse', verse, 'passage', passage
      ) order by round_number) from verses
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'teammate1', teammate1, 'teammate2', teammate2,
        'color', color, 'active', active, 'lastSeen', last_seen
      ) order by created_at) from teams
    ), '[]'::jsonb),
    'guesses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'teamId', team_id, 'roundNumber', round_number,
        'guessBook', guess_book, 'guessChapter', guess_chapter, 'guessVerse', guess_verse,
        'bookScore', book_score, 'chapterScore', chapter_score, 'verseScore', verse_score,
        'score', score, 'submissionOrder', submission_order, 'multiplier', multiplier,
        'createdAt', created_at
      ) order by round_number, submission_order) from guesses
    ), '[]'::jsonb),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object(
        'teamId', team_id, 'roundNumber', round_number,
        'awayCount', away_count, 'awayMs', away_ms
      )) from round_flags
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'createdAt', created_at, 'kind', kind, 'message', message
      ) order by id desc)
      from (select * from game_events order by id desc limit 80) recent
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function begin_guessing_timer() from public;
revoke all on function rebuild_public_snapshot() from public;
revoke all on function host_state() from public;
revoke all on function host_prepare_round(int) from public;
revoke all on function host_reveal_standings(boolean) from public;
revoke all on function report_away(uuid, int, int, int) from public;

grant execute on function host_prepare_round(int) to anon, authenticated, service_role;
grant execute on function host_reveal_standings(boolean) to anon, authenticated, service_role;
grant execute on function report_away(uuid, int, int, int) to anon, authenticated, service_role;

select rebuild_public_snapshot();
