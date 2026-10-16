import { useEffect, useState } from 'react';
import { api } from '../api';
import { supermarket } from '../storeData';
import type { StudentSession } from '../types';

interface Wallet {
  balance: number;
  spent: number;
  owned: string[];
  resetToday?: boolean;
}

interface StoreViewProps {
  session: StudentSession;
}

export function StoreView({ session }: StoreViewProps) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [view, setView] = useState<'market' | 'fridge'>('market');
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Wallet>({ action: 'getWallet', room: session.room, classNumber: session.classNumber, catalogVersion: supermarket.version })
      .then(setWallet)
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load the supermarket.'));
  }, [session.room, session.classNumber]);

  const items = supermarket.aisles.flatMap(aisle => aisle.shelves.flat().map(([id, icon, name, price]) => ({ id, icon, name, price, aisle: aisle.name, aisleIcon: aisle.icon })));
  const owned = new Set(wallet?.owned || []);

  async function buy(item: typeof items[number]) {
    if (!wallet || wallet.balance < item.price || owned.has(item.id)) return;
    setBusyId(item.id);
    setError('');
    try {
      const updated = await api.post<Wallet>({ action: 'buyItem', room: session.room, classNumber: session.classNumber, student: session.student, itemId: item.id, price: item.price, catalogVersion: supermarket.version });
      setWallet(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not buy this item.');
    } finally {
      setBusyId('');
    }
  }

  async function resetFridge() {
    if (!wallet || !owned.size || wallet.resetToday || !window.confirm('Return every item to the supermarket and restore the Fremantium you spent?')) return;
    setBusyId('reset');
    setError('');
    try {
      const updated = await api.post<Wallet>({ action: 'resetPurchases', room: session.room, classNumber: session.classNumber, student: session.student, catalogVersion: supermarket.version });
      setWallet(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not reset your fridge.');
    } finally {
      setBusyId('');
    }
  }

  const visibleItems = items.filter(item => view === 'market' ? !owned.has(item.id) : owned.has(item.id));
  return <section className="screen-enter">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><div className="eyebrow mb-2">Student workspace</div><h1 className="text-3xl font-bold">Supermarket</h1><p className="mt-1 text-sm text-[var(--muted)]">Items are bought with Fremantium earned from activity results.</p></div><div className="panel px-4 py-3 text-sm"><span className="text-[var(--muted)]">Available</span><strong className="ml-3 text-lg">{wallet?.balance ?? '—'} F</strong></div></div>
    <div className="mb-4 flex items-center justify-between border-b border-[var(--line)]"><div><button className={`border-b-2 px-4 py-3 text-sm font-semibold ${view === 'market' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'}`} onClick={() => setView('market')}>Market</button><button className={`border-b-2 px-4 py-3 text-sm font-semibold ${view === 'fridge' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'}`} onClick={() => setView('fridge')}>My fridge ({owned.size})</button></div>{view === 'fridge' && <button className="action action-secondary mb-1" disabled={!owned.size || !wallet || wallet.resetToday || busyId === 'reset'} onClick={() => void resetFridge()}>{wallet?.resetToday ? 'Reset available tomorrow' : busyId === 'reset' ? 'Resetting…' : 'Reset fridge'}</button>}</div>
    {error && <div className="notice mb-4" role="alert">{error}</div>}
    {!wallet && !error ? <p className="py-8 text-sm text-[var(--muted)]">Loading saved purchases…</p> : visibleItems.length === 0 ? <p className="panel p-6 text-sm text-[var(--muted)]">{view === 'market' ? 'Everything is in your fridge.' : 'Your fridge is empty.'}</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visibleItems.map(item => <article key={item.id} className="panel flex items-center justify-between gap-4 p-4"><div className="min-w-0"><div className="eyebrow flex items-center gap-1"><span className="material-symbols-rounded" aria-hidden="true">{item.aisleIcon}</span>{item.aisle}</div><h2 className="mt-1 truncate font-semibold">{item.name}</h2><p className="mt-1 text-sm text-[var(--muted)]">{item.price} Fremantium</p></div>{view === 'market' && <button className="action action-primary shrink-0" disabled={!wallet || wallet.balance < item.price || busyId === item.id} onClick={() => void buy(item)}>{busyId === item.id ? 'Buying…' : 'Buy'}</button>}</article>)}</div>}
  </section>;
}
