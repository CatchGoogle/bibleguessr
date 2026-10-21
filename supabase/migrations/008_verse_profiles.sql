-- BibleGuessr 008: three verse lists. Official stays on profile 1.
-- Practice lists have their own passages, guesses, and scores.
-- Run after 007 in the Supabase SQL editor.

alter table game_state
  add column if not exists verse_profile smallint not null default 1;

alter table game_state drop constraint if exists game_state_verse_profile_check;
alter table game_state
  add constraint game_state_verse_profile_check check (verse_profile between 1 and 3);

alter table verses
  add column if not exists profile smallint not null default 1;

alter table verses drop constraint if exists verses_round_number_key;
alter table verses drop constraint if exists verses_profile_round_key;
alter table verses
  add constraint verses_profile_round_key unique (profile, round_number);

alter table verses drop constraint if exists verses_profile_check;
alter table verses
  add constraint verses_profile_check check (profile between 1 and 3);

alter table guesses
  add column if not exists profile smallint not null default 1;

alter table guesses drop constraint if exists guesses_team_id_round_number_key;
alter table guesses drop constraint if exists guesses_team_round_profile_key;
alter table guesses
  add constraint guesses_team_round_profile_key unique (team_id, round_number, profile);

alter table guesses drop constraint if exists guesses_profile_check;
alter table guesses
  add constraint guesses_profile_check check (profile between 1 and 3);

alter table round_flags
  add column if not exists profile smallint not null default 1;

alter table round_flags drop constraint if exists round_flags_pkey;
alter table round_flags
  add primary key (team_id, round_number, profile);

create or replace function current_profile()
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select verse_profile from game_state where id = 1
$$;

