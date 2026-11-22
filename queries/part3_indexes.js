// queries/part3_indexes.js
// Частина 3 (додаткова ціль) — індекси та профілювання explain():
// замірюємо план виконання ДО індексу, створюємо індекс, замірюємо ПІСЛЯ.
// Запуск: mongosh "$MONGO_URI" --file queries/part3_indexes.js

db = db.getSiblingDB("spotify");

function header(title) {
  print("\n========================================================");
  print(title);
  print("========================================================");
}

// Витягує ключові метрики з explain("executionStats")
function profile(filter, sort, label) {
  const ex = db.tracks.find(filter).sort(sort || {}).explain("executionStats");
  const stats = ex.executionStats;

  // Шукаємо стадію сканування в дереві плану (включно з SORT-обгортками)
  function findScan(stage) {
    if (!stage) return "n/a";
    if (stage.inputStage) return findScan(stage.inputStage);
    if (stage.inputStages) return stage.inputStages.map(findScan).join("+");
    return stage.stage;
  }

  return {
    label: label,
    scan: findScan(ex.queryPlanner.winningPlan.queryPlan || ex.queryPlanner.winningPlan),
    executionTimeMillis: stats.executionTimeMillis,
    totalKeysExamined: stats.totalKeysExamined,
    totalDocsExamined: stats.totalDocsExamined,
    nReturned: stats.nReturned
  };
}

// Три тестові запити
const cases = [
  {
    label: "A: genre='pop' AND popularity>=70 (sort popularity desc)",
    filter: { track_genre: "pop", popularity: { $gte: 70 } },
    sort: { popularity: -1 },
    index: { track_genre: 1, popularity: -1 },
    indexName: "idx_genre_popularity"
  },
  {
    label: "B: artists='Bad Bunny' (multikey)",
    filter: { artists: "Bad Bunny" },
    sort: {},
    index: { artists: 1 },
    indexName: "idx_artists_multikey"
  },
  {
    label: "C: energy>0.9 AND danceability>0.8 (вкладені поля)",
    filter: { "audio_features.energy": { $gt: 0.9 }, "audio_features.danceability": { $gt: 0.8 } },
    sort: {},
    index: { "audio_features.energy": 1, "audio_features.danceability": 1 },
    indexName: "idx_energy_danceability"
  }
];

// --------------------------------------------------------
// Крок 0. Прибираємо індекси (крім _id) — ідемпотентний запуск
// --------------------------------------------------------
header("Крок 0. Скидання наявних індексів (крім _id)");
db.tracks.dropIndexes();
print("Індекси tracks: " + JSON.stringify(db.tracks.getIndexes().map(i => i.name)));

// --------------------------------------------------------
// Крок 1. Заміри БЕЗ індексів (очікуємо COLLSCAN)
// --------------------------------------------------------
header("Крок 1. explain() БЕЗ індексів");
const before = cases.map(c => profile(c.filter, c.sort, c.label));
before.forEach(r => printjson(r));

// --------------------------------------------------------
// Крок 2. Створення індексів
// --------------------------------------------------------
header("Крок 2. Створення індексів");
cases.forEach(c => {
  print("createIndex " + JSON.stringify(c.index) + " → " + db.tracks.createIndex(c.index, { name: c.indexName }));
});
printjson(db.tracks.getIndexes().map(i => ({ name: i.name, key: i.key })));

// --------------------------------------------------------
// Крок 3. Заміри ПІСЛЯ індексів (очікуємо IXSCAN)
// --------------------------------------------------------
header("Крок 3. explain() ПІСЛЯ індексів");
const after = cases.map(c => profile(c.filter, c.sort, c.label));
after.forEach(r => printjson(r));

// --------------------------------------------------------
// Крок 4. Порівняльна таблиця
// --------------------------------------------------------
header("Крок 4. Порівняння ДО / ПІСЛЯ");
before.forEach((b, i) => {
  const a = after[i];
  print(b.label);
  print("  scan:          " + b.scan + "  →  " + a.scan);
  print("  час (мс):      " + b.executionTimeMillis + "  →  " + a.executionTimeMillis);
  print("  docsExamined:  " + b.totalDocsExamined + "  →  " + a.totalDocsExamined);
  print("  keysExamined:  " + b.totalKeysExamined + "  →  " + a.totalKeysExamined);
  print("  nReturned:     " + b.nReturned + "  →  " + a.nReturned);
  print("");
});

print("Профілювання завершено.");
