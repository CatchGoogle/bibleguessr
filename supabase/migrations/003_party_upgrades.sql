-- BibleGuessr 003: settings, presence, activity log, auto-start timer, auto-reveal.
-- Safe to run on top of 001 + 002. It does not drop tables or data.

alter table game_state
  add column if not exists auto_start_timer boolean not null default true,
  add column if not exists reveal_when_all_in boolean not null default false,
  add column if not exists effects_enabled boolean not null default true;

alter table teams
  add column if not exists last_seen timestamptz not null default now();

create table if not exists game_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  message text not null,
  team_id uuid
);

alter table game_events enable row level security;
revoke all on game_events from anon, authenticated;

create or replace function log_event(p_kind text, p_message text, p_team uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into game_events (kind, message, team_id) values (p_kind, p_message, p_team);
  delete from game_events where id < (select max(id) from game_events) - 200;
end;
$$;

-- Team activity ---------------------------------------------------------

create or replace function trg_team_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform log_event('join', new.teammate1 || ' & ' || new.teammate2 || ' joined', new.id);
  elsif tg_op = 'UPDATE' then
    if old.active and not new.active then
      perform log_event('leave', new.teammate1 || ' & ' || new.teammate2 || ' left the game', new.id);
    elsif old.teammate1 is distinct from new.teammate1 or old.teammate2 is distinct from new.teammate2 then
      perform log_event(
        'edit',
        old.teammate1 || ' & ' || old.teammate2 || ' renamed to ' || new.teammate1 || ' & ' || new.teammate2,
        new.id
      );
    elsif old.color is distinct from new.color then
      perform log_event('edit', new.teammate1 || ' & ' || new.teammate2 || ' changed color', new.id);
    end if;
  elsif tg_op = 'DELETE' then
    perform log_event('remove', old.teammate1 || ' & ' || old.teammate2 || ' was removed', null);
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists team_events on teams;
create trigger team_events
  after insert or update or delete on teams
  for each row execute function trg_team_events();

create or replace function trg_guess_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  label text;
  have int;
  need int;
begin
  select teammate1 || ' & ' || teammate2 into label from teams where id = new.team_id;
  select count(*) into need from teams where active;
  select count(*) into have
  from guesses g join teams t on t.id = g.team_id
  where g.round_number = new.round_number and t.active;
  perform log_event(
    'guess',
    coalesce(label, 'A team') || ' locked in (' || have || '/' || need || ')',
    new.team_id
  );
  return null;
end;
$$;

drop trigger if exists guess_events on guesses;
create trigger guess_events
  after insert on guesses
  for each row execute function trg_guess_events();

-- Reveal automatically once everyone is locked in (host setting, off by default)

create or replace function trg_guess_auto_reveal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gs game_state%rowtype;
  need int;
  have int;
begin
  select * into gs from game_state where id = 1;
  if gs.reveal_when_all_in and gs.phase = 'guessing' and new.round_number = gs.current_round then
    select count(*) into need from teams where active;
    select count(*) into have
    from guesses g join teams t on t.id = g.team_id
    where g.round_number = gs.current_round and t.active;
    if need > 0 and have >= need then
      perform host_set_phase('reveal');
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists guess_auto_reveal on guesses;
create trigger guess_auto_reveal
  after insert on guesses
  for each row execute function trg_guess_auto_reveal();

-- Presence, leaving, and a server clock --------------------------------------

create or replace function team_heartbeat(p_team_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update teams set last_seen = now() where id = p_team_id and active;
  return found;
end;
$$;

create or replace function leave_team(p_team_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update teams set active = false where id = p_team_id and active;
  if found then
    perform rebuild_public_snapshot();
    return true;
  end if;
  return false;
end;
$$;

create or replace function server_now()
returns timestamptz
language sql
stable
as $$
  select now();
$$;

-- Public snapshot now carries round count and the effects flag ------------------

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
begin
  select * into gs from game_state where id = 1;

  select v.passage, v.book, v.chapter, v.verse
    into passage, ans_book, ans_chapter, ans_verse
  from verses v
  where v.round_number = gs.current_round;

  select count(*) into rounds from verses;

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
        'totalScore', (select coalesce(sum(g2.score), 0) from guesses g2 where g2.team_id = t.id)
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
          'reveal', reveal_json
        ),
        updated_at = now()
  where id = 1;
end;
$$;

-- Host state: settings, presence, and the activity log ------------------------

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
        'score', score, 'submissionOrder', submission_order, 'multiplier', multiplier
      ) order by round_number, submission_order) from guesses
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

