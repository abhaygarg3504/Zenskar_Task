CREATE OR REPLACE VIEW vw_pipeline_health AS
SELECT
    run_id,
    started_at,
    TO_CHAR(started_at, 'YYYY-MM-DD')      AS run_date,
    source_file,
    records_in_file,
    records_parsed,
    records_valid,
    records_invalid,
    records_loaded,
    records_api_success,
    records_api_failed,
    execution_time_ms,
    ROUND(execution_time_ms / 1000.0, 2)   AS execution_time_sec,
    success_rate,
    status,
    pipeline_version
FROM pipeline_runs
ORDER BY started_at DESC;

CREATE OR REPLACE VIEW vw_daily_import_volume AS
SELECT
    d.full_date,
    d.year,
    d.month,
    d.month_name,
    d.day_name,
    COUNT(f.import_key)                     AS total_imports,
    SUM(CASE WHEN f.was_valid THEN 1 ELSE 0 END)    AS valid_imports,
    SUM(CASE WHEN NOT f.was_valid THEN 1 ELSE 0 END) AS invalid_imports,
    SUM(CASE WHEN f.api_success THEN 1 ELSE 0 END)  AS api_success,
    ROUND(
        100.0 * SUM(CASE WHEN f.api_success THEN 1 ELSE 0 END)
        / NULLIF(COUNT(f.import_key), 0), 2
    )                                        AS daily_success_rate
FROM dim_import_date d
JOIN fact_customer_imports f ON d.date_key = f.date_key
GROUP BY d.full_date, d.year, d.month, d.month_name, d.day_name
ORDER BY d.full_date DESC;

CREATE OR REPLACE VIEW vw_customer_by_country AS
SELECT
    COALESCE(c.country_name, 'Unknown')     AS country,
    COALESCE(c.country_code, 'XX')          AS country_code,
    COALESCE(c.region, 'Unknown')           AS region,
    COUNT(DISTINCT cu.customer_key)         AS unique_customers,
    COUNT(f.import_key)                     AS total_imports,
    SUM(CASE WHEN f.was_valid THEN 1 ELSE 0 END) AS valid_imports,
    ROUND(
        100.0 * SUM(CASE WHEN f.was_valid THEN 1 ELSE 0 END)
        / NULLIF(COUNT(f.import_key), 0), 2
    )                                        AS validity_rate
FROM fact_customer_imports f
LEFT JOIN dim_customer cu ON f.customer_key = cu.customer_key
LEFT JOIN dim_country c   ON f.country_key  = c.country_key
GROUP BY c.country_name, c.country_code, c.region
ORDER BY unique_customers DESC;

CREATE OR REPLACE VIEW vw_validity_summary AS
SELECT
    TO_CHAR(imported_at, 'YYYY-MM-DD')      AS import_date,
    SUM(CASE WHEN was_valid THEN 1 ELSE 0 END)       AS valid_count,
    SUM(CASE WHEN NOT was_valid THEN 1 ELSE 0 END)   AS invalid_count,
    COUNT(*)                                          AS total_count,
    ROUND(
        100.0 * SUM(CASE WHEN was_valid THEN 1 ELSE 0 END)
        / NULLIF(COUNT(*), 0), 2
    )                                                 AS validity_pct
FROM fact_customer_imports
GROUP BY TO_CHAR(imported_at, 'YYYY-MM-DD')
ORDER BY import_date DESC;


CREATE OR REPLACE VIEW vw_company_size_distribution AS
SELECT
    COALESCE(NULLIF(TRIM(cu.company_size), ''), 'Not Specified') AS company_size,
    COUNT(DISTINCT cu.customer_key)                               AS customer_count,
    ROUND(
        100.0 * COUNT(DISTINCT cu.customer_key)
        / NULLIF(SUM(COUNT(DISTINCT cu.customer_key)) OVER (), 0), 2
    )                                                             AS pct_of_total
FROM dim_customer cu
GROUP BY cu.company_size
ORDER BY customer_count DESC;

CREATE OR REPLACE VIEW vw_pipeline_success_trend AS
SELECT
    TO_CHAR(started_at, 'YYYY-MM-DD')   AS run_date,
    COUNT(*)                             AS total_runs,
    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successful_runs,
    ROUND(AVG(success_rate), 2)          AS avg_success_rate,
    ROUND(AVG(execution_time_ms), 0)     AS avg_execution_ms,
    SUM(records_loaded)                  AS total_records_loaded
FROM pipeline_runs
GROUP BY TO_CHAR(started_at, 'YYYY-MM-DD')
ORDER BY run_date DESC;