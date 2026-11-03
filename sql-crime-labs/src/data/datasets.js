// The two practice databases (the Global Crimes Bureau's case files). Each one is plain seed SQL (run in
// SQLite via sql.js) plus what the 3D office needs: a "population" (one figure per row, matched against
// query results) and "anchors" (the regional desks the population clusters around: countries for
// crime, port cities for seizures). Everything here is fictional.

function q(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}
function inserts(table, cols, rows) {
  return rows.map(function (r) { return "INSERT INTO " + table + " (" + cols.join(", ") + ") VALUES (" + r.map(q).join(", ") + ");"; }).join("\n");
}
// Deterministic PRNG so the generated seizures are identical on every load (answers never drift).
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- crime: the world watch-list

// country_id, name, hq_city (where the bureau's field office sits), region, agents
const countries = [
  [1, "Brazil", "Rio de Janeiro", "South America", 1200],
  [2, "France", "Marseille", "Europe", 650],
  [3, "Japan", "Osaka", "Asia", 420],
  [4, "Nigeria", "Lagos", "Africa", 380],
  [5, "Mexico", "Tijuana", "North America", 300],
  [6, "Italy", "Naples", "Europe", 900],
  [7, "Germany", "Hamburg", "Europe", 250]
];

// suspect_id, first_name, last_name, country_id, role, bounty_usd, first_seen, boss_id, phone (intercepted number)
const suspects = [
  [1, "Mateus", "Albuquerque", 4, "Kingpin", 245000, "2015-03-02", null, "+55 21 5550 0101"],
  [2, "Dante", "Moreau", 1, "Chief Smuggler", 198000, "2016-06-13", 1, "+33 4 5550 0102"],
  [3, "Priya", "Raghavan", 2, "Chief Forger", 176000, "2017-01-09", 1, "+81 6 5550 0103"],
  [4, "Tobias", "Alvarez", 3, "Cartel Treasurer", 142000, "2018-04-23", 1, "+234 1 5550 0104"],
  [5, "Grace", "Okafor", 4, "Fixer", 151000, "2016-11-07", 1, "+52 664 5550 0105"],
  [6, "Leo", "Martins", 5, "Dock Boss", 98000, "2019-02-18", 1, "+39 81 5550 0106"],
  [7, "Hana", "Sato", 6, "Cyber Chief", 155000, "2017-08-28", 1, "+49 40 5550 0107"],
  [8, "Jamal", "Brooks", 1, "Senior Smuggler", 152000, "2018-09-10", 2, "+55 21 5550 0108"],
  [9, "Elena", "Petrova", 1, "Senior Smuggler", 149000, "2019-05-06", 2, null],
  [10, "Chris", "Young", 1, "Smuggler", 118000, "2021-03-15", 8, "+55 21 5550 0110"],
  [11, "Aisha", "Khan", 1, "Smuggler", 121000, "2020-07-20", 8, "+55 21 5550 0111"],
  [12, "Ben", "Carter", 1, "Smuggler", 112000, "2022-01-10", 9, "+55 21 5550 0112"],
  [13, "Sofia", "Rossi", 1, "Junior Smuggler", 86000, "2023-06-05", 9, "+55 21 5550 0113"],
  [14, "Marcus", "Lee", 1, "Junior Smuggler", 84000, "2024-02-12", 8, null],
  [15, "Nina", "Patel", 1, "Wire Hacker", 126000, "2020-10-01", 2, "+55 21 5550 0115"],
  [16, "Omar", "Haddad", 2, "Counterfeiter", 92000, "2019-09-16", 3, "+33 4 5550 0116"],
  [17, "Julia", "Novak", 2, "Counterfeiter", 96000, "2020-03-02", 3, "+33 4 5550 0117"],
  [18, "Kevin", "Wright", 2, "Courier", 68000, "2022-08-22", 16, "+33 4 5550 0118"],
  [19, "Lucia", "Gomez", 2, "Courier", 71000, "2021-11-08", 17, "+33 4 5550 0119"],
  [20, "Ryan", "Murphy", 2, "Courier", 64000, "2023-04-17", 16, null],
  [21, "Zoe", "Adams", 2, "Courier", 66000, "2024-01-08", 17, "+33 4 5550 0121"],
  [22, "Ethan", "Clark", 3, "Art Thief", 82000, "2020-05-11", 4, "+81 6 5550 0122"],
  [23, "Mia", "Johnson", 3, "Forger", 88000, "2019-07-29", 4, "+81 6 5550 0123"],
  [24, "Noah", "Kim", 3, "Lookout", 79000, "2022-09-12", 4, "+81 6 5550 0124"],
  [25, "Ava", "Thompson", 3, "Forger", 85000, "2023-02-27", 23, null],
  [26, "Samuel", "Ortiz", 4, "Launderer", 87000, "2018-12-03", 5, "+234 1 5550 0126"],
  [27, "Chloe", "Dubois", 4, "Fraudster", 94000, "2021-06-14", 5, "+234 1 5550 0127"],
  [28, "Daniel", "Moore", 4, "Launderer", 83000, "2023-09-05", 26, "+234 1 5550 0128"],
  [29, "Fatima", "Ali", 5, "Lookout", 58000, "2021-01-25", 6, "+52 664 5550 0129"],
  [30, "George", "Hill", 5, "Lookout", 56000, "2022-05-16", 6, "+52 664 5550 0130"],
  [31, "Isabel", "Cruz", 5, "Lookout", 61000, "2020-08-03", 6, "+52 664 5550 0131"],
  [32, "Jack", "Turner", 5, "Dock Foreman", 72000, "2019-10-21", 6, null],
  [33, "Lily", "Evans", 5, "Lookout", 55000, "2024-03-11", 32, "+52 664 5550 0133"],
  [34, "Victor", "Silva", 6, "Safecracker", 158000, "2018-03-19", 7, "+39 81 5550 0134"],
  [35, "Wendy", "Zhao", 6, "Safecracker", 161000, "2019-11-04", 7, "+39 81 5550 0135"],
  [36, "Yusuf", "Demir", 6, "Getaway Driver", 134000, "2021-09-27", 34, "+39 81 5550 0136"],
  [37, "Rosa", "Lopez", 6, "Getaway Driver", 129000, "2022-12-05", 35, "+39 81 5550 0137"],
  [38, "Ian", "Walsh", null, "Hired Gun", 75000, "2024-05-20", 2, null],
  [39, "Kara", "Singh", null, "Hired Gun", 79000, "2024-06-03", 3, "+00 000 5550 0139"],
  [40, "Felix", "Brandt", 1, "Smuggler", 118000, "2021-08-30", 9, "+55 21 5550 0140"]
];

