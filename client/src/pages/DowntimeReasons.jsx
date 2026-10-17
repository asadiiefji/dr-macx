import { MasterPage } from './People.jsx';
import { CategoryLabel, Mono, TypeChip } from '../ui.jsx';
import { CATEGORIES } from '../theme.js';

export default function DowntimeReasons() {
  return (
    <MasterPage
      col="reasons"
      tour="reasons"
      title="Downtime reasons"
      noun="Reason"
      sortKey="code"
      note="Every stop is confirmed with one of these reasons. A linked alarm code pre-fills the reason when the PLC raises that alarm. Reasons in the “Operator break” category can only be given to a stop during a scheduled break or within the break tolerance before or after it (OEE calculation page, default 5 min). Planned reasons (maintenance, meetings, QC patrol) are taken out of planned production time, so they never lower OEE."
      fields={[
        { key: 'code', label: 'Reason code', required: true, help: 'Short code, e.g. BD-HYD' },
        { key: 'name', label: 'Reason', required: true },
        { key: 'category', label: 'Category', options: CATEGORIES.map((c) => ({ value: c.name, label: c.name })), default: 'Other', required: true },
        {
          key: 'type',
          label: 'Type',
          options: [{ value: 'unplanned', label: 'Unplanned: a loss, lowers OEE' }, { value: 'planned', label: 'Planned: scheduled, excluded from OEE' }],
          default: 'unplanned',
          required: true,
        },
        { key: 'alarmCode', label: 'Linked PLC alarm code (optional)', type: 'number', help: 'Leave empty for operator-initiated stops (QC check, break, meeting)' },
      ]}
      columns={[
        { key: 'code', label: 'Code', render: (r) => <Mono fontWeight={700}>{r.code}</Mono> },
        { key: 'name', label: 'Reason' },
        { key: 'category', label: 'Category', render: (r) => <CategoryLabel name={r.category} /> },
        { key: 'type', label: 'Type', render: (r) => <TypeChip type={r.type} /> },
        { key: 'alarmCode', label: 'Linked alarm', render: (r) => r.alarmCode ?? '—' },
      ]}
    />
  );
}
