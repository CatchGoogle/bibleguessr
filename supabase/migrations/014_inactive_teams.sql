-- BibleGuessr 014: mark a duo inactive (sitting out).
-- An inactive duo keeps every score and guess. It is hidden from the projector (team list, pins,
-- average dot, duo results), nobody waits for it, and it cannot lock in a guess while inactive.
-- Its past points still count toward its color's total, because color totals take the best duo
-- of that color each round. Run after 013 in the Supabase SQL editor.

alter table teams add column if not exists benched boolean not null default false;

create or replace function host_set_team_benched(p_team_id uuid, p_benched boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  gs game_state%rowtype;
  need int;
  have int;
begin
  update teams set benched = p_benched where id = p_team_id;
  if not found then
    raise exception 'Team not found';
  end if;
  perform log_event(
    'edit',
    (select teammate1 || ' & ' || teammate2 from teams where id = p_team_id)
      || case when p_benched then ' marked inactive' else ' marked active again' end,
    p_team_id
  );
  perform rebuild_public_snapshot();

  -- Sitting a duo out can complete the round for everyone who is left.
  select * into gs from game_state where id = 1;
  if p_benched and gs.reveal_when_all_in and gs.phase = 'guessing' then
    select count(*) into need from teams where active and not benched;
    select count(*) into have
    from guesses g join teams t on t.id = g.team_id
    where g.round_number = gs.current_round and g.profile = gs.verse_profile
      and t.active and not t.benched;
    if need > 0 and have >= need then
      perform host_set_phase('reveal');
    end if;
  end if;
  return host_state();
end;
$$;

-- An inactive duo cannot lock in a guess.
create or replace function trg_guess_block_benched()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from teams where id = new.team_id and benched) then
    raise exception 'Your team is sitting out for now';
  end if;
  return new;
end;
$$;

drop trigger if exists guess_block_benched on guesses;
create trigger guess_block_benched
  before insert on guesses
  for each row execute function trg_guess_block_benched();

-- "Everyone is in" ignores inactive duos (and only counts the current verse profile).
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
    select count(*) into need from teams where active and not benched;
    select count(*) into have
    from guesses g join teams t on t.id = g.team_id
    where g.round_number = gs.current_round and g.profile = gs.verse_profile
      and t.active and not t.benched;
    if need > 0 and have >= need then
      perform host_set_phase('reveal');
    end if;
  end if;
  return null;
end;
$$;

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
  prof smallint;
