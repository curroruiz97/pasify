-- Migration 20260522070027 · industry_price_benchmarks
-- Recuperada desde produccion (se aplico via MCP sin commitear el fichero).

CREATE OR REPLACE FUNCTION public.industry_price_benchmarks()
RETURNS TABLE (
  tenants       integer,
  events_count  integer,
  tiers_count   integer,
  p25_cents     numeric,
  median_cents  numeric,
  p75_cents     numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
  SELECT
    count(DISTINCT coalesce(e.org_id::text, e.partner_id::text))::int AS tenants,
    count(DISTINCT e.id)::int                                          AS events_count,
    count(t.id)::int                                                   AS tiers_count,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY t.price_cents)        AS p25_cents,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY t.price_cents)        AS median_cents,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY t.price_cents)        AS p75_cents
  FROM public.ticket_tiers t
  JOIN public.events e ON e.id = t.event_id
  WHERE t.price_cents > 0
    AND e.status::text = 'published';
$fn$;

REVOKE EXECUTE ON FUNCTION public.industry_price_benchmarks() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.industry_price_benchmarks() FROM anon;
GRANT EXECUTE ON FUNCTION public.industry_price_benchmarks() TO authenticated;
GRANT EXECUTE ON FUNCTION public.industry_price_benchmarks() TO service_role;
