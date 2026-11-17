import { useState } from 'react';
import type { CallSummary, PickupMode } from '../../../shared/types';
import { DRAG_TYPE, QueueCard } from './CallCard';

type Tab = 'ALL' | PickupMode;

function sortQueue(a: CallSummary, b: CallSummary) {
  const rank = (c: CallSummary) => (c.pickupMode === 'ASAP' ? 0 : c.pickupMode === 'SCHEDULED' ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.pickupMode === 'SCHEDULED') return (a.pickupTime || '').localeCompare(b.pickupTime || '');
  return a.createdAt.localeCompare(b.createdAt);
}

export function QueuePanel({
  calls,
  canEdit,
  onOpen,
  onDropCall,
}: {
  calls: CallSummary[];
  canEdit: boolean;
  onOpen: (id: string) => void;
  onDropCall: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('ALL');
  const [over, setOver] = useState(false);
  const shown = calls.filter((c) => tab === 'ALL' || c.pickupMode === tab).sort(sortQueue);
  const count = (t: Tab) => calls.filter((c) => t === 'ALL' || c.pickupMode === t).length;

  return (
    <aside
      className={`queue ${over ? 'dropping' : ''}`}
      onDragOver={(e) => {
        if (!canEdit || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData(DRAG_TYPE);
        if (id) onDropCall(id);
      }}
    >
      <div className="queue-head">
        <h2>Unassigned calls</h2>
        <div className="tabs">
          {(['ALL', 'ASAP', 'SCHEDULED', 'WILL_CALL'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {{ ALL: 'All', ASAP: 'ASAP', SCHEDULED: 'Sched.', WILL_CALL: 'Will-call' }[t]} <span>{count(t)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="queue-list">
        {shown.map((c) => (
          <QueueCard key={c.id} c={c} canEdit={canEdit} onOpen={onOpen} />
        ))}
        {shown.length === 0 && <div className="empty">No calls waiting.</div>}
      </div>
      {canEdit && <div className="queue-hint">Drag a call onto a crew's timeline to assign it. Drag an assigned trip back here to unassign.</div>}
    </aside>
  );
}
