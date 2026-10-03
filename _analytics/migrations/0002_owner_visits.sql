-- Keep historical records explicitly unclassified; IP alone cannot identify the owner.
ALTER TABLE visits ADD COLUMN visitor_type TEXT NOT NULL DEFAULT 'unknown'
  CHECK (visitor_type IN ('owner', 'visitor', 'unknown'));

CREATE INDEX visits_type_ip_time ON visits (visitor_type, ip, visited_at);

CREATE VIEW owner_visits AS SELECT * FROM visits WHERE visitor_type = 'owner';
CREATE VIEW other_visits AS SELECT * FROM visits WHERE visitor_type = 'visitor';

CREATE VIEW visitor_totals_by_type AS
SELECT visitor_type, ip, COUNT(*) AS visit_count,
       MIN(visited_at) AS first_visit_at,
       MAX(visited_at) AS last_visit_at
FROM visits
GROUP BY visitor_type, ip;
