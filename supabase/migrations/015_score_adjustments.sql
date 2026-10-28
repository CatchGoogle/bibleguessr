-- BibleGuessr 015: host score adjustments (penalties or manual edits) on a single guess.
-- guesses.adjustment is added to the computed score (negative = penalty). A guess never drops below 0.
-- The adjustment survives rescoring, re-ordering and answer edits. Run after 014.

alter table guesses add column if not exists adjustment int not null default 0;
alter table guesses add column if not exists adjustment_note text;

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
    select id, book_score, chapter_score, verse_score, multiplier, speed_bonus, adjustment
    from guesses
    where round_number = p_round and profile = p_profile
    order by coalesce(locked_at, created_at), created_at, id
  loop
    ord := ord + 1;
    base := rec.book_score + rec.chapter_score + rec.verse_score;
    update guesses
      set submission_order = ord,
          score = greatest(0, case
            when coalesce(rec.speed_bonus, 0) > 0 then base + rec.speed_bonus
            when coalesce(rec.multiplier, 1) > 1 then round(base * rec.multiplier)::int
            else base + coalesce(rec.speed_bonus, 0)
          end + coalesce(rec.adjustment, 0))
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
          score = greatest(0, case
            when coalesce(rec.speed_bonus, 0) > 0 then base + rec.speed_bonus
            when coalesce(rec.multiplier, 1) > 1 then round(base * rec.multiplier)::int
            else base + coalesce(rec.speed_bonus, 0)
          end + coalesce(rec.adjustment, 0))
    where id = rec.id;
  end loop;
end;
$$;

create or replace function host_adjust_guess(p_guess_id uuid, p_adjustment int, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  round_num int;
  prof smallint;
  label text;
begin
  select g.round_number, g.profile, t.teammate1 || ' & ' || t.teammate2
    into round_num, prof, label
  from guesses g join teams t on t.id = g.team_id
  where g.id = p_guess_id;
  if round_num is null then
    raise exception 'Guess not found';
  end if;
  update guesses
    set adjustment = greatest(-100000, least(100000, coalesce(p_adjustment, 0))),
        adjustment_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_guess_id;
  perform recompute_round_scores(round_num, prof);
  perform log_event(
    'edit',
    label || ' round ' || round_num || ' score adjusted by ' || coalesce(p_adjustment, 0)
      || coalesce(' (' || nullif(btrim(coalesce(p_note, '')), '') || ')', ''),
    null
  );
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
        'color', color, 'active', active, 'benched', benched, 'lastSeen', last_seen
      ) order by created_at) from teams
    ), '[]'::jsonb),
    'guesses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'teamId', team_id, 'roundNumber', round_number,
        'guessBook', guess_book, 'guessChapter', guess_chapter, 'guessVerse', guess_verse,
        'bookScore', book_score, 'chapterScore', chapter_score, 'verseScore', verse_score,
        'score', score, 'submissionOrder', submission_order, 'multiplier', multiplier,
        'speedBonus', coalesce(speed_bonus, 0),
        'adjustment', coalesce(adjustment, 0), 'adjustmentNote', adjustment_note,
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

revoke all on function host_adjust_guess(uuid, int, text) from public;
grant execute on function host_adjust_guess(uuid, int, text) to anon, authenticated, service_role;

do $$
declare
  rec record;
begin
  for rec in select distinct round_number, profile from guesses loop
    perform recompute_round_scores(rec.round_number, rec.profile);
  end loop;
end;
$$;
select rebuild_public_snapshot();

notify pgrst, 'reload schema';
