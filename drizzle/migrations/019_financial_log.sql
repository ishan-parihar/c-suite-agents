-- Migration 019: financial_log
-- Financial transaction tracking with signed amounts, categories, and account linkage.
-- Source: LifeOS Notion database "Financial Log"
-- Schema: Live Notion (19 properties extracted)
-- Dependencies: weeks(id), months(id), projects(id), financial_accounts(id)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS financial_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,                  -- Notion data_source_id: 265c18ce-5aab-8047-881f-e2e565ac4ff1

    -- Title: "Name"
    name            TEXT NOT NULL,

    -- Unique ID: "ID" (FIN prefix)
    transaction_id  TEXT UNIQUE,

    -- Date: "Date"
    date            TIMESTAMPTZ,

    -- Number: "signed_amount" — positive=income, negative=expense
    signed_amount   NUMERIC(12,2),

    -- Select: "Category" — Business Revenue/Pocket Money/Client Payment/Investment Income/Income/Investments-Trading/House Expenses/Food & Dining/Utilities/Family Times/Transportation/Business Expenses/Rent-Mortgage/Account Transfer/Miscellaneous
    category        TEXT,

    -- Select: "Capital Engine" — E/Self-employment/Business/Investment/Personal
    capital_engine  TEXT,

    -- Checkbox: "recurring"
    is_recurring    BOOLEAN,

    -- Files: "Receipt/Document"
    receipt_files   JSONB,

    -- URL: "receipt_url"
    receipt_url     TEXT,

    -- Formula: "Notes" — formula parsing title, kept for migration compat
    notes           TEXT,

    -- Formula: "Is Financial?" — formula: if signed_amount not empty
    is_financial    BOOLEAN,

    -- Formula: "Amount" — legacy formula parsing title, kept for migration compat
    legacy_amount   TEXT,

    -- Formula: "Financial Relater"
    financial_elater TEXT,

    -- Formula: "Transaction Type" — formula: Income/Expenses based on signed_amount
    transaction_type TEXT,

    -- Formula: "Financial_JSON"
    financial_json  TEXT,

    -- Relation: "Weeks" → weeks(id)
    week_id         UUID REFERENCES weeks(id),

    -- Relation: "Months" → months(id)
    month_id        UUID REFERENCES months(id),

    -- Relation: "Projects" → projects(id)
    project_id      UUID REFERENCES projects(id),

    -- Relation: "Financial Accounts" → financial_accounts(id)
    account_id      UUID REFERENCES financial_accounts(id),

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_financial_log_transaction_id ON financial_log (transaction_id);
CREATE INDEX idx_financial_log_date ON financial_log (date);
CREATE INDEX idx_financial_log_category ON financial_log (category);
CREATE INDEX idx_financial_log_capital_engine ON financial_log (capital_engine);
CREATE INDEX idx_financial_log_signed_amount ON financial_log (signed_amount);
CREATE INDEX idx_financial_log_is_recurring ON financial_log (is_recurring);
CREATE INDEX idx_financial_log_week_id ON financial_log (week_id);
CREATE INDEX idx_financial_log_month_id ON financial_log (month_id);
CREATE INDEX idx_financial_log_project_id ON financial_log (project_id);
CREATE INDEX idx_financial_log_account_id ON financial_log (account_id);
CREATE INDEX idx_financial_log_transaction_type ON financial_log (transaction_type);

-- Trigger for updated_at
CREATE TRIGGER update_financial_log_updated_at BEFORE UPDATE ON financial_log
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
