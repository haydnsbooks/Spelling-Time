import { BookOpen, ClipboardList, FileText, Headphones, Lightbulb, Search, SpellCheck, TextSearch } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadStage } from '../curriculum';
import type { ActivityId, StageRecord } from '../types';

interface ActivityMenuProps {
  stage: number | null;
  term: number;
  week: number;
  enabled: ActivityId[] | null;
  onTermChange: (term: number) => void;
  onWeekChange: (week: number) => void;
  onLaunch: (activity: ActivityId) => void;
}

const activities: { id: ActivityId; title: string; detail: string; icon: typeof BookOpen }[] = [
  { id: 'wordlist', title: 'Word list', detail: 'Read and explore this week’s words.', icon: BookOpen },
  { id: 'passage', title: 'Phonic passage', detail: 'Read a passage using the spelling pattern.', icon: FileText },
  { id: 'testEasy', title: 'Spelling practice', detail: 'Listen, think, and spell each word.', icon: SpellCheck },
  { id: 'testHard', title: 'Spelling challenge', detail: 'Type each word from memory.', icon: ClipboardList },
  { id: 'defEasy', title: 'Definitions', detail: 'Match each meaning to a word.', icon: Lightbulb },
  { id: 'defHard', title: 'Definitions challenge', detail: 'Recall each word from its meaning.', icon: TextSearch },
  { id: 'clozeEasy', title: 'Complete the sentence', detail: 'Choose the word that fits the context.', icon: Search },
  { id: 'clozeHard', title: 'Sentence challenge', detail: 'Type the word that completes each sentence.', icon: TextSearch },
  { id: 'editing', title: 'Editing passage', detail: 'Find and correct spelling mistakes.', icon: Search },
  { id: 'dictation', title: 'Dictation', detail: 'Listen to words and write them down.', icon: Headphones }
];

export function ActivityMenu({ stage, term, week, enabled, onTermChange, onWeekChange, onLaunch }: ActivityMenuProps) {
  const [stageData, setStageData] = useState<StageRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let active = true;
    if (!stage) { setStageData(null); return; }
    setLoading(true);
    setLoadError('');
    loadStage(stage).then(data => { if (active) setStageData(data); }).catch(error => { if (active) setLoadError(error instanceof Error ? error.message : 'Could not load the selected stage.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [stage]);
  const weekData = stageData?.weeks[`${term}-${week}`];
  const count = Object.keys(stageData?.weeks ?? {}).filter(key => key.startsWith(`${term}-`)).length;
  return (
    <section className="screen-enter">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div><div className="eyebrow mb-2">Student workspace</div><h1 className="text-3xl font-bold">Learning</h1><p className="mt-1 text-sm text-[var(--muted)]">{stage ? `Stage ${stage} · Term ${term} · Week ${week}` : 'Your teacher has not assigned a stage yet.'}</p></div>
        <div className="flex gap-2">
          <label><span className="field-label">Term</span><select className="control min-w-28" value={term} onChange={event => onTermChange(Number(event.target.value))}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>Term {value}</option>)}</select></label>
          <label><span className="field-label">Week</span><select className="control min-w-24" value={week} onChange={event => onWeekChange(Number(event.target.value))}>{Array.from({ length: 9 }, (_, index) => index + 1).map(value => <option key={value} value={value}>Week {value}</option>)}</select></label>
        </div>
      </div>

      {!stage ? <div className="panel p-6"><div className="font-semibold">Stage not set</div><p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">Ask your teacher to assign your stage for Term {term}. Your activities will appear here once it is set.</p></div> : loadError ? <div className="notice" role="alert">{loadError}</div> : loading || !stageData ? <p className="py-8 text-sm text-[var(--muted)]" role="status">Loading stage curriculum…</p> : !weekData ? <div className="panel p-6"><div className="font-semibold">No lessons for this week</div><p className="mt-2 text-sm text-[var(--muted)]">Stage {stage} has no PLD lesson data for Term {term}, Week {week}.</p></div> : <>
        <div className="mb-5 border-b border-[var(--line)] pb-4"><div className="eyebrow">{stageData.title}</div><div className="mt-2 font-semibold">{weekData.c || 'Weekly spelling activities'}</div>{weekData.n && <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">{weekData.n}</p>}</div>
        <div className="grid gap-x-6 md:grid-cols-2">
          {activities.map(({ id, title, detail, icon: Icon }) => {
            const available = !enabled || enabled.includes(id);
            return <button key={id} disabled={!available} className="group flex min-h-[90px] items-start gap-4 border-b border-[var(--line)] py-5 text-left hover:bg-white/70" onClick={() => onLaunch(id)}>
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-white text-[var(--accent)] ring-1 ring-[var(--line)]"><Icon size={19} /></span>
            <span className="min-w-0 flex-1"><span className="block font-semibold group-hover:text-[var(--accent)]">{title}</span><span className="mt-1 block text-sm leading-5 text-[var(--muted)]">{detail}</span></span>
            <span className="mt-2 text-sm text-[var(--muted)]">{available ? 'Open' : 'Off'}</span>
          </button>;
          })}
        </div>
        <div className="mt-6 text-xs text-[var(--muted)]">{count} weeks of lessons available this term.</div>
      </>}
    </section>
  );
}
