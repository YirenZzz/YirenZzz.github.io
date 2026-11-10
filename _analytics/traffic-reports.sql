-- Read-only reports. Run one SELECT at a time in the private D1 Console.
-- Labels are heuristic, not verified human identities. Raw records are retained.

-- 1. Separate bots, unclassified traffic and browsers for each owner category.
SELECT visitor_type,
       CASE WHEN device_type = 'bot' THEN 'bot'
            WHEN device_type IS NULL OR device_type = 'unknown' THEN 'unclassified'
            ELSE 'not_identified_as_bot' END AS traffic_type,
       COUNT(*) AS page_views,
       COUNT(DISTINCT visitor_id) AS known_browsers,
       COUNT(DISTINCT session_id) AS sessions
FROM visits
GROUP BY visitor_type, traffic_type
ORDER BY visitor_type, traffic_type;

-- 2. Recent unmarked browser visits to formal pages, excluding recognized bots.
-- Display time uses America/New_York under US DST rules effective since 2007.
-- D1 cannot automatically follow the viewing computer's system timezone.
SELECT datetime(visited_at, CASE
         WHEN datetime(visited_at) >= datetime(strftime('%Y', visited_at) || '-03-01', 'weekday 0', '+7 days', '+7 hours')
          AND datetime(visited_at) < datetime(strftime('%Y', visited_at) || '-11-01', 'weekday 0', '+6 hours')
         THEN '-4 hours' ELSE '-5 hours' END) AS visit_time,
       ip, visitor_type, country, region, city, path,
       ROUND(active_ms / 1000.0, 1) AS foreground_seconds,
       max_scroll_pct, referrer, utm_source, utm_medium, utm_campaign,
       device_type, browser, os, language, as_organization, session_id
FROM visits
WHERE visitor_type = 'visitor'
  AND device_type IN ('desktop', 'mobile', 'tablet')
  AND path IN ('/', '/publications/', '/teaching/', '/service/')
ORDER BY visited_at DESC, id DESC
LIMIT 100;

-- 3. Links clicked by unmarked browsers, excluding recognized bots.
SELECT v.ip, c.link_text AS clicked_link, c.paper_title, c.link_type,
       c.target_url, v.path AS source_page, v.session_id
FROM link_clicks c JOIN visits v ON v.page_id = c.page_id
WHERE v.visitor_type = 'visitor'
  AND v.device_type IN ('desktop', 'mobile', 'tablet')
ORDER BY c.clicked_at DESC, c.event_id DESC
LIMIT 100;

-- 4. Paper interest from unmarked browsers, excluding recognized bots.
SELECT c.paper_title, COUNT(*) AS link_clicks,
       COUNT(DISTINCT v.visitor_id) AS known_browsers,
       SUM(c.link_type = 'pdf') AS pdf_clicks,
       SUM(c.link_type = 'github') AS github_clicks
FROM link_clicks c JOIN visits v ON v.page_id = c.page_id
WHERE v.visitor_type = 'visitor'
  AND v.device_type IN ('desktop', 'mobile', 'tablet')
  AND c.paper_title IS NOT NULL
GROUP BY c.paper_title
ORDER BY link_clicks DESC, c.paper_title;
