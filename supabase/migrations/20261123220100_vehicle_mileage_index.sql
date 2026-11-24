-- Candidate pairs for duplicates are looked up by make, model and registration, then by mileage.
-- With the mileage in the index, a lookup reads only the listings in the mileage window instead
-- of every listing of that model and month or year. It replaces the index without the mileage.
-- A file of its own, so the column change before it is committed and its lock released first:
-- building the index blocks only writes (about a second for 800,000 listings), and the drop
-- right before the commit holds its exclusive lock only for a moment.
create index listings_active_vehicle_km_idx on listings (make_slug, model_slug, first_registration, mileage_km)
 where status = 'active';
drop index listings_active_vehicle_idx;
