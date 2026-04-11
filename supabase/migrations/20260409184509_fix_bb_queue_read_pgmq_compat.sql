
-- Fix pgmq 1.4.4 compatibility: remove redundant column definition list
CREATE OR REPLACE FUNCTION public.bb_queue_read(
  queue_name text,
  vt_seconds integer,
  n integer
)
RETURNS TABLE (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.msg_id,
    r.read_ct,
    r.enqueued_at,
    r.vt,
    r.message
  FROM pgmq.read(queue_name, greatest(vt_seconds, 1), greatest(n, 1)) r;
END;
$$;
;
