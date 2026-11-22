# nosql_1 — Аналітична платформа для музичного стрімінгового сервісу

Практичне завдання з MongoDB: завантаження датасету **Spotify Tracks Dataset** (~114 000 треків) у **MongoDB Atlas**, проєктування документо-орієнтованої схеми через Aggregation Pipeline, запити з фільтрацією/масивами/діапазонами, аналітичні пайплайни з `$lookup`/`$unwind` та профілювання індексів через `explain()`.

## Структура репозиторію

```
.
├── .env                        # рядок підключення MONGO_URI (не комітиться!)
├── .gitignore
├── requirements.txt
├── scripts/
│   ├── 01_load_data.py         # завантаження CSV → tracks_raw (pymongo)
│   └── 02_transform.js         # агрегація tracks_raw → tracks (MQL)
├── queries/
│   ├── part2_queries.js        # запити частини 2
│   ├── part3_analytics.js      # аналітичні пайплайни частини 3
│   └── part3_indexes.js        # індекси + explain() частини 3
├── results/                    # збережений вивід усіх скриптів (замість скріншотів)
│   ├── part2_output.txt        # повний запит + результат для кожного пункту
│   ├── part3_analytics_output.txt
│   └── part3_indexes_output.txt
└── README.md
```

## Налаштування та запуск

```bash
# 1. Залежності
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. .env — рядок підключення до Atlas (файл у .gitignore)
# MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/

# ВАЖЛИВО: експортуйте змінну в шел перед запуском mongosh,
# інакше "$MONGO_URI" порожній і mongosh піде на localhost:27017 (ECONNREFUSED)
export $(grep -m1 '^MONGO_URI=' .env)
echo ${#MONGO_URI}   # sanity check: має бути > 0

# 3. Датасет dataset.csv у корінь проєкту
#    Kaggle: https://www.kaggle.com/datasets/maharshipandya/-spotify-tracks-dataset
#    (використано публічне дзеркало HuggingFace: maharshipandya/spotify-tracks-dataset)

# 4. Частина 1: завантаження + трансформація
python scripts/01_load_data.py
mongosh "$MONGO_URI" --file scripts/02_transform.js

# 5. Частина 2: запити
mongosh "$MONGO_URI" --file queries/part2_queries.js

# 6. Частина 3: аналітика та індекси
mongosh "$MONGO_URI" --file queries/part3_analytics.js
mongosh "$MONGO_URI" --file queries/part3_indexes.js
```

Кластер: **Atlas M0 `GoItNoSQLTask01`** — вже працює як Replica Set із 3 нод
(`setName: atlas-3m6xy7-shard-0`), окреме налаштування реплікації не потрібне.

## Частина 1 — Завантаження та схема

- `tracks_raw`: **113 999** документів із 114 000 рядків CSV (1 рядок відсіяно — відсутні виконавець/назва). Типи приведено: `explicit` → bool, 5 полів → int, 9 полів → float. Вставка батчами по 1000.
- `tracks`: **113 999** документів після трансформації (`$project → $addFields → $unset → $out`).

Приклад документа `tracks`:

```javascript
{
  track_id: '5SuOikwiRyPMVoIQDJUgSV',
  track_name: 'Comedy',
  album_name: 'Comedy',
  artists: ['Gen Hoshino'],            // масив замість рядка "A;B"
  popularity: 73,
  popularity_tier: 'high',             // обчислюване: high ≥70, medium ≥40, low <40
  duration_ms: 230666,
  duration_sec: 230.7,                 // обчислюване: округлені секунди
  explicit: false,
  track_genre: 'acoustic',
  audio_features: {                    // вкладений об'єкт
    danceability: 0.676, energy: 0.461, loudness: -6.746,
    speechiness: 0.143, acousticness: 0.0322, instrumentalness: 0.00000101,
    liveness: 0.358, valence: 0.715, tempo: 87.917,
    key: 1, mode: 0, time_signature: 4
  }
}
```

### Відповіді на обов'язкові теоретичні питання