create or replace function recompute_round_scores(p_round int, p_profile int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  team_count int;
  ord int := 0;
  rec record;
  mult numeric;
  base int;
begin
  select count(*) into team_count from teams where active;
  if team_count < 1 then
    team_count := 1;
  end if;

  for rec in
    select id, book_score, chapter_score, verse_score
    from guesses
    where round_number = p_round and profile = p_profile
    order by created_at, id
  loop
    ord := ord + 1;
    base := rec.book_score + rec.chapter_score + rec.verse_score;
    if ord = team_count then
      mult := 1;
    else
      mult := 1 + (0.1 * (team_count - 1)::numeric / ord);
    end if;
    update guesses
      set submission_order = ord,
          multiplier = mult,
          score = round(base * mult)::int
    where id = rec.id;
  end loop;
end;
$$;

create or replace function recompute_round_scores(p_round int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform recompute_round_scores(p_round, current_profile());
end;
$$;

create or replace function rescore_round_answers(p_round int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ans verses%rowtype;
  rec record;
  scored record;
  prof smallint := current_profile();
begin
  select * into ans from verses where round_number = p_round and profile = prof;
  if not found then
    return;
  end if;

  for rec in select * from guesses where round_number = p_round and profile = prof loop
    select * into scored
    from score_guess(rec.guess_book, rec.guess_chapter, rec.guess_verse, ans.book, ans.chapter, ans.verse);
    update guesses
      set ans_book = ans.book,
          ans_chapter = ans.chapter,
          ans_verse = ans.verse,
          book_score = scored.book_score,
          chapter_score = scored.chapter_score,
          verse_score = scored.verse_score,
          score = round((scored.base_score * multiplier))::int
    where id = rec.id;
  end loop;
end;
$$;

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
  prof smallint;
begin
  select verse_profile into prof from game_state where id = 1;

  select v.passage, v.book, v.chapter, v.verse
    into passage, ans_book, ans_chapter, ans_verse
  from verses v
  where v.round_number = p_round and v.profile = prof;

  select count(*) into rounds from verses where profile = prof;
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
        where g.team_id = t.id and g.round_number = p_round and g.profile = prof
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
    where g.round_number = p_round and g.profile = prof and t.active
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
          else (
            select coalesce(sum(g2.score), 0)
            from guesses g2
            where g2.team_id = t.id
              and g2.profile = prof
              and g2.round_number <= p_round
          )
        end
      ) as item
      from teams t
      left join guesses g on g.team_id = t.id and g.round_number = p_round and g.profile = prof
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

create or replace function submit_guess(p_team_id uuid, p_book text, p_chapter int, p_verse int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  gs game_state%rowtype;
  ans verses%rowtype;
  team_count int;
  ord int;
  mult numeric;
  scored record;
  book_name text;
begin
  if not exists (select 1 from teams where id = p_team_id and active) then
    raise exception 'Team not found';
  end if;

  perform pg_advisory_xact_lock(841026);
  select * into gs from game_state where id = 1 for update;
  if gs.phase <> 'guessing' then
    raise exception 'Guesses are closed';
  end if;
  if gs.timer_paused and gs.timer_remaining_ms <= 0 then
    raise exception 'Time is up';
  end if;
  if gs.guessing_ends_at is not null and now() >= gs.guessing_ends_at then
    raise exception 'Time is up';
  end if;
  if exists (
    select 1 from guesses
    where team_id = p_team_id and round_number = gs.current_round and profile = gs.verse_profile
  ) then
    raise exception 'You already locked in a guess for this round';
  end if;

  select * into ans from verses where round_number = gs.current_round and profile = gs.verse_profile;
  if not found then
    raise exception 'This round has no passage yet';
  end if;

  book_name := assert_reference(p_book, p_chapter, p_verse);
  select * into scored from score_guess(book_name, p_chapter, p_verse, ans.book, ans.chapter, ans.verse);
  select count(*) into team_count from teams where active;
  select count(*) + 1 into ord
  from guesses
  where round_number = gs.current_round and profile = gs.verse_profile;
  if ord = team_count then
    mult := 1;
  else
    mult := 1 + (0.1 * (team_count - 1)::numeric / ord);
  end if;

  insert into guesses (
    team_id, round_number, profile, guess_book, guess_chapter, guess_verse,
    ans_book, ans_chapter, ans_verse, book_score, chapter_score, verse_score,
    score, submission_order, multiplier
  ) values (
    p_team_id, gs.current_round, gs.verse_profile, book_name, p_chapter, p_verse,
    ans.book, ans.chapter, ans.verse, scored.book_score, scored.chapter_score, scored.verse_score,
    round(scored.base_score * mult)::int, ord, mult
  );

  perform rebuild_public_snapshot();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function host_add_verse(p_book text, p_chapter int, p_verse int, p_passage text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  book_name text;
  next_round int;
  body text := trim(p_passage);
  prof smallint := current_profile();
begin
  book_name := assert_reference(p_book, p_chapter, p_verse);
  if body is null or length(body) < 1 or length(body) > 2000 then
    raise exception 'Enter the passage text';
  end if;
  select coalesce(max(round_number), 0) + 1 into next_round
  from verses
  where profile = prof;
  insert into verses (round_number, profile, book, chapter, verse, passage)
  values (next_round, prof, book_name, p_chapter, p_verse, body);
  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

create or replace function host_update_verse(
  p_round int, p_book text, p_chapter int, p_verse int, p_passage text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  book_name text;
  body text := trim(p_passage);
  prof smallint := current_profile();
begin
  book_name := assert_reference(p_book, p_chapter, p_verse);
  if body is null or length(body) < 1 or length(body) > 2000 then
    raise exception 'Enter the passage text';
  end if;
  update verses
    set book = book_name, chapter = p_chapter, verse = p_verse, passage = body
  where round_number = p_round and profile = prof;
  if not found then
    raise exception 'That round does not exist';
  end if;
  perform rescore_round_answers(p_round);
  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

create or replace function host_delete_verse(p_round int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  gs game_state%rowtype;
  next_current int;
  prof smallint := current_profile();
begin
  if exists (select 1 from guesses where round_number = p_round and profile = prof) then
    raise exception 'Reset scores before deleting a round that already has guesses';
  end if;
  delete from verses where round_number = p_round and profile = prof;
  if not found then
    raise exception 'That round does not exist';
  end if;

  delete from round_flags where round_number = p_round and profile = prof;

  update verses set round_number = -round_number
  where profile = prof and round_number > p_round;
  update verses set round_number = (-round_number) - 1
  where profile = prof and round_number < 0;

  update guesses set round_number = -round_number
  where profile = prof and round_number > p_round;
  update guesses set round_number = (-round_number) - 1
  where profile = prof and round_number < 0;

  update round_flags set round_number = -round_number
  where profile = prof and round_number > p_round;
  update round_flags set round_number = (-round_number) - 1
  where profile = prof and round_number < 0;

  select * into gs from game_state where id = 1;
  if gs.current_round = p_round then
    select coalesce(max(round_number), 1) into next_current
    from verses
    where profile = prof;
    next_current := least(p_round, next_current);
  elsif gs.current_round > p_round then
    next_current := gs.current_round - 1;
  else
    next_current := gs.current_round;
  end if;
  update game_state set current_round = greatest(next_current, 1) where id = 1;
  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

create or replace function host_move_verse(p_round int, p_direction int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  neighbor int;
  current_verse uuid;
  prof smallint := current_profile();
begin
  if p_direction not in (-1, 1) then
    raise exception 'Invalid move';
  end if;
  neighbor := p_round + p_direction;
  if not exists (select 1 from verses where round_number = neighbor and profile = prof) then
    raise exception 'No round on that side';
  end if;

  select id into current_verse from verses
  where profile = prof
    and round_number = (select current_round from game_state where id = 1);

  update verses set round_number = 0 where profile = prof and round_number = p_round;
  update verses set round_number = p_round where profile = prof and round_number = neighbor;
  update verses set round_number = neighbor where profile = prof and round_number = 0;

  update guesses set round_number = 0 where profile = prof and round_number = p_round;
  update guesses set round_number = p_round where profile = prof and round_number = neighbor;
  update guesses set round_number = neighbor where profile = prof and round_number = 0;

  update round_flags set round_number = 0 where profile = prof and round_number = p_round;
  update round_flags set round_number = p_round where profile = prof and round_number = neighbor;
  update round_flags set round_number = neighbor where profile = prof and round_number = 0;

  if current_verse is not null then
    update game_state
      set current_round = (select round_number from verses where id = current_verse)
    where id = 1;
  end if;

  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

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
    'verseProfile', gs.verse_profile,
    'roundStartedAt', gs.round_started_at,
    'serverNow', now(),
    'verses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'roundNumber', round_number, 'book', book,
        'chapter', chapter, 'verse', verse, 'passage', passage
      ) order by round_number) from verses where profile = gs.verse_profile
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
      ) order by round_number, submission_order)
      from guesses where profile = gs.verse_profile
    ), '[]'::jsonb),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object(
        'teamId', team_id, 'roundNumber', round_number,
        'awayCount', away_count, 'awayMs', away_ms
      )) from round_flags where profile = gs.verse_profile
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

