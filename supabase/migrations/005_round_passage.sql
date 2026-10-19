-- BibleGuessr 005: the new passage travels with the round change.
-- Switching rounds used to update the round first and the public snapshot afterwards,
-- so viewers briefly kept the previous passage. Run after 004.

-- Builds the snapshot for a specific round and phase, without reading game_state.
-- Callers pass the values that are about to be saved, so one UPDATE can carry both.
create or replace function build_public_snapshot(
  p_round int,
  p_phase text,
  p_effects boolean,
  p_standings boolean,
  p_up_next int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
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
  select v.passage, v.book, v.chapter, v.verse
    into passage, ans_book, ans_chapter, ans_verse
  from verses v
  where v.round_number = p_round;

  select count(*) into rounds from verses;
  hide_totals := rounds > 0 and p_round >= rounds and not p_standings;

  select coalesce(jsonb_agg(item), '[]'::jsonb) into teams_json
  from (
    select jsonb_build_object(
      'id', t.id,
      'teammate1', t.teammate1,
      'teammate2', t.teammate2,
      'color', t.color,
      'submitted', exists (
        select 1 from guesses g
        where g.team_id = t.id and g.round_number = p_round
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
    where g.round_number = p_round and t.active
    order by g.created_at
  ) pins_ordered;
  pins_json := coalesce(pins_json, '[]'::jsonb);

  reveal_json := null;
  if p_phase = 'reveal' and ans_book is not null then
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
      left join guesses g on g.team_id = t.id and g.round_number = p_round
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

  return jsonb_build_object(
    'verseText', case when p_phase = 'lobby' then null else passage end,
    'verseRound', p_round,
    'teams', teams_json,
    'pins', pins_json,
    'totalRounds', rounds,
    'effects', p_effects,
    'standingsRevealed', p_standings,
    'upNext', p_up_next,
    'reveal', reveal_json
  );
end;
$$;

create or replace function rebuild_public_snapshot()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  gs game_state%rowtype;
begin
  select * into gs from game_state where id = 1;
  update game_state
    set public_snapshot = build_public_snapshot(
          gs.current_round,
          gs.phase,
          gs.effects_enabled,
          gs.standings_revealed,
          case when gs.phase = 'lobby' and gs.between_rounds then gs.current_round else null end
        ),
        updated_at = now()
  where id = 1;
end;
$$;

-- One row change: round, clock, and the passage for that round.
create or replace function host_set_round(p_round int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  gs game_state%rowtype;
begin
  if not exists (select 1 from verses where round_number = p_round) then
    raise exception 'That round does not exist';
  end if;
  select * into gs from game_state where id = 1 for update;

  update game_state
    set current_round = p_round,
        phase = 'guessing',
        guessing_ends_at = case
          when auto_start_timer then now() + (timer_duration_ms + 2600) * interval '1 millisecond'
          else null
        end,
        timer_paused = false,
        timer_remaining_ms = timer_duration_ms,
        round_started_at = now(),
        public_snapshot = build_public_snapshot(p_round, 'guessing', gs.effects_enabled, false, null),
        updated_at = now()
  where id = 1;

  perform log_event('phase', 'Round ' || p_round || ' started');
  return host_state();
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
    update game_state
      set phase = 'guessing',
          guessing_ends_at = case
            when auto_start_timer then now() + (timer_duration_ms + 2600) * interval '1 millisecond'
            else null
          end,
          timer_paused = false,
          timer_remaining_ms = timer_duration_ms,
          round_started_at = now(),
          public_snapshot = build_public_snapshot(gs.current_round, 'guessing', gs.effects_enabled, false, null),
          updated_at = now()
    where id = 1;
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
          public_snapshot = build_public_snapshot(gs.current_round, 'reveal', gs.effects_enabled, false, null),
          updated_at = now()
    where id = 1;
    perform log_event('phase', 'Round ' || gs.current_round || ' revealed');
  else
    update game_state
      set phase = 'lobby',
          guessing_ends_at = null,
          timer_paused = false,
          timer_remaining_ms = timer_duration_ms,
          public_snapshot = build_public_snapshot(gs.current_round, 'lobby', gs.effects_enabled, false, null),
          updated_at = now()
    where id = 1;
    perform log_event('phase', 'Game stopped, back to the lobby');
  end if;

  return host_state();
end;
$$;

revoke all on function build_public_snapshot(int, text, boolean, boolean, int) from public;
revoke all on function rebuild_public_snapshot() from public;

select rebuild_public_snapshot();
