-- =====================================================================
-- Stage 9b: rename Core List kinds + allow many owners per city
--   PIC          -> owner   (now its own list, many per city)
--   dealer       -> store
--   product_type -> platform
--   city stays a standalone list
-- Safe to re-run.
-- =====================================================================

alter table master_data drop constraint if exists master_data_kind_check;

-- migrate any existing rows to the new kind names
update master_data set kind = 'store'    where kind = 'dealer';
update master_data set kind = 'platform' where kind = 'product_type';

-- existing city rows kept their owner in the `pic` column under the old
-- 1-city-1-PIC model; promote that into a proper owner row (linked to city)
insert into master_data (client_id, kind, value, city)
select client_id, 'owner', pic, value
from master_data
where kind = 'city' and pic is not null and pic <> ''
on conflict (client_id, kind, value) do nothing;

alter table master_data
  add constraint master_data_kind_check
  check (kind in ('city','owner','store','brand','platform'));