**1. Чому аудіо-характеристики винесені в окремий об’єкт `audio_features`, а не зберігаються плоско? Коли таке вкладення вигідне, а коли створює проблеми?**

Вигідне, тому що:
- **Логічне групування та самодокументованість.** 12 характеристик — це одна предметна сутність («аудіопрофіль треку», аналог відповіді Spotify Audio Features API). Вкладення відображає предметну модель: трек *має* аудіопрофіль, а не 12 розрізнених атрибутів. Верхній рівень документа лишається чистим (ідентифікація, виконавці, популярність).
- **Атомарні операції з групою.** Увесь профіль можна замінити/додати одним `$set: {audio_features: {...}}`, скопіювати в інший документ, або прибрати одним `$unset` — без перелічення 12 полів.
- **Зручні проєкції та еволюція схеми.** `audio_features: 1` повертає весь блок; нові фічі додаються всередині об'єкта, не засмічуючи корінь документа. Це природна межа для валідації схеми (`$jsonSchema`) і для прав доступу/редaкції на рівні блоку.

Проблеми створює, коли:
- **Запити та індекси стають довшими.** Кожне звернення — через dot notation (`audio_features.energy`); індекси теж будуються на довших шляхах. Плоска схема для суто аналітичного workload (постійні фільтри/агрегації по окремих фічах) ергономічніша.
- **Глибокі або часто оновлювані вкладення.** MongoDB оновлює документ цілком (WiredTiger), тож дрібне оновлення глибоко всередині великого об'єкта коштує дорожче; глибока вкладеність (>2–3 рівні) погіршує читабельність запитів.
- **Потрібні незалежні життєві цикли.** Якщо фічі оновлюються окремо й часто різними процесами — краще окрема колекція/плоскі поля, щоб уникнути write-конфліктів на одному документі.

У нашому випадку вкладення правильне: профіль незмінний, читається як ціле, глибоких рівнів немає.

**2. Чому виконавці зберігаються як масив, а не як рядок? Які запити стають простішими?**

Рядок `"Daddy Yankee;Bad Bunny"` — це непрозора для БД склейка: щоб знайти треки Bad Bunny, довелось би робити `$regex: /Bad Bunny/` — повільно (не використовує індекс ефективно), крихко (хибні збіги підрядків, залежність від роздільника/пробілів) і неможливо коректно порахувати кількість виконавців.

Масив робить кожен елемент повноцінним значенням, яке MongoDB індексує **multikey-індексом** і до якого застосовуються оператори масивів:

| Запит | З масивом | З рядком |
|---|---|---|
| Усі треки виконавця | `{artists: "Bad Bunny"}` — точний збіг елемента, IXSCAN | `$regex` + COLLSCAN, хибні збіги |
| Спільна робота двох | `{artists: {$all: ["Daddy Yankee","Bad Bunny"]}}` | 2 regex-и, порядок/пробіли мають значення |
| Будь-хто зі списку | `{artists: {$in: [...]}}` | громіздкий `$or` з regex |
| Сольні / колаборації | `{artists: {$size: 1}}`, `$expr: {$gte: [{$size: "$artists"}, 3]}` | підрахунок роздільників у `$expr` |
| Аналітика по виконавцях | `$unwind: "$artists"` → `$group` | попередній `$split` у кожному пайплайні |

Практичний ефект підтверджено у `part3_indexes.js`: запит `{artists: "Bad Bunny"}` з multikey-індексом виконується за **2 мс проти 82 мс** і читає **416 документів замість 113 999**.

## Частина 2 — Запити (`queries/part2_queries.js`)

Повний вивід: `results/part2_output.txt` — для кожного завдання надруковано **повний запит/пайплайн** і одразу результат.

### Завдання 1. Треки для вечірки

Фільтр: `audio_features.danceability > 0.7`, `audio_features.energy > 0.7`, `duration_ms ∈ [180000, 300000]` (3–5 хв).

