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
│   ├── part2_output.txt
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

Практичний ефект підтверджено у `part3_indexes.js`: запит `{artists: "Bad Bunny"}` з multikey-індексом виконується за **2 мс проти 89 мс** і читає **416 документів замість 113 999**.

## Частина 2 — Запити (`queries/part2_queries.js`)

Повний вивід: `results/part2_output.txt`.

| # | Запит | Оператори | Результат |
|---|---|---|---|
| 2.1 | Енергійні танцювальні треки | dot notation, `$gt` по вкладених полях | 7 066 |
| 2.2 | tempo 120–140, popularity ≥ 60, 180–240 с | `$gte`/`$lte` (діапазони) | 1 741 |
| 2.3 | Треки за участю Bad Bunny | збіг елемента масиву | 416 |
| 2.4 | Спільні роботи Daddy Yankee + Bad Bunny | `$all` | 88 |
| 2.5 | Сольні / з 3+ виконавцями | `$size`, `$expr` | 83 924 / 8 963 |
| 2.6 | Bruno Mars або Silk Sonic | `$in` | 90 |
| 2.7 | popular explicit OR instrumental | `$or`, `$and`, `$gt` | 19 727 |
| 2.8 | Назва на "love", valence > 0.7 | `$regex`, `$gt` | 143 |
| 2.9 | high tier, не explicit, не pop/k-pop | `$ne`, `$nin` | 4 103 |

## Частина 3 — Аналітика (`queries/part3_analytics.js`)

Повний вивід: `results/part3_analytics_output.txt`.

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

## Частина 3 — Індекси та explain() (`queries/part3_indexes.js`)

Повний вивід: `results/part3_indexes_output.txt`. Методика: `explain("executionStats")` до індексу → `createIndex` → той самий explain після.

Створені індекси:
- `idx_genre_popularity` — `{track_genre: 1, popularity: -1}` (compound, підтримує і фільтр, і сортування)
- `idx_artists_multikey` — `{artists: 1}` (multikey по масиву)
- `idx_energy_danceability` — `{"audio_features.energy": 1, "audio_features.danceability": 1}` (compound по вкладених полях)

| Запит | План | Час, мс | docsExamined | keysExamined | nReturned |
|---|---|---|---|---|---|
| A: `genre='pop' ∧ popularity≥70`, sort | COLLSCAN → IXSCAN | **81 → 1** | 113 999 → 317 | 0 → 317 | 317 |
| B: `artists='Bad Bunny'` | COLLSCAN → IXSCAN | **89 → 2** | 113 999 → 416 | 0 → 416 | 416 |
| C: `energy>0.9 ∧ danceability>0.8` | COLLSCAN → IXSCAN | **88 → 4** | 113 999 → 427 | 0 → 527 | 427 |

Висновки:
- Ефект доведено об'єктивно: **~40–90× швидше**, замість 113 999 документів читається лише потрібні (~360× менше I/O).
- Для запиту A `keysExamined == nReturned` — compound-індекс ідеальний: рівність по `track_genre` + діапазон і сортування по `popularity` (правило ESR: Equality → Sort → Range).
- Для C `keysExamined (527) > nReturned (427)` — друге поле compound-індексу після range-умови не може звузити скан ідеально, але це все одно на 2 порядки краще за COLLSCAN.

## Примітки

- Замість скріншотів у репозиторії збережено повний текстовий вивід усіх скриптів у `results/` — це відтворюваніші артефакти.
- Секрети (`.env`, `atlas-credentials.env`) та датасет (`dataset.csv`) свідомо не комітяться (див. `.gitignore`).
- Скрипти ідемпотентні: повторний запуск дропає цільові колекції/індекси й відтворює результат.
