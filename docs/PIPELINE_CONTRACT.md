# Контракт: pipeline → out/ → server

Python (`pipeline/run.py`) считает всё и пишет CSV в `out/`. Bun-сервер только читает `out/` и `task/data/*.parquet` и отдаёт JSON. Фронт ходит только в `/api`.

Одна команда полного пересчёта:

```bash
python3 pipeline/run.py --data task/data --out out
```

`out/` коммитится: это и есть «мок» для фронта.

## Общие правила

- gid в CSV пишется как целое без экспоненты; сервер читает его как строку и никогда не делает `Number()`.
- Булевы поля: `true`/`false` (строчными).
- Даты: `YYYY-MM-DD`. Пустое значение = пустая строка.
- Числа с плавающей точкой: без округления до тысяч, `pagerank`/`betweenness` можно с 8 знаками.
- Все файлы UTF-8, разделитель запятая, первая строка — заголовок.

## Файлы

### `out/nodes_roles.csv` — ровно 2 248 строк (обязательный по ТЗ)

| колонка | тип | смысл |
|---|---|---|
| gid | int | идентификатор |
| role | str | `consolidator, transit, distributor, terminal, coordinator, peripheral` |
| role_score | float 0–1 | уверенность |
| cluster_id | int | из кластеризации; узлы без рёбер получают свой отдельный id |
| priority_score | float 0–1 | приоритет |
| evidence | str ≤ 200 | обоснование с числами |
| role_rule | str | id правила, которое сработало (доп. колонка) |

### `out/clusters.csv` (обязательный по ТЗ)

`cluster_id, n_nodes, n_seed, sum_kzt_internal, top_gids, hypothesis`

- `top_gids` — до 5 gid через `;`, отсортированы по priority_score.
- `sum_kzt_internal` — сумма рёбер, у которых оба конца в кластере.

### `out/top_nodes.csv` — ≥ 20 строк (обязательный по ТЗ)

`rank, gid, role, priority_score, why`

### `out/node_metrics.csv` — 2 248 строк, промежуточный слой

Все метрики, на которые ссылаются правила и evidence.

| колонка | тип |
|---|---|
| gid | int |
| depth | int |
| is_seed | bool |
| in_deg, out_deg | int, уникальные контрагенты |
| in_kzt, out_kzt | float |
| in_tx, out_tx | int |
| n_counterparties | int, уникальные в обе стороны |
| first_date, last_date | date, по transactions, как src или dst |
| active_days | int |
| pass_through | float, `out_kzt / in_kzt`, пусто если in_kzt = 0 |
| truncated_by_depth | bool, depth = 4 и out_deg = 0 |
| real_sink | bool, depth < 4, не seed, out_deg = 0 |
| no_edges | bool, нет ни одного ребра |
| pagerank | float, взвешенный по sum_kzt |
| betweenness | float |
| component | int, слабосвязная компонента, 0 = крупнейшая |
| component_size | int |
| in_cycle | bool, входит в цикл длиной ≤ 5 |
| same_day_bursts | int, число пар (контрагент, день) с 2+ переводами, где узел — src или dst |
| avg_in_tx, avg_out_tx | float, средний перевод |
| seed_money_in | float, KZT, оценка денег, пришедших от seed по цепочке |
| seed_share | float 0–1 |
| cluster_id | int, тот же, что в nodes_roles.csv |

### `out/edge_metrics.csv` — 3 119 строк

`src, dst, sum_kzt, n_tx, depth, src_depth, dst_depth, min_tx, max_tx, first_date, last_date, active_days, mutual, back_edge`

- `mutual` — есть обратное ребро dst→src.
- `back_edge` — `dst_depth <= src_depth`.

## API сервера (читает out/)

| маршрут | отдаёт |
|---|---|
| `GET /api/stats` | как сейчас |
| `GET /api/graph` | `{ nodes: GraphNode[], edges: Edge[] }`, GraphNode = nodes.parquet + `role, roleScore, clusterId, priorityScore, inKzt, outKzt, inDeg, outDeg` |
| `GET /api/nodes/:gid` | `{ node: GraphNode, metrics: NodeMetrics, role: { role, roleScore, roleRule, evidence, priorityScore }, in: Edge[], out: Edge[], daily: { date, inKzt, outKzt, inTx, outTx }[] }` |
| `GET /api/top` | строки top_nodes.csv |
| `GET /api/clusters` | строки clusters.csv |
| `GET /api/clusters/:id` | строка clusters.csv + `members: GraphNode[]` |

Имена полей в JSON — camelCase, в CSV — snake_case.
