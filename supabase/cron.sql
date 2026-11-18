-- Schedules (pg_cron). call_fn(path) calls an edge function with the project's public anon key.
select cron.schedule('sync-live', '*/5 * * * *', $$select public.call_fn('sync?mode=live', 60000)$$);
select cron.schedule('sync-nfl-schedule', '17 9 * * *', $$select public.call_fn('sync?mode=schedule&lg=nfl')$$);
select cron.schedule('sync-cfb-schedule', '27 9 * * *', $$select public.call_fn('sync?mode=schedule&lg=cfb')$$);
select cron.schedule('sync-nba-finals', '37 9 * * *', $$select public.call_fn('sync?mode=nbadays&from=-3&to=-1')$$);
select cron.schedule('hist-nfl', '47 9 * * *', $$select public.call_fn('hist')$$);
select cron.schedule('backfill-closes', '57 9 * * *', $$select public.call_fn('sync?mode=backfill&lg=nba&limit=200'); select public.call_fn('sync?mode=backfill&lg=nfl&limit=100'); select public.call_fn('sync?mode=backfill&lg=cfb&limit=300')$$);
select cron.schedule('cleanup-http', '7 * * * *', $$delete from net._http_response where created < now() - interval '6 hours'$$);
select cron.schedule('action-splits', '*/10 * * * *', $$select public.call_fn('action?mode=splits', 90000)$$);
select cron.schedule('action-experts', '3,33 * * * *', $$select public.call_fn('action?mode=experts', 90000)$$);
select cron.schedule('picks-other', '13 */2 * * *', $$select public.call_fn('picks', 150000)$$);
select cron.schedule('players-nfl', '52 10 * * *', $$select public.call_fn('players', 120000)$$);

select cron.schedule('nba-breaks', '* 0-7,16-23 * * *', $$select public.call_fn('breaks', 30000)$$);

select cron.schedule('props-nfl', '7,37 * * * *', $$select public.call_fn('props', 120000)$$);
select cron.schedule('nfl-whistle', '* 0-6,16-23 * * *', $$select public.call_fn('whistle', 60000)$$);
