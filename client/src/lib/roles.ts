import type { Role } from '@/lib/api'

/** Role vocabulary: Russian label, hypothesis phrase, one-line rule (mirrors pipeline/RULES.md §1). */
export const ROLE: Record<Role, { label: string; sign: string; rule: string; color: string }> = {
  coordinator: {
    label: 'Координатор',
    sign: 'признаки координации',
    rule: 'и собирает, и раздаёт; посредничество ≥ p95; связь с ≥ 2 seed или цикл',
    color: 'var(--role-coordinator)',
  },
  consolidator: {
    label: 'Консолидатор',
    sign: 'признаки консолидации',
    rule: '≥ 3 плательщика, дальше уходит < 30 %, вход ≥ 200 тыс. ₸',
    color: 'var(--role-consolidator)',
  },
  distributor: {
    label: 'Распределитель',
    sign: 'признаки веерной раздачи',
    rule: '≥ 15 получателей и получателей ≥ 3 × плательщиков',
    color: 'var(--role-distributor)',
  },
  transit: {
    label: 'Транзит',
    sign: 'признаки транзита',
    rule: 'пропускает 80–120 % входа, вход ≥ 100 тыс. ₸',
    color: 'var(--role-transit)',
  },
  terminal: {
    label: 'Конечный получатель',
    sign: 'признаки конечного получателя',
    rule: 'колена 1–3, дальше уходит < 30 %, вход ≥ 200 тыс. ₸',
    color: 'var(--role-terminal)',
  },
  peripheral: {
    label: 'Периферия',
    sign: 'признаков роли не выявлено',
    rule: 'остальные узлы и обрыв обхода на 4-м колене',
    color: 'var(--role-peripheral)',
  },
}
