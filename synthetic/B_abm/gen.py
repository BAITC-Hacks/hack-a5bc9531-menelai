"""Метод B: стохастическая агентная модель мира, по дням 1.06–15.08.2026.

uv run --project ../../pipeline python gen.py [--seed 7]  →  world_tx.csv, world_actors.csv
Все параметры — случайные в широких диапазонах; seed фиксирует мир целиком.
"""
import argparse
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("--seed", type=int, default=7)
R = np.random.default_rng(ap.parse_args().seed)
D0, ND = date(2026, 6, 1), 76                      # 1 июня … 15 августа
WDAY = [(D0 + timedelta(d)).weekday() for d in range(ND)]
MDAY = [(D0 + timedelta(d)).day for d in range(ND)]
WF = [1.0, 0.95, 0.95, 1.0, 1.15, 1.3, 0.85]         # ритм недели (Пн…Вс)

ACT, CLIENT, BIAS, ROUT, TX, Q = {}, {}, {}, {}, [], {}
U = lambda a, b: float(R.uniform(a, b))
I = lambda a, b: int(R.integers(a, b + 1))
pick = lambda xs: xs[int(R.integers(len(xs)))]


def actor(h, role, inv, arch, note, known=False, client=True, force=False):
    old = ACT.get(h)   # криминальная и «ролевая» легальная разметка не затирается бытовой
    if force or old is None or (old[1] == "legit" and (old[0] == "peripheral" or role != "peripheral")):
        ACT[h] = [role, inv, known, arch, note]
    CLIENT.setdefault(h, client)
    return h


def money(med, sig=0.6, rp=0.5, unit=1000):
    """Логнормальная сумма: с вероятностью rp «круглая», иначе «рваная» (иногда с тиынами)."""
    x = med * np.exp(sig * R.standard_normal())
    if R.random() < rp:
        return float(max(unit, round(x / unit) * unit))
    return round(x, 2) if R.random() < 0.12 else float(round(x))


def later(d, fn):
    Q.setdefault(d, []).append(fn)


def pay(d, s, t, a, ch=None):
    if a < 1 or s == t:
        return
    if ch is None:   # внутри банка, только если оба клиенты; часть людей платит с карт других банков
        ch = "intra" if CLIENT.get(s) and CLIENT.get(t) and R.random() < BIAS.get(s, 0.92) else "inter"
    TX.append((s, t, d, round(a, 2), ch))
    if t in ROUT:
        ROUT[t]["bal"] += a
    if R.random() < 0.0015:   # ошибочный перевод — возврат через 0–2 дня
        later(d + I(0, 2), lambda dd, s=s, t=t, a=a, ch=ch: TX.append((t, s, dd, round(a, 2), ch)))


# ---------- маршрутизатор: копит баланс и с вероятностью p в день «сметает» его дальше ----------
def router(h, targets, w=None, split=False, p=0.5, keep=(0, 0), thr=10000, rp=0.3, unit=1000, lim=2e6, days=None):
    w = np.ones(len(targets)) if w is None else np.asarray(w, float)
    ROUT[h] = dict(bal=0.0, t=targets, w=w / w.sum(), split=split, p=p, keep=keep, thr=thr, rp=rp, unit=unit,
                   lim=lim, days=days)


