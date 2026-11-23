// queries/part2_queries.js
// Частина 2 — Запити до даних (4 обов'язкові завдання).
// Кожен запит/пайплайн виводиться ПОВНІСТЮ перед результатом.
// Запуск: mongosh "$MONGO_URI" --file queries/part2_queries.js

db = db.getSiblingDB("spotify");

function header(title) {
  print("\n========================================================");
  print(title);
  print("========================================================");
}

// Друкує повний find-запит і виконує його
function runQuery(title, filter, { projection = { _id: 0 }, sort = null, limit = 5 } = {}) {
  header(title);
  print(">>> ЗАПИТ:");
  print("db.tracks.find(");
  printjson(filter);
  print(", ");
  printjson(projection);
  print(")");
  if (sort) { print(".sort("); printjson(sort); print(")"); }
  print(".limit(" + limit + ")");

  print("\n>>> РЕЗУЛЬТАТ:");
  print("Кількість (countDocuments): " + db.tracks.countDocuments(filter));
  let cursor = db.tracks.find(filter, projection);
  if (sort) cursor = cursor.sort(sort);
  printjson(cursor.limit(limit).toArray());
}

// Друкує повний пайплайн і виконує його
function runPipeline(title, pipeline, { printAll = true, preview = 3 } = {}) {
  header(title);
  print(">>> ЗАПИТ:");
  print("db.tracks.aggregate(");
  printjson(pipeline);
  print(")");

  print("\n>>> РЕЗУЛЬТАТ:");
  const result = db.tracks.aggregate(pipeline, { allowDiskUse: true }).toArray();
  print("Документів у результаті: " + result.length);
  printjson(printAll ? result : result.slice(0, preview));
  return result;
}

// ========================================================
// Завдання 1. Треки для вечірки
// danceability > 0.7, energy > 0.7, тривалість 180000–300000 мс (3–5 хв)
// ========================================================
runQuery(
  "Завдання 1. Треки для вечірки: danceability>0.7, energy>0.7, 3–5 хв",
  {
    "audio_features.danceability": { $gt: 0.7 },
    "audio_features.energy": { $gt: 0.7 },
    duration_ms: { $gte: 180000, $lte: 300000 }
  },
  {
    projection: {
      _id: 0, track_name: 1, artists: 1, duration_ms: 1,
      "audio_features.danceability": 1, "audio_features.energy": 1
    },
    sort: { popularity: -1 },
    limit: 5
  }
);

// ========================================================
// Завдання 2. Виконавці, у яких УСІ треки популярні:
// мінімум 3 треки, мінімальна популярність >= 60.
// Топ-20 за середньою популярністю; avg — 1 знак після коми.
// $unwind: колаборації зараховуються кожному виконавцю.
// ВАЖЛИВО: датасет семплений по жанрах, тож один трек (той самий track_id)
// може бути в колекції кілька разів — по документу на кожен жанр
// (напр. "Caile" Luar La L — 4 документи: latin, latino, reggae, reggaeton).
// Без дедуплікації такий виконавець отримав би "4 треки" з одного треку.
// Тому спершу згортаємо пари (виконавець, track_id) до одного треку.
// ========================================================
runPipeline(
  "Завдання 2. Топ-20 виконавців: >=3 унікальних треків і min(popularity) >= 60",
  [
    { $unwind: "$artists" },
    // Крок дедуплікації: один трек виконавця = один унікальний track_id.
    // Популярність копій у різних жанрах може відрізнятися на 1–2 пункти
    // (різні моменти знімку даних) — беремо максимальне значення.
    { $group: {
        _id: { artist: "$artists", track_id: "$track_id" },
        popularity: { $max: "$popularity" }
    }},
    { $group: {
        _id: "$_id.artist",
        track_count: { $sum: 1 },
        min_popularity: { $min: "$popularity" },
        avg_popularity: { $avg: "$popularity" }
    }},
    { $match: {
        track_count: { $gte: 3 },
        min_popularity: { $gte: 60 }        // "усі треки популярні" = мінімум >= 60
    }},
    { $project: {
        _id: 0,
        artist: "$_id",
        track_count: 1,
        min_popularity: 1,
        avg_popularity: { $round: ["$avg_popularity", 1] }
    }},
    { $sort: { avg_popularity: -1, track_count: -1 } },
    { $limit: 20 }
  ]
);