-- Starting a round can start the clock too (after the projector's round intro) -----

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
        updated_at = now()
  where id = 1;
end;
$$;

create or replace function host_set_phase(p_phase text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  gs game_state%rowtype;
  remaining int;
begin
  if p_phase not in ('lobby', 'guessing', 'reveal') then
    raise exception 'Unknown phase';
  end if;
  select * into gs from game_state where id = 1 for update;

  if p_phase = 'guessing' then
    if not exists (select 1 from verses where round_number = gs.current_round) then
      raise exception 'Add a passage for this round first';
    end if;
    perform reset_timer();
    update game_state set phase = 'guessing', updated_at = now() where id = 1;
    perform begin_guessing_timer();
    perform log_event('phase', 'Round ' || gs.current_round || ' started');
  elsif p_phase = 'reveal' then
    if gs.guessing_ends_at is not null then
      remaining := greatest(0, floor(extract(epoch from (gs.guessing_ends_at - now())) * 1000))::int;
    elsif gs.timer_paused then
      remaining := gs.timer_remaining_ms;
    else
      remaining := gs.timer_duration_ms;
    end if;
    update game_state
      set phase = 'reveal',
          guessing_ends_at = null,
          timer_paused = true,
          timer_remaining_ms = least(remaining, gs.timer_duration_ms),
          updated_at = now()
    where id = 1;
    perform log_event('phase', 'Round ' || gs.current_round || ' revealed');
  else
    perform reset_timer();
    update game_state set phase = 'lobby', updated_at = now() where id = 1;
    perform log_event('phase', 'Game stopped, back to the lobby');
  end if;

  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

create or replace function host_set_round(p_round int)
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
  update game_state set current_round = p_round, phase = 'guessing', updated_at = now() where id = 1;
  perform begin_guessing_timer();
  perform log_event('phase', 'Round ' || p_round || ' started');
  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

create or replace function host_set_settings(
  p_auto_start boolean,
  p_reveal_when_all_in boolean,
  p_effects boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update game_state
    set auto_start_timer = p_auto_start,
        reveal_when_all_in = p_reveal_when_all_in,
        effects_enabled = p_effects,
        updated_at = now()
  where id = 1;
  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

create or replace function host_delete_guess(p_guess_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  round_num int;
  label text;
begin
  select g.round_number, t.teammate1 || ' & ' || t.teammate2
    into round_num, label
  from guesses g join teams t on t.id = g.team_id
  where g.id = p_guess_id;
  if round_num is null then
    raise exception 'Guess not found';
  end if;
  delete from guesses where id = p_guess_id;
  perform recompute_round_scores(round_num);
  perform log_event('guess', 'Deleted ' || label || '''s guess for round ' || round_num);
  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

create or replace function host_reset_scores()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from guesses;
  perform log_event('reset', 'All guesses and scores were reset');
  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

revoke all on function log_event(text, text, uuid) from public;
revoke all on function begin_guessing_timer() from public;
revoke all on function trg_team_events() from public;
revoke all on function trg_guess_events() from public;
revoke all on function trg_guess_auto_reveal() from public;
revoke all on function host_state() from public;
revoke all on function rebuild_public_snapshot() from public;
revoke all on function team_heartbeat(uuid) from public;
revoke all on function leave_team(uuid) from public;
revoke all on function server_now() from public;
revoke all on function host_set_settings(boolean, boolean, boolean) from public;

grant execute on function team_heartbeat(uuid) to anon, authenticated, service_role;
grant execute on function leave_team(uuid) to anon, authenticated, service_role;
grant execute on function server_now() to anon, authenticated, service_role;
grant execute on function host_set_settings(boolean, boolean, boolean) to anon, authenticated, service_role;

select rebuild_public_snapshot();