def rnd(x, r):
    return float(max(r["unit"], x // r["unit"] * r["unit"])) if R.random() < r["rp"] else round(x, 2 if R.random() < .1 else 0)


def send(d, s, t, a, r):
    if isinstance(t, list):   # веер: часть получателей в эту неделю пропущена
        k = [x for x in t if R.random() > 0.12] or t
        for x, q in zip(k, R.dirichlet(np.full(len(k), 2.5))):
            pay(d, s, x, rnd(a * q, r))
        return
    while a > r["lim"]:       # дробление крупных сумм
        part = r["lim"] * U(.4, 1)
        pay(d, s, t, rnd(part, r))
        a -= part
    pay(d, s, t, rnd(a, r))


def sweep(d, h, r):
    if r["bal"] < r["thr"] or (r["days"] and WDAY[d] not in r["days"]) or R.random() > r["p"]:
        return
    out, r["bal"] = r["bal"] * (1 - U(*r["keep"])), 0.0      # удержанное уходит «на жизнь»
    if r["split"]:
        for t, q in zip(r["t"], r["w"]):
            send(d, h, t, out * q * U(.8, 1.2), r)
    else:
        send(d, h, r["t"][R.choice(len(r["t"]), p=r["w"])], out, r)


# ---------- население: районы, семьи, друзья ----------
NP = I(7000, 9500)
P = [f"p{i:05d}" for i in range(NP)]
for h in P:
    CLIENT[h] = R.random() < 0.6
cuts = np.cumsum(R.integers(90, 260, NP // 90))
bounds = np.r_[0, cuts[cuts < NP], NP]
dist = np.searchsorted(bounds, np.arange(NP), side="right") - 1


def near(i, p=0.8):
    b = dist[i]
    return I(bounds[b], bounds[b + 1] - 1) if R.random() < p else I(0, NP - 1)


fam, i = [[] for _ in range(NP)], 0
while i < NP:
    g = list(range(i, min(NP, i + I(1, 6))))
    for j in g:
        fam[j] = [k for k in g if k != j]
    i += len(g)
for j in range(NP):
    if R.random() < 0.3:                                  # родня в другом районе
        k = I(0, NP - 1)
        fam[j].append(k), fam[k].append(j)
fr = [[near(j) for _ in range(I(1, 6))] for j in range(NP)]
free = iter(R.permutation(NP).tolist())                   # пул людей для «работ» без повторов
take = lambda n: [next(free) for _ in range(n)]

# ---------- легальная экономика ----------
shops, sh_by_d = [], {}
for k in range(NP // 110):
    h = actor(f"shop_{k}", "consolidator", "legit", pick(["магазин", "кафе", "донерная", "аптека"]),
              "принимает оплату от покупателей района")
    dd = int(R.integers(dist.max() + 1))
    sh_by_d.setdefault(dd, []).append(h)
    shops.append(dict(h=h, staff=take(I(1, 4)), owner=take(1)[0], wd=I(0, 5), rent=money(250000, .4, .9, 10000),
                      scale=U(.4, 2.5)))
SUP = [actor(f"sup_{k}", "consolidator", "legit", "оптовый поставщик", "поставки магазинам района") for k in range(I(2, 4))]
my_shops = [(sh_by_d.get(dist[j], []) + [pick(shops)["h"] for _ in range(I(1, 2))])[:I(2, 4)] for j in range(NP)]

emps = []
for k in range(I(9, 16)):
    n = int(np.clip(np.exp(R.normal(3.0, 0.9)), 5, 130))
    emps.append(dict(h=actor(f"emp_{k}", "distributor", "legit", "работодатель",
                             pick(["стройфирма", "автосервис", "цех", "склад"]) + f": платит зарплату {n} сотрудникам"), wk=take(n), owner=take(1)[0], adv=I(14, 20), sal=I(1, 7)))
big = max(emps, key=lambda e: len(e["wk"]))
if len(big["wk"]) < 60:                                   # хотя бы один легальный веер 60+
    big["wk"] += take(I(60, 120) - len(big["wk"]))
    ACT[big["h"]][4] = f"стройфирма: платит зарплату {len(big['wk'])} сотрудникам"
salary = {j: money(230000, .4, .6, 5000) for e in emps for j in e["wk"]}

brigs = []
for k in range(I(4, 9)):
    h, crew = actor(f"p{take(1)[0]:05d}", "distributor", "legit", "бригадир", "получает за объект и раздаёт бригаде"), take(I(5, 25))
    CLIENT[h] = True
    router(h, [[P[j] for j in crew]], p=0.7, keep=(.05, .2), thr=60000, rp=.7)
    brigs.append(h)

taxis = []
for k in range(I(1, 2)):
    h = actor(f"taxi_{k}", "coordinator", "legit", "таксопарк", "берёт аренду машин у водителей и платит им выручку")
    taxis.append(dict(h=h, dr=take(I(15, 50)), fee={}))
drivers = [j for t in taxis for j in t["dr"]] + take(I(20, 50))
TERMB = [actor(f"hall_{k}", "terminal", "legit", "тойхана", "предоплаты за банкеты") for k in range(I(2, 3))]
CARS = [actor(f"car_{k}", "terminal", "legit", "перекуп авто", "продаёт подержанные авто") for k in range(2)] + \
       [actor("realty_0", "terminal", "legit", "агентство недвижимости", "задатки за квартиры")]
PAWN = actor("pawn_0", "distributor", "legit", "ломбард", "выдаёт займы под залог и принимает выкуп")

renters = np.nonzero(R.random(NP) < 0.3)[0]
lords = R.choice(NP, max(1, len(renters) // 3), replace=False)
lw = R.pareto(1.5, len(lords)) + 1
lord_of = {j: P[lords[R.choice(len(lords), p=lw / lw.sum())]] for j in renters}
rent = {j: money(130000, .35, .9, 5000) for j in renters}
rday = {j: I(1, 10) for j in renters}

# ---------- преступная сеть ----------
W = actor(f"p{take(1)[0]:05d}", "consolidator", "criminal", "оптовик", "получает оплату за товар от нескольких ячеек", force=True)
WT = actor(f"p{take(1)[0]:05d}", "terminal", "criminal", "бенефициар оптовика", "кошелёк оптовика: наличные и авто", force=True)
router(W, ["ext_abroad", WT], [.85, .15], p=.2, thr=300000, rp=.6, unit=10000, lim=3e6)
router(WT, ["ext_cash"] + CARS, [.7, .1, .1, .1], p=.12, thr=500000, rp=.8, unit=10000, lim=5e6)
LS = actor(f"p{take(1)[0]:05d}", "coordinator", "criminal", "ростовщик", "даёт займы курьерам и собирает возвраты с процентом", force=True)
p2p = []
for k in range(I(2, 4)):
    inv = "criminal" if k == 0 or R.random() < .5 else "legit"
    h = actor(f"p{take(1)[0]:05d}", "transit", inv, "P2P-трейдер",
              "меняет тенге на крипту; клиенты смешанные" + (" включая сборщиков" if inv == "criminal" else ""), force=True)
    cl = [P[j] for j in R.choice(NP, I(30, 90), replace=False)]
    router(h, [cl] if R.random() < .3 else cl, p=.6, keep=(.005, .02), thr=30000, rp=.2)
    p2p.append(dict(h=h, cl=cl, inv=inv))
crypto = {c: t["h"] for t in p2p for c in t["cl"] if R.random() < .5}

cells, orgs = [], []
n_cells = I(4, 9)
for o in range(I(1, max(1, n_cells // 2))):
    O = actor(f"p{take(1)[0]:05d}", "coordinator", "criminal", "организатор", "собирает с ячеек и раздаёт: опт, бенефициары, зарплаты", force=True)
    T = [actor(f"p{take(1)[0]:05d}", "terminal", "criminal", pick(["бенефициар", "вывод наличных", "кошелёк"]),
               "деньги оседают: наличные, авто, недвижимость", force=True) for _ in range(I(1, 3))]
    for t in T:
        router(t, ["ext_cash"] + CARS + [PAWN, P[pick(fam[int(t[1:])] or [0])]], [.55, .1, .1, .1, .05, .1], p=.15, thr=300000, rp=.7, unit=10000)
    orgs.append(dict(O=O, T=T, fund=[]))
for c in range(n_cells):
    org = orgs[c % len(orgs)] if c < len(orgs) else pick(orgs)
    n = int(np.clip(np.exp(R.normal(2.8, 0.8)), 4, 110))
    cour = [f"p{j:05d}" for j in take(n)]
    f_sell = U(0, .6)
    sellers = [h for h in cour if R.random() < f_sell]
    drops = [f"p{j:05d}" for j in take(I(0, max(1, n // 5)))]
    cols = [f"p{j:05d}" for j in take(1 + (n > 20) + (n > 50))]
    coord = f"p{take(1)[0]:05d}" if R.random() < .6 else None
    pr = [f"p{j:05d}" for j in take(0 if R.random() < .25 else 1 + (n > 60))]
    up = coord or org["O"]
    crp = [t["h"] for t in p2p if t["inv"] == "criminal"]
    for h in cols:
        actor(h, "consolidator", "criminal", "сборщик", f"ячейка {c}: собирает выручку с {len(drops) or len(sellers)} карт", force=True)
        router(h, [up, org["O"]] + crp, [.8, .1 if coord else 0] + [.1 / len(crp)] * len(crp),
               p=U(.25, .5), keep=(.01, .04), thr=80000, rp=.6, unit=10000, lim=U(.8e6, 2e6))
    for h in drops:
        leak = R.random() < .35
        actor(h, "transit", "criminal", "дроп-карта" + (" (удерживает комиссию)" if leak else ""),
              f"ячейка {c}: принимает оплату и пересылает сборщику", force=True)
        router(h, cols, p=U(.5, .9), keep=(.05, .15) if leak else (.01, .03), thr=8000, rp=.1, lim=U(3e5, 8e5))
    for h in cour:
        if h in sellers:
            actor(h, "transit", "criminal", "курьер-приёмщик", f"ячейка {c}: берёт оплату от покупателей и сдаёт выше", force=True)
            router(h, drops or cols, p=U(.3, .7), keep=(.05, .25), thr=20000, rp=.5)
        else:
            actor(h, "peripheral", "criminal", "закладчик", f"ячейка {c}: делает клады и получает оплату", force=True)
    fan = [cour + (pick(cells)["cour"][:I(3, 15)] if cells and R.random() < .25 else [])]
    for h in pr:
        actor(h, "distributor", "criminal", "распределитель-зарплатчик", f"ячейка {c}: платит курьерам раз в неделю", force=True)
        router(h, fan, p=.9, keep=(.02, .08), thr=50000, rp=.5, unit=500, days={I(0, 6), I(0, 6)})
    pay_t = pr or fan   # без зарплатчика курьерам платит координатор/организатор напрямую
    if coord:
        actor(coord, "coordinator", "criminal", "координатор ячейки", f"ячейка {c}: собирает со сборщиков и платит курьерам и выше", force=True)
        router(coord, pay_t + [org["O"], pick(org["T"])], [.4 / len(pay_t)] * len(pay_t) + [.45, .15], split=True,
               p=.3, thr=150000, rp=.7, unit=5000, lim=1.5e6)
    else:
        org["fund"] += pay_t
    cells.append(dict(cour=cour, sellers=sellers, drops=drops, cols=cols, recv=sellers + drops or cols,
                      lam=n * U(.5, 1.6), org=org))
others = [o["O"] for o in orgs]
for org in orgs:   # организатор: опт, бенефициары, ростовщик, зарплаты ячеек без координатора, связь с другими
    t = [W, WT] + org["T"] + [LS] + org["fund"] + [x for x in others if x != org["O"]][:1]
    w = [.42, .03] + [.25 / len(org["T"])] * len(org["T"]) + [.05] + [.3 / max(1, len(org["fund"]))] * len(org["fund"]) + \
        ([.05] if len(others) > 1 else [])
    router(org["O"], t, w, split=True, p=.2, thr=300000, rp=.7, unit=10000, lim=2.5e6)
router(LS, [orgs[0]["O"]], p=.03, thr=800000, rp=.8, unit=10000)

# seed: курьеры и дропы, известные правоохранителям; часть «тихих» — почти всё через другие банки
cand = [h for c in cells for h in c["cour"] + c["drops"]]
wts = np.array([.35 if ACT[h][3].startswith("дроп") else 1.0 for h in cand]) * R.uniform(.3, 1, len(cand))
K = min(len(cand), I(60, 110))
for h in R.choice(cand, K, replace=False, p=wts / wts.sum()):
    ACT[h][2] = True
    CLIENT[h] = True
    if R.random() < .35:
        BIAS[h] = U(0, .05)
for c in cells:
    for h in c["cour"] + c["drops"] + c["cols"]:
        CLIENT[h] = True
crim = [h for h, a in ACT.items() if a[1] == "criminal"]
for h in crim:
    CLIENT[h] = True
for h in crim:   # родня участников — легальная, помечена
    for k in fam[int(h[1:])]:
        actor(P[k], "peripheral", "legit", "родня", f"родственник {h}: переводы туда-обратно")

# легальные метки людей
for e in emps:
    actor(P[e["owner"]], "peripheral", "legit", "владелец бизнеса", f"владелец {e['h']}")
    for j in e["wk"]:
        actor(P[j], "peripheral", "legit", "рабочий", f"зарплата от {e['h']}")
for s in shops:
    actor(P[s["owner"]], "peripheral", "legit", "владелец бизнеса", f"владелец {s['h']}")
    for j in s["staff"]:
        actor(P[j], "peripheral", "legit", "продавец", f"работает в {s['h']}")
for t in taxis:
    for j in t["dr"]:
        t["fee"][j] = money(7000, .15, .9, 500)
        actor(P[j], "peripheral", "legit", "таксист", f"арендует авто в {t['h']}")
for j in lords:
    n = sum(1 for v in lord_of.values() if v == P[j])
    if n:
        actor(P[j], "consolidator" if n >= 4 else "peripheral", "legit", "арендодатель", f"сдаёт {n} квартир(ы)")
for h in crypto:
    actor(h, "peripheral", "legit", "клиент P2P", f"покупает/продаёт крипту у {crypto[h]}")


# ---------- шаг дня ----------
def life(d):
    wf = WF[WDAY[d]]
    for j in np.nonzero(R.random(NP) < .2 * wf)[0]:                      # магазины: в основном < 5 000
        pay(d, P[j], pick(my_shops[j]), money(3200, .8, .25, 100))
    for j in np.nonzero(R.random(NP) < .04 * wf)[0]:                     # такси
        pay(d, P[j], P[pick(drivers)], money(2300, .55, .2, 100))
    for j in np.nonzero(R.random(NP) < .09)[0]:                          # семья туда-обратно
        if fam[j]:
            pay(d, P[j], P[pick(fam[j])], money(12000, .9, .8, 1000))
    for j in np.nonzero(R.random(NP) < .02)[0]:                          # долг другу с возвратом
        f, a = fr[j][int(R.integers(len(fr[j])))], money(20000, .7, .85, 5000)
        pay(d, P[j], P[f], a)
        if R.random() < .75:
            later(d + I(3, 30), lambda dd, f=f, j=j, a=a: pay(dd, P[f], P[j], a))
    for j in np.nonzero(R.random(NP) < .0012)[0]:                        # ремонт / стройка
        pay(d, P[j], pick(brigs + [e["h"] for e in emps]), money(150000, .8, .8, 5000))
    for j in np.nonzero(R.random(NP) < .0006)[0]:                        # ломбард: займ под залог и выкуп
        a = money(40000, .6, .9, 1000)
        pay(d, PAWN, P[j], a)
        if R.random() < .7:
            later(d + I(7, 30), lambda dd, j=j, a=a: pay(dd, P[j], PAWN, a * U(1.05, 1.2)))
    for j in renters:
        if MDAY[d] == rday[j]:
            dd = d + (I(1, 5) if R.random() < .1 else 0)
            parts = [.5, .5] if R.random() < .15 else [1]
            for q, x in enumerate(parts):
                later(dd + q, lambda z, j=j, x=x: pay(z, P[j], lord_of[j], rent[j] * x))
    for j in np.nonzero(R.random(NP) < .0004)[0]:                        # задаток за авто/квартиру
        pay(d, P[j], pick(CARS), money(600000, .8, .9, 50000))
    for h, t in crypto.items():
        if R.random() < .04:
            pay(d, h, t, money(80000, .8, .6, 5000))
    for _ in range(R.poisson(NP / 3000)):                                # той: складчина и предоплата тойхане
        o = I(0, NP - 1)
        actor(P[o], "consolidator", "legit", "организатор тоя", "собирает складчину и платит тойхане")
        tot = 0
        for k in set(fr[o] + fam[o] + [near(o) for _ in range(I(5, 20))]):
            a = money(10000, .4, .9, 5000)
            tot += a
            later(d + I(0, 4), lambda dd, k=k, a=a: pay(dd, P[k], P[o], a))
        later(d + I(5, 8), lambda dd, o=o, tot=tot: pay(dd, P[o], pick(TERMB), tot * U(.6, 1)))


def business(d):
    wd, md = WDAY[d], MDAY[d]
    for s in shops:
        if wd == s["wd"]:
            pay(d, s["h"], pick(SUP), money(220000 * s["scale"], .5, .3))
        if md in (10, 25):
            for j in s["staff"]:
                pay(d, s["h"], P[j], money(150000, .2, .7, 5000))
        if md == 5:
            pay(d, s["h"], P[pick(lords)], s["rent"])
        if R.random() < .2:
            pay(d, s["h"], P[s["owner"]], money(40000, .6, .7))
    for h in SUP + TERMB + CARS:
        if wd == 4:
            pay(d, h, "ext_producer", money(3e6, .6, .5, 10000))
    for e in emps:
        if R.random() < .01:
            pay(d, P[e["owner"]], e["h"], money(300000, .7, .9, 10000))
        for day, adv in ((e["adv"], True), (e["sal"], False)):
            if md == day:
                dd = d + (7 - wd if wd >= 5 else 0)   # выходные → понедельник
                for j in e["wk"]:
                    if R.random() > .03:
                        a = round(salary[j] * .4, -3) if adv else salary[j] * .9 - round(salary[j] * .4, -3)
                        later(dd, lambda z, h=e["h"], j=j, a=a: pay(z, h, P[j], a))
        if wd == 2 and R.random() < .4:
            pay(d, e["h"], pick(brigs), money(400000, .6, .8, 10000))
    for t in taxis:
        for j in t["dr"]:
            if R.random() < .75 * WF[wd]:
                pay(d, P[j], t["h"], t["fee"][j])
            if wd == 0:
                pay(d, t["h"], P[j], money(55000, .5, .3, 100))
    for h, tr in ((c["h"], c) for c in p2p):
        if R.random() < .15:   # продавцы крипты тоже приходят без баланса
            pay(d, h, pick(tr["cl"]), money(70000, .8, .5, 5000))


def crime(d):
    wf = WF[WDAY[d]] ** 1.5
    for c in cells:   # покупатели платят извне на карты приёмщиков/дропов
        for _ in range(R.poisson(c["lam"] * wf)):
            pay(d, "ext_buyer", pick(c["recv"]), money(14000, .45, .75, 500), "inter")
    if R.random() < .2:   # ростовщик: займ курьеру, возврат с процентом (иногда частями, иногда нет)
        h, a = pick(pick(cells)["cour"]), money(60000, .6, .9, 10000)
        pay(d, LS, h, a)
        if R.random() < .85:
            n = I(1, 2)
            for q in range(n):
                later(d + I(7, 25) + q * 3, lambda dd, h=h, a=a, n=n: pay(dd, h, LS, a * U(1.1, 1.25) / n))


for d in range(ND):
    for fn in Q.pop(d, []):
        fn(d)
    crime(d)
    for h, r in list(ROUT.items()):
        sweep(d, h, r)
    life(d)
    business(d)
for d in sorted(Q):   # хвосты за пределами окна
    for fn in Q[d]:
        fn(d)

out = Path(__file__).parent
tx = pd.DataFrame(TX, columns=["src", "dst", "d", "amount", "channel"])
tx.insert(2, "date", [(D0 + timedelta(int(x))).isoformat() for x in tx.pop("d")])
tx.to_csv(out / "world_tx.csv", index=False)
for j, h in enumerate(P):
    if h not in ACT:
        actor(h, "peripheral", "legit", "житель", "обычная жизнь: семья, магазины, долги друзьям")
ac = pd.DataFrame([[h, *a] for h, a in ACT.items()], columns=["handle", "functional_role", "involvement", "is_known", "archetype", "note"])
ac.to_csv(out / "world_actors.csv", index=False)
print(f"мир: людей {NP}, ячеек {n_cells}, организаций {len(orgs)}, переводов {len(tx)}, seed {int(ac.is_known.sum())}")
