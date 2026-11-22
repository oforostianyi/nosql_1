// queries/part2_queries.js
// Частина 2 — запити до колекції tracks:
// фільтрація за вкладеними полями, масиви виконавців, оператори порівняння та діапазонів.
// Запуск: mongosh "$MONGO_URI" --file queries/part2_queries.js

db = db.getSiblingDB("spotify");

function header(title) {
  print("\n========================================================");
  print(title);
  print("========================================================");
}

// --------------------------------------------------------
// 2.1. Фільтрація за вкладеними полями (dot notation):
//      енергійні та танцювальні треки
// --------------------------------------------------------
header("2.1. Вкладені поля: energy > 0.8 AND danceability > 0.7");

const q21 = {
  "audio_features.energy": { $gt: 0.8 },
  "audio_features.danceability": { $gt: 0.7 }
};

print("Кількість: " + db.tracks.countDocuments(q21));
printjson(
  db.tracks.find(q21, {
    _id: 0, track_name: 1, artists: 1,
    "audio_features.energy": 1, "audio_features.danceability": 1
  }).limit(3).toArray()
);

// --------------------------------------------------------
// 2.2. Діапазони та порівняння:
//      tempo 120–140 BPM, popularity >= 60, тривалість 180–240 с
// --------------------------------------------------------
header("2.2. Діапазони: tempo [120,140], popularity >= 60, duration_sec [180,240]");

const q22 = {
  "audio_features.tempo": { $gte: 120, $lte: 140 },
  popularity: { $gte: 60 },
  duration_sec: { $gte: 180, $lte: 240 }
};

print("Кількість: " + db.tracks.countDocuments(q22));
printjson(
  db.tracks.find(q22, {
    _id: 0, track_name: 1, artists: 1, popularity: 1,
    duration_sec: 1, "audio_features.tempo": 1
  }).sort({ popularity: -1 }).limit(3).toArray()
);

// --------------------------------------------------------
// 2.3. Масив виконавців: точний збіг елемента масиву.
//      MongoDB автоматично шукає по кожному елементу artists
// --------------------------------------------------------
header("2.3. Масиви: усі треки за участю Bad Bunny");

print("Кількість: " + db.tracks.countDocuments({ artists: "Bad Bunny" }));
printjson(
  db.tracks.find({ artists: "Bad Bunny" }, {
    _id: 0, track_name: 1, artists: 1, popularity: 1
  }).sort({ popularity: -1 }).limit(3).toArray()
);

// --------------------------------------------------------
// 2.4. $all — треки, де задані виконавці присутні ОДНОЧАСНО
//      (спільні роботи Daddy Yankee та Bad Bunny)
// --------------------------------------------------------
header("2.4. $all: Daddy Yankee ТА Bad Bunny в одному треку");

const q24 = { artists: { $all: ["Daddy Yankee", "Bad Bunny"] } };
print("Кількість: " + db.tracks.countDocuments(q24));
printjson(
  db.tracks.find(q24, { _id: 0, track_name: 1, artists: 1, track_genre: 1 })
    .limit(3).toArray()
);

// --------------------------------------------------------
// 2.5. $size — сольні треки (рівно один виконавець)
// --------------------------------------------------------
header("2.5. $size: сольні треки (artists розміром 1)");

print("Кількість: " + db.tracks.countDocuments({ artists: { $size: 1 } }));

// Порівняння через $expr: колаборації з 3+ виконавцями
const q25b = { $expr: { $gte: [{ $size: "$artists" }, 3] } };
print("З 3+ виконавцями: " + db.tracks.countDocuments(q25b));
printjson(
  db.tracks.find(q25b, { _id: 0, track_name: 1, artists: 1 })
    .limit(2).toArray()
);

// --------------------------------------------------------
// 2.6. $in — будь-хто зі списку виконавців
// --------------------------------------------------------
header("2.6. $in: треки Bruno Mars або Silk Sonic");

const q26 = { artists: { $in: ["Bruno Mars", "Silk Sonic"] } };
print("Кількість: " + db.tracks.countDocuments(q26));
printjson(
  db.tracks.find(q26, { _id: 0, track_name: 1, artists: 1, popularity: 1 })
    .sort({ popularity: -1 }).limit(3).toArray()
);

// --------------------------------------------------------
// 2.7. Комбіновані умови $and / $or:
//      популярні explicit-треки АБО інструментальні композиції
// --------------------------------------------------------
header("2.7. $or: (explicit AND popularity>=70) OR instrumentalness>0.5");

const q27 = {
  $or: [
    { $and: [{ explicit: true }, { popularity: { $gte: 70 } }] },
    { "audio_features.instrumentalness": { $gt: 0.5 } }
  ]
};
print("Кількість: " + db.tracks.countDocuments(q27));
printjson(
  db.tracks.find(q27, {
    _id: 0, track_name: 1, artists: 1, explicit: 1,
    popularity: 1, "audio_features.instrumentalness": 1
  }).limit(3).toArray()
);

// --------------------------------------------------------
// 2.8. $regex по назві + діапазон valence:
//      "щасливі" треки про любов (valence > 0.7)
// --------------------------------------------------------
header("2.8. $regex: назва починається з 'love', valence > 0.7");

const q28 = {
  track_name: { $regex: /^love/i },
  "audio_features.valence": { $gt: 0.7 }
};
print("Кількість: " + db.tracks.countDocuments(q28));
printjson(
  db.tracks.find(q28, {
    _id: 0, track_name: 1, artists: 1,
    popularity: 1, "audio_features.valence": 1
  }).sort({ popularity: -1 }).limit(3).toArray()
);

// --------------------------------------------------------
// 2.9. popularity_tier + $ne / $nin:
//      не-експліцитні треки високої популярності поза pop-жанрами
// --------------------------------------------------------
header("2.9. tier='high', explicit != true, жанр не з [pop, k-pop]");

const q29 = {
  popularity_tier: "high",
  explicit: { $ne: true },
  track_genre: { $nin: ["pop", "k-pop"] }
};
print("Кількість: " + db.tracks.countDocuments(q29));
printjson(
  db.tracks.find(q29, {
    _id: 0, track_name: 1, artists: 1, track_genre: 1, popularity: 1
  }).sort({ popularity: -1 }).limit(3).toArray()
);

print("\nУсі запити частини 2 виконано.");
