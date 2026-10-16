import type { StudentSession } from './types';

const SESSION_KEY = 'spelling-time.student-session.v1';

export function loadStudentSession(): StudentSession | null {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved) return null;
    const value = JSON.parse(saved) as StudentSession;
    if (value.role !== 'student' || !value.room || !value.student || typeof value.classNumber !== 'number') return null;
    return value;
  } catch {
    return null;
  }
}

export function saveStudentSession(session: StudentSession): void {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
}

export function clearStudentSession(): void {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}