```javascript
db.tracks.find({
  "audio_features.danceability": { $gt: 0.7 },
  "audio_features.energy": { $gt: 0.7 },
  duration_ms: { $gte: 180000, $lte: 300000 }
}).sort({ popularity: -1 })
```

**Результат: 7 311 треків.** У топі за популярністю — `Quevedo: Bzrp Music Sessions, Vol. 52` (99), `Me Porto Bonito` (97).

### Завдання 2. Виконавці, у яких усі треки популярні

Агрегація: `$unwind: "$artists"` (колаборація зараховується кожному виконавцю) → `$group` по виконавцю з `track_count`, `min_popularity`, `avg_popularity` → `$match: { track_count: { $gte: 3 }, min_popularity: { $gte: 60 } }` → `$round` avg до 1 знака → `$sort` за avg → `$limit: 20`.

Ключова ідея: «усі треки популярні» ⇔ **мінімум** популярності ≥ 60 — тому фільтруємо за `$min`, а не за середнім.

**Результат: топ-20.** Перші місця:

| Артист | Треків | min | avg |
|---|---|---|---|
| Harry Styles | 3 | 89 | 92.0 |
| Luar La L | 4 | 90 | 90.5 |
| Olivia Rodrigo | 5 | 86 | 87.4 |
| BYOR | 4 | 87 | 87.0 |
| IVE | 3 | 79 | 84.0 |

### Завдання 3. Нетипові треки (темпо-викиди по жанрах)

Пайплайн: `$group` по `track_genre` з `$avg`/`$stdDevPop` темпу і `$push` треків жанру → `$addFields: outlier_threshold = avg + 2*stdDev` → `$filter` масиву треків за умовою `tempo > threshold` → `$match` непорожніх → `$project` форми `{genre, avg_tempo, outlier_threshold, outlier_tracks[]}`.

**Результат: 112 жанрів із викидами, загалом 3 506 треків** (≈3% — узгоджується з правилом 2σ для нормального розподілу). Приклад для `acoustic`: `avg_tempo: 119`, `outlier_threshold: 178.5`, викиди — `Breaco` (Criolo, 182.0 BPM), `Tengo Luquita` (Juanafé, 176.3 BPM)…

У консоль виводяться 3 приклади; **повний результат збережено в колекцію `spotify.tempo_outliers`** (`$merge`) — перегляд: `db.tempo_outliers.find().sort({genre: 1})`.

### Завдання 4. Треки для фонової роботи

```javascript
db.tracks.find({
  "audio_features.loudness": { $lt: -10 },
  "audio_features.speechiness": { $lt: 0.1 },
  "audio_features.instrumentalness": { $gt: 0.5 },
  explicit: false
}).sort({ popularity: -1 })
```

**Результат: 9 324 треки.** Саме цей патерн запиту оптимізовано складеним індексом у частині 3 (завдання 2).

## Додаткова аналітика (`queries/part3_analytics.js`)