// case_id, title, country_id, opened, closed (NULL = still open), loss_usd
const cases = [
  [1, "The Blue Marlin Run", 1, "2023-01-15", null, 450000],
  [2, "Vermeer's Shadow", 6, "2022-06-01", "2024-03-31", 320000],
  [3, "Counterfeit Riviera", 2, "2023-09-01", null, 180000],
  [4, "Midnight at the Museum", 3, "2024-02-01", "2024-08-31", 95000],
  [5, "The Ledger Heist", 4, "2023-04-10", "2024-01-31", 140000],
  [6, "Border Tunnel", 5, "2024-01-08", null, 60000],
  [7, "The Naples Vault", 6, "2024-05-01", null, 510000],
  [8, "Silent Harbor", 1, "2022-02-14", "2023-10-30", 260000]
];

// suspect_id, case_id, sightings (times the bureau has put them at the scene)
const caseSuspects = [
  [2, 1, 120], [8, 1, 640], [9, 1, 580], [10, 1, 710], [11, 1, 690], [15, 1, 520], [15, 8, 800], [8, 8, 300],
  [12, 8, 450], [40, 1, 600], [13, 1, 300], [7, 2, 200], [34, 2, 900], [35, 2, 850], [36, 2, 620], [34, 7, 400],
  [35, 7, 520], [36, 7, 700], [37, 7, 760], [15, 7, 180], [16, 3, 300], [17, 3, 340], [18, 3, 520], [19, 3, 480],
  [22, 4, 260], [23, 4, 310], [24, 4, 280], [26, 5, 410], [27, 5, 460], [28, 5, 390], [31, 6, 350], [32, 6, 420],
  [29, 6, 300], [4, 4, 90]
];

