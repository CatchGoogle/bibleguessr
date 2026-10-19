-- BibleGuessr: one shared game.
-- Run this in the Supabase SQL editor. The browser uses the anon key.

drop function if exists create_room();
drop function if exists join_team(text, text, text, text);
drop function if exists submit_guess(text, uuid, text, int, int);
drop function if exists host_get_state(text, text);
drop function if exists host_add_verse(text, text, text, int, int, text);
drop function if exists host_update_verse(text, text, int, text, int, int, text);
drop function if exists host_delete_verse(text, text, int);
drop function if exists host_move_verse(text, text, int, int);
drop function if exists host_set_phase(text, text, text);
drop function if exists host_set_round(text, text, int);
drop function if exists host_timer(text, text, text, int);
drop function if exists host_update_team(text, text, uuid, text, text, text);
drop function if exists host_delete_team(text, text, uuid);
drop function if exists host_delete_guess(text, text, uuid);
drop function if exists host_reset_scores(text, text);
drop function if exists require_host(text, text);
drop function if exists recompute_round_scores(uuid, int);
drop function if exists rescore_round_answers(uuid, int);
drop function if exists rebuild_public_snapshot(uuid);
drop function if exists host_state(uuid);
drop function if exists reset_timer(uuid);
drop view if exists public_rooms;
drop table if exists guesses, teams, verses, game_state, rooms cascade;

create table game_state (
  id integer primary key default 1 check (id = 1),
  phase text not null default 'lobby' check (phase in ('lobby', 'guessing', 'reveal')),
  current_round integer not null default 1,
  timer_duration_ms integer not null default 60000,
  guessing_ends_at timestamptz,
  timer_paused boolean not null default false,
  timer_remaining_ms integer not null default 60000,
  public_snapshot jsonb not null default '{"verseText":null,"teams":[],"pins":[],"reveal":null}'::jsonb,
  updated_at timestamptz not null default now()
);

