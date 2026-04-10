-- Migration 020: financial_accounts
-- Account registry for tracking financial holdings, balances, and types.
-- Source: LifeOS Notion database "Financial Accounts"
-- Schema: Live Notion (16 properties extracted)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS financial_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,                  -- Notion data_source_id: 265c18ce-5aab-80ce-8fec-000b920d6a27

    -- Title: "Account Name"
    name            TEXT NOT NULL,

    -- Rich Text: "institution"
    institution     TEXT,

    -- Select: "Status" — Active/Dormant/Closed
    status          TEXT,

    -- Select: "Sub-Type" — Cash-Liquid/Investment Taxable/Retirement Tax-Advantaged/Real Estate/Cryptocurrency/Credit Card/Loan/Business Capital
    sub_type        TEXT,

    -- Multi-Select: "Type" — Asset/Liability
    type            TEXT[],

    -- Select: "Capital Engine" — E-Employment/S-Self-Employment/B-Business/I-Investor/Personal
    capital_engine  TEXT,

    -- Select: "currency" — INR/USD/EUR
    currency        TEXT,

    -- Number: "Current Balance" (rupee format)
    current_balance NUMERIC(14,2),

    -- Number: "interest_rate" (percent format)
    interest_rate   NUMERIC(5,2),

    -- Date: "balance_as_of"
    balance_as_of   TIMESTAMPTZ,

    -- Rich Text: "Related Statements"
    related_statements TEXT,

    -- Rich Text: "Related Transactions"
    related_transactions TEXT,

    -- Last Edited Time: "Last Updated"
    last_updated    TIMESTAMPTZ,

    -- Formula: "Current Status" — formula: sum of financial logs
    current_status  NUMERIC(14,2),

    -- Formula: "Active Range"
    active_range    TEXT,

    -- Relation: "Financial Logs" (array of log IDs)
    financial_logs  UUID[],

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_financial_accounts_status ON financial_accounts (status);
CREATE INDEX idx_financial_accounts_sub_type ON financial_accounts (sub_type);
CREATE INDEX idx_financial_accounts_capital_engine ON financial_accounts (capital_engine);
CREATE INDEX idx_financial_accounts_currency ON financial_accounts (currency);
CREATE INDEX idx_financial_accounts_type ON financial_accounts USING GIN (type);
CREATE INDEX idx_financial_accounts_financial_logs ON financial_accounts USING GIN (financial_logs);

-- Trigger for updated_at
CREATE TRIGGER update_financial_accounts_updated_at BEFORE UPDATE ON financial_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
