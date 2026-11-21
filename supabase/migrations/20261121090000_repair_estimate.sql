-- Phase 2 of the flip rating: what repairing a listing probably takes (src/core/repairs.ts),
-- computed from its damage hints, size class and HU by src/ingest/repairs.ts. Parts in euros
-- and hours as from-to ranges, the hardest job's difficulty (1 to 5), how well the damage is
-- known, and whether the car has to be towed. Null until computed.
alter table listings add column vehicle_class text;
alter table listings add column repair_parts_min_eur integer;
alter table listings add column repair_parts_max_eur integer;
alter table listings add column repair_hours_min real;
alter table listings add column repair_hours_max real;
alter table listings add column repair_difficulty smallint;
alter table listings add column repair_confidence text;
alter table listings add column repair_needs_tow boolean;

-- The flip list (listings with damage hints) and the repair estimate update read only these.
create index listings_damaged_idx on listings (id) where status = 'active' and cardinality(damage) > 0;
