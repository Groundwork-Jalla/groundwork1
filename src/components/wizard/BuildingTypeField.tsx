import { useWizard } from '@/contexts/WizardContext';
import { useT } from '@/lib/i18n';
import { useDomainLabels } from '@/lib/domain-labels';
import { BUILDING_TYPES_BY_PROJECT, buildingTypePatch } from '@/lib/projects/building-types';
import type { ProjectType } from '@/types/project';

export function BuildingTypeField() {
  const { data, update } = useWizard();
  const t = useT();
  const labels = useDomainLabels();
  return <select aria-label={t('preview.sub.buildingType')} value={data.buildingType ?? ''}
    className="w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black dark:text-white"
    onChange={event => { const patch = buildingTypePatch(event.target.value); if (patch) update(patch); }}>
    <option value="" disabled>{t('preview.sub.buildingType')}</option>
    {Object.entries(BUILDING_TYPES_BY_PROJECT).map(([projectType, types]) => <optgroup key={projectType} label={labels.projectType(projectType as ProjectType)}>
      {types.map(type => <option key={type} value={type}>{labels.buildingType(type)}</option>)}
    </optgroup>)}
  </select>;
}