create or replace function host_set_round(p_round int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  gs game_state%rowtype;
begin
  select * into gs from game_state where id = 1 for update;
  if not exists (
    select 1 from verses where round_number = p_round and profile = gs.verse_profile
  ) then
    raise exception 'That round does not exist';
  end if;

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
    if not exists (
      select 1 from verses where round_number = gs.current_round and profile = gs.verse_profile
    ) then
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

create or replace function host_prepare_round(p_round int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from verses where round_number = p_round and profile = current_profile()
  ) then
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

create or replace function host_reset_scores()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prof smallint := current_profile();
begin
  delete from round_flags where profile = prof;
  delete from guesses where profile = prof;
  perform reset_timer();
  update game_state
    set phase = 'lobby',
        current_round = 1,
        between_rounds = false,
        standings_revealed = false,
        round_started_at = null,
        updated_at = now()
  where id = 1;
  perform log_event('reset', 'Scores on this verse list were reset. Back to round 1.');
  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

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
  if exists (
    select 1 from guesses
    where team_id = p_team_id and round_number = p_round and profile = gs.verse_profile
  ) then
    return true;
  end if;

  select exists (
    select 1 from round_flags
    where team_id = p_team_id and round_number = p_round and profile = gs.verse_profile
  ) into had;
  insert into round_flags (team_id, round_number, profile, away_count, away_ms)
  values (
    p_team_id, p_round, gs.verse_profile,
    least(greatest(p_count, 0), 999), least(greatest(p_ms, 0), 3600000)
  )
  on conflict (team_id, round_number, profile) do update
    set away_count = greatest(round_flags.away_count, excluded.away_count),
        away_ms = greatest(round_flags.away_ms, excluded.away_ms),
        updated_at = now();

  if not had then
    perform log_event('flag', label || ' left the page during round ' || p_round, p_team_id);
  end if;
  update game_state set updated_at = now() where id = 1;
  return true;
end;
$$;

create or replace function host_delete_team(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  delete from teams where id = p_team_id;
  if not found then
    raise exception 'Team not found';
  end if;
  for rec in select distinct round_number, profile from guesses loop
    perform recompute_round_scores(rec.round_number, rec.profile);
  end loop;
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
  prof smallint;
begin
  select round_number, profile into round_num, prof from guesses where id = p_guess_id;
  if round_num is null then
    raise exception 'Guess not found';
  end if;
  delete from guesses where id = p_guess_id;
  perform recompute_round_scores(round_num, prof);
  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

create or replace function host_set_profile(p_profile int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  list_name text;
begin
  if p_profile not in (1, 2, 3) then
    raise exception 'Choose Official, Practice A, or Practice B';
  end if;
  list_name := case p_profile
    when 1 then 'Official'
    when 2 then 'Practice A'
    else 'Practice B'
  end;
  perform reset_timer();
  update game_state
    set verse_profile = p_profile,
        phase = 'lobby',
        current_round = 1,
        between_rounds = false,
        standings_revealed = false,
        round_started_at = null,
        updated_at = now()
  where id = 1;
  perform log_event('phase', 'Switched to the ' || list_name || ' verse list');
  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

revoke all on function current_profile() from public;
revoke all on function recompute_round_scores(int, int) from public;
revoke all on function recompute_round_scores(int) from public;
revoke all on function build_public_snapshot(int, text, boolean, boolean, int) from public;
revoke all on function host_set_profile(int) from public;

grant execute on function host_set_profile(int) to anon, authenticated, service_role;

select rebuild_public_snapshot();
