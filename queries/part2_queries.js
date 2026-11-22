// queries/part2_queries.js
// Частина 2 — запити до колекції tracks:
// фільтрація за вкладеними полями, масиви виконавців, оператори порівняння та діапазонів.
// Кожен запит виводиться у вивід ПОВНІСТЮ (filter/projection/sort/limit) перед результатом.
// Запуск: mongosh "$MONGO_URI" --file queries/part2_queries.js

db = db.getSiblingDB("spotify");

function header(title) {
  print("\n========================================================");
  print(title);
  print("========================================================");
}

// Друкує повний запит і виконує його: count + find з проєкцією/сортуванням/лімітом
function runQuery(title, filter, { projection = { _id: 0 }, sort = null, limit = 3 } = {}) {
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

// --------------------------------------------------------
// 2.1. Фільтрація за вкладеними полями (dot notation):
//      енергійні та танцювальні треки
// --------------------------------------------------------
runQuery(
  "2.1. Вкладені поля: energy > 0.8 AND danceability > 0.7",
  {
    "audio_features.energy": { $gt: 0.8 },
    "audio_features.danceability": { $gt: 0.7 }
  },
  { projection: {
      _id: 0, track_name: 1, artists: 1,
      "audio_features.energy": 1, "audio_features.danceability": 1
  } }
);

// --------------------------------------------------------
// 2.2. Діапазони та порівняння:
//      tempo 120–140 BPM, popularity >= 60, тривалість 180–240 с
// --------------------------------------------------------
runQuery(
  "2.2. Діапазони: tempo [120,140], popularity >= 60, duration_sec [180,240]",
  {
    "audio_features.tempo": { $gte: 120, $lte: 140 },
    popularity: { $gte: 60 },
    duration_sec: { $gte: 180, $lte: 240 }
  },
  { projection: {
      _id: 0, track_name: 1, artists: 1, popularity: 1,
      duration_sec: 1, "audio_features.tempo": 1
    },
    sort: { popularity: -1 } }
);

// --------------------------------------------------------
// 2.3. Масив виконавців: точний збіг елемента масиву.
//      MongoDB автоматично шукає по кожному елементу artists
// --------------------------------------------------------
runQuery(
  "2.3. Масиви: усі треки за участю Bad Bunny",
  { artists: "Bad Bunny" },
  { projection: { _id: 0, track_name: 1, artists: 1, popularity: 1 },
    sort: { popularity: -1 } }
);

// --------------------------------------------------------
// 2.4. $all — треки, де задані виконавці присутні ОДНОЧАСНО
//      (спільні роботи Daddy Yankee та Bad Bunny)
// --------------------------------------------------------
runQuery(
  "2.4. $all: Daddy Yankee ТА Bad Bunny в одному треку",
  { artists: { $all: ["Daddy Yankee", "Bad Bunny"] } },
  { projection: { _id: 0, track_name: 1, artists: 1, track_genre: 1 } }
);

// --------------------------------------------------------
// 2.5. $size — сольні треки (рівно один виконавець)
//      + $expr: колаборації з 3+ виконавцями
// --------------------------------------------------------
runQuery(
  "2.5a. $size: сольні треки (artists розміром 1)",
  { artists: { $size: 1 } },
  { projection: { _id: 0, track_name: 1, artists: 1 } }
);

runQuery(
  "2.5b. $expr: колаборації з 3+ виконавцями",
  { $expr: { $gte: [{ $size: "$artists" }, 3] } },
  { projection: { _id: 0, track_name: 1, artists: 1 }, limit: 2 }
);

// --------------------------------------------------------
// 2.6. $in — будь-хто зі списку виконавців
// --------------------------------------------------------
runQuery(
  "2.6. $in: треки Bruno Mars або Silk Sonic",
  { artists: { $in: ["Bruno Mars", "Silk Sonic"] } },
  { projection: { _id: 0, track_name: 1, artists: 1, popularity: 1 },
    sort: { popularity: -1 } }
);

// --------------------------------------------------------
// 2.7. Комбіновані умови $and / $or:
//      популярні explicit-треки АБО інструментальні композиції
// --------------------------------------------------------
runQuery(
  "2.7. $or: (explicit AND popularity>=70) OR instrumentalness>0.5",
  {
    $or: [
      { $and: [{ explicit: true }, { popularity: { $gte: 70 } }] },
      { "audio_features.instrumentalness": { $gt: 0.5 } }
    ]
  },
  { projection: {
      _id: 0, track_name: 1, artists: 1, explicit: 1,
      popularity: 1, "audio_features.instrumentalness": 1
  } }
);

// --------------------------------------------------------
// 2.8. $regex по назві + діапазон valence:
//      "щасливі" треки про любов (valence > 0.7)
// --------------------------------------------------------
runQuery(
  "2.8. $regex: назва починається з 'love', valence > 0.7",
  {
    track_name: { $regex: /^love/i },
    "audio_features.valence": { $gt: 0.7 }
  },
  { projection: {
      _id: 0, track_name: 1, artists: 1,
      popularity: 1, "audio_features.valence": 1
    },
    sort: { popularity: -1 } }
);

// --------------------------------------------------------
// 2.9. popularity_tier + $ne / $nin:
//      не-експліцитні треки високої популярності поза pop-жанрами
// --------------------------------------------------------
runQuery(
  "2.9. tier='high', explicit != true, жанр не з [pop, k-pop]",
  {
    popularity_tier: "high",
    explicit: { $ne: true },
    track_genre: { $nin: ["pop", "k-pop"] }
  },
  { projection: {
      _id: 0, track_name: 1, artists: 1, track_genre: 1, popularity: 1
    },
    sort: { popularity: -1 } }
);

print("\nУсі запити частини 2 виконано.");
