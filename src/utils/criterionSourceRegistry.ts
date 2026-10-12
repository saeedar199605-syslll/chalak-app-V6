import type { Criterion, CriterionScoringSource } from '../types';
import { normalizeSearchText } from './personnelSearch';

export type CriterionImportSource = 'FILE_IMPORT' | 'MIS' | 'KASRA' | 'EMAIL';

export interface CriterionImportRegistration {
  criterionId: string;
  criterionCode: string;
  title: string;
  source: CriterionImportSource;
  aliases: string[];
  required: boolean;
  active: boolean;
  unit?: string;
}

const SOURCE_MAP: Partial<Record<CriterionScoringSource, CriterionImportSource[]>> = {
  supervisor: ['FILE_IMPORT'],
  mis: ['MIS', 'FILE_IMPORT'],
  kasra: ['KASRA', 'FILE_IMPORT'],
  system: ['FILE_IMPORT'],
  multi_source: ['FILE_IMPORT', 'MIS', 'KASRA', 'EMAIL'],
};

function aliasesFor(criterion: Criterion): string[] {
  const configured = (criterion as Criterion & { importAliases?: string[] }).importAliases;
  const customField = (criterion as Criterion & { customMetricField?: string }).customMetricField;
  return [...new Set([criterion.id, criterion.code, criterion.name, customField || '', ...(Array.isArray(configured) ? configured : [])]
    .map(value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase())
    .filter(Boolean))];
}

export function normalizeCriterionImportHeader(value: string): string {
  return normalizeSearchText(String(value || ''))
    .replace(/ى/g, 'ی')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLocaleLowerCase();
}

/** Build current import mappings from saved criterion configuration, never a historical field list. */
export function buildCriterionImportRegistry(
  criteria: readonly Criterion[],
  source: CriterionImportSource,
  profileCriterionIds?: ReadonlySet<string>,
): CriterionImportRegistration[] {
  return criteria
    .filter(criterion => (criterion as Criterion & { active?: boolean }).active !== false)
    .filter(criterion => !profileCriterionIds || profileCriterionIds.has(criterion.id) || profileCriterionIds.has(criterion.code))
    .filter(criterion => (SOURCE_MAP[criterion.scoringSource || 'supervisor'] || []).includes(source))
    .filter(criterion => source !== 'MIS' || criterion.autoPopulate !== false)
    .filter(criterion => source !== 'KASRA' || criterion.autoPopulate !== false)
    .map(criterion => ({
      criterionId: criterion.id,
      criterionCode: criterion.code,
      title: criterion.name,
      source,
      aliases: aliasesFor(criterion),
      required: Boolean((criterion as Criterion & { required?: boolean }).required),
      active: true,
      ...(criterion.unit ? { unit: criterion.unit } : {}),
    }));
}

export type CriterionHeaderResolution =
  | { status: 'matched'; registration: CriterionImportRegistration; candidates: CriterionImportRegistration[] }
  | { status: 'ambiguous'; registration: null; candidates: CriterionImportRegistration[] }
  | { status: 'unmapped'; registration: null; candidates: [] };

export function resolveCriterionHeader(
  header: string,
  registrations: readonly CriterionImportRegistration[],
): CriterionHeaderResolution {
  const normalized = normalizeCriterionImportHeader(header);
  if (!normalized) return { status: 'unmapped', registration: null, candidates: [] };
  const byId = new Map<string, CriterionImportRegistration>();
  for (const registration of registrations) {
    if (registration.aliases.some(alias => normalizeCriterionImportHeader(alias) === normalized)) {
      byId.set(registration.criterionId, registration);
    }
  }
  const candidates = [...byId.values()];
  if (candidates.length === 1) return { status: 'matched', registration: candidates[0], candidates };
  if (candidates.length > 1) return { status: 'ambiguous', registration: null, candidates };
  return { status: 'unmapped', registration: null, candidates: [] };
}

export function suggestCriterionForHeader(header: string, registrations: readonly CriterionImportRegistration[]): CriterionImportRegistration | null {
  const result = resolveCriterionHeader(header, registrations);
  return result.status === 'matched' ? result.registration : null;
}

/** Convert a configured raw metric to a score without assuming historical MIS fields. */
export function scoreConfiguredMetric(criterion: Criterion, raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  if (criterion.calculationType === 'direct_score') return raw >= 0 && raw <= 5 ? Math.round(raw * 10) / 10 : null;
  const thresholds = criterion.scoreThresholds;
  if (!thresholds) return null;
  const ordered = [thresholds.score5, thresholds.score4, thresholds.score3, thresholds.score2];
  if (!ordered.every(Number.isFinite)) return null;
  if (criterion.dir === 'less') {
    for (let index = 0; index < ordered.length; index += 1) if (raw <= ordered[index]) return 5 - index;
  } else {
    for (let index = 0; index < ordered.length; index += 1) if (raw >= ordered[index]) return 5 - index;
  }
  return 1;
}
