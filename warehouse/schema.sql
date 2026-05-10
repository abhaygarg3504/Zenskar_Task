
CREATE TABLE IF NOT EXISTS stg_customers (
    -- Surrogate key for the staging row
    stg_id          SERIAL PRIMARY KEY,

    -- Source tracking (metadata / lineage)
    source_file     VARCHAR(500),
    source_row      INTEGER,
    source_hash     VARCHAR(64),        -- SHA256 of raw row for dedup
    pipeline_run_id VARCHAR(36),        -- FK to pipeline_runs
    ingested_at     TIMESTAMPTZ DEFAULT NOW(),
    pipeline_version VARCHAR(20),

    -- Raw fields (as they came from CSV, cleaned only)
    company_name    VARCHAR(500),
    contact_email   VARCHAR(500),
    contact_first   VARCHAR(200),
    contact_last    VARCHAR(200),
    phone_number    VARCHAR(100),
    tax_id          VARCHAR(100),
    company_size    VARCHAR(100),
    address         TEXT,
    city            VARCHAR(200),
    country         VARCHAR(200),
    postal_code     VARCHAR(50),

    -- Quality flags
    is_valid        BOOLEAN DEFAULT TRUE,
    quality_issues  JSONB,              -- array of issue strings

    -- Load tracking
    is_processed    BOOLEAN DEFAULT FALSE,
    processed_at    TIMESTAMPTZ
);