Реалізує пункт 3 «Ходу роботи»: багатоетапні агрегації з `$lookup` та `$unwind` (понад обов'язкові завдання).

Повний вивід: `results/part3_analytics_output.txt` — кожен пайплайн надруковано **повністю** (`db.tracks.aggregate([...])`) перед результатом.

**3.1. Топ-жанри за середньою популярністю** (`$group` + обчислюваний `hit_rate_pct` через `$cond`): лідери — `pop-film` (59.3), `k-pop` (57.0), `chill` (53.7). Цікаво: у `pop` найбільша частка хітів (31.7%), хоча середня популярність лише 47.6 — жанр «все або нічого».

**3.2. Розподіл за popularity_tier** (`$group` + `$setWindowFields` для % від цілого):

| tier | count | share | avg popularity |
|---|---|---|---|
| high | 5 472 | 4.80% | 75.9 |
| medium | 43 115 | 37.82% | 52.0 |
| low | 65 412 | 57.38% | 17.3 |

**3.3. Лідерборд виконавців** (`$unwind` → `$group` → `$merge` у `artist_stats`, 3 527 виконавців із ≥10 треками): топ — Måneskin (83.7), Lil Nas X (83.5), ROSALÍA (77.1), Radiohead (76.7).

**3.4. `$lookup` + `$unwind`** — хіти (popularity ≥ 90) з'єднані зі статистикою виконавця з `artist_stats`. Приклад: `Unholy` (100) — Kim Petras має середню 19.1 по 16 треках: один вірусний хіт не робить виконавця стабільно популярним.

**3.5. `$bucket` по energy** — середня популярність майже не залежить від енергійності (28.9 → 35.4 → 31.8 по бакетах): гіпотеза «енергійні треки популярніші» не підтверджується; максимум у діапазоні 0.4–0.6.

## Частина 3 — Індекси та оптимізація (`queries/part3_indexes.js`)

Повний вивід: `results/part3_indexes_output.txt` (повні filter/sort кожного запиту, команди `createIndex`, ключові поля `explain("executionStats")` до/після). Методика: explain без індексу → `createIndex` → той самий explain.

### Завдання 1. Аналіз запиту та індексація

Запит з умови:

```javascript
db.tracks.find({
  track_genre: "pop",
  "audio_features.danceability": { $gte: 0.7 }
}).sort({ popularity: -1 }).toArray();
```

Створений індекс — за правилом **ESR (Equality → Sort → Range)**:

```javascript
db.tracks.createIndex(
  { track_genre: 1, popularity: -1, "audio_features.danceability": 1 },
  { name: "idx_genre_pop_dance" }
)
```

- **Equality**: `track_genre: 1` — точний збіг звужує скан до одного жанру;
- **Sort**: `popularity: -1` — індекс уже впорядкований, сервер віддає документи одразу в потрібному порядку;
- **Range**: `danceability: 1` — діапазонна умова перевіряється по ключах індексу.

**Що змінилося в плані виконання** (поля з explain):

| Поле | ДО | ПІСЛЯ |
|---|---|---|
| stages | `SORT → COLLSCAN` | `FETCH → IXSCAN` |
| executionTimeMillis | 72 | **2** |
| totalDocsExamined | 113 999 | **354** |
| totalKeysExamined | 0 | 412 |
| nReturned | 354 | 354 |

1. Було: повне сканування колекції (**COLLSCAN**, 113 999 документів) + **блокуюче сортування SORT** у пам'яті. Стає: **IXSCAN** по `idx_genre_pop_dance` + FETCH лише 354 потрібних документів.
2. **Стадія SORT зникла з плану** — сортування виконує сам індекс (порядок ключів `popularity: -1`), пам'ять на sort не витрачається.
3. `keysExamined (412) > nReturned (354)`: 58 ключів жанру `pop` відсіяно за діапазоном danceability ще на рівні індексу — документи для них не читалися.

**Як зрозуміти, що індекс використовується:** у `explain()` стадія сканування — `IXSCAN` (а не `COLLSCAN`), з'являється `keyPattern: {track_genre: 1, popularity: -1, "audio_features.danceability": 1}` та `indexName: "idx_genre_pop_dance"`; `totalKeysExamined > 0`; відсутня стадія `SORT`. Значення полів наведено в таблиці вище та у `results/part3_indexes_output.txt`.

### Завдання 2. Індекс для «музики для роботи»

```javascript
db.tracks.createIndex(
  { explicit: 1, "audio_features.instrumentalness": 1, "audio_features.speechiness": 1 },
  { name: "idx_work_music" }
)
```

Порядок полів обґрунтовано: `explicit` — умова **рівності** (`false`), тому перше (E з ESR); далі найбільш селективний діапазон `instrumentalness > 0.5`, потім `speechiness < 0.1`.

Explain запиту `{explicit: false, instrumentalness: {$gt: 0.5}, speechiness: {$lt: 0.1}}`:

| Поле | ДО | ПІСЛЯ |
|---|---|---|
| stages | `COLLSCAN` | `FETCH → IXSCAN` |
| executionTimeMillis | 124 | **37** |
| totalDocsExamined | 113 999 | **16 141** |
| totalKeysExamined | 0 | 16 602 |
| nReturned | 16 141 | 16 141 |

Індекс використовується (`IXSCAN`, `indexName: "idx_work_music"`): читання документів скоротилося у 7 разів, час — у 3.4 раза. Приріст скромніший, ніж у завданні 1, бо запит повертає 14% колекції — індекси найвигідніші для селективних запитів.

### Завдання 3 (факультативне). Чи є запит покривним?

```javascript
db.tracks.find({ track_genre: "pop", popularity: { $gte: 70 } });
// індекс: { track_genre: 1, popularity: -1, "audio_features.danceability": 1 }
```

**Відповідь: у такому вигляді — НІ, не є covered.** Обґрунтування:

1. Covered query — це коли сервер відповідає **лише з ключів індексу**, не читаючи документи (FETCH). Для цього *всі* поля, які повертаються, мають бути в індексі.
2. Запит без проєкції повертає **весь документ**: `track_name`, `artists`, `audio_features`, `duration_sec`… — жодного з цих полів в індексі немає → потрібен FETCH.
3. Навіть якби проєкція обмежувалась полями індексу, за замовчуванням повертається ще й `_id`, якого в цьому індексі немає → все одно не covered, доки не вказати `_id: 0`.

Експериментальне підтвердження (обидва explain — у `results/part3_indexes_output.txt`):

| Варіант | stages | totalDocsExamined | totalKeysExamined |
|---|---|---|---|
| А: без проєкції (як в умові) | `FETCH → IXSCAN` | **317** | 317 |
| Б: `{_id: 0, track_genre: 1, popularity: 1}` | `PROJECTION_COVERED → IXSCAN` | **0** | 317 |

Варіант Б уже **є covered**: проєкція містить лише поля індексу й виключає `_id`, стадія — `PROJECTION_COVERED`, `totalDocsExamined = 0` — жоден документ не прочитано, відповідь зібрана з 317 ключів.

### Бонус. Multikey-індекс по масиву виконавців

`db.tracks.createIndex({artists: 1}, {name: "idx_artists_multikey"})`; запит `{artists: "Bad Bunny"}`:
`COLLSCAN → FETCH → IXSCAN`, **82 → 2 мс**, docsExamined **113 999 → 416**, keysExamined 416 = nReturned — ідеальний збіг.

### Підсумкові індекси колекції tracks

| Ім'я | Ключ | Призначення |
|---|---|---|
| `idx_genre_pop_dance` | `{track_genre: 1, popularity: -1, "audio_features.danceability": 1}` | завдання 1 + covered-проєкції |
| `idx_work_music` | `{explicit: 1, "audio_features.instrumentalness": 1, "audio_features.speechiness": 1}` | завдання 2 / запит 2.4 |
| `idx_artists_multikey` | `{artists: 1}` | пошук за виконавцем (масив) |

## Якість даних: дублікати в датасеті

У `tracks` 113 999 документів, але лише **89 740 унікальних `track_id`**: датасет семплений по жанрах (~1000 треків на жанр), тож крос-жанрові треки присутні в кожному своєму жанрі (16 641 задубльованих id, 24 259 «зайвих» документів). Приклад: «Ferrari» (`4zN21mbAuaD0WqtmaTZZeP`) — 4 копії в `dance`, `deep-house`, `groove`, `house`. Це властивість вихідних даних, не помилка завантаження. Жанрові звіти коректні; глобальні метрики дещо зважені на користь крос-жанрових хітів. За потреби дублікати згортаються в масив жанрів через `$group: {_id: "$track_id", track_genre: {$addToSet: "$track_genre"}}`.

## Примітки

- Замість скріншотів у репозиторії збережено повний текстовий вивід усіх скриптів у `results/` — це відтворюваніші артефакти.
- Секрети (`.env`, `atlas-credentials.env`) та датасет (`dataset.csv`) свідомо не комітяться (див. `.gitignore`).
- Скрипти ідемпотентні: повторний запуск дропає цільові колекції/індекси й відтворює результат.
