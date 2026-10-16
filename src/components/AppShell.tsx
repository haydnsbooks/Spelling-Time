import { BookOpen, ChartNoAxesColumn, Gamepad2, LogOut, Settings2, ShoppingBasket, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Session } from '../types';

export type PageId = 'learning' | 'progress' | 'store' | 'bonus' | 'teacher' | 'stages' | 'activities';

interface AppShellProps {
  session: Session;
  page: PageId;
  onNavigate: (page: PageId) => void;
  onLogout: () => void;
  children: ReactNode;
}

const studentNavigation = [
  { id: 'learning' as const, label: 'Learning', icon: BookOpen },
  { id: 'progress' as const, label: 'Progress', icon: ChartNoAxesColumn },
  { id: 'store' as const, label: 'Supermarket', icon: ShoppingBasket },
  { id: 'bonus' as const, label: 'Bonus games', icon: Gamepad2 }
];

const teacherNavigation = [
  { id: 'teacher' as const, label: 'Overview', icon: UserRound },
  { id: 'stages' as const, label: 'Student stages', icon: Settings2 },
  { id: 'activities' as const, label: 'Activities', icon: BookOpen },
  { id: 'progress' as const, label: 'Progress', icon: ChartNoAxesColumn }
];

export function AppShell({ session, page, onNavigate, onLogout, children }: AppShellProps) {
  const navigation = session.role === 'student' ? studentNavigation : teacherNavigation;
  const user = session.role === 'student' ? session.firstName : 'Teacher';

  const links = navigation.map(({ id, label, icon: Icon }) => (
    <button
      key={id}
      className={`nav-link w-full ${page === id ? 'active' : ''}`}
      aria-current={page === id ? 'page' : undefined}
      onClick={() => onNavigate(id)}
    >
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
    </button>
  ));

  return (
    <div className="app-frame md:grid md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="hidden border-r border-[var(--line)] bg-white md:flex md:flex-col">
        <div className="flex h-[68px] items-center gap-3 border-b border-[var(--line)] px-6">
          <span className="grid size-9 place-items-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]"><BookOpen size={20} /></span>
          <span className="brand">Spelling Time</span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-5" aria-label="Main navigation">{links}</nav>
        <div className="border-t border-[var(--line)] p-3">
          <div className="mb-2 px-2 text-sm font-semibold">{user}</div>
          <div className="px-2 text-xs text-[var(--muted)]">{session.room}</div>
          <button className="nav-link mt-3 w-full" onClick={onLogout}><LogOut size={17} />Log out</button>
        </div>
      </aside>

      <div className="workspace flex min-h-screen flex-col">
        <header className="flex min-h-[68px] items-center justify-between border-b border-[var(--line)] bg-white px-4 md:px-8">
          <div className="flex items-center gap-3 md:hidden"><BookOpen className="text-[var(--accent)]" size={21} /><span className="brand">Spelling Time</span></div>
          <div className="hidden text-sm text-[var(--muted)] md:block">{session.room}</div>
          <div className="ml-auto flex items-center gap-2 text-sm font-semibold"><UserRound size={17} /><span className="hidden min-[400px]:inline">{user}</span><button className="ml-1 inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 py-1.5 text-[var(--muted)] hover:bg-[var(--canvas)] hover:text-[var(--ink)] md:hidden" aria-label="Log out" onClick={onLogout}><LogOut size={16} /><span className="hidden min-[400px]:inline">Log out</span></button></div>
        </header>
        <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-6 pb-24 md:px-8 md:py-8 md:pb-10">{children}</main>
        <nav className="mobile-nav flex md:hidden" aria-label="Main navigation">{links}</nav>
      </div>
    </div>
  );
}
