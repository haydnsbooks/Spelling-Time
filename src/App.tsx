import { Suspense, lazy, useEffect, useState } from 'react';
import { AuthScreen } from './features/AuthScreen';
import { AppShell, type PageId } from './components/AppShell';
import { api } from './api';
import { supermarket } from './storeData';
import { clearStudentSession, loadStudentSession, saveStudentSession } from './session';
import type { ActivityId, Session, StudentSession } from './types';

const ActivityMenu = lazy(() => import('./features/ActivityMenu').then(module => ({ default: module.ActivityMenu })));
const ActivityRunner = lazy(() => import('./features/ActivityRunner').then(module => ({ default: module.ActivityRunner })));
const StudentProgress = lazy(() => import('./features/StudentProgress').then(module => ({ default: module.StudentProgress })));
const StoreView = lazy(() => import('./features/StoreView').then(module => ({ default: module.StoreView })));
const TeacherWorkspace = lazy(() => import('./features/TeacherWorkspace').then(module => ({ default: module.TeacherWorkspace })));
const BonusHub = lazy(() => import('./features/BonusHub').then(module => ({ default: module.BonusHub })));

interface StudentSync {
  stages?: Record<number, number>;
  activities?: Record<number, ActivityId[]>;
}

interface LegacyStage { classNumber: number; stage: number; }

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadStudentSession());
  const [page, setPage] = useState<PageId>('learning');
  const [term, setTerm] = useState(() => loadStudentSession()?.term || 1);
  const [stage, setStage] = useState<number | null>(() => loadStudentSession()?.stage || null);
  const [week, setWeek] = useState(() => loadStudentSession()?.week || 1);
  const [activity, setActivity] = useState<ActivityId | null>(null);
  const [enabledActivities, setEnabledActivities] = useState<ActivityId[] | null>(null);
  const [syncError, setSyncError] = useState('');
  const [notice, setNotice] = useState('');
  const [syncRevision, setSyncRevision] = useState(0);
  const studentClassNumber = session?.role === 'student' ? session.classNumber : null;

  useEffect(() => {
    if (!session || session.role !== 'student') return;
    let active = true;
    setSyncError('');
    const applyData = (stages: Record<number, number>, activities: Record<number, ActivityId[]>) => {
      if (!active) return;
      const assignedStage = stages[term] || null;
      setStage(assignedStage);
      setEnabledActivities(activities[term] || null);
      setSession(current => {
        if (!current || current.role !== 'student') return current;
        const updated = { ...current, term, stage: assignedStage, week };
        saveStudentSession(updated);
        return updated;
      });
    };
    api.post<StudentSync>({ action: 'studentSync', room: session.room, classNumber: session.classNumber, catalogVersion: supermarket.version, results: [] })
      .then(data => applyData(data.stages || {}, data.activities || {}))
      .catch(async error => {
        if (!active) return;
        if (!(error instanceof Error) || !/unknown action/i.test(error.message)) {
          setSyncError(error instanceof Error ? error.message : 'Could not sync this student account.');
          return;
        }
        try {
          const [stageData, activityData] = await Promise.all([
            api.get<{ stages?: LegacyStage[] }>({ action: 'getStages', room: session.room, term }),
            api.get<{ terms?: Record<number, ActivityId[]> }>({ action: 'getActivities', room: session.room })
          ]);
          const assignedStage = stageData.stages?.find(row => row.classNumber === session.classNumber)?.stage;
          applyData(assignedStage ? { [term]: assignedStage } : {}, activityData.terms || {});
        } catch (fallbackError) {
          if (active) setSyncError(fallbackError instanceof Error ? fallbackError.message : 'Could not sync this student account.');
        }
      });
    return () => { active = false; };
  }, [session?.role, session?.room, studentClassNumber, term, syncRevision]);

  function authenticate(value: Session) {
    setSession(value);
    setPage(value.role === 'student' ? 'learning' : 'teacher');
    setNotice('');
    if (value.role === 'student') {
      saveStudentSession(value);
      setTerm(value.term);
      setStage(value.stage);
      setWeek(value.week);
    }
  }

  function logout() {
    clearStudentSession();
    setSession(null);
    setActivity(null);
    setEnabledActivities(null);
    setSyncError('');
    setNotice('');
  }

  function updateWeek(value: number) {
    setWeek(value);
    setSession(current => {
      if (!current || current.role !== 'student') return current;
      const updated = { ...current, week: value };
      saveStudentSession(updated);
      return updated;
    });
  }

  if (!session) return <AuthScreen onAuthenticated={authenticate} />;
  const student = session.role === 'student' ? { ...session, term, stage, week } : null;
  const allowed = !enabledActivities || enabledActivities.includes(activity || 'wordlist');

  return <AppShell session={session} page={page} onNavigate={next => { setActivity(null); setPage(next); }} onLogout={logout}>
    <Suspense fallback={<p className="py-8 text-sm text-[var(--muted)]" role="status">Loading workspace…</p>}>
    {syncError && <div className="notice mb-5 flex items-center justify-between gap-3" role="status"><span>{syncError}</span><button className="text-sm font-bold underline" onClick={() => setSyncRevision(value => value + 1)}>Retry</button></div>}
    {notice && <div className="mb-5 flex items-center justify-between border-l-4 border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3 text-sm" role="status"><span>{notice}</span><button aria-label="Dismiss" onClick={() => setNotice('')}>×</button></div>}
    {session.role === 'student' && student && activity && allowed ? <ActivityRunner key={`${activity}-${term}-${week}`} activity={activity} session={student as StudentSession} onBack={() => setActivity(null)} onComplete={(score, total) => { setNotice(`Result saved: ${score} of ${total}.`); setActivity(null); }} /> : null}
    {session.role === 'student' && !activity && page === 'learning' && <ActivityMenu stage={stage} term={term} week={week} enabled={enabledActivities} onTermChange={value => { setTerm(value); setWeek(1); }} onWeekChange={updateWeek} onLaunch={setActivity} />}
    {session.role === 'student' && !activity && page === 'progress' && <StudentProgress session={student as StudentSession} term={term} />}
    {session.role === 'student' && !activity && page === 'store' && <StoreView session={student as StudentSession} />}
    {session.role === 'student' && !activity && page === 'bonus' && <BonusHub stage={stage} term={term} week={week} />}
    {session.role === 'teacher' && <TeacherWorkspace session={session} mode={page === 'teacher' || page === 'stages' || page === 'activities' || page === 'progress' ? page : 'teacher'} onNavigate={setPage} />}
    </Suspense>
  </AppShell>;
}
