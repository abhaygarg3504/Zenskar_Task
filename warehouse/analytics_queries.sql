SELECT country, unique_customers, validity_rate
FROM vw_customer_by_country
ORDER BY unique_customers DESC
LIMIT 10;

SELECT full_date, total_imports, valid_imports, invalid_imports, daily_success_rate
FROM vw_daily_import_volume
WHERE full_date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY full_date;

SELECT
    COUNT(*)                                                    AS total_runs,
    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)        AS successful,
    ROUND(AVG(success_rate), 2)                                 AS avg_success_rate,
    SUM(records_loaded)                                         AS total_records_loaded,
    ROUND(AVG(execution_time_ms) / 1000.0, 2)                  AS avg_run_time_sec
FROM pipeline_runs;

SELECT
    run_id,
    started_at,
    records_invalid,
    records_api_failed,
    success_rate,
    status
FROM pipeline_runs
ORDER BY records_invalid DESC
LIMIT 5;

SELECT
    pr.run_id,
    pr.started_at,
    COUNT(DISTINCT cu.customer_key)                              AS total_customers,
    SUM(CASE WHEN cu.first_seen_at::DATE = pr.started_at::DATE
             THEN 1 ELSE 0 END)                                 AS new_customers,
    SUM(CASE WHEN cu.first_seen_at::DATE < pr.started_at::DATE
             THEN 1 ELSE 0 END)                                 AS returning_customers
FROM pipeline_runs pr
JOIN fact_customer_imports f ON f.pipeline_run_id = pr.run_id
JOIN dim_customer cu          ON f.customer_key = cu.customer_key
GROUP BY pr.run_id, pr.started_at
ORDER BY pr.started_at DESC;