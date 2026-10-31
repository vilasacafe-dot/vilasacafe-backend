-- ============================================================
-- Vilasa Cafe — 016_add_pickup_option.sql
--
-- Adds "RESTAURANT PICKUP" as a valid value for the college_enum
-- so customers can choose to collect their order directly from
-- the restaurant instead of getting campus delivery.
--
-- ADD VALUE IF NOT EXISTS is safe to run more than once.
-- Run in the Supabase SQL editor.
-- ============================================================

ALTER TYPE college_enum ADD VALUE IF NOT EXISTS 'RESTAURANT PICKUP';
