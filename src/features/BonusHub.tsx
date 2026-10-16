import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Lightbulb, RotateCcw, Volume2 } from 'lucide-react';
import { loadStage, loadStageContent } from '../curriculum';
import type { StageRecord, WordContent } from '../types';
import { isRealWord } from '../dictionary';
import type { WordEntry } from '../types';

interface BonusHubProps { stage: number | null; term: number; week: number; }
type Game = 'hangman' | 'ice' | 'speed' | null;

function say(word: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const speech = new SpeechSynthesisUtterance(word);
  speech.lang = 'en-AU';
  window.speechSynthesis.speak(speech);
}

function randomWord(words: WordEntry[], minimum = 1, maximum = 99) {
  const choices = words.map(item => item[0]).filter(word => word.length >= minimum && word.length <= maximum);
  return choices[Math.floor(Math.random() * choices.length)] || '';
}

export function BonusHub({ stage, term, week }: BonusHubProps) {
  const [stageData, setStageData] = useState<StageRecord | null>(null);
  const [stageContent, setStageContent] = useState<Record<string, WordContent>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let active = true;
    if (!stage) {
      setStageData(null);
      setLoading(false);
      setLoadError('Ask your teacher to assign your stage before opening bonus games.');
      return () => { active = false; };
    }
    setLoading(true);
    setLoadError('');
    Promise.all([loadStage(stage), loadStageContent(stage)]).then(([data, content]) => {
      if (active) { setStageData(data); setStageContent(content); }
    }).catch(error => { if (active) setLoadError(error instanceof Error ? error.message : 'Could not load game data.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [stage]);
  const weekData = stageData?.weeks[`${term}-${week}`];
  const list = weekData ? stageData?.lists[weekData.l] : undefined;
  const words = list?.w || [];
  const [game, setGame] = useState<Game>(null);
  const [target, setTarget] = useState('');
  const [guessed, setGuessed] = useState<string[]>([]);
  const [hint, setHint] = useState(false);
  const [rows, setRows] = useState<string[]>([]);
  const [guess, setGuess] = useState('');
  const [feedback, setFeedback] = useState('');
  const [seconds, setSeconds] = useState(60);
  const [running, setRunning] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const speedWord = words.length ? words[speedIndex % words.length][0] : '';

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setSeconds(value => {
      if (value <= 1) { setRunning(false); return 0; }
      return value - 1;
    }), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  function restart(nextGame: Game = game) {
    const selectedGame = nextGame || 'hangman';
    setTarget(randomWord(words, selectedGame === 'ice' ? 4 : 1, selectedGame === 'ice' ? 8 : 99));
    setGuessed([]); setHint(false); setRows([]); setGuess(''); setFeedback('');
    setSeconds(60); setRunning(false); setSpeedIndex(0); setCorrectCount(0);
  }

  function hangLetter(letter: string) {
    if (!guessed.includes(letter)) setGuessed(current => [...current, letter]);
  }

  function submitIce(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = guess.trim().toLowerCase();
    if (value.length !== target.length) return setFeedback(`Enter a ${target.length}-letter word.`);
    if (!isRealWord(value) && !words.some(item => item[0].toLowerCase() === value)) return setFeedback('That word is not in the dictionary.');
    if (rows.includes(value)) return setFeedback('You already tried that word.');
    const nextRows = [...rows, value];
    setRows(nextRows); setGuess('');
    setFeedback(value === target ? 'You found the word.' : nextRows.length === 6 ? `No guesses left. The word was ${target}.` : '');
  }

  function submitSpeed(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guess.trim().toLowerCase() === speedWord.toLowerCase()) {
      setCorrectCount(value => value + 1); setSeconds(value => value + 3); setSpeedIndex(value => value + 1); setGuess('');
    } else setFeedback('Try again or skip this word.');
  }

  if (loading) return <p className="py-8 text-sm text-[var(--muted)]" role="status">Loading game data…</p>;
  if (loadError) return <div className="notice" role="alert">{loadError}</div>;
  if (!words.length) return <section className="panel p-6"><h1 className="section-title">Bonus games</h1><p className="mt-2 text-sm text-[var(--muted)]">Choose a week with a spelling list to play.</p></section>;
  if (!game) return <section className="screen-enter"><div className="mb-7"><div className="eyebrow mb-2">Student workspace</div><h1 className="text-3xl font-bold">Bonus games</h1><p className="mt-1 text-sm text-[var(--muted)]">Quick word games using this week’s list.</p></div><div className="grid gap-4 md:grid-cols-3">{[['hangman', 'Spellsa', 'Reveal the word one letter at a time.'], ['ice', 'Ice Blocks', 'Find the word in six guesses.'], ['speed', 'Let it Go', 'Spell as many words as you can.']].map(([id, title, detail]) => <button key={id} className="panel p-5 text-left hover:border-[var(--accent)]" onClick={() => { const nextGame = id as Game; setGame(nextGame); restart(nextGame); }}><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm text-[var(--muted)]">{detail}</p></button>)}</div></section>;

  const solved = guessed.length > 0 && [...target].every(letter => guessed.includes(letter));
  const wrong = guessed.filter(letter => !target.includes(letter)).length;
  return <section className="screen-enter max-w-3xl">
    <button className="action action-secondary mb-5" onClick={() => setGame(null)}><ArrowLeft size={16} /> Bonus games</button>
    <div className="mb-5 flex items-end justify-between"><div><div className="eyebrow">Bonus games</div><h1 className="mt-1 text-3xl font-bold">{game === 'hangman' ? 'Spellsa' : game === 'ice' ? 'Ice Blocks' : 'Let it Go'}</h1></div><button className="action action-secondary" onClick={() => restart()}><RotateCcw size={16} /> New game</button></div>
    {game === 'hangman' && <div className="panel p-5 sm:p-7"><div className="flex items-center justify-between"><span className="text-sm text-[var(--muted)]">{6 - wrong} lives remaining</span><button className="action action-secondary" onClick={() => setHint(true)}><Lightbulb size={16} /> Hint</button></div>{hint && <p className="mt-4 text-sm text-[var(--muted)]">{stageContent[target]?.d || 'No hint for this word.'}</p>}<div className="my-8 flex justify-center gap-2">{[...target].map((letter, index) => <span key={`${index}-${letter}`} className="min-w-8 border-b-2 border-[var(--ink)] px-1 pb-2 text-center text-2xl font-bold">{guessed.includes(letter) ? letter : ''}</span>)}</div><div className="flex flex-wrap justify-center gap-2">{'abcdefghijklmnopqrstuvwxyz'.split('').map(letter => <button key={letter} className="action action-secondary size-10 p-0 uppercase" disabled={guessed.includes(letter) || solved || wrong >= 6} onClick={() => hangLetter(letter)}>{letter}</button>)}</div>{(solved || wrong >= 6) && <p className="mt-5 text-center font-semibold">{solved ? 'Word found.' : `The word was ${target}.`}</p>}</div>}
    {game === 'ice' && <div className="panel p-5 sm:p-7"><div className="mx-auto grid max-w-sm gap-2">{Array.from({ length: 6 }, (_, row) => <div key={row} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${target.length}, minmax(0, 1fr))` }}>{Array.from({ length: target.length }, (_, column) => { const value = rows[row]?.[column]; const state = !value ? '' : target[column] === value ? 'bg-[#d7eee5] border-[#3b8d70]' : target.includes(value) ? 'bg-[#f8edcd] border-[#c7a64b]' : 'bg-[#edf0ed] border-[#c9d2cc]'; return <span key={column} className={`grid aspect-square place-items-center border text-lg font-bold uppercase ${state}`}>{value || ''}</span>; })}</div>)}</div>{rows.at(-1) !== target && rows.length < 6 && <form className="mx-auto mt-5 flex max-w-sm gap-2" onSubmit={submitIce}><input className="control uppercase" maxLength={target.length} value={guess} onChange={event => setGuess(event.target.value.replace(/[^a-z]/gi, ''))} aria-label="Guess word" /><button className="action action-primary" type="submit">Guess</button></form>}<p className="mt-3 text-center text-sm text-[var(--muted)]" role="status">{feedback || `Guess a ${target.length}-letter real word.`}</p></div>}
    {game === 'speed' && <div className="panel max-w-xl p-6"><div className="flex justify-between text-sm"><span>Time <strong>{seconds}s</strong></span><span>Correct <strong>{correctCount}</strong></span></div><div className="my-8 text-center"><button className="action action-secondary" onClick={() => say(speedWord)}><Volume2 size={18} /> Hear word</button></div>{running && seconds > 0 ? <form className="flex gap-2" onSubmit={submitSpeed}><input className="control" autoFocus value={guess} onChange={event => setGuess(event.target.value)} aria-label="Spell the word" /><button className="action action-primary" type="submit"><Check size={16} /> Check</button><button className="action action-secondary" type="button" onClick={() => { setSeconds(value => Math.max(0, value - 3)); setSpeedIndex(value => value + 1); setGuess(''); }}>Skip</button></form> : <button className="action action-primary" onClick={() => { restart(); setRunning(true); }}>Start 60-second round</button>}{feedback && <p className="mt-3 text-sm text-[var(--warning)]">{feedback}</p>}</div>}
  </section>;
}
