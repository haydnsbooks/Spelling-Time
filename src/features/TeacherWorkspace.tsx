import { useEffect, useState } from 'react';
import { api } from '../api';
import { classLists } from '../classData';
import type { PageId } from '../components/AppShell';
import type { ActivityId, Session } from '../types';

const activities: { id: ActivityId; label: string }[] = [
  { id: 'wordlist', label: 'Word list' }, { id: 'passage', label: 'Phonic passage' },
  { id: 'testEasy', label: 'Spelling practice' }, { id: 'testHard', label: 'Spelling challenge' },
  { id: 'defEasy', label: 'Definitions' }, { id: 'defHard', label: 'Definitions challenge' },
  { id: 'clozeEasy', label: 'Complete the sentence' }, { id: 'clozeHard', label: 'Sentence challenge' },
  { id: 'editing', label: 'Editing passage' }, { id: 'dictation', label: 'Dictation' }
];

interface TeacherWorkspaceProps {
  session: Extract<Session, { role: 'teacher' }>;
  mode: 'teacher' | 'stages' | 'activities' | 'progress';
  onNavigate: (page: PageId) => void;
}

interface StageRow { classNumber: number; stage: number; student?: string; }
interface ProgressData { stages?: Record<number, Record<number, number>>; perfect?: Record<number, Record<number, Record<number, string[]>>>; }

