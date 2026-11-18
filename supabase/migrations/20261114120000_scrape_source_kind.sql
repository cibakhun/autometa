-- Scraped portals get their own source kind, so they can be told apart from APIs and feeds.
alter table sources drop constraint if exists sources_kind_check;
alter table sources add constraint sources_kind_check check (kind in ('api', 'feed', 'push', 'scrape', 'demo'));
