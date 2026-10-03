CREATE TABLE visits (
  id INTEGER PRIMARY KEY,
  ip TEXT NOT NULL,
  visited_at TEXT NOT NULL,
  path TEXT NOT NULL,
  country TEXT,
  region TEXT,
  city TEXT,
  timezone TEXT
);

CREATE INDEX visits_ip_time ON visits (ip, visited_at);
CREATE INDEX visits_time ON visits (visited_at);

CREATE VIEW visitor_totals AS
SELECT ip, COUNT(*) AS visit_count,
       MIN(visited_at) AS first_visit_at,
       MAX(visited_at) AS last_visit_at
FROM visits
GROUP BY ip;
