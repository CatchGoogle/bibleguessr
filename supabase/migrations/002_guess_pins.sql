-- Adds guess pins to the public snapshot without dropping the game.
-- Run this if the database was created before the projector map showed live guesses.

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

select rebuild_public_snapshot();