const crimeSeed = [
  "CREATE TABLE countries (country_id INTEGER PRIMARY KEY, name TEXT NOT NULL, hq_city TEXT, region TEXT, agents INTEGER);",
  "CREATE TABLE suspects (suspect_id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, country_id INTEGER REFERENCES countries(country_id), role TEXT, bounty_usd INTEGER, first_seen TEXT, boss_id INTEGER REFERENCES suspects(suspect_id), phone TEXT);",
  "CREATE TABLE cases (case_id INTEGER PRIMARY KEY, title TEXT, country_id INTEGER REFERENCES countries(country_id), opened TEXT, closed TEXT, loss_usd INTEGER);",
  "CREATE TABLE case_suspects (suspect_id INTEGER REFERENCES suspects(suspect_id), case_id INTEGER REFERENCES cases(case_id), sightings INTEGER, PRIMARY KEY (suspect_id, case_id));",
  inserts("countries", ["country_id", "name", "hq_city", "region", "agents"], countries),
  inserts("suspects", ["suspect_id", "first_name", "last_name", "country_id", "role", "bounty_usd", "first_seen", "boss_id", "phone"], suspects),
  inserts("cases", ["case_id", "title", "country_id", "opened", "closed", "loss_usd"], cases),
  inserts("case_suspects", ["suspect_id", "case_id", "sightings"], caseSuspects)
].join("\n");

// ---------------------------------------------------------------- seizures: the port evidence room

// informant_id, name, port, signed_date, reliability
const informants = [
  [1, "Alicia Moreno", "Marseille", "2022-01-14", "gold"], [2, "Brandon Lewis", "Rotterdam", "2022-03-02", "silver"],
  [3, "Carmen Diaz", "Singapore", "2022-04-19", "bronze"], [4, "Derek Shaw", "Marseille", "2022-05-30", "silver"],
  [5, "Erin Walsh", "Santos", "2022-07-11", "gold"], [6, "Faisal Rahman", "Marseille", "2022-08-23", "bronze"],
  [7, "Gina Park", "Rotterdam", "2022-09-05", "gold"], [8, "Hector Ruiz", "Lagos", "2022-10-17", "bronze"],
  [9, "Ivy Chen", "Singapore", "2022-11-28", "silver"], [10, "Jordan Blake", "Marseille", "2023-01-09", "gold"],
  [11, "Kendra Ellis", "Rotterdam", "2023-02-20", "bronze"], [12, "Luis Herrera", "Santos", "2023-03-13", "silver"],
  [13, "Megan Foster", "Singapore", "2023-04-24", "gold"], [14, "Nate Coleman", "Marseille", "2023-05-15", "bronze"],
  [15, "Olivia Grant", "Rotterdam", "2023-06-26", "silver"], [16, "Pedro Sanchez", "Lagos", "2023-07-07", "silver"],
  [17, "Quinn Harper", "Singapore", "2023-08-18", "bronze"], [18, "Rachel Kim", "Marseille", "2023-09-29", "silver"],
  [19, "Sean O'Neil", "Rotterdam", "2023-10-10", "gold"], [20, "Tasha Green", "Santos", "2023-11-21", "bronze"],
  [21, "Umar Farouk", "Marseille", "2023-12-02", "gold"], [22, "Valerie Stone", "Singapore", "2024-01-13", "silver"],
  [23, "Wes Porter", "Lagos", "2024-02-24", "bronze"], [24, "Ximena Vega", "Marseille", "2024-03-06", "silver"],
  [25, "Yara Haddad", "Rotterdam", "2024-04-17", "bronze"], [26, "Zane Mitchell", "Singapore", "2024-05-28", "gold"],
  [27, "Bianca Torres", "Marseille", "2024-07-09", "bronze"], [28, "Caleb Price", "Santos", "2024-08-20", "silver"],
  [29, "Dana Brooks", "Rotterdam", "2024-09-30", "bronze"], [30, "Eli Navarro", "Lagos", "2024-10-11", "bronze"]
];

