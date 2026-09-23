# Граф денег

Инструмент для AML-аналитика: по выгрузке исходящих переводов 81 известного клиента на 4 колена (2 248 узлов) восстанавливает структуру финансовой сети и отвечает на вопрос «кого из этих клиентов смотреть первым и почему».

> Кейс HackAlem AI «Граф денег: восстановление финансовой структуры организованной группы по транзакционной сети». Требования к README — в [docs/README_REQUIREMENTS.md](docs/README_REQUIREMENTS.md).

## Статус

Каркас проекта. Сейчас реализовано:
- сервер читает три `.parquet` и отдаёт граф по HTTP API;
- клиент показывает сводную статистику по данным.

Роли, кластеры, приоритеты, CSV-выгрузки и схема сети — в работе.

## Как работает решение

_Будет описано после реализации пайплайна:_ `.parquet` → граф → метрики → роли и кластеры → приоритет → `nodes_roles.csv`, `clusters.csv`, `top_nodes.csv` + экран просмотра.

## Технологии

| Часть | Стек |
|---|---|
| Сервер | Bun, Hono, hyparquet (чтение parquet, ZSTD через встроенный `Bun.zstdDecompressSync`) |
| Клиент | Vite, React 19, React Router 8, TypeScript, Tailwind CSS v4, shadcn/ui (Base UI) |
| Монорепо | bun workspaces: `client/`, `server/` |

## Архитектура

```
task/data/*.parquet ──► server/ (Bun + Hono, :3001) ──/api──► client/ (Vite + React, :5173)
```

```
server/src/
  index.ts        точка входа Bun (порт 3001, env PORT)
  app.ts          Hono-приложение: /api + JSON-обработчики 404/500
  routes/index.ts все маршруты API в одном месте, экспорт AppType для Hono RPC
  routes/*.ts     health, stats, graph, transactions, nodes, top, clusters
  data/load.ts    загрузка parquet один раз при старте (env DATA_DIR)
  data/out.ts     чтение out/*.csv пайплайна один раз при старте (env OUT_DIR)
  data/types.ts   типы parquet и out/*.csv

client/src/
  router.tsx      таблица маршрутов (React Router, createBrowserRouter)
  layouts/        общий каркас: навигация и поиск по gid
  pages/          Обзор, Схема сети, Узел, Топ приоритетов, Кластеры, 404
  lib/api.ts      типизированные запросы к /api
```

- gid везде хранятся строками: значения вида `100000003684369100` больше `Number.MAX_SAFE_INTEGER`.
- В режиме разработки Vite проксирует `/api` на `:3001`.

### Страницы

| Путь | Что показывает |
|---|---|
| `/` | сводная статистика по данным |
| `/nodes/:gid` | узел: колено, seed, число входящих и исходящих связей |
| `/graph`, `/top`, `/clusters` | заглушки, в работе |

### API

| Метод | Ответ |
|---|---|
| `GET /api/health` | `{ ok: true }` |
| `GET /api/stats` | число узлов, рёбер, транзакций, seed, общий оборот |
| `GET /api/graph` | `{ nodes, edges }`; узлы дополнены `role, roleScore, clusterId, priorityScore, inKzt, outKzt, inDeg, outDeg` |
| `GET /api/transactions` | все транзакции с датами |
| `GET /api/nodes/:gid` | `{ node, metrics, role, in, out, daily }`: узел, метрики из `node_metrics.csv`, роль с evidence, рёбра, обороты по дням; 404 для неизвестного gid |
| `GET /api/top` | строки `top_nodes.csv` |
| `GET /api/clusters` | строки `clusters.csv` (`topGids` — массив) |
| `GET /api/clusters/:id` | строка `clusters.csv` + `members`; 404 для неизвестного id |

## Установка и запуск

Нужен [Bun](https://bun.sh) ≥ 1.4.

```bash
bun install
bun run dev
```

Клиент: http://localhost:5173, API: http://localhost:3001. Путь к данным по умолчанию — `task/data`, переопределяется переменной `DATA_DIR`. Сервер также читает CSV пайплайна из `out/` (переменная `OUT_DIR`) и не стартует без них; формат — [docs/PIPELINE_CONTRACT.md](docs/PIPELINE_CONTRACT.md).

## Как проверить

```bash
curl localhost:3001/api/stats
# {"nodes":2248,"edges":3119,"transactions":4840,"seeds":81,"totalKzt":365890012.01...}

curl localhost:3001/api/nodes/100000003684369100
# seed-клиент: 24 входящих ребра, 62 исходящих
```

## Данные и интеграции

Датасет организаторов (обезличенный), папка `task/data/`:
- `edges.parquet` — 3 119 пар плательщик → получатель, агрегировано за июль 2026;
- `nodes.parquet` — 2 248 клиентов, колено обхода, признак seed;
- `transactions.parquet` — 4 840 отдельных переводов с датами.

Описание полей — `task/README.md`. Внешние сервисы и API не используются.

## Ограничения

- Реализован только каркас: ролей, кластеров, приоритетов и выгрузок пока нет.
- Особенности данных, которые пайплайн должен учитывать: обрыв обхода на 4-м колене (444 узла без исходящих — артефакт выгрузки), заниженные входящие у seed, порог 5 000 ₸, только исходящие и только внутрибанковские переводы.

## Deployed-версия

https://graf-deneg-production.up.railway.app — один сервис Railway: `bun run build` собирает клиент, `bun run start` запускает сервер, который отдаёт `/api` и `client/dist`. Деплой из локальной копии: `railway up --service graf-deneg` (репозиторий организации не подключён к Railway, автодеплоя по push нет).
