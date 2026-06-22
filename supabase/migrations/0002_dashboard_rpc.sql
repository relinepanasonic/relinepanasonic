-- =====================================================================
-- dashboard_summary: one-call aggregation for the dashboard.
-- SECURITY INVOKER (default) => RLS applies, so role scoping is automatic:
--   branch_manager only aggregates their city, store_user their store, etc.
-- The SPOS parent-row rule (is_parent) is enforced here so variants are
-- never double-counted.
-- =====================================================================
create or replace function dashboard_summary(
  p_year  int  default null,
  p_month text default null,
  p_city  text default null,
  p_store text default null
) returns jsonb
language sql stable
as $$
  with f as (
    select *
    from sales_rows
    where (p_year  is null or year       = p_year)
      and (p_month is null or month      = p_month)
      and (p_city  is null or city       = p_city)
      and (p_store is null or store_name = p_store)
      and (source <> 'spos' or is_parent)   -- parent-row rule
  )
  select jsonb_build_object(
    'kpis', (
      select jsonb_build_object(
        'sales',    coalesce(sum(sales_idr) filter (where source = 'spos'), 0),
        'orders',   coalesce(sum(orders)    filter (where source = 'spos'), 0),
        'units',    coalesce(sum(units)     filter (where source = 'spos'), 0),
        'visitors', coalesce(sum(visitors)  filter (where source = 'spos'), 0),
        'ad_cost',  coalesce(sum(ad_cost)   filter (where source = 'ads'),  0),
        'gmv',      coalesce(sum(sales_idr) filter (where source = 'perf'), 0)
      ) from f
    ),
    'by_brand', (
      select coalesce(jsonb_agg(x order by x.sales desc), '[]'::jsonb) from (
        select brand, sum(sales_idr) as sales
        from f where source = 'spos' and brand is not null
        group by brand
      ) x
    ),
    'by_store', (
      select coalesce(jsonb_agg(x order by x.sales desc), '[]'::jsonb) from (
        select store_name, sum(sales_idr) as sales
        from f where source = 'spos' and store_name is not null
        group by store_name
      ) x
    ),
    'by_month', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select month, sum(sales_idr) as sales
        from f where source = 'spos' and month is not null
        group by month
      ) x
    ),
    'by_city', (
      select coalesce(jsonb_agg(x order by x.sales desc), '[]'::jsonb) from (
        select city, sum(sales_idr) as sales
        from f where source = 'spos' and city is not null
        group by city
      ) x
    )
  );
$$;

-- Filter options for the dropdowns (also RLS-scoped).
create or replace function dashboard_filters()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'years',  (select coalesce(jsonb_agg(distinct year order by year desc),  '[]') from sales_rows where year is not null),
    'months', (select coalesce(jsonb_agg(distinct month), '[]') from sales_rows where month is not null),
    'cities', (select coalesce(jsonb_agg(distinct city  order by city),  '[]') from sales_rows where city is not null),
    'stores', (select coalesce(jsonb_agg(distinct store_name order by store_name), '[]') from sales_rows where store_name is not null)
  );
$$;
