
-- Enable pg_net for HTTP calls from within Postgres
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- Enable pg_cron for scheduled job polling
CREATE EXTENSION IF NOT EXISTS pg_cron SCHEMA pg_catalog;
;
