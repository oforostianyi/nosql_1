// queries/part3_indexes.js
// Частина 3 — Індекси та оптимізація.
// Завдання 1: explain() до/після індексу для genre+danceability+sort(popularity).
// Завдання 2: складений індекс для "музики для роботи" + explain().
// Завдання 3 (факультативне): перевірка covered query через explain().
// Бонус: multikey-індекс по масиву artists.
// Запуск: mongosh "$MONGO_URI" --file queries/part3_indexes.js

db = db.getSiblingDB("spotify");

function header(title) {
  print("\n========================================================");
  print(title);
  print("========================================================");
}

// Зводить explain("executionStats") до ключових полів
function profileFind(filter, sort, projection, label) {
  let cursor = db.tracks.find(filter, projection || {});
  if (sort) cursor = cursor.sort(sort);
  const ex = cursor.explain("executionStats");
  const stats = ex.executionStats;

  // Збираємо всі стадії дерева плану (щоб побачити SORT / FETCH / PROJECTION_COVERED)
  function stages(stage, acc) {
    if (!stage) return acc;
    acc.push(stage.stage);
    if (stage.inputStage) stages(stage.inputStage, acc);
    if (stage.inputStages) stage.inputStages.forEach(s => stages(s, acc));
    return acc;
  }
  const plan = ex.queryPlanner.winningPlan.queryPlan || ex.queryPlanner.winningPlan;

  return {
    label: label,
    stages: stages(plan, []).join(" → "),
    executionTimeMillis: stats.executionTimeMillis,
    totalKeysExamined: stats.totalKeysExamined,
    totalDocsExamined: stats.totalDocsExamined,
    nReturned: stats.nReturned
  };
}

function printQuery(filter, sort, projection) {
  print(">>> ЗАПИТ: db.tracks.find(");
  printjson(filter);
  print(projection ? ", " : "");
  if (projection) printjson(projection);
  print(")" + (sort ? ".sort(" : ""));
  if (sort) { printjson(sort); print(")"); }
}

// --------------------------------------------------------
// Крок 0. Скидання індексів (крім _id) — ідемпотентний запуск
// --------------------------------------------------------
header("Крок 0. Скидання наявних індексів (крім _id)");
db.tracks.dropIndexes();
print("Індекси tracks: " + JSON.stringify(db.tracks.getIndexes().map(i => i.name)));

// ========================================================
// Завдання 1. Аналіз запиту та індексація
// Запит поєднує точний збіг (track_genre), діапазон
// (danceability) і сортування (popularity).
// Індекс за правилом ESR: Equality → Sort → Range:
//   { track_genre: 1, popularity: -1, "audio_features.danceability": 1 }
// ========================================================
header("Завдання 1. Жанр pop, танцювальність від 0.7, сортування за популярністю");

const q1filter = { track_genre: "pop", "audio_features.danceability": { $gte: 0.7 } };
const q1sort = { popularity: -1 };
printQuery(q1filter, q1sort);

print("\n--- explain() БЕЗ індексу:");
const t1before = profileFind(q1filter, q1sort, null, "завдання 1: до індексу");
printjson(t1before);

print("\n>>> ЗАПИТ: db.tracks.createIndex(");
const idx1 = { track_genre: 1, popularity: -1, "audio_features.danceability": 1 };
printjson(idx1);
print(', { name: "idx_genre_pop_dance" })');
print("Створено: " + db.tracks.createIndex(idx1, { name: "idx_genre_pop_dance" }));

print("\n--- explain() ПІСЛЯ індексу:");
const t1after = profileFind(q1filter, q1sort, null, "завдання 1: після індексу");
printjson(t1after);

print("\n--- Порівняння:");
print("  stages:        " + t1before.stages + "  →  " + t1after.stages);
print("  час (мс):      " + t1before.executionTimeMillis + "  →  " + t1after.executionTimeMillis);
print("  docsExamined:  " + t1before.totalDocsExamined + "  →  " + t1after.totalDocsExamined);
print("  keysExamined:  " + t1before.totalKeysExamined + "  →  " + t1after.totalKeysExamined);
print("  nReturned:     " + t1before.nReturned + "  →  " + t1after.nReturned);