// ========================================================
// Завдання 3. Нетипові треки: tempo > mean(жанру) + 2 * stdDev(жанру).
// $group з $avg/$stdDevPop → поріг → $filter по масиву треків жанру.
// Для кожного жанру: genre, avg_tempo, outlier_threshold, outlier_tracks[].
// ========================================================
runPipeline(
  "Завдання 3. Темпо-викиди: tempo > avg + 2*stdDevPop по жанру",
  [
    // Крок 1: статистика темпу по жанру + усі треки жанру в масив
    { $group: {
        _id: "$track_genre",
        avg_tempo: { $avg: "$audio_features.tempo" },
        std_tempo: { $stdDevPop: "$audio_features.tempo" },
        tracks: { $push: {
            _id: "$_id",
            track_name: "$track_name",
            popularity: "$popularity",
            artists: "$artists",
            audio_features: { tempo: "$audio_features.tempo" }
        } }
    }},
    // Крок 2: поріг = середнє + 2 стандартні відхилення
    { $addFields: {
        outlier_threshold: { $add: ["$avg_tempo", { $multiply: [2, "$std_tempo"] }] }
    }},
    // Крок 3: лишаємо тільки треки вище порогу
    { $addFields: {
        outlier_tracks: {
          $filter: {
            input: "$tracks",
            as: "t",
            cond: { $gt: ["$$t.audio_features.tempo", "$outlier_threshold"] }
          }
        }
    }},
    // Крок 4: жанри без викидів не виводимо
    { $match: { $expr: { $gt: [{ $size: "$outlier_tracks" }, 0] } } },
    // Крок 5: фінальна форма документа
    { $project: {
        _id: 0,
        genre: "$_id",
        avg_tempo: { $round: ["$avg_tempo", 1] },
        outlier_threshold: { $round: ["$outlier_threshold", 1] },
        outlier_tracks: 1
    }},
    { $sort: { genre: 1 } }
  ],
  { printAll: false, preview: 3 }   // повний результат додатково зберігаємо нижче
);

// Зберігаємо повний результат завдання 3 у колекцію tempo_outliers,
// щоб його можна було переглянути цілком (у консоль — лише 3 приклади).
db.tracks.aggregate([
  { $group: {
      _id: "$track_genre",
      avg_tempo: { $avg: "$audio_features.tempo" },
      std_tempo: { $stdDevPop: "$audio_features.tempo" },
      tracks: { $push: {
          _id: "$_id", track_name: "$track_name", popularity: "$popularity",
          artists: "$artists", audio_features: { tempo: "$audio_features.tempo" }
      } }
  }},
  { $addFields: { outlier_threshold: { $add: ["$avg_tempo", { $multiply: [2, "$std_tempo"] }] } } },
  { $addFields: { outlier_tracks: {
      $filter: { input: "$tracks", as: "t",
                 cond: { $gt: ["$$t.audio_features.tempo", "$outlier_threshold"] } }
  } } },
  { $match: { $expr: { $gt: [{ $size: "$outlier_tracks" }, 0] } } },
  { $project: {
      _id: 0, genre: "$_id",
      avg_tempo: { $round: ["$avg_tempo", 1] },
      outlier_threshold: { $round: ["$outlier_threshold", 1] },
      outlier_tracks: 1
  } },
  // $out повністю перезаписує колекцію — повторний запуск не створює дублікатів
  // ($merge тут не підходить: через _id: 0 у $project кожен запуск отримує нові _id
  // і документи лише дописуються).
  { $out: "tempo_outliers" }
], { allowDiskUse: true });

print("\nПовний результат завдання 3 збережено в колекцію tempo_outliers:");
print("Жанрів з викидами: " + db.tempo_outliers.countDocuments());
print("Усього треків-викидів: " + db.tempo_outliers.aggregate([
  { $project: { n: { $size: "$outlier_tracks" } } },
  { $group: { _id: null, total: { $sum: "$n" } } }
]).toArray()[0].total);
print("Перегляд: db.tempo_outliers.find().sort({genre:1})");

// ========================================================
// Завдання 4. Треки для фонової роботи:
// loudness < -10, speechiness < 0.1, instrumentalness > 0.5, explicit = false
// ========================================================
runQuery(
  "Завдання 4. Фонова музика: тихі, інструментальні, без explicit",
  {
    "audio_features.loudness": { $lt: -10 },
    "audio_features.speechiness": { $lt: 0.1 },
    "audio_features.instrumentalness": { $gt: 0.5 },
    explicit: false
  },
  {
    projection: {
      _id: 0, track_name: 1, artists: 1,
      "audio_features.loudness": 1, "audio_features.speechiness": 1,
      "audio_features.instrumentalness": 1, explicit: 1
    },
    sort: { popularity: -1 },
    limit: 5
  }
);

print("\nУсі завдання частини 2 виконано.");
