ALTER TABLE visits ADD COLUMN page_id TEXT;
ALTER TABLE visits ADD COLUMN visitor_id TEXT;
ALTER TABLE visits ADD COLUMN session_id TEXT;
ALTER TABLE visits ADD COLUMN page_sequence INTEGER;
ALTER TABLE visits ADD COLUMN started_at TEXT;
ALTER TABLE visits ADD COLUMN last_seen_at TEXT;
ALTER TABLE visits ADD COLUMN previous_path TEXT;
ALTER TABLE visits ADD COLUMN referrer TEXT;
ALTER TABLE visits ADD COLUMN browser TEXT;
ALTER TABLE visits ADD COLUMN browser_version TEXT;
ALTER TABLE visits ADD COLUMN os TEXT;
ALTER TABLE visits ADD COLUMN os_version TEXT;
ALTER TABLE visits ADD COLUMN device_type TEXT;
ALTER TABLE visits ADD COLUMN language TEXT;
ALTER TABLE visits ADD COLUMN languages TEXT;
ALTER TABLE visits ADD COLUMN browser_timezone TEXT;
ALTER TABLE visits ADD COLUMN utm_source TEXT;
ALTER TABLE visits ADD COLUMN utm_medium TEXT;
ALTER TABLE visits ADD COLUMN utm_campaign TEXT;
ALTER TABLE visits ADD COLUMN utm_term TEXT;
ALTER TABLE visits ADD COLUMN utm_content TEXT;
ALTER TABLE visits ADD COLUMN asn INTEGER;
ALTER TABLE visits ADD COLUMN as_organization TEXT;
ALTER TABLE visits ADD COLUMN active_ms INTEGER;
ALTER TABLE visits ADD COLUMN max_scroll_pct INTEGER;

CREATE UNIQUE INDEX visits_page_id ON visits(page_id);
CREATE INDEX visits_visitor_session ON visits(visitor_id, session_id, started_at);
CREATE INDEX visits_session_sequence ON visits(session_id, page_sequence);

CREATE TABLE link_clicks (
  event_id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES visits(page_id) ON DELETE CASCADE,
  clicked_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  target_url TEXT NOT NULL,
  link_text TEXT,
  link_type TEXT NOT NULL,
  paper_title TEXT
);
CREATE INDEX clicks_page ON link_clicks(page_id);

CREATE VIEW visitor_profiles AS
SELECT visitor_id, MIN(started_at) AS first_seen_at, MAX(last_seen_at) AS last_seen_at,
       COUNT(*) AS page_views, COUNT(DISTINCT session_id) AS session_count,
       SUM(active_ms) AS active_ms
FROM visits WHERE visitor_id IS NOT NULL GROUP BY visitor_id;

CREATE VIEW session_summary AS
SELECT s.*,
       CASE WHEN s.visitor_id IS NULL THEN NULL
            WHEN s.started_at > (SELECT MIN(v.started_at) FROM visits v WHERE v.visitor_id = s.visitor_id)
            THEN 1 ELSE 0 END AS is_returning
FROM (
  SELECT visitor_id, session_id, MIN(started_at) AS started_at, MAX(last_seen_at) AS last_seen_at,
         COUNT(*) AS page_views, COUNT(DISTINCT path) AS distinct_pages,
         SUM(active_ms) AS active_ms, MAX(max_scroll_pct) AS max_scroll_pct,
         CASE WHEN MIN(visitor_type) = MAX(visitor_type) THEN MIN(visitor_type) ELSE 'mixed' END AS visitor_type
  FROM visits WHERE session_id IS NOT NULL GROUP BY visitor_id, session_id
) s;

CREATE VIEW session_paths AS
SELECT session_id, visitor_id, visitor_type, page_sequence, path, previous_path,
       started_at, visited_at, active_ms, max_scroll_pct,
       ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY page_sequence, started_at, id) AS step
FROM visits WHERE session_id IS NOT NULL;

CREATE VIEW paper_interest AS
SELECT c.paper_title, v.visitor_type, COUNT(*) AS link_clicks,
       COUNT(DISTINCT v.visitor_id) AS known_browsers,
       COUNT(DISTINCT v.session_id) AS sessions,
       SUM(c.link_type = 'pdf') AS pdf_clicks,
       SUM(c.link_type = 'github') AS github_clicks,
       MAX(c.clicked_at) AS last_clicked_at
FROM link_clicks c JOIN visits v ON v.page_id = c.page_id
WHERE c.paper_title IS NOT NULL
GROUP BY c.paper_title, v.visitor_type;
