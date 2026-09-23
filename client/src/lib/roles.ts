import type { Role } from '@/lib/api'

/** Role vocabulary: Russian label and hypothesis phrase. Thresholds are never written here — they come from /api/meta. */
export const ROLE: Record<Role, { label: string; sign: string; color: string }> = {
  coordinator: {
    label: 'Организатор',
    sign: 'признаки координации',
    color: 'var(--role-coordinator)',
  },
  consolidator: {
    label: 'Сборщик средств',
    sign: 'признаки консолидации',
    color: 'var(--role-consolidator)',
  },
  distributor: {
    label: 'Распределитель',
    sign: 'признаки веерной раздачи',
    color: 'var(--role-distributor)',
  },
  transit: {
    label: 'Транзитный счёт',
    sign: 'признаки транзита',
    color: 'var(--role-transit)',
  },
  terminal: {
    label: 'Конечный получатель',
    sign: 'признаки конечного получателя',
    color: 'var(--role-terminal)',
  },
  peripheral: {
    label: 'Без выраженной роли',
    sign: 'признаков роли не выявлено',
    color: 'var(--role-peripheral)',
  },
}
