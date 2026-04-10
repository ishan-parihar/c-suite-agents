-- Migration 000: Create the update_updated_at_column trigger function
-- This MUST run before all other migrations (001-024) that reference it.

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
