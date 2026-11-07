-- SiddhiGL Mobile — 01_schema.sql
-- Creates the separate schema for the mobile app.
-- Run in the Supabase SQL editor, "Run without RLS".

create schema if not exists mob;

comment on schema mob is
  'SiddhiGL Mobile (phone capture app). Tables are private: access only through mob functions.';

revoke all on schema mob from public;
grant usage on schema mob to anon;
