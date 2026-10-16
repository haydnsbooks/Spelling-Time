import { useEffect, useState } from 'react';
import { api } from '../api';
import type { StudentSession } from '../types';

interface ResultRow {
  term: number;
  stage: number;
  week: number;
  activity: string;
  score: number;
  total: number;
  timestamp?: string;
}

interface StudentProgressProps {
  session: StudentSession;
  term: number;
}

export function StudentProgress({ session, term }: StudentProgressProps) {
  const [results, setResults] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get<{ results?: ResultRow[] }>({ action: 'getResults', room: session.room, classNumber: session.classNumber, term })
      .then(response => { if (active) setResults(response.results || []); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load progress.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.room, session.classNumber, term]);

  const weeks = Array.from({ length: 9 }, (_, index) => index + 1);
  return <section className="screen-enter">
    <div className="mb-7"><div className="eyebrow mb-2">Student workspace</div><h1 className="text-3xl font-bold">Progress</h1><p className="mt-1 text-sm text-[var(--muted)]">Term {term} activity results</p></div>
    {error && <div className="notice mb-4" role="alert">{error}</div>}
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4"><h2 className="section-title">Weekly activity</h2><span className="text-sm text-[var(--muted)]">{loading ? 'Updating…' : `${results.length} results`}</span></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[620px] border-collapse text-left text-sm"><thead><tr className="bg-[#f8faf8] text-xs uppercase text-[var(--muted)]"><th className="px-4 py-3">Week</th><th className="px-4 py-3">Activity</th><th className="px-4 py-3">Result</th><th className="px-4 py-3">Date</th></tr></thead><tbody>
        {weeks.map(week => {
          const weekResults = results.filter(result => result.week === week);
          return <tr key={week} className="border-t border-[var(--line)]"><th className="px-4 py-3 font-semibold">Week {week}</th><td className="px-4 py-3">{weekResults.length ? weekResults.map(result => result.activity).join(', ') : <span className="text-[var(--muted)]">No results yet</span>}</td><td className="px-4 py-3">{weekResults.length ? weekResults.map(result => `${result.score}/${result.total}`).join(' · ') : '—'}</td><td className="px-4 py-3 text-[var(--muted)]">{weekResults[0]?.timestamp ? new Date(weekResults[0].timestamp).toLocaleDateString('en-AU') : '—'}</td></tr>;
        })}
      </tbody></table></div>
    </div>
  </section>;
}
