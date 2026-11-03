// The curriculum: case requests that land on the lab's lead data analyst. Each question is graded by running
// `solution` on the same database and comparing results: rows in any order unless `ordered`, columns
// matched by name when the names line up, otherwise by position. `hint` is the clue the boss texts before the
// third attempt; `explanation` and `dialects` show once the question is solved or revealed. `vis` overrides the
// 3D mesh for rows that are not people ("crate"). Run tools/validate-questions.mjs after editing.
// Everything in the databases is fictional.

export const TIERS = [
  { id: "rookie", name: "Rookie", tagline: "SELECT, WHERE, ORDER BY, LIMIT, DISTINCT and your first aggregates.", xp: 100 },
  { id: "semipro", name: "Semi-Pro", tagline: "GROUP BY, HAVING, joins, subqueries, CASE, NULLs and dates.", xp: 200 },
  { id: "pro", name: "Pro", tagline: "CTEs, window functions, self-joins, recursion and set operations.", xp: 300 }
];

export const QUESTIONS = [
  // ------------------------------------------------------------------ Rookie
  {
    id: "r1", tier: "rookie", dataset: "crime", title: "Pull the watch-list",
    prompt: "Case request: the task force wants a printed watch-list of every suspect on file. Pull each suspect's <b>first_name</b>, <b>last_name</b> and <b>role</b>.",
    solution: "SELECT first_name, last_name, role\nFROM suspects;",
    hint: "You need every row, so no WHERE clause. Name the three columns after SELECT, separated by commas, then say which table with FROM suspects.",
    explanation: "SELECT picks the columns, FROM picks the table. With no WHERE, every row comes back, which is why all 40 suspects stepped up to the evidence table.",
    dialects: "Identical in PostgreSQL, MySQL, SQL Server and Oracle.",
    concepts: ["select"]
  },
  {
    id: "r2", tier: "rookie", dataset: "crime", title: "Big bounties",
    prompt: "Case request: which suspects carry a bounty of <b>more than 150,000</b>? Return <b>first_name</b>, <b>last_name</b> and <b>bounty_usd</b>.",
    solution: "SELECT first_name, last_name, bounty_usd\nFROM suspects\nWHERE bounty_usd > 150000;",
    hint: "Filter rows with WHERE bounty_usd > 150000. Numbers don't take quotes or commas.",
    explanation: "WHERE keeps only the rows where the condition is true. The suspects who stayed dim are the rows the filter threw away.",
    dialects: "Identical everywhere. Never write 150,000 with a comma in SQL; the comma separates columns.",
    concepts: ["where"]
  },
  {
    id: "r3", tier: "rookie", dataset: "crime", title: "New faces in Brazil",
    prompt: "Case request: find suspects in <b>country 1</b> (Brazil) who first appeared <b>on or after 2021-01-01</b>. Return <b>first_name</b> and <b>first_seen</b>.",
    solution: "SELECT first_name, first_seen\nFROM suspects\nWHERE country_id = 1\n  AND first_seen >= '2021-01-01';",
    hint: "Two conditions joined with AND: country_id = 1 AND first_seen >= '2021-01-01'. Dates are stored as text here, so the date needs quotes.",
    explanation: "AND needs both conditions to be true. ISO dates (YYYY-MM-DD) sort the same way as text and as dates, so >= works on them.",
    dialects: "SQLite stores dates as text. PostgreSQL/MySQL/SQL Server have real DATE types but accept '2021-01-01' the same way. Oracle prefers DATE '2021-01-01'.",
    concepts: ["where", "and"]
  },
  {
    id: "r4", tier: "rookie", dataset: "seizures", title: "Two ports",
    prompt: "Case request: the port task force is interviewing informants in <b>Singapore</b> and <b>Rotterdam</b>. List the <b>name</b> and <b>port</b> of every informant in either port.",
    solution: "SELECT name, port\nFROM informants\nWHERE port IN ('Singapore', 'Rotterdam');",
    hint: "Use WHERE port IN ('Singapore', 'Rotterdam'), or two conditions joined with OR. Text values need single quotes.",
    explanation: "IN (...) is shorthand for port = 'Singapore' OR port = 'Rotterdam'. It reads better as the list grows.",
    dialects: "Identical everywhere. Text comparison is case-sensitive in PostgreSQL and Oracle, case-insensitive by default in MySQL and SQL Server.",
    concepts: ["where", "in"]
  },
  {
    id: "r5", tier: "rookie", dataset: "crime", title: "Smuggler sweep",
    prompt: "Case request: find everyone whose <b>role</b> contains the word <b>Smuggler</b> (Senior Smuggler, Junior Smuggler, Chief Smuggler...). Return <b>first_name</b>, <b>last_name</b> and <b>role</b>.",
    solution: "SELECT first_name, last_name, role\nFROM suspects\nWHERE role LIKE '%Smuggler%';",
    hint: "LIKE matches patterns. % stands for any run of characters, so '%Smuggler%' means Smuggler anywhere in the role.",
    explanation: "LIKE '%Smuggler%' matches Smuggler with anything before or after it. That catches Chief Smuggler, Senior Smuggler and Junior Smuggler along with plain Smuggler.",
    dialects: "LIKE is case-insensitive in SQLite and MySQL but case-sensitive in PostgreSQL (use ILIKE there) and in Oracle.",
    concepts: ["where", "like"]
  },
  {
    id: "r6", tier: "rookie", dataset: "seizures", title: "Mid-value evidence", vis: "crate", ordered: true,
    prompt: "Case request: list the <b>name</b> and <b>street_value</b> of contraband worth <b>between 20 and 60</b> (inclusive), <b>cheapest first</b>.",
    solution: "SELECT name, street_value\nFROM contraband\nWHERE street_value BETWEEN 20 AND 60\nORDER BY street_value;",
    hint: "WHERE street_value BETWEEN 20 AND 60 includes both ends. Then ORDER BY street_value sorts ascending (cheapest first) by default.",
    explanation: "BETWEEN a AND b is the same as >= a AND <= b. ORDER BY sorts ascending unless you add DESC. Without ORDER BY, SQL doesn't promise any particular order.",
    dialects: "Identical everywhere.",
    concepts: ["between", "order"]
  },
  {
    id: "r7", tier: "rookie", dataset: "crime", title: "Most wanted five", ordered: true,
    prompt: "Case request: show the <b>5 highest bounties</b> on file: <b>first_name</b>, <b>last_name</b>, <b>bounty_usd</b>, highest first.",
    solution: "SELECT first_name, last_name, bounty_usd\nFROM suspects\nORDER BY bounty_usd DESC\nLIMIT 5;",
    hint: "Sort with ORDER BY bounty_usd DESC so the biggest bounty comes first, then keep the first five rows with LIMIT 5.",
    explanation: "ORDER BY ... DESC puts the biggest values first and LIMIT cuts the list off. LIMIT applies after sorting, which is why you get the top five and not five random rows.",
    dialects: "PostgreSQL and MySQL use LIMIT 5. SQL Server uses SELECT TOP 5 ... and Oracle/standard SQL use FETCH FIRST 5 ROWS ONLY.",
    concepts: ["order", "limit"]
  },
  {
    id: "r8", tier: "rookie", dataset: "seizures", title: "Which ports?", vis: "crate", ordered: true,
    prompt: "Case request: which ports do our informants work from? Return each <b>port</b> <b>once</b>, alphabetically.",
    solution: "SELECT DISTINCT port\nFROM informants\nORDER BY port;",
    hint: "SELECT DISTINCT port removes the duplicates. Add ORDER BY port for A to Z.",
    explanation: "DISTINCT collapses identical rows into one. Thirty informants work out of only five ports.",
    dialects: "Identical everywhere.",
    concepts: ["distinct", "order"]
  },
  {
    id: "r9", tier: "rookie", dataset: "crime", title: "Bounty snapshot",
    prompt: "Case request: the director wants three numbers in one row: <b>suspects</b> (how many are on file), <b>total_bounty</b> (sum of all bounties), and <b>avg_bounty</b> (average bounty, rounded to a whole number).",
    solution: "SELECT COUNT(*) AS suspects,\n       SUM(bounty_usd) AS total_bounty,\n       ROUND(AVG(bounty_usd)) AS avg_bounty\nFROM suspects;",
    hint: "Aggregates squash many rows into one: COUNT(*), SUM(bounty_usd), ROUND(AVG(bounty_usd)). Name each one with AS.",
    explanation: "Aggregate functions summarize the whole table into a single row. AS gives each result column a readable name.",
    dialects: "ROUND(x) works in all major databases. SQL Server needs ROUND(x, 0), and its AVG of an integer column returns an integer, so cast to DECIMAL first when you need the exact average.",
    concepts: ["aggregate"]
  },

  // ------------------------------------------------------------------ Semi-Pro
  {
    id: "s1", tier: "semipro", dataset: "crime", title: "Suspects by country",
    prompt: "Case request: for each <b>country_id</b>, return the <b>country_id</b> and a <b>headcount</b> of suspects. Two hired guns have no country on file (country_id is NULL); leave them out.",
    solution: "SELECT country_id, COUNT(*) AS headcount\nFROM suspects\nWHERE country_id IS NOT NULL\nGROUP BY country_id;",
    hint: "GROUP BY country_id makes one row per country; COUNT(*) counts the rows in each group. Filter the stateless suspects first with WHERE country_id IS NOT NULL.",
    explanation: "GROUP BY splits the rows into buckets and the aggregate runs once per bucket. Each tower is one bucket. NULL is never equal to anything, so you test it with IS NULL / IS NOT NULL.",
    dialects: "Identical everywhere.",
    concepts: ["group", "null"]
  },
  {
    id: "s2", tier: "semipro", dataset: "crime", title: "Who works where",
    prompt: "Case request: return each suspect's <b>first_name</b>, <b>last_name</b> and their country's <b>name</b> (call it <b>country</b>). Stateless suspects don't appear.",
    solution: "SELECT s.first_name, s.last_name, c.name AS country\nFROM suspects s\nJOIN countries c ON c.country_id = s.country_id;",
    hint: "JOIN countries ON countries.country_id = suspects.country_id. Short aliases help: FROM suspects s JOIN countries c ON c.country_id = s.country_id.",
    explanation: "An INNER JOIN pairs rows that match on the ON condition and drops rows with no partner. That's why the two hired guns (NULL country_id) disappear. The beams show each suspect linked to their country.",
    dialects: "Identical everywhere. JOIN on its own means INNER JOIN.",
    concepts: ["join"]
  },
  {
    id: "s3", tier: "semipro", dataset: "crime", title: "Every country counts",
    prompt: "Case request: list <b>every</b> country's <b>name</b> and its <b>headcount</b> of suspects, including countries with nobody on file (they should show 0).",
    solution: "SELECT c.name, COUNT(s.suspect_id) AS headcount\nFROM countries c\nLEFT JOIN suspects s ON s.country_id = c.country_id\nGROUP BY c.country_id, c.name;",
    hint: "Start FROM countries and LEFT JOIN suspects so empty countries survive. Count a column from suspects, COUNT(s.suspect_id), not COUNT(*), or empty countries count as 1.",
    explanation: "LEFT JOIN keeps every row from the left table even with no match, filling the right side with NULL. COUNT(column) skips NULLs, so Germany correctly gets 0. COUNT(*) would count its one NULL-filled row.",
    dialects: "Identical everywhere. Some databases require every non-aggregated column in GROUP BY, so grouping by both id and name is the portable habit.",
    concepts: ["join", "left-join", "group"]
  },
  {
    id: "s4", tier: "semipro", dataset: "crime", title: "No phone intercepted",
    prompt: "Case request: surveillance needs to chase suspects with <b>no phone number</b> on file. Return their <b>first_name</b> and <b>last_name</b>.",
    solution: "SELECT first_name, last_name\nFROM suspects\nWHERE phone IS NULL;",
    hint: "phone = NULL never matches anything. Use WHERE phone IS NULL.",
    explanation: "NULL means unknown, so NULL = NULL isn't true; it's unknown too. IS NULL is the only test that works.",
    dialects: "Identical everywhere. In Oracle an empty string '' also counts as NULL; elsewhere it doesn't.",
    concepts: ["null"]
  },
  {
    id: "s5", tier: "semipro", dataset: "crime", title: "Above average bounty",
    prompt: "Case request: who carries a bounty <b>higher than the average bounty on file</b>? Return <b>first_name</b> and <b>bounty_usd</b>.",
    solution: "SELECT first_name, bounty_usd\nFROM suspects\nWHERE bounty_usd > (SELECT AVG(bounty_usd) FROM suspects);",
    hint: "You can't use AVG() directly in WHERE. Put it in a subquery: WHERE bounty_usd > (SELECT AVG(bounty_usd) FROM suspects).",
    explanation: "A scalar subquery returns a single value, and you can use it anywhere a number would go. It runs first, then the outer query compares each bounty against it.",
    dialects: "Identical everywhere.",
    concepts: ["subquery"]
  },
  {
    id: "s6", tier: "semipro", dataset: "crime", title: "Threat tiers",
    prompt: "Case request: tag every suspect. Return <b>first_name</b>, <b>bounty_usd</b> and <b>tier</b>: <b>'Most Wanted'</b> for 130,000 and up, <b>'Wanted'</b> for 80,000 and up, otherwise <b>'Watch'</b>.",
    solution: "SELECT first_name, bounty_usd,\n       CASE WHEN bounty_usd >= 130000 THEN 'Most Wanted'\n            WHEN bounty_usd >= 80000 THEN 'Wanted'\n            ELSE 'Watch' END AS tier\nFROM suspects;",
    hint: "CASE WHEN bounty_usd >= 130000 THEN 'Most Wanted' WHEN bounty_usd >= 80000 THEN 'Wanted' ELSE 'Watch' END AS tier. The first true WHEN wins, so check the biggest threshold first.",
    explanation: "CASE is SQL's if/else. It checks the WHEN conditions top to bottom and stops at the first true one. That's why the order of the thresholds matters.",
    dialects: "Identical everywhere. SQL Server also has IIF() and MySQL has IF(); CASE works in all of them.",
    concepts: ["case"]
  },
  {
    id: "s7", tier: "semipro", dataset: "seizures", title: "Seizures per month", ordered: true,
    prompt: "Case request: for seizures made in <b>2024</b>, return the <b>month</b> as text like <b>2024-03</b> and the number of seizures that month (<b>seizures</b>), in calendar order.",
    solution: "SELECT strftime('%Y-%m', seized_date) AS month, COUNT(*) AS seizures\nFROM seizures\nWHERE seized_date >= '2024-01-01' AND seized_date < '2025-01-01'\nGROUP BY month\nORDER BY month;",
    hint: "In SQLite, strftime('%Y-%m', seized_date) turns a date into '2024-03'. Filter 2024 with WHERE, GROUP BY that month, ORDER BY it.",
    explanation: "You can group by a computed value. The month string sorts correctly because the year comes first and the month is zero-padded.",
    dialects: "PostgreSQL: to_char(seized_date, 'YYYY-MM'). MySQL: DATE_FORMAT(seized_date, '%Y-%m'). SQL Server: FORMAT(seized_date, 'yyyy-MM'). Oracle: TO_CHAR(seized_date, 'YYYY-MM').",
    concepts: ["date", "group", "order"]
  },
  {
    id: "s8", tier: "semipro", dataset: "seizures", title: "Top informants", ordered: true,
    prompt: "Case request: return each informant's <b>name</b> and <b>total_value</b> (quantity × street_value over all seizures their tips led to, any status), only for informants whose tips were worth <b>more than 500</b>, biggest first.",
    solution: "SELECT i.name, SUM(si.quantity * c.street_value) AS total_value\nFROM informants i\nJOIN seizures s ON s.informant_id = i.informant_id\nJOIN seizure_items si ON si.seizure_id = s.seizure_id\nJOIN contraband c ON c.item_id = si.item_id\nGROUP BY i.informant_id, i.name\nHAVING SUM(si.quantity * c.street_value) > 500\nORDER BY total_value DESC;",
    hint: "Chain the joins: informants to seizures to seizure_items to contraband. GROUP BY the informant, SUM(quantity * street_value), then filter the groups with HAVING (WHERE can't see aggregates).",
    explanation: "WHERE filters rows before grouping. HAVING filters groups after. Four tables joined in a chain give one row per item seized, and SUM rolls them up per informant.",
    dialects: "Identical everywhere. PostgreSQL and SQL Server don't let you use the alias total_value in HAVING; repeating the expression is portable.",
    concepts: ["join", "group", "having"]
  },
  {
    id: "s9", tier: "semipro", dataset: "seizures", title: "Dry tips",
    prompt: "Case request: which informants have <b>never produced a seizure</b>? Return their <b>name</b> and <b>port</b>.",
    solution: "SELECT name, port\nFROM informants\nWHERE informant_id NOT IN (SELECT informant_id FROM seizures);",
    hint: "Find informant_ids that aren't in the seizures table: WHERE informant_id NOT IN (SELECT informant_id FROM seizures). A LEFT JOIN with WHERE s.seizure_id IS NULL works too.",
    explanation: "NOT IN with a subquery keeps rows whose value never appears in the list. LEFT JOIN ... IS NULL is the other common way to find rows with no partner.",
    dialects: "Identical everywhere. Careful: if the subquery can return a NULL, NOT IN returns nothing at all. NOT EXISTS doesn't have that trap.",
    concepts: ["subquery", "anti-join"]
  },

  // ------------------------------------------------------------------ Pro
  {
    id: "p1", tier: "pro", dataset: "crime", title: "Rank the crew",
    prompt: "Case request: within each country, rank suspects by bounty (highest = 1, ties share a rank). Return <b>first_name</b>, <b>country_id</b>, <b>bounty_usd</b> and <b>country_rank</b>. Skip suspects with no country.",
    solution: "SELECT first_name, country_id, bounty_usd,\n       RANK() OVER (PARTITION BY country_id ORDER BY bounty_usd DESC) AS country_rank\nFROM suspects\nWHERE country_id IS NOT NULL;",
    hint: "A window function: RANK() OVER (PARTITION BY country_id ORDER BY bounty_usd DESC). PARTITION BY restarts the ranking for each country.",
    explanation: "Window functions compute across related rows without collapsing them like GROUP BY does. RANK gives ties the same number (Chris and Felix both carry 118,000) and then skips the next one.",
    dialects: "Window functions work in PostgreSQL, SQL Server, Oracle, MySQL 8+ and SQLite 3.25+. MySQL 5.7 doesn't have them.",
    concepts: ["window"]
  },
  {
    id: "p2", tier: "pro", dataset: "crime", title: "Top target per country",
    prompt: "Case request: find the <b>single highest bounty in each country</b>. Return the country <b>name</b> (as <b>country</b>), <b>first_name</b> and <b>bounty_usd</b>.",
    solution: "WITH ranked AS (\n  SELECT s.first_name, s.bounty_usd, c.name AS country,\n         ROW_NUMBER() OVER (PARTITION BY s.country_id ORDER BY s.bounty_usd DESC) AS rn\n  FROM suspects s\n  JOIN countries c ON c.country_id = s.country_id\n)\nSELECT country, first_name, bounty_usd\nFROM ranked\nWHERE rn = 1;",
    hint: "Number the rows per country with ROW_NUMBER() OVER (PARTITION BY country_id ORDER BY bounty_usd DESC) inside a CTE (WITH ranked AS (...)), then keep WHERE rn = 1. You can't filter on a window function in the same SELECT.",
    explanation: "This is the top-N-per-group pattern. Window results only exist after WHERE runs, so you compute them in a CTE or subquery and filter on the outside.",
    dialects: "Same in PostgreSQL, SQL Server, Oracle and MySQL 8+. PostgreSQL also has DISTINCT ON; Snowflake/BigQuery/DuckDB have QUALIFY.",
    concepts: ["cte", "window", "top-n"]
  },
  {
    id: "p3", tier: "pro", dataset: "crime", title: "Out-ranking the boss",
    prompt: "Case request: find suspects with a <b>bigger bounty than their own boss</b>. Return <b>suspect</b> (first_name), <b>bounty_usd</b>, <b>boss</b> (the boss's first_name) and <b>boss_bounty</b>.",
    solution: "SELECT s.first_name AS suspect, s.bounty_usd,\n       b.first_name AS boss, b.bounty_usd AS boss_bounty\nFROM suspects s\nJOIN suspects b ON b.suspect_id = s.boss_id\nWHERE s.bounty_usd > b.bounty_usd;",
    hint: "Join the suspects table to itself: FROM suspects s JOIN suspects b ON b.suspect_id = s.boss_id. Now s is the underling and b is the boss on the same row.",
    explanation: "A self-join treats one table as two, with different aliases. Each row pairs a suspect with their boss, so you can compare the two bounties side by side.",
    dialects: "Identical everywhere.",
    concepts: ["self-join"]
  },
  {
    id: "p4", tier: "pro", dataset: "crime", title: "Chain of command",
    prompt: "Case request: map the organization. Return every suspect's <b>first_name</b> and <b>level</b>, where the kingpin (no boss) is level <b>1</b>, their direct reports are level 2, and so on.",
    solution: "WITH RECURSIVE chain AS (\n  SELECT suspect_id, first_name, 1 AS level\n  FROM suspects WHERE boss_id IS NULL\n  UNION ALL\n  SELECT s.suspect_id, s.first_name, c.level + 1\n  FROM suspects s\n  JOIN chain c ON s.boss_id = c.suspect_id\n)\nSELECT first_name, level FROM chain;",
    hint: "WITH RECURSIVE chain AS ( start with the kingpin: SELECT ..., 1 AS level FROM suspects WHERE boss_id IS NULL  UNION ALL  then join suspects to chain ON s.boss_id = c.suspect_id with c.level + 1 ).",
    explanation: "A recursive CTE has a starting query (the anchor) and a step that joins back to itself. Each pass adds the next layer of the organization. It stops when a pass finds no new rows.",
    dialects: "PostgreSQL, MySQL 8+ and SQLite need WITH RECURSIVE. SQL Server and Oracle write plain WITH. Oracle also has CONNECT BY.",
    concepts: ["recursive", "cte"]
  },
  {
    id: "p5", tier: "pro", dataset: "crime", title: "Gap between sightings",
    prompt: "Case request: for each suspect with a country, return <b>country_id</b>, <b>first_name</b>, <b>first_seen</b> and <b>days_since_prev</b>: days since the previous suspect first appeared <b>in the same country</b> (NULL for the first one).",
    solution: "SELECT country_id, first_name, first_seen,\n       julianday(first_seen) - julianday(LAG(first_seen) OVER (PARTITION BY country_id ORDER BY first_seen)) AS days_since_prev\nFROM suspects\nWHERE country_id IS NOT NULL;",
    hint: "LAG(first_seen) OVER (PARTITION BY country_id ORDER BY first_seen) gives the previous suspect's date. In SQLite, subtract dates with julianday(a) - julianday(b).",
    explanation: "LAG looks back one row inside the window. The first row in each country has nothing before it, so LAG returns NULL and the subtraction stays NULL.",
    dialects: "PostgreSQL: first_seen - LAG(first_seen) OVER (...) on DATE columns. SQL Server: DATEDIFF(day, LAG(...), first_seen). MySQL: DATEDIFF(first_seen, LAG(...)).",
    concepts: ["window", "lag", "date"]
  },
  {
    id: "p6", tier: "pro", dataset: "crime", title: "Off the case board",
    prompt: "Case request: which suspects aren't linked to <b>any case</b>? Return <b>first_name</b> and <b>last_name</b>. Use a correlated subquery.",
    solution: "SELECT first_name, last_name\nFROM suspects s\nWHERE NOT EXISTS (\n  SELECT 1 FROM case_suspects cs WHERE cs.suspect_id = s.suspect_id\n);",
    hint: "WHERE NOT EXISTS (SELECT 1 FROM case_suspects cs WHERE cs.suspect_id = s.suspect_id). The inner query refers to s from the outer query, so it runs once per suspect.",
    explanation: "A correlated subquery depends on the outer row. NOT EXISTS is true when the inner query finds nothing for that suspect, and unlike NOT IN it handles NULLs safely.",
    dialects: "Identical everywhere.",
    concepts: ["correlated", "subquery"]
  },
  {
    id: "p7", tier: "pro", dataset: "seizures", title: "Running seized value", ordered: true,
    prompt: "Case request: for <b>confirmed</b> seizures in <b>2024</b>, return each <b>seized_date</b>, that day's <b>seized_value</b> (quantity × street_value) and a <b>running_total</b> across the year, in date order.",
    solution: "WITH daily AS (\n  SELECT s.seized_date, SUM(si.quantity * c.street_value) AS seized_value\n  FROM seizures s\n  JOIN seizure_items si ON si.seizure_id = s.seizure_id\n  JOIN contraband c ON c.item_id = si.item_id\n  WHERE s.status = 'confirmed'\n    AND s.seized_date >= '2024-01-01' AND s.seized_date < '2025-01-01'\n  GROUP BY s.seized_date\n)\nSELECT seized_date, seized_value,\n       SUM(seized_value) OVER (ORDER BY seized_date) AS running_total\nFROM daily\nORDER BY seized_date;",
    hint: "First a CTE that sums value per seized_date (GROUP BY s.seized_date) for confirmed 2024 seizures. Then SUM(seized_value) OVER (ORDER BY seized_date) adds up everything so far.",
    explanation: "SUM() OVER (ORDER BY ...) is a running total: each row adds up every row up to and including itself. Doing the GROUP BY in a CTE first keeps the two steps easy to read.",
    dialects: "Same in PostgreSQL, SQL Server, Oracle, MySQL 8+. Add ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW to be explicit when dates repeat.",
    concepts: ["cte", "window", "running"]
  },
  {
    id: "p8", tier: "pro", dataset: "seizures", title: "Marseille only", vis: "crate",
    prompt: "Case request: which contraband items (<b>name</b>) were seized from tips by at least one informant in <b>Marseille</b> but <b>never</b> from a tip by anyone in <b>Rotterdam</b>? Use a set operation.",
    solution: "SELECT c.name\nFROM contraband c\nJOIN seizure_items si ON si.item_id = c.item_id\nJOIN seizures s ON s.seizure_id = si.seizure_id\nJOIN informants i ON i.informant_id = s.informant_id\nWHERE i.port = 'Marseille'\nEXCEPT\nSELECT c.name\nFROM contraband c\nJOIN seizure_items si ON si.item_id = c.item_id\nJOIN seizures s ON s.seizure_id = si.seizure_id\nJOIN informants i ON i.informant_id = s.informant_id\nWHERE i.port = 'Rotterdam';",
    hint: "Write one query for items seized from Marseille tips and one for Rotterdam tips (same joins, different port), then put EXCEPT between them.",
    explanation: "EXCEPT returns rows from the first query that don't appear in the second, and removes duplicates. UNION stacks results and INTERSECT keeps only the rows in both.",
    dialects: "Oracle calls it MINUS (EXCEPT works from 21c). MySQL added EXCEPT in 8.0.31. PostgreSQL and SQL Server use EXCEPT.",
    concepts: ["set-ops"]
  }
];
