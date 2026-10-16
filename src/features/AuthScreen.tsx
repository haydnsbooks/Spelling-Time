import { ArrowLeft, BookOpen, LoaderCircle, LockKeyhole, UserRound } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { classLists } from '../classData';
import type { Role, Session, Student } from '../types';

interface AuthScreenProps {
  onAuthenticated: (session: Session) => void;
}

type PasswordMode = 'existing' | 'create';
type SignInStep = 'role' | 'room' | 'room-exit' | 'student' | 'checking' | 'password' | 'teacher';

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [role, setRole] = useState<Role | null>(null);
  const [step, setStep] = useState<SignInStep>('role');
  const [room, setRoom] = useState('');
  const [student, setStudent] = useState<Student | null>(null);
  const [passwordMode, setPasswordMode] = useState<PasswordMode | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const roomNames = classLists.map(item => item.room);
  const roomStudents = classLists.find(item => item.room === room)?.students ?? [];

  function resetRole(nextRole: Role) {
    setRole(nextRole);
    setStep(nextRole === 'student' ? 'room' : 'teacher');
    setRoom('');
    setStudent(null);
    setPasswordMode(null);
    setError('');
  }

  function backToRole() {
    setRole(null);
    setStep('role');
    setRoom('');
    setStudent(null);
    setPasswordMode(null);
    setPassword('');
    setConfirmation('');
    setError('');
  }

  function selectRoom(value: string) {
    setRoom(value);
    setStudent(null);
    setError('');
    if (role === 'student' && value) {
      setStep('room-exit');
      window.setTimeout(() => setStep(current => current === 'room-exit' ? 'student' : current), 220);
    }
  }

  async function continueStudent(selected: Student) {
    if (!room) return;
    setStudent(selected);
    setBusy(true);
    setError('');
    setStep('checking');
    try {
      await new Promise(resolve => window.setTimeout(resolve, 220));
      const status = await api.get<{ hasPassword?: boolean }>({ action: 'studentStatus', room, classNumber: selected.classNumber });
      setPasswordMode(status.hasPassword ? 'existing' : 'create');
      setPassword('');
      setConfirmation('');
      setStep('password');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not check this account.');
      setStep('student');
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    if (step === 'password') {
      setPasswordMode(null);
      setStudent(null);
      setPassword('');
      setConfirmation('');
      setError('');
      setStep('student');
    } else if (step === 'student' || step === 'checking' || step === 'room-exit') {
      setStudent(null);
      setError('');
      setStep('room');
    } else {
      backToRole();
    }
  }

  async function submitStudentPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!student || !room || !passwordMode) return;
    setError('');
    if (passwordMode === 'create' && password.length < 4) return setError('Use at least 4 characters.');
    if (passwordMode === 'create' && password !== confirmation) return setError('The passwords do not match.');
    setBusy(true);
    try {
      if (passwordMode === 'create') {
        await api.post({ action: 'setStudentPassword', room, classNumber: student.classNumber, student: student.displayName, password });
      } else {
        const result = await api.post<{ needsPassword?: boolean }>({ action: 'studentLogin', room, classNumber: student.classNumber, password });
        if (result.needsPassword) return setPasswordMode('create');
      }
      onAuthenticated({ role: 'student', room, student: student.displayName, firstName: student.firstName, classNumber: student.classNumber, term: 1, stage: null, week: 1 });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function submitTeacher(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const teacherPassword = String(form.get('password') || '');
    if (!room || !teacherPassword) return setError('Choose a room and enter your password.');
    setBusy(true);
    setError('');
    try {
      await api.post({ action: 'teacherLogin', password: teacherPassword });
      onAuthenticated({ role: 'teacher', room, password: teacherPassword });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  const title = step === 'password' ? `Welcome, ${student?.firstName}` : step === 'student' ? 'Choose your name' : step === 'checking' ? 'Checking account' : role === 'teacher' ? 'Teacher sign in' : 'Student sign in';

  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <section className="w-full max-w-[440px]">
        <div className="mb-8 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-md bg-[var(--accent)] text-white"><BookOpen size={23} /></span><span className="brand text-2xl">Spelling Time</span></div>
        <div className="panel p-6 sm:p-8">
          <div className="eyebrow mb-2">Learning workspace</div>
          <h1 className="mb-2 text-2xl font-bold">{title}</h1>
          <p className="mb-6 text-sm leading-6 text-[var(--muted)]">{step === 'password' ? 'Enter your password to continue.' : step === 'student' ? `Room: ${room}` : step === 'checking' ? `Checking ${student?.firstName ?? 'student'}…` : 'Sign in to continue to your class activities.'}</p>

          {!role && <div className="grid grid-cols-2 gap-3">
            <button className="action action-secondary h-24 flex-col" onClick={() => resetRole('student')}><UserRound size={22} />Student</button>
            <button className="action action-secondary h-24 flex-col" onClick={() => resetRole('teacher')}><LockKeyhole size={22} />Teacher</button>
          </div>}

          {role === 'student' && (step === 'room' || step === 'room-exit') && <div key="room-step" className={`space-y-4 auth-step ${step === 'room-exit' ? 'auth-step-exit' : ''}`}>
            <label className="block"><span className="field-label">Room</span><select className="control" value={room} onChange={event => selectRoom(event.target.value)} required><option value="">Select a room</option>{roomNames.map(name => <option key={name}>{name}</option>)}</select></label>
          </div>}

          {role === 'student' && step === 'student' && <div key="student-step" className="space-y-4 auth-step">
            <label className="block"><span className="field-label">Your name</span><select className="control" value={student?.classNumber ?? ''} onChange={event => { const selected = roomStudents.find(item => item.classNumber === Number(event.target.value)); if (selected) void continueStudent(selected); }} required><option value="">Select your name</option>{roomStudents.map(item => <option key={item.classNumber} value={item.classNumber}>{item.displayName}</option>)}</select></label>
          </div>}

          {role === 'student' && step === 'checking' && <div className="auth-step flex items-center gap-3 py-3 text-sm text-[var(--muted)]" role="status"><LoaderCircle className="animate-spin" size={18} />Checking your account…</div>}

          {role === 'teacher' && step === 'teacher' && <form className="auth-step space-y-4" onSubmit={submitTeacher}>
            <label className="block"><span className="field-label">Room</span><select className="control" value={room} onChange={event => setRoom(event.target.value)} required><option value="">Select a room</option>{roomNames.map(name => <option key={name}>{name}</option>)}</select></label>
            <label className="block"><span className="field-label">Teacher password</span><input className="control" name="password" type="password" autoComplete="current-password" required /></label>
            <button className="action action-primary w-full" disabled={busy}>{busy && <LoaderCircle className="animate-spin" size={17} />}Sign in</button>
          </form>}

          {role === 'student' && step === 'password' && passwordMode && <form key="password-step" className="auth-step space-y-4" onSubmit={event => void submitStudentPassword(event)}>
            <label className="block"><span className="field-label">{passwordMode === 'create' ? 'Create a password' : 'Password'}</span><input className="control" type="password" autoComplete={passwordMode === 'create' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} required /></label>
            {passwordMode === 'create' && <label className="block"><span className="field-label">Confirm password</span><input className="control" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} required /></label>}
            <button className="action action-primary w-full" disabled={busy}>{busy && <LoaderCircle className="animate-spin" size={17} />}{passwordMode === 'create' ? 'Create account' : 'Sign in'}</button>
          </form>}

          {error && <p className="notice mt-4 text-sm" role="alert">{error}</p>}
          {role && step !== 'checking' && <button className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted)] hover:text-[var(--ink)]" onClick={goBack}><ArrowLeft size={16} />Back</button>}
        </div>
      </section>
    </main>
  );
}
