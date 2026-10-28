-- BibleGuessr 011: a flat +150 for locking in with 15 seconds or more left.
-- Guess pins stay off the projector until the reveal.
-- Run after 010. Safe to run if 010 was skipped, as long as 008 is already applied.
-- Saved guesses keep the speed multiplier they already have.

alter table guesses add column if not exists locked_at timestamptz;
alter table guesses add column if not exists speed_bonus int not null default 0;
update guesses set locked_at = created_at where locked_at is null;

create or replace function recompute_round_scores(p_round int, p_profile int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ord int := 0;
  rec record;
  base int;
begin
  for rec in
    select id, book_score, chapter_score, verse_score, multiplier, speed_bonus
    from guesses
    where round_number = p_round and profile = p_profile
    order by coalesce(locked_at, created_at), created_at, id
  loop
    ord := ord + 1;
    base := rec.book_score + rec.chapter_score + rec.verse_score;
    update guesses
      set submission_order = ord,
          score = case
            when coalesce(rec.speed_bonus, 0) > 0 then base + rec.speed_bonus
            when coalesce(rec.multiplier, 1) > 1 then round(base * rec.multiplier)::int
            else base + coalesce(rec.speed_bonus, 0)
          end
    where id = rec.id;
  end loop;
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
  base int;
begin
  select * into ans from verses where round_number = p_round and profile = prof;
  if not found then
    return;
  end if;

  for rec in select * from guesses where round_number = p_round and profile = prof loop
    select * into scored
    from score_guess(rec.guess_book, rec.guess_chapter, rec.guess_verse, ans.book, ans.chapter, ans.verse);
    base := scored.base_score;
    update guesses
      set ans_book = ans.book,
          ans_chapter = ans.chapter,
          ans_verse = ans.verse,
          book_score = scored.book_score,
          chapter_score = scored.chapter_score,
          verse_score = scored.verse_score,
          score = case
            when coalesce(rec.speed_bonus, 0) > 0 then base + rec.speed_bonus
            when coalesce(rec.multiplier, 1) > 1 then round(base * rec.multiplier)::int
            else base + coalesce(rec.speed_bonus, 0)
          end
    where id = rec.id;
  end loop;
end;
$$;

create or replace function submit_guess(
  p_team_id uuid,
  p_book text,
  p_chapter int,
  p_verse int,
  p_locked_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  gs game_state%rowtype;
  ans verses%rowtype;
  scored record;
  book_name text;
  locked timestamptz;
  bonus int := 0;
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
  -- A tap before the buzzer still counts if the upload lands within 12 seconds after.
  if gs.guessing_ends_at is not null and now() >= gs.guessing_ends_at then
    if p_locked_at is null
      or p_locked_at > gs.guessing_ends_at
      or now() > gs.guessing_ends_at + interval '12 seconds'
    then
      raise exception 'Time is up';
    end if;
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

  locked := now();
  if p_locked_at is not null then
    locked := least(greatest(p_locked_at, now() - interval '12 seconds'), now());
    if gs.round_started_at is not null and locked < gs.round_started_at then
      locked := gs.round_started_at;
    end if;
  end if;

  -- +150 for everyone who still had 15 seconds left. No ranking.
  if gs.timer_paused then
    if gs.timer_remaining_ms >= 15000 then bonus := 150; end if;
  elsif gs.guessing_ends_at is null then
    if gs.timer_duration_ms >= 15000 then bonus := 150; end if;
  elsif gs.guessing_ends_at - locked >= interval '15 seconds' then
    bonus := 150;
  end if;

  book_name := assert_reference(p_book, p_chapter, p_verse);
  select * into scored from score_guess(book_name, p_chapter, p_verse, ans.book, ans.chapter, ans.verse);

  insert into guesses (
    team_id, round_number, profile, guess_book, guess_chapter, guess_verse,
    ans_book, ans_chapter, ans_verse, book_score, chapter_score, verse_score,
    score, submission_order, multiplier, locked_at, speed_bonus
  ) values (
    p_team_id, gs.current_round, gs.verse_profile, book_name, p_chapter, p_verse,
    ans.book, ans.chapter, ans.verse, scored.book_score, scored.chapter_score, scored.verse_score,
    0, 0, 1, locked, bonus
  );

  perform recompute_round_scores(gs.current_round, gs.verse_profile);
  perform rebuild_public_snapshot();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function submit_guess(p_team_id uuid, p_book text, p_chapter int, p_verse int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return submit_guess(p_team_id, p_book, p_chapter, p_verse, null);
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

  if p_phase = 'guessing' then
    pins_json := '[]'::jsonb;
  else
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
      order by coalesce(g.locked_at, g.created_at), g.created_at
    ) pins_ordered;
    pins_json := coalesce(pins_json, '[]'::jsonb);
  end if;

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
        'speedBonus', coalesce(g.speed_bonus, 0),
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
        'speedBonus', coalesce(speed_bonus, 0),
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

revoke all on function submit_guess(uuid, text, int, int, timestamptz) from public;
revoke all on function submit_guess(uuid, text, int, int) from public;
grant execute on function submit_guess(uuid, text, int, int, timestamptz) to anon, authenticated, service_role;
grant execute on function submit_guess(uuid, text, int, int) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
