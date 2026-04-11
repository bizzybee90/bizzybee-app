
-- Prevent race conditions on customer creation from concurrent webhook deliveries
CREATE UNIQUE INDEX IF NOT EXISTS customers_workspace_phone_uidx
ON public.customers (workspace_id, phone)
WHERE phone IS NOT NULL;
;
