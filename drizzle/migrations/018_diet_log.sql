-- Migration 018: diet_log
-- Daily diet, nutrition, vitals, mood, and health tracking entries.
-- Source: LifeOS Notion database "Diet Log"
-- Schema: Live Notion (19 properties extracted)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS diet_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,                  -- Notion data_source_id: 265c18ce-5aab-80f5-96c5-cde06cf82fa7

    -- Title: "Name"
    name            TEXT NOT NULL,

    -- Unique ID: "ID" (DIET prefix)
    entry_id        TEXT UNIQUE,

    -- Date: "Date"
    date            TIMESTAMPTZ,

    -- Select: "log_type" — Meal/Supplement/Medication/Symptom/Vitals/Mood/Hormonal/Exercise-Recovery/Environmental
    log_type        TEXT,

    -- Select: "meal_type" — Breakfast/Morning Snack/Lunch/Evening Snack/Dinner/Late Night
    meal_type       TEXT,

    -- Number: "calories"
    calories        INTEGER,

    -- Rich Text: "Nutrition"
    nutrition       TEXT,

    -- Number: "protein_g"
    protein_g       NUMERIC(6,1),

    -- Number: "water_ml"
    water_ml        INTEGER,

    -- Number: "caffeine_mg"
    caffeine_mg     INTEGER,

    -- Multi-Select: "supplements" — Creatine/Whey/Vit D/Magnesium/Omega3/Zinc/Iron/Other
    supplements     TEXT[],

    -- Select: "mood" — Low/Neutral/Good/Great/Euphoric
    mood            TEXT,

    -- Select: "energy_level" — 1-10
    energy_level    TEXT,

    -- Select: "sleep_quality" — Poor/Fair/Good/Excellent
    sleep_quality   TEXT,

    -- Multi-Select: "symptoms" — Headache/Fatigue/Nausea/Dizziness/Brain Fog/Joint Pain/Digestive/Skin Rash/Other
    symptoms        TEXT[],

    -- Multi-Select: "environment" — Indoor/Outdoor/Polluted/AC/Nature/Office/Gym/Home
    environment     TEXT[],

    -- Rich Text: "vitals_notes"
    vitals_notes    TEXT,

    -- Formula: "Diet_JSON"
    diet_json       TEXT,

    -- Relation: "Days" → days(id)
    days_id         UUID REFERENCES days(id),

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_diet_log_entry_id ON diet_log (entry_id);
CREATE INDEX idx_diet_log_date ON diet_log (date);
CREATE INDEX idx_diet_log_log_type ON diet_log (log_type);
CREATE INDEX idx_diet_log_meal_type ON diet_log (meal_type);
CREATE INDEX idx_diet_log_mood ON diet_log (mood);
CREATE INDEX idx_diet_log_days_id ON diet_log (days_id);
CREATE INDEX idx_diet_log_supplements ON diet_log USING GIN (supplements);
CREATE INDEX idx_diet_log_symptoms ON diet_log USING GIN (symptoms);
CREATE INDEX idx_diet_log_environment ON diet_log USING GIN (environment);

-- Trigger for updated_at
CREATE TRIGGER update_diet_log_updated_at BEFORE UPDATE ON diet_log
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