// item_id, name, category, street_value, units_in_vault
const contraband = [
  [1, "Cloned Phones", "Electronics", 59.99, 120], [2, "Pirated Speakers", "Electronics", 89.0, 64],
  [3, "Fake Charging Hubs", "Electronics", 34.5, 210], [4, "Stolen Monitors", "Electronics", 329.0, 18],
  [5, "Skimmed Keyboards", "Electronics", 119.0, 45], [6, "Smuggled Cookware", "Home", 39.95, 80],
  [7, "Counterfeit Coffee Sets", "Home", 48.0, 55], [8, "Looted Linens", "Home", 129.0, 30],
  [9, "Bootleg Lamps", "Home", 27.5, 140], [10, "Poached Tents", "Outdoors", 189.0, 22],
  [11, "Knockoff Backpacks", "Outdoors", 74.0, 60], [12, "Fake Thermoses", "Outdoors", 24.0, 300],
  [13, "Stolen Hammocks", "Outdoors", 54.0, 0], [14, "Forged First Editions", "Books", 32.0, 75],
  [15, "Pirated Textbooks", "Books", 22.5, 90], [16, "Looted Star Atlases", "Books", 45.0, 12],
  [17, "Counterfeit Puzzles", "Toys", 12.99, 400], [18, "Bootleg Robot Kits", "Toys", 79.0, 35],
  [19, "Stolen Train Sets", "Toys", 58.0, 0], [20, "Fake Board Games", "Toys", 36.0, 50]
];

// 60 seizures from tips by informants 1-26 (27-30 have never produced one), June 2023 - December 2024.
const seizures = [];
const seizureItems = [];
(function () {
  const rnd = mulberry32(20261029);
  const statuses = ["confirmed", "confirmed", "confirmed", "confirmed", "in_court", "in_court", "pending", "dismissed"];
  const start = Date.UTC(2023, 5, 1);
  const span = Date.UTC(2024, 11, 31) - start;
  const dates = [];
  for (let i = 0; i < 60; i++) dates.push(start + Math.floor(rnd() * span / 86400000) * 86400000);
  dates.sort(function (a, b) { return a - b; });
  for (let i = 0; i < 60; i++) {
    const id = i + 1;
    const tip = 1 + Math.floor(rnd() * 26);
    seizures.push([id, tip, new Date(dates[i]).toISOString().slice(0, 10), statuses[Math.floor(rnd() * statuses.length)]]);
    const n = 1 + Math.floor(rnd() * 4);
    const used = {};
    for (let k = 0; k < n; k++) {
      const p = 1 + Math.floor(rnd() * 20);
      if (used[p]) continue;
      used[p] = 1;
      seizureItems.push([id, p, 1 + Math.floor(rnd() * 3)]);
    }
  }
})();

const seizureSeed = [
  "CREATE TABLE informants (informant_id INTEGER PRIMARY KEY, name TEXT, port TEXT, signed_date TEXT, reliability TEXT);",
  "CREATE TABLE contraband (item_id INTEGER PRIMARY KEY, name TEXT, category TEXT, street_value REAL, units_in_vault INTEGER);",
  "CREATE TABLE seizures (seizure_id INTEGER PRIMARY KEY, informant_id INTEGER REFERENCES informants(informant_id), seized_date TEXT, status TEXT);",
  "CREATE TABLE seizure_items (seizure_id INTEGER REFERENCES seizures(seizure_id), item_id INTEGER REFERENCES contraband(item_id), quantity INTEGER, PRIMARY KEY (seizure_id, item_id));",
  inserts("informants", ["informant_id", "name", "port", "signed_date", "reliability"], informants),
  inserts("contraband", ["item_id", "name", "category", "street_value", "units_in_vault"], contraband),
  inserts("seizures", ["seizure_id", "informant_id", "seized_date", "status"], seizures),
  inserts("seizure_items", ["seizure_id", "item_id", "quantity"], seizureItems)
].join("\n");