create table verses (
  id uuid primary key default gen_random_uuid(),
  round_number integer not null unique,
  book text not null,
  chapter integer not null,
  verse integer not null,
  passage text not null
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  teammate1 text not null,
  teammate2 text not null,
  color text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table guesses (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  round_number integer not null,
  guess_book text not null,
  guess_chapter integer not null,
  guess_verse integer not null,
  ans_book text not null,
  ans_chapter integer not null,
  ans_verse integer not null,
  book_score integer not null,
  chapter_score integer not null,
  verse_score integer not null,
  score integer not null,
  submission_order integer not null,
  multiplier numeric not null,
  created_at timestamptz not null default now(),
  unique (team_id, round_number)
);

insert into game_state (id) values (1);

alter table game_state enable row level security;
alter table verses enable row level security;
alter table teams enable row level security;
alter table guesses enable row level security;

create policy "public read game state" on game_state for select using (true);

create or replace function canon_books()
returns text[]
language sql
immutable
as $$
  select array[
    'Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth',
    '1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra','Nehemiah',
    'Esther','Job','Psalm','Proverbs','Ecclesiastes','Song of Solomon','Isaiah','Jeremiah',
    'Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos','Obadiah','Jonah','Micah','Nahum',
    'Habakkuk','Zephaniah','Haggai','Zechariah','Malachi','Matthew','Mark','Luke','John','Acts',
    'Romans','1 Corinthians','2 Corinthians','Galatians','Ephesians','Philippians','Colossians',
    '1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon','Hebrews',
    'James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation'
  ]::text[];
$$;

create or replace function canon_chapters()
returns int[]
language sql
immutable
as $$
  select array[
    50,40,27,36,34,24,21,4,31,24,22,25,29,36,10,13,10,42,150,31,12,8,66,52,5,48,12,14,3,9,1,4,7,3,3,3,2,14,4,
    28,16,24,21,28,16,16,13,6,6,4,4,5,3,6,4,3,1,13,5,5,3,5,1,1,1,22
  ]::int[];
$$;

create or replace function canonical_book(p_book text)
returns text
language sql
immutable
as $$
  select case when p_book in ('Psalm', 'Psalms') then 'Psalm' else p_book end;
$$;

create or replace function score_guess(
  p_guess_book text,
  p_guess_chapter int,
  p_guess_verse int,
  p_answer_book text,
  p_answer_chapter int,
  p_answer_verse int,
  out book_score int,
  out chapter_score int,
  out verse_score int,
  out base_score int
)
language plpgsql
immutable
as $$
declare
  gname text;
  aname text;
  gi int;
  ai int;
  distance int;
  chapter_distance int;
  verse_distance int;
  exact boolean;
begin
  gname := canonical_book(p_guess_book);
  aname := canonical_book(p_answer_book);
  gi := array_position(canon_books(), gname);
  ai := array_position(canon_books(), aname);
  if gi is null or ai is null then
    book_score := 0;
    chapter_score := 0;
    verse_score := 0;
    base_score := 0;
    return;
  end if;

  distance := abs(gi - ai);
  exact := gname = aname;
  if exact then
    book_score := 50;
  elsif distance <= 3 then
    book_score := 40;
  elsif distance <= 5 then
    book_score := 20;
  elsif distance <= 10 then
    book_score := 10;
  else
    book_score := 0;
  end if;

  chapter_score := 0;
  verse_score := 0;
  if exact or distance <= 3 then
    chapter_distance := abs(p_guess_chapter - p_answer_chapter);
    if chapter_distance = 0 then chapter_score := 30;
    elsif chapter_distance <= 3 then chapter_score := 20;
    elsif chapter_distance <= 5 then chapter_score := 10;
    elsif chapter_distance <= 10 then chapter_score := 5;
    end if;

    verse_distance := abs(p_guess_verse - p_answer_verse);
    if verse_distance = 0 then verse_score := 20;
    elsif verse_distance <= 3 then verse_score := 10;
    elsif verse_distance <= 5 then verse_score := 5;
    elsif verse_distance <= 10 then verse_score := 3;
    end if;
  end if;

  base_score := book_score + chapter_score + verse_score;
end;
$$;

create or replace function assert_reference(p_book text, p_chapter int, p_verse int)
returns text
language plpgsql
immutable
as $$
declare
  name text;
  idx int;
  max_chapter int;
begin
  name := canonical_book(trim(p_book));
  idx := array_position(canon_books(), name);
  if idx is null then
    raise exception 'Choose a Bible book';
  end if;
  max_chapter := (canon_chapters())[idx];
  if p_chapter is null or p_chapter < 1 or p_chapter > max_chapter then
    raise exception 'Chapter is out of range for %', name;
  end if;
  if p_verse is null or p_verse < 1 or p_verse > 176 then
    raise exception 'Verse must be between 1 and 176';
  end if;
  return name;
end;
$$;

create or replace function recompute_round_scores(p_round int)
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
    where round_number = p_round
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
begin
  select * into ans from verses where round_number = p_round;
  if not found then
    return;
  end if;

  for rec in select * from guesses where round_number = p_round loop
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
begin
  select * into gs from game_state where id = 1;

  select v.passage, v.book, v.chapter, v.verse
    into passage, ans_book, ans_chapter, ans_verse
  from verses v
  where v.round_number = gs.current_round;

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
          'reveal', reveal_json
        ),
        updated_at = now()
  where id = 1;
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
    'verses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'roundNumber', round_number, 'book', book,
        'chapter', chapter, 'verse', verse, 'passage', passage
      ) order by round_number) from verses
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'teammate1', teammate1, 'teammate2', teammate2,
        'color', color, 'active', active
      ) order by created_at) from teams
    ), '[]'::jsonb),
    'guesses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'teamId', team_id, 'roundNumber', round_number,
        'guessBook', guess_book, 'guessChapter', guess_chapter, 'guessVerse', guess_verse,
        'bookScore', book_score, 'chapterScore', chapter_score, 'verseScore', verse_score,
        'score', score, 'submissionOrder', submission_order, 'multiplier', multiplier
      ) order by round_number, submission_order) from guesses
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function reset_timer()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update game_state
    set guessing_ends_at = null,
        timer_paused = false,
        timer_remaining_ms = timer_duration_ms,
        updated_at = now()
  where id = 1;
end;
$$;