-- Index for incremental processing
CREATE INDEX IF NOT EXISTS idx_stg_source_hash ON stg_customers(source_hash);
CREATE INDEX IF NOT EXISTS idx_stg_ingested_at ON stg_customers(ingested_at);
CREATE INDEX IF NOT EXISTS idx_stg_pipeline_run ON stg_customers(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_stg_processed ON stg_customers(is_processed);

-- ============================================================
-- DIMENSION TABLES
-- ============================================================

-- dim_country: reference table for country validation + analytics
-- Interview note: dimension tables are denormalized for query performance (OLAP pattern)

CREATE TABLE IF NOT EXISTS dim_country (
    country_key     SERIAL PRIMARY KEY,
    country_code    CHAR(2) UNIQUE,     -- ISO 3166-1 alpha-2
    country_name    VARCHAR(200),
    region          VARCHAR(100),
    is_valid        BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Seed common country codes (extend as needed)
INSERT INTO dim_country (country_code, country_name, region) VALUES
    ('US', 'United States', 'North America'),
    ('GB', 'United Kingdom', 'Europe'),
    ('CA', 'Canada', 'North America'),
    ('AU', 'Australia', 'Oceania'),
    ('DE', 'Germany', 'Europe'),
    ('FR', 'France', 'Europe'),
    ('IN', 'India', 'Asia'),
    ('SG', 'Singapore', 'Asia'),
    ('AE', 'United Arab Emirates', 'Middle East'),
    ('NL', 'Netherlands', 'Europe')
ON CONFLICT (country_code) DO NOTHING;


-- dim_import_date: date dimension for time-based analytics
-- Interview note: date dimension is standard in star schemas.
-- Pre-populate it so queries can do calendar logic without date functions.

CREATE TABLE IF NOT EXISTS dim_import_date (
    date_key        INTEGER PRIMARY KEY,  -- YYYYMMDD format
    full_date       DATE,
    year            SMALLINT,
    quarter         SMALLINT,
    month           SMALLINT,
    month_name      VARCHAR(20),
    week_of_year    SMALLINT,
    day_of_week     SMALLINT,
    day_name        VARCHAR(20),
    is_weekend      BOOLEAN,
    fiscal_quarter  SMALLINT              -- adjust to your fiscal year
);

-- Populate date dimension for 2023-2027 range
INSERT INTO dim_import_date
SELECT
    TO_CHAR(d, 'YYYYMMDD')::INTEGER                        AS date_key,
    d::DATE                                                 AS full_date,
    EXTRACT(YEAR FROM d)::SMALLINT                         AS year,
    EXTRACT(QUARTER FROM d)::SMALLINT                      AS quarter,
    EXTRACT(MONTH FROM d)::SMALLINT                        AS month,
    TO_CHAR(d, 'Month')                                    AS month_name,
    EXTRACT(WEEK FROM d)::SMALLINT                         AS week_of_year,
    EXTRACT(DOW FROM d)::SMALLINT                          AS day_of_week,
    TO_CHAR(d, 'Day')                                      AS day_name,
    EXTRACT(DOW FROM d) IN (0, 6)                          AS is_weekend,
    EXTRACT(QUARTER FROM d)::SMALLINT                      AS fiscal_quarter
FROM generate_series('2023-01-01'::DATE, '2027-12-31'::DATE, '1 day') d
ON CONFLICT (date_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS dim_customer (
    customer_key    SERIAL PRIMARY KEY,
    company_name    VARCHAR(500) NOT NULL,
    contact_email   VARCHAR(500) NOT NULL UNIQUE,
    contact_first   VARCHAR(200),
    contact_last    VARCHAR(200),
    phone_number    VARCHAR(100),
    tax_id          VARCHAR(100),
    company_size    VARCHAR(100),
    address         TEXT,
    city            VARCHAR(200),
    country_code    CHAR(2),
    postal_code     VARCHAR(50),

    -- Lineage
    first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ DEFAULT NOW(),
    source_run_id   VARCHAR(36),    
    is_active       BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_dim_customer_email ON dim_customer(contact_email);
CREATE INDEX IF NOT EXISTS idx_dim_customer_country ON dim_customer(country_code);

CREATE TABLE IF NOT EXISTS fact_customer_imports (
    import_key      BIGSERIAL,
    customer_key    INTEGER REFERENCES dim_customer(customer_key),
    country_key     INTEGER REFERENCES dim_country(country_key),
    date_key        INTEGER REFERENCES dim_import_date(date_key),
    pipeline_run_id VARCHAR(36),
    source_file     VARCHAR(500),
    source_row      INTEGER,
    was_valid       BOOLEAN,
    api_sent        BOOLEAN DEFAULT FALSE,
    api_success     BOOLEAN,
    api_attempts    SMALLINT,
    imported_at     TIMESTAMPTZ DEFAULT NOW()
)

PARTITION BY RANGE (imported_at);

CREATE TABLE IF NOT EXISTS fact_customer_imports_2024_01
    PARTITION OF fact_customer_imports
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE IF NOT EXISTS fact_customer_imports_2024_02
    PARTITION OF fact_customer_imports
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

CREATE TABLE IF NOT EXISTS fact_customer_imports_2025_01
    PARTITION OF fact_customer_imports
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE IF NOT EXISTS fact_customer_imports_2025_q2
    PARTITION OF fact_customer_imports
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');

CREATE TABLE IF NOT EXISTS fact_customer_imports_default
    PARTITION OF fact_customer_imports DEFAULT;

CREATE TABLE IF NOT EXISTS pipeline_runs (
    run_id              VARCHAR(36) PRIMARY KEY,
    pipeline_version    VARCHAR(20),
    source_file         VARCHAR(500),
    started_at          TIMESTAMPTZ NOT NULL,
    completed_at        TIMESTAMPTZ,
    execution_time_ms   INTEGER,
    records_in_file     INTEGER DEFAULT 0,
    records_parsed      INTEGER DEFAULT 0,
    records_valid       INTEGER DEFAULT 0,
    records_invalid     INTEGER DEFAULT 0,
    records_new         INTEGER DEFAULT 0,     
    records_loaded      INTEGER DEFAULT 0,     
    records_api_sent    INTEGER DEFAULT 0,
    records_api_success INTEGER DEFAULT 0,
    records_api_failed  INTEGER DEFAULT 0,
    success_rate        NUMERIC(5,2),
    parse_error_count   INTEGER DEFAULT 0,
    status              VARCHAR(20) DEFAULT 'running',  
    error_message       TEXT,
    dq_report           JSONB                  
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started ON pipeline_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status  ON pipeline_runs(status);