// ========================================================
// Завдання 2. Складений індекс для "музики для роботи":
// explicit (рівність) + instrumentalness (діапазон) + speechiness (діапазон).
// Порядок полів: рівність першою (ESR), далі найбільш селективний діапазон.
// ========================================================
header("Завдання 2. Індекс для музики під час роботи: explicit, instrumentalness, speechiness");

const q2filter = {
  explicit: false,
  "audio_features.instrumentalness": { $gt: 0.5 },
  "audio_features.speechiness": { $lt: 0.1 }
};
printQuery(q2filter);

print("\n--- explain() БЕЗ індексу:");
const t2before = profileFind(q2filter, null, null, "завдання 2: до індексу");
printjson(t2before);

print("\n>>> ЗАПИТ: db.tracks.createIndex(");
const idx2 = {
  explicit: 1,
  "audio_features.instrumentalness": 1,
  "audio_features.speechiness": 1
};
printjson(idx2);
print(', { name: "idx_work_music" })');
print("Створено: " + db.tracks.createIndex(idx2, { name: "idx_work_music" }));

print("\n--- explain() ПІСЛЯ індексу:");
const t2after = profileFind(q2filter, null, null, "завдання 2: після індексу");
printjson(t2after);

print("\n--- Порівняння:");
print("  stages:        " + t2before.stages + "  →  " + t2after.stages);
print("  час (мс):      " + t2before.executionTimeMillis + "  →  " + t2after.executionTimeMillis);
print("  docsExamined:  " + t2before.totalDocsExamined + "  →  " + t2after.totalDocsExamined);
print("  keysExamined:  " + t2before.totalKeysExamined + "  →  " + t2after.totalKeysExamined);
print("  nReturned:     " + t2before.nReturned + "  →  " + t2after.nReturned);

// ========================================================
// Завдання 3 (факультативне). Covered query?
// Індекс завдання 1: { track_genre, popularity, danceability }.
// Запит: find({track_genre:"pop", popularity:{$gte:70}})
// ========================================================
header("Завдання 3. Чи є запит покривним (covered query)?");

const q3filter = { track_genre: "pop", popularity: { $gte: 70 } };

print("Варіант А: як в умові, без переліку полів (база повертає весь запис):");
printQuery(q3filter);
const t3a = profileFind(q3filter, null, null, "завдання 3: без проєкції");
printjson(t3a);

print("\nВаріант Б: повертаємо лише поля з індексу і не повертаємо _id:");
const q3proj = { _id: 0, track_genre: 1, popularity: 1 };
printQuery(q3filter, null, q3proj);
const t3b = profileFind(q3filter, null, q3proj, "завдання 3: покривна проєкція");
printjson(t3b);

print("\nВисновок: варіант А не покривний (є стадія FETCH, прочитано записів: " + t3a.totalDocsExamined + ").");
print("Варіант Б покривний (стадія PROJECTION_COVERED, прочитано записів: " + t3b.totalDocsExamined + ").");

// ========================================================
// Бонус. Multikey-індекс по масиву artists
// ========================================================
header("Додатково. Індекс за списком виконавців (multikey), пошук Bad Bunny");

const q4filter = { artists: "Bad Bunny" };
printQuery(q4filter);

const t4before = profileFind(q4filter, null, null, "бонус: до індексу");
print("\n--- explain() БЕЗ індексу:");
printjson(t4before);

print("\n>>> ЗАПИТ: db.tracks.createIndex({ artists: 1 }, { name: 'idx_artists_multikey' })");
print("Створено: " + db.tracks.createIndex({ artists: 1 }, { name: "idx_artists_multikey" }));

const t4after = profileFind(q4filter, null, null, "бонус: після індексу");
print("\n--- explain() ПІСЛЯ індексу:");
printjson(t4after);

print("\n--- Порівняння:");
print("  stages:        " + t4before.stages + "  →  " + t4after.stages);
print("  час (мс):      " + t4before.executionTimeMillis + "  →  " + t4after.executionTimeMillis);
print("  docsExamined:  " + t4before.totalDocsExamined + "  →  " + t4after.totalDocsExamined);

// --------------------------------------------------------
// Фінальний список індексів
// --------------------------------------------------------
header("Підсумок: індекси колекції tracks");
printjson(db.tracks.getIndexes().map(i => ({ name: i.name, key: i.key })));

print("\nЧастину 3 виконано.");