create or replace function join_team(p_teammate1 text, p_teammate2 text, p_color text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  name1 text := trim(p_teammate1);
  name2 text := trim(p_teammate2);
  new_id uuid;
begin
  if name1 is null or length(name1) < 1 or length(name1) > 24 or name2 is null or length(name2) < 1 or length(name2) > 24 then
    raise exception 'Enter both names, up to 24 characters';
  end if;
  if p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Choose a team color';
  end if;
  if (select count(*) from teams where active) >= 12 then
    raise exception 'This game already has 12 teams';
  end if;

  insert into teams (teammate1, teammate2, color)
  values (name1, name2, lower(p_color))
  returning id into new_id;

  perform rebuild_public_snapshot();
  return jsonb_build_object('id', new_id, 'teammate1', name1, 'teammate2', name2, 'color', lower(p_color));
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
  if exists (select 1 from guesses where team_id = p_team_id and round_number = gs.current_round) then
    raise exception 'You already locked in a guess for this round';
  end if;

  select * into ans from verses where round_number = gs.current_round;
  if not found then
    raise exception 'This round has no passage yet';
  end if;

  book_name := assert_reference(p_book, p_chapter, p_verse);
  select * into scored from score_guess(book_name, p_chapter, p_verse, ans.book, ans.chapter, ans.verse);
  select count(*) into team_count from teams where active;
  select count(*) + 1 into ord from guesses where round_number = gs.current_round;
  if ord = team_count then
    mult := 1;
  else
    mult := 1 + (0.1 * (team_count - 1)::numeric / ord);
  end if;

  insert into guesses (
    team_id, round_number, guess_book, guess_chapter, guess_verse,
    ans_book, ans_chapter, ans_verse, book_score, chapter_score, verse_score,
    score, submission_order, multiplier
  ) values (
    p_team_id, gs.current_round, book_name, p_chapter, p_verse,
    ans.book, ans.chapter, ans.verse, scored.book_score, scored.chapter_score, scored.verse_score,
    round(scored.base_score * mult)::int, ord, mult
  );

  perform rebuild_public_snapshot();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function host_get_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return host_state();
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
begin
  book_name := assert_reference(p_book, p_chapter, p_verse);
  if body is null or length(body) < 1 or length(body) > 2000 then
    raise exception 'Enter the passage text';
  end if;
  select coalesce(max(round_number), 0) + 1 into next_round from verses;
  insert into verses (round_number, book, chapter, verse, passage)
  values (next_round, book_name, p_chapter, p_verse, body);
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
begin
  book_name := assert_reference(p_book, p_chapter, p_verse);
  if body is null or length(body) < 1 or length(body) > 2000 then
    raise exception 'Enter the passage text';
  end if;
  update verses
    set book = book_name, chapter = p_chapter, verse = p_verse, passage = body
  where round_number = p_round;
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
begin
  if exists (select 1 from guesses where round_number = p_round) then
    raise exception 'Reset scores before deleting a round that already has guesses';
  end if;
  delete from verses where round_number = p_round;
  if not found then
    raise exception 'That round does not exist';
  end if;

  update verses set round_number = -round_number where round_number > p_round;
  update verses set round_number = (-round_number) - 1 where round_number < 0;
  update guesses set round_number = -round_number where round_number > p_round;
  update guesses set round_number = (-round_number) - 1 where round_number < 0;

  select * into gs from game_state where id = 1;
  if gs.current_round = p_round then
    select coalesce(max(round_number), 1) into next_current from verses;
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
begin
  if p_direction not in (-1, 1) then
    raise exception 'Invalid move';
  end if;
  neighbor := p_round + p_direction;
  if not exists (select 1 from verses where round_number = neighbor) then
    raise exception 'No round on that side';
  end if;

  select id into current_verse from verses
  where round_number = (select current_round from game_state where id = 1);

  update verses set round_number = 0 where round_number = p_round;
  update verses set round_number = p_round where round_number = neighbor;
  update verses set round_number = neighbor where round_number = 0;

  update guesses set round_number = 0 where round_number = p_round;
  update guesses set round_number = p_round where round_number = neighbor;
  update guesses set round_number = neighbor where round_number = 0;

  if current_verse is not null then
    update game_state
      set current_round = (select round_number from verses where id = current_verse)
    where id = 1;
  end if;

  perform rebuild_public_snapshot();
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
    perform reset_timer();
    update game_state set phase = 'guessing', updated_at = now() where id = 1;
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
          timer_remaining_ms = remaining,
          updated_at = now()
    where id = 1;
  else
    perform reset_timer();
    update game_state set phase = 'lobby', updated_at = now() where id = 1;
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
  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

create or replace function host_timer(p_action text, p_duration_ms int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  gs game_state%rowtype;
  remaining int;
begin
  select * into gs from game_state where id = 1 for update;

  if p_action = 'start' then
    if gs.phase <> 'guessing' then
      raise exception 'Start the round before the timer';
    end if;
    if gs.timer_paused and gs.timer_remaining_ms <= 0 then
      raise exception 'Reset the timer first';
    end if;
    if gs.guessing_ends_at is not null and gs.guessing_ends_at > now() then
      raise exception 'Timer is already running';
    end if;
    if gs.guessing_ends_at is not null and gs.guessing_ends_at <= now() then
      raise exception 'Reset the timer first';
    end if;
    remaining := case when gs.timer_paused then gs.timer_remaining_ms else gs.timer_duration_ms end;
    update game_state
      set guessing_ends_at = now() + (remaining * interval '1 millisecond'),
          timer_paused = false,
          timer_remaining_ms = remaining,
          updated_at = now()
    where id = 1;
  elsif p_action = 'pause' then
    if gs.guessing_ends_at is null then
      raise exception 'Timer is not running';
    end if;
    remaining := greatest(0, floor(extract(epoch from (gs.guessing_ends_at - now())) * 1000))::int;
    update game_state
      set guessing_ends_at = null, timer_paused = true, timer_remaining_ms = remaining, updated_at = now()
    where id = 1;
  elsif p_action = 'reset' then
    perform reset_timer();
  elsif p_action = 'duration' then
    if p_duration_ms is null or p_duration_ms < 10000 or p_duration_ms > 300000 then
      raise exception 'Timer must be between 10 and 300 seconds';
    end if;
    if gs.guessing_ends_at is not null or gs.timer_paused then
      raise exception 'Reset the timer before changing its length';
    end if;
    update game_state
      set timer_duration_ms = p_duration_ms, timer_remaining_ms = p_duration_ms, updated_at = now()
    where id = 1;
  else
    raise exception 'Unknown timer action';
  end if;

  return host_state();
end;
$$;

create or replace function host_update_team(
  p_team_id uuid, p_teammate1 text, p_teammate2 text, p_color text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  name1 text := trim(p_teammate1);
  name2 text := trim(p_teammate2);
begin
  if length(name1) < 1 or length(name1) > 24 or length(name2) < 1 or length(name2) > 24 then
    raise exception 'Enter both names, up to 24 characters';
  end if;
  if p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Choose a team color';
  end if;
  update teams set teammate1 = name1, teammate2 = name2, color = lower(p_color) where id = p_team_id;
  if not found then
    raise exception 'Team not found';
  end if;
  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

create or replace function host_delete_team(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  round_num int;
begin
  delete from teams where id = p_team_id;
  if not found then
    raise exception 'Team not found';
  end if;
  for round_num in select distinct round_number from guesses loop
    perform recompute_round_scores(round_num);
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
begin
  select round_number into round_num from guesses where id = p_guess_id;
  if round_num is null then
    raise exception 'Guess not found';
  end if;
  delete from guesses where id = p_guess_id;
  perform recompute_round_scores(round_num);
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
  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

revoke all on function canon_books() from public;
revoke all on function canon_chapters() from public;
revoke all on function canonical_book(text) from public;
revoke all on function score_guess(text, int, int, text, int, int) from public;
revoke all on function assert_reference(text, int, int) from public;
revoke all on function recompute_round_scores(int) from public;
revoke all on function rescore_round_answers(int) from public;
revoke all on function rebuild_public_snapshot() from public;
revoke all on function host_state() from public;
revoke all on function reset_timer() from public;
revoke all on function join_team(text, text, text) from public;
revoke all on function submit_guess(uuid, text, int, int) from public;
revoke all on function host_get_state() from public;
revoke all on function host_add_verse(text, int, int, text) from public;
revoke all on function host_update_verse(int, text, int, int, text) from public;
revoke all on function host_delete_verse(int) from public;
revoke all on function host_move_verse(int, int) from public;
revoke all on function host_set_phase(text) from public;
revoke all on function host_set_round(int) from public;
revoke all on function host_timer(text, int) from public;
revoke all on function host_update_team(uuid, text, text, text) from public;
revoke all on function host_delete_team(uuid) from public;
revoke all on function host_delete_guess(uuid) from public;
revoke all on function host_reset_scores() from public;

grant execute on function join_team(text, text, text) to anon, authenticated, service_role;
grant execute on function submit_guess(uuid, text, int, int) to anon, authenticated, service_role;
grant execute on function host_get_state() to anon, authenticated, service_role;
grant execute on function host_add_verse(text, int, int, text) to anon, authenticated, service_role;
grant execute on function host_update_verse(int, text, int, int, text) to anon, authenticated, service_role;
grant execute on function host_delete_verse(int) to anon, authenticated, service_role;
grant execute on function host_move_verse(int, int) to anon, authenticated, service_role;
grant execute on function host_set_phase(text) to anon, authenticated, service_role;
grant execute on function host_set_round(int) to anon, authenticated, service_role;
grant execute on function host_timer(text, int) to anon, authenticated, service_role;
grant execute on function host_update_team(uuid, text, text, text) to anon, authenticated, service_role;
grant execute on function host_delete_team(uuid) to anon, authenticated, service_role;
grant execute on function host_delete_guess(uuid) to anon, authenticated, service_role;
grant execute on function host_reset_scores() to anon, authenticated, service_role;

revoke all on verses, teams, guesses, game_state from anon, authenticated;
grant select on game_state to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table game_state;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
