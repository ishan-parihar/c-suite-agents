-- Migration 003: months
-- Child of quarters via relation. Depends on 002_quarters.
-- Source: LifeOS Notion database "Months"
-- Schema: Live Notion (26 properties extracted)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS months (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,

    name            TEXT NOT NULL,

    quarters_id     UUID REFERENCES quarters(id),

    days            UUID[],

    financial_log   UUID[],

    quarterly_goals UUID[],

    year            INTEGER,

    month_number    INTEGER,

    month_name      TEXT,

    month_range     TEXT,

    month_start     TIMESTAMPTZ,

    month_end       TIMESTAMPTZ,

    month_json      TEXT,

    status          TEXT,

    total_income    NUMERIC(12,2),

    total_expenses  NUMERIC(12,2),

    net_cashflow    NUMERIC(12,2),

    category_summary TEXT,

    ending_net_worth NUMERIC(14,2),

    net_worth_change NUMERIC(14,2),

    accounts_involved TEXT[],

    projects_active TEXT,

    cashflow_narrative TEXT,

    capital_allocation_insight TEXT,

    accounts_snapshot TEXT,

    key_learnings   TEXT,

    significant_events TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_months_status ON months (status);
CREATE INDEX idx_months_quarters_id ON months (quarters_id);
CREATE INDEX idx_months_year ON months (year);
CREATE INDEX idx_months_month_number ON months (month_number);
CREATE INDEX idx_months_month_start ON months (month_start);
CREATE INDEX idx_months_month_end ON months (month_end);
CREATE INDEX idx_months_days ON months USING GIN (days);
CREATE INDEX idx_months_financial_log ON months USING GIN (financial_log);
CREATE INDEX idx_months_quarterly_goals ON months USING GIN (quarterly_goals);
CREATE INDEX idx_months_accounts_involved ON months USING GIN (accounts_involved);

CREATE TRIGGER update_months_updated_at BEFORE UPDATE ON months
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