begin
  select teammate1 || ' & ' || teammate2 into label from teams where id = new.team_id;
  select verse_profile into prof from game_state where id = 1;
  select count(*) into need from teams where active and not benched;
  select count(*) into have
  from guesses g join teams t on t.id = g.team_id
  where g.round_number = new.round_number and g.profile = prof and t.active and not t.benched;
  perform log_event(
    'guess',
    coalesce(label, 'A team') || ' locked in (' || have || '/' || need || ')',
    new.team_id
  );
  return null;
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
  average_json jsonb;
  reveal_json jsonb;
  color_json jsonb;
  rounds int;
  hide_totals boolean;
  prof smallint;
  avg_count int;
  avg_x numeric;
  avg_y numeric;
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
    where t.active and not t.benched
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
      where g.round_number = p_round and g.profile = prof and t.active and not t.benched
      order by coalesce(g.locked_at, g.created_at), g.created_at
    ) pins_ordered;
    pins_json := coalesce(pins_json, '[]'::jsonb);
  end if;

  average_json := null;
  if p_phase <> 'lobby' then
    select count(*)::int, avg(px), avg(py)
      into avg_count, avg_x, avg_y
    from (
      select
        (a.idx - 1)::numeric / (cardinality(canon_books()) - 1) * 100 as px,
        case
          when (canon_chapters())[a.idx] <= 1 then 50
          else ((canon_chapters())[a.idx] - least(greatest(a.ch, 1), (canon_chapters())[a.idx]))::numeric
               / ((canon_chapters())[a.idx] - 1) * 80 + 10
        end as py
      from (
        select array_position(canon_books(), canonical_book(g.guess_book)) as idx, g.guess_chapter as ch
        from guesses g
        join teams t on t.id = g.team_id
        where g.round_number = p_round and g.profile = prof and t.active and not t.benched
      ) a
      where a.idx is not null
    ) pts;
    if avg_count > 0 then
      average_json := jsonb_build_object(
        'x', round(avg_x, 3),
        'y', round(avg_y, 3),
        'count', avg_count
      );
    end if;
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
      where t.active and not t.benched
      order by g.score desc nulls last, g.submission_order nulls last, t.created_at
    ) results_ordered;

    -- One row per color that still has an active duo. The best duo of the color counts each round,
    -- including an inactive duo's earlier rounds, so their points are never lost.
    select coalesce(jsonb_agg(x.item order by x.sc desc, x.ord nulls last, x.first_at), '[]'::jsonb)
      into color_json
    from (
      select
        b.sc,
        b.ord,
        c.first_at,
        jsonb_build_object(
          'teamId', b.id,
          'teammate1', b.teammate1,
          'teammate2', b.teammate2,
          'color', c.color,
          'guessBook', b.guess_book,
          'guessChapter', b.guess_chapter,
          'guessVerse', b.guess_verse,
          'bookScore', coalesce(b.book_score, 0),
          'chapterScore', coalesce(b.chapter_score, 0),
          'verseScore', coalesce(b.verse_score, 0),
          'multiplier', coalesce(b.multiplier, 0),
          'speedBonus', coalesce(b.speed_bonus, 0),
          'score', b.sc,
          'totalScore', case
            when hide_totals then 0
            else (
              select coalesce(sum(best.m), 0)
              from (
                select max(g2.score) as m
                from guesses g2
                join teams t2 on t2.id = g2.team_id
                where t2.active
                  and t2.color = c.color
                  and g2.profile = prof
                  and g2.round_number <= p_round
                group by g2.round_number
              ) best
            )
          end
        ) as item
      from (
        select color, min(created_at) as first_at
        from teams
        where active and not benched
        group by color
      ) c
      cross join lateral (
        select
          t.id, t.teammate1, t.teammate2,
          g.guess_book, g.guess_chapter, g.guess_verse,
          g.book_score, g.chapter_score, g.verse_score,
          g.multiplier, g.speed_bonus,
          coalesce(g.score, 0) as sc,
          g.submission_order as ord
        from teams t
        left join guesses g
          on g.team_id = t.id and g.round_number = p_round and g.profile = prof
        where t.active and not t.benched and t.color = c.color
        order by g.score desc nulls last, g.submission_order nulls last, t.created_at
        limit 1
      ) b
    ) x;

    reveal_json := jsonb_build_object(
      'book', ans_book,
      'chapter', ans_chapter,
      'verse', ans_verse,
      'results', coalesce(reveal_json, '[]'::jsonb),
      'colorResults', coalesce(color_json, '[]'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'verseText', case when p_phase = 'lobby' then null else passage end,
    'verseRound', p_round,
    'teams', teams_json,
    'pins', pins_json,
    'average', average_json,
    'totalRounds', rounds,
    'effects', p_effects,
    'standingsRevealed', p_standings,
    'upNext', p_up_next,
    'sittingOut', coalesce((select jsonb_agg(id) from teams where active and benched), '[]'::jsonb),
    'reveal', reveal_json
  );
end;
$$;

revoke all on function build_public_snapshot(int, text, boolean, boolean, int) from public;

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

revoke all on function host_set_team_benched(uuid, boolean) from public;
grant execute on function host_set_team_benched(uuid, boolean) to anon, authenticated, service_role;

select rebuild_public_snapshot();

notify pgrst, 'reload schema';