// ---------------------------------------------------------------- exports

export const DATASETS = {
  crime: {
    id: "crime",
    title: "World Watch-list",
    blurb: "The Global Crimes Bureau's files: suspects and their bosses, the countries they work in, open and closed cases, and who was seen at which scene.",
    seed: crimeSeed,
    tables: [
      { name: "suspects", columns: [["suspect_id", "INTEGER", "PK"], ["first_name", "TEXT"], ["last_name", "TEXT"], ["country_id", "INTEGER", "FK countries (NULL = stateless)"], ["role", "TEXT"], ["bounty_usd", "INTEGER"], ["first_seen", "TEXT (YYYY-MM-DD)"], ["boss_id", "INTEGER", "FK suspects"], ["phone", "TEXT (nullable)"]] },
      { name: "countries", columns: [["country_id", "INTEGER", "PK"], ["name", "TEXT"], ["hq_city", "TEXT"], ["region", "TEXT"], ["agents", "INTEGER"]] },
      { name: "cases", columns: [["case_id", "INTEGER", "PK"], ["title", "TEXT"], ["country_id", "INTEGER", "FK countries"], ["opened", "TEXT"], ["closed", "TEXT (NULL = still open)"], ["loss_usd", "INTEGER"]] },
      { name: "case_suspects", columns: [["suspect_id", "INTEGER", "PK, FK suspects"], ["case_id", "INTEGER", "PK, FK cases"], ["sightings", "INTEGER"]] }
    ],
    // One figure per suspect. Results are matched against these columns by name.
    population: "SELECT s.suspect_id AS _id, s.*, c.name AS country, c.hq_city AS hq_city FROM suspects s LEFT JOIN countries c ON c.country_id = s.country_id ORDER BY s.suspect_id",
    populationLabel: "first_name",
    anchors: "SELECT country_id AS key, name AS label FROM countries ORDER BY country_id",
    anchorColumn: "country_id",
    anchorNoun: "country",
    spawnMesh: "figure"
  },
  seizures: {
    id: "seizures",
    title: "Port Evidence Room",
    blurb: "Informants across five ports, the contraband in the vault, and every seizure their tips led to.",
    seed: seizureSeed,
    tables: [
      { name: "informants", columns: [["informant_id", "INTEGER", "PK"], ["name", "TEXT"], ["port", "TEXT"], ["signed_date", "TEXT (YYYY-MM-DD)"], ["reliability", "TEXT (bronze/silver/gold)"]] },
      { name: "contraband", columns: [["item_id", "INTEGER", "PK"], ["name", "TEXT"], ["category", "TEXT"], ["street_value", "REAL"], ["units_in_vault", "INTEGER"]] },
      { name: "seizures", columns: [["seizure_id", "INTEGER", "PK"], ["informant_id", "INTEGER", "FK informants"], ["seized_date", "TEXT (YYYY-MM-DD)"], ["status", "TEXT (confirmed/in_court/pending/dismissed)"]] },
      { name: "seizure_items", columns: [["seizure_id", "INTEGER", "PK, FK seizures"], ["item_id", "INTEGER", "PK, FK contraband"], ["quantity", "INTEGER"]] }
    ],
    population: "SELECT informant_id AS _id, i.* FROM informants i ORDER BY informant_id",
    populationLabel: "name",
    anchors: "SELECT DISTINCT port AS key, port AS label FROM informants ORDER BY port",
    anchorColumn: "port",
    anchorNoun: "port",
    spawnMesh: "crate"
  }
};