export function TeacherWorkspace({ session, mode, onNavigate }: TeacherWorkspaceProps) {
  const [term, setTerm] = useState(1);
  const [assigned, setAssigned] = useState<Record<number, number | ''>>({});
  const [hasExistingStages, setHasExistingStages] = useState(false);
  const [selectedActivities, setSelectedActivities] = useState<ActivityId[]>(activities.map(item => item.id));
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const students = classLists.find(item => item.room === session.room)?.students || [];

  useEffect(() => {
    let active = true;
    setMessage('');
    if (mode === 'stages') api.get<{ stages?: StageRow[] }>({ action: 'getStages', room: session.room, term })
      .then(result => {
        if (!active) return;
        const rows = result.stages || [];
        setHasExistingStages(rows.length > 0);
        const values: Record<number, number | ''> = {};
        students.forEach(student => { values[student.classNumber] = rows.find(row => row.classNumber === student.classNumber)?.stage || ''; });
        setAssigned(values);
      }).catch(error => active && setMessage(error instanceof Error ? error.message : 'Could not load stages.'));
    if (mode === 'activities') api.get<{ terms?: Record<number, ActivityId[]> }>({ action: 'getActivities', room: session.room })
      .then(result => { if (active) setSelectedActivities(result.terms?.[term] || activities.map(item => item.id)); })
      .catch(error => active && setMessage(error instanceof Error ? error.message : 'Could not load activities.'));
    if (mode === 'progress') api.post<ProgressData>({ action: 'getRoomProgress', password: session.password, room: session.room })
      .then(result => { if (active) setProgress(result); })
      .catch(error => active && setMessage(error instanceof Error ? error.message : 'Could not load progress.'));
    return () => { active = false; };
  }, [mode, term, session.room, session.password]);

  async function saveStages() {
    if (hasExistingStages && !window.confirm('Changing existing stages can reset student progress for this term. Continue?')) return;
    setBusy(true); setMessage('');
    try {
      await api.post({ action: 'setStages', password: session.password, room: session.room, term, stages: students.filter(student => assigned[student.classNumber]).map(student => ({ classNumber: student.classNumber, student: student.displayName, stage: assigned[student.classNumber] })) });
      setMessage(`Stages saved for Term ${term}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save stages.'); }
    finally { setBusy(false); }
  }

  async function saveActivities() {
    if (!selectedActivities.length) return setMessage('Keep at least one activity enabled.');
    setBusy(true); setMessage('');
    try {
      await api.post({ action: 'setActivities', password: session.password, room: session.room, term, activities: selectedActivities });
      setMessage(`Activities saved for Term ${term}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save activities.'); }
    finally { setBusy(false); }
  }

  const title = mode === 'stages' ? 'Student stages' : mode === 'activities' ? 'Activity settings' : mode === 'progress' ? 'Class progress' : 'Teacher overview';
  return <section className="screen-enter">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><div className="eyebrow mb-2">Teacher workspace · {session.room}</div><h1 className="text-3xl font-bold">{title}</h1><p className="mt-1 text-sm text-[var(--muted)]">Manage learning for this room.</p></div>{mode !== 'teacher' && <label><span className="field-label">Term</span><select className="control min-w-32" value={term} onChange={event => setTerm(Number(event.target.value))}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>Term {value}</option>)}</select></label>}</div>
    {message && <div className="notice mb-4" role="status">{message}</div>}
    {mode === 'teacher' && <div className="grid gap-4 sm:grid-cols-2">{[{ id: 'stages' as const, label: 'Assign student stages', detail: 'Set the PLD stage for each student.' }, { id: 'activities' as const, label: 'Choose activities', detail: 'Control which activities are available this term.' }, { id: 'progress' as const, label: 'View class progress', detail: 'Review stage assignments and perfect results.' }].map(item => <button key={item.id} className="panel p-5 text-left transition-colors hover:border-[var(--accent)]" onClick={() => onNavigate(item.id)}><h2 className="font-semibold">{item.label}</h2><p className="mt-2 text-sm text-[var(--muted)]">{item.detail}</p><span className="mt-4 inline-block text-sm font-semibold text-[var(--accent)]">Open section</span></button>)}</div>}
    {mode === 'stages' && <div className="panel overflow-hidden"><div className="grid grid-cols-[minmax(0,1fr)_112px] gap-2 border-b border-[var(--line)] bg-[#f8faf8] px-3 py-3 text-xs font-bold uppercase text-[var(--muted)] sm:grid-cols-[minmax(180px,1fr)_180px] sm:gap-4 sm:px-5"><span>Student</span><span>Stage</span></div>{students.map(student => <label key={student.classNumber} className="grid grid-cols-[minmax(0,1fr)_112px] items-center gap-2 border-b border-[var(--line)] px-3 py-3 last:border-0 sm:grid-cols-[minmax(180px,1fr)_180px] sm:gap-4 sm:px-5"><span className="break-words text-sm font-medium sm:text-base">{student.displayName}</span><select className="control px-2 text-sm sm:px-3 sm:text-base" value={assigned[student.classNumber] ?? ''} onChange={event => setAssigned(current => ({ ...current, [student.classNumber]: event.target.value ? Number(event.target.value) : '' }))}><option value="">Unassigned</option>{[2, 3, 4, 5, 6].map(value => <option key={value} value={value}>Stage {value}</option>)}</select></label>)}<div className="border-t border-[var(--line)] p-4"><button className="action action-primary" disabled={busy} onClick={() => void saveStages()}>{busy ? 'Saving…' : 'Save stages'}</button></div></div>}
    {mode === 'activities' && <div className="panel divide-y divide-[var(--line)]">{activities.map(item => <label key={item.id} className="flex min-h-14 cursor-pointer items-center gap-3 px-5 py-3"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={selectedActivities.includes(item.id)} onChange={event => setSelectedActivities(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /><span className="font-medium">{item.label}</span></label>)}<div className="p-4"><button className="action action-primary" disabled={busy} onClick={() => void saveActivities()}>{busy ? 'Saving…' : 'Save activities'}</button></div></div>}
    {mode === 'progress' && <div className="panel overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="bg-[#f8faf8] text-xs uppercase text-[var(--muted)]"><th className="px-4 py-3">Student</th>{[1, 2, 3, 4].map(value => <th key={value} className="px-4 py-3">Term {value}</th>)}</tr></thead><tbody>{students.map(student => <tr key={student.classNumber} className="border-t border-[var(--line)]"><th className="px-4 py-3 font-semibold">{student.displayName}</th>{[1, 2, 3, 4].map(value => { const weeks = progress?.perfect?.[student.classNumber]?.[value] || {}; const perfectWeeks = Object.values(weeks).filter(items => items.length > 0).length; return <td key={value} className="px-4 py-3"><div>Stage {progress?.stages?.[value]?.[student.classNumber] || '—'}</div><div className="mt-1 text-xs text-[var(--muted)]">{perfectWeeks} weeks with perfect results</div></td>; })}</tr>)}</tbody></table>{!progress && !message && <p className="p-5 text-sm text-[var(--muted)]">Loading class progress…</p>}</div>}
  </section>;
}
