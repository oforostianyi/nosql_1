// queries/part3_analytics.js
// Частина 3 — аналітичні Aggregation Pipelines:
// групування, обчислювані поля, $unwind, $lookup, $bucket, $setWindowFields.
// Кожен пайплайн виводиться у вивід ПОВНІСТЮ перед результатом.
// Запуск: mongosh "$MONGO_URI" --file queries/part3_analytics.js

db = db.getSiblingDB("spotify");

function header(title) {
  print("\n========================================================");
  print(title);
  print("========================================================");
}

// Друкує повний пайплайн і виконує його.
// Якщо saveResult=true — результат $merge не повертається, читаємо цільову колекцію окремо.
function runPipeline(title, collection, pipeline, { show = null } = {}) {
  header(title);

  print(">>> ЗАПИТ:");
  print("db." + collection + ".aggregate(");
  printjson(pipeline);
  print(")");

  print("\n>>> РЕЗУЛЬТАТ:");
  const result = db[collection].aggregate(pipeline, { allowDiskUse: true }).toArray();
  if (result.length > 0) printjson(result);
  if (show) show();
}

// --------------------------------------------------------
// 3.1. Топ-10 жанрів за середньою популярністю.
//      $group + обчислювані поля: avg-характеристики та hit_rate
//      (частка треків категорії high у жанрі)
// --------------------------------------------------------
runPipeline(
  "3.1. Топ-10 жанрів за середньою популярністю (мін. 100 треків)",
  "tracks",
  [
    { $group: {
        _id: "$track_genre",
        track_count:   { $sum: 1 },
        avg_popularity:{ $avg: "$popularity" },
        avg_energy:    { $avg: "$audio_features.energy" },
        avg_danceability: { $avg: "$audio_features.danceability" },
        hits: { $sum: { $cond: [{ $eq: ["$popularity_tier", "high"] }, 1, 0] } }
    }},
    { $match: { track_count: { $gte: 100 } } },
    { $addFields: {
        avg_popularity:   { $round: ["$avg_popularity", 1] },
        avg_energy:       { $round: ["$avg_energy", 3] },
        avg_danceability: { $round: ["$avg_danceability", 3] },
        hit_rate_pct:     { $round: [{ $multiply: [{ $divide: ["$hits", "$track_count"] }, 100] }, 1] }
    }},
    { $project: { hits: 0 } },
    { $sort: { avg_popularity: -1 } },
    { $limit: 10 }
  ]
);

// --------------------------------------------------------
// 3.2. Розподіл треків за popularity_tier з відсотками.
//      $group + $setWindowFields (частка від загальної кількості)
// --------------------------------------------------------
runPipeline(
  "3.2. Розподіл за popularity_tier (з % від усієї колекції)",
  "tracks",
  [
    { $group: { _id: "$popularity_tier", count: { $sum: 1 }, avg_popularity: { $avg: "$popularity" } } },
    { $setWindowFields: {
        output: { total: { $sum: "$count" } }
    }},
    { $addFields: {
        share_pct: { $round: [{ $multiply: [{ $divide: ["$count", "$total"] }, 100] }, 2] },
        avg_popularity: { $round: ["$avg_popularity", 1] }
    }},
    { $project: { total: 0 } },
    { $sort: { avg_popularity: -1 } }
  ]
);

// --------------------------------------------------------
// 3.3. Лідерборд виконавців: $unwind масиву artists → $group.
//      Результат зберігається в колекцію artist_stats ($merge) —
//      знадобиться для $lookup у наступному пайплайні.
// --------------------------------------------------------
runPipeline(
  "3.3. Лідерборд виконавців (мін. 10 треків) → $merge в artist_stats",
  "tracks",
  [
    { $unwind: "$artists" },                  // колаборація рахується кожному виконавцю
    { $group: {
        _id: "$artists",
        track_count:    { $sum: 1 },
        avg_popularity: { $avg: "$popularity" },
        max_popularity: { $max: "$popularity" },
        avg_energy:     { $avg: "$audio_features.energy" }
    }},
    { $match: { track_count: { $gte: 10 } } },
    { $addFields: {
        avg_popularity: { $round: ["$avg_popularity", 1] },
        avg_energy:     { $round: ["$avg_energy", 3] }
    }},
    { $merge: { into: "artist_stats", on: "_id", whenMatched: "replace", whenNotMatched: "insert" } }
  ],
  { show: () => {
      print("artist_stats документів: " + db.artist_stats.countDocuments());
      print("\n>>> ЧИТАННЯ ЗБЕРЕЖЕНОГО: db.artist_stats.find().sort({avg_popularity:-1, track_count:-1}).limit(15)");
      printjson(
        db.artist_stats.find().sort({ avg_popularity: -1, track_count: -1 }).limit(15).toArray()
      );
  } }
);

// --------------------------------------------------------
// 3.4. $lookup + $unwind: хіти (popularity >= 90) збагачені
//      статистикою виконавця з колекції artist_stats.
//      Багатоетапна агрегація з'єднує дві колекції.
// --------------------------------------------------------
runPipeline(
  "3.4. $lookup: хіти (popularity>=90) + статистика виконавця",
  "tracks",
  [
    { $match: { popularity: { $gte: 90 } } },
    { $unwind: "$artists" },
    { $lookup: {
        from: "artist_stats",
        localField: "artists",
        foreignField: "_id",
        as: "artist_info"
    }},
    { $unwind: "$artist_info" },            // розгортаємо результат join-у
    { $project: {
        _id: 0,
        track_name: 1,
        artist: "$artists",
        popularity: 1,
        track_genre: 1,
        artist_avg_popularity: "$artist_info.avg_popularity",
        artist_track_count: "$artist_info.track_count"
    }},
    { $sort: { popularity: -1, artist_avg_popularity: -1 } },
    { $limit: 10 }
  ]
);

// --------------------------------------------------------
// 3.5. $bucket: гістограма енергійності треку →
//      середня популярність у кожному діапазоні energy.
//      Перевірка гіпотези: чи корелює energy з популярністю?
// --------------------------------------------------------
runPipeline(
  "3.5. $bucket: популярність за діапазонами energy",
  "tracks",
  [
    { $bucket: {
        groupBy: "$audio_features.energy",
        boundaries: [0, 0.2, 0.4, 0.6, 0.8, 1.01],
        default: "other",
        output: {
          count: { $sum: 1 },
          avg_popularity: { $avg: "$popularity" },
          avg_valence: { $avg: "$audio_features.valence" }
        }
    }},
    { $addFields: {
        avg_popularity: { $round: ["$avg_popularity", 1] },
        avg_valence:    { $round: ["$avg_valence", 3] }
    }}
  ]
);

print("\nУсі пайплайни частини 3 виконано.");
