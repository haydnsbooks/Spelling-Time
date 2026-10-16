import { ArrowLeft, Check, Trash2, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { loadStage, loadStageContent } from '../curriculum';
import { loadWordInfo } from '../wordInfo';
import type { ActivityId, Session, StageRecord, WordContent, WordEntry, WordInfo } from '../types';

interface ActivityRunnerProps {
  activity: ActivityId;
  session: Extract<Session, { role: 'student' }>;
  onBack: () => void;
  onComplete: (score: number, total: number) => void;
}

interface Question { word: WordEntry; prompt: string; options: string[]; }
interface PassageAnnotation { id: string; start: number; end: number; quote: string; color: string; note: string; }
interface SelectionDraft { start: number; end: number; quote: string; left: number; top: number; }

const highlightColors = [
  { name: 'Yellow', value: '#fef08a' },
  { name: 'Mint', value: '#a7f3d0' },
  { name: 'Blue', value: '#bae6fd' },
  { name: 'Pink', value: '#fecdd3' },
  { name: 'Lilac', value: '#ddd6fe' }
];

function readPassageAnnotations(key: string): PassageAnnotation[] {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]') as PassageAnnotation[];
  } catch {
    return [];
  }
}

function renderAnnotatedPassage(text: string, annotations: PassageAnnotation[]) {
  const parts = [];
  let cursor = 0;
  for (const annotation of [...annotations].sort((a, b) => a.start - b.start)) {
    const start = Math.max(cursor, Math.min(text.length, annotation.start));
    const end = Math.max(start, Math.min(text.length, annotation.end));
    if (start > cursor) parts.push(text.slice(cursor, start));
    if (end > start) parts.push(<mark key={annotation.id} className="passage-highlight" style={{ backgroundColor: annotation.color }} title={annotation.note || annotation.quote}>{text.slice(start, end)}</mark>);
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

const names: Record<ActivityId, string> = {
  wordlist: 'Word list', passage: 'Phonic passage', testEasy: 'Spelling practice', testHard: 'Spelling challenge',
  defEasy: 'Definitions', defHard: 'Definitions challenge', clozeEasy: 'Complete the sentence',
  clozeHard: 'Sentence challenge', editing: 'Editing passage', dictation: 'Dictation'
};

function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-AU';
  window.speechSynthesis.speak(utterance);
}

function WordLabel({ word, stage }: { word: WordEntry; stage: StageRecord }) {
  return <span className="word-text">{word[1].map(([text, key], index) => <span key={`${text}-${index}`} style={{ color: stage.pal[key] || 'inherit' }}>{text}</span>)}</span>;
}

function WordSymbol({ value }: { value?: string }) {
  const symbol = value?.match(/material-symbols-rounded">([a-z0-9_]+)</)?.[1];
  return symbol ? <span className="material-symbols-rounded ml-2 align-middle text-[var(--accent)]" aria-hidden="true">{symbol}</span> : null;
}

function makeQuestions(words: WordEntry[], activity: ActivityId, entries: Record<string, WordContent>): Question[] {
  const kind = activity.startsWith('def') ? 'definition' : activity.startsWith('cloze') ? 'cloze' : 'spelling';
  const eligible = words.filter(([word]) => kind === 'spelling' || entries[word]?.[kind === 'definition' ? 'd' : 's']);
  return eligible.map(([word, ...rest]) => {
    const clue = entries[word];
    const prompt = kind === 'definition' ? clue?.d || '' : kind === 'cloze' ? (clue?.s || '').replace('___', '_____') : 'Spell the word you hear.';
    const options = eligible.map(([choice]) => choice).filter(choice => choice !== word).sort(() => Math.random() - 0.5).slice(0, 3);
    return { word: [word, ...rest] as WordEntry, prompt, options: [...options, word].sort(() => Math.random() - 0.5) };
  }).sort(() => Math.random() - 0.5);
}

export function ActivityRunner({ activity, session, onBack, onComplete }: ActivityRunnerProps) {
  const [stageData, setStageData] = useState<StageRecord | null>(null);
  const [stageContent, setStageContent] = useState<Record<string, WordContent>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const stageNumber = session.stage || 2;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    Promise.all([loadStage(stageNumber), loadStageContent(stageNumber)]).then(([data, content]) => {
      if (active) { setStageData(data); setStageContent(content); }
    }).catch(error => { if (active) setLoadError(error instanceof Error ? error.message : 'Could not load this activity.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [stageNumber]);
  const weekData = stageData?.weeks[`${session.term}-${session.week}`];
  const list = weekData ? stageData.lists[weekData.l] : undefined;
  const passage = weekData?.p != null && stageData ? stageData.passages[weekData.p] : undefined;
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionsReady, setQuestionsReady] = useState(false);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editText, setEditText] = useState(passage?.e || '');
  const [editFeedback, setEditFeedback] = useState('');
  const [wordDetails, setWordDetails] = useState<Record<string, WordInfo>>({});
  const passageRef = useRef<HTMLParagraphElement>(null);
  const annotationKey = `spelling-time.passage-notes.${session.room}.${session.classNumber}.${session.term}.${session.stage}.${session.week}`;
  const [annotations, setAnnotations] = useState<PassageAnnotation[]>(() => readPassageAnnotations(annotationKey));
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [editingHighlight, setEditingHighlight] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [colorDraft, setColorDraft] = useState(highlightColors[0].value);
  const question = questions[index];

  useEffect(() => {
    if (list) {
      setQuestions(makeQuestions(list.w, activity, stageContent));
      setQuestionsReady(true);
    }
  }, [activity, list, stageContent]);

  useEffect(() => setEditText(passage?.e || ''), [passage]);

  useEffect(() => {
    try { localStorage.setItem(annotationKey, JSON.stringify(annotations)); } catch {}
  }, [annotationKey, annotations]);

  useEffect(() => {
    if (activity !== 'wordlist') return;
    let active = true;
    loadWordInfo().then(details => { if (active) setWordDetails(details); });
    return () => { active = false; };
  }, [activity]);

  async function finish() {
    setSaving(true);
    setError('');
    try {
      await api.post({
        action: 'addResult', id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(), room: session.room, classNumber: session.classNumber,
        student: session.student, term: session.term, stage: session.stage, week: session.week,
        list: String(weekData?.l || ''), activity, score, total: questions.length
      });
      onComplete(score, questions.length);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this result.');
    } finally {
      setSaving(false);
    }
  }

  function submit(value: string) {
    const correct = value.trim().toLocaleLowerCase() === question.word[0].toLocaleLowerCase();
    if (correct) setScore(current => current + 1);
    setIndex(current => current + 1);
    setAnswer('');
    if (index + 1 >= questions.length) setFinished(true);
  }

  function capturePassageSelection() {
    const container = passageRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.isCollapsed || !selection.toString().trim()) {
      setSelectionDraft(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;
    const before = range.cloneRange();
    before.selectNodeContents(container);
    before.setEnd(range.startContainer, range.startOffset);
    const quote = selection.toString();
    const rect = range.getBoundingClientRect();
    setNoteDraft('');
    setEditingHighlight(false);
    setSelectionDraft({
      start: before.toString().length,
      end: before.toString().length + quote.length,
      quote,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 300)),
      top: Math.max(12, rect.top - 46)
    });
  }

  function savePassageHighlight() {
    if (!selectionDraft) return;
    const annotation: PassageAnnotation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      start: selectionDraft.start,
      end: selectionDraft.end,
      quote: selectionDraft.quote,
      color: colorDraft,
      note: noteDraft.trim()
    };
    setAnnotations(current => [...current.filter(item => item.end <= annotation.start || item.start >= annotation.end), annotation]);
    setSelectionDraft(null);
    setEditingHighlight(false);
    window.getSelection()?.removeAllRanges();
  }

  const title = names[activity];
  if (loading) return <p className="py-8 text-sm text-[var(--muted)]" role="status">Loading activity data…</p>;
  if (loadError) return <div className="notice" role="alert">{loadError}</div>;
  if (!stageData || !weekData || !list) return <div className="panel p-6"><button className="action action-secondary mb-5" onClick={onBack}><ArrowLeft size={16} /> Back</button><p>There is no activity data for this week.</p></div>;

  if (activity === 'wordlist') return <section className="screen-enter">
    <button className="action action-secondary mb-5" onClick={onBack}><ArrowLeft size={16} /> Learning</button>
    <div className="mb-6"><div className="eyebrow">Stage {session.stage} · Term {session.term} · Week {session.week}</div><h1 className="mt-2 text-3xl font-bold">{title}</h1><p className="mt-1 text-sm text-[var(--muted)]">{list.t}</p></div>
    <label className="mb-4 block max-w-sm"><span className="field-label">Filter words</span><input className="control" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search this list" /></label>
    <div className="panel px-5"><div className="divide-y divide-[var(--line)]">{list.w.filter(item => item[0].toLowerCase().includes(search.toLowerCase())).map(item => <div className="word-row" key={item[0]}><button className="text-left" onClick={() => { setSelectedWord(item[0]); speak(item[0]); }}><WordLabel word={item} stage={stageData} /></button><button className="action action-secondary" aria-label={`Hear ${item[0]}`} onClick={() => speak(item[0])}><Volume2 size={17} /></button></div>)}</div></div>
    {selectedWord && <div className="panel mt-4 p-5" role="region" aria-label={`${selectedWord} word information`}><div className="flex items-start justify-between"><div><div className="eyebrow">Word details</div><h2 className="mt-1 text-xl font-bold">{selectedWord}<WordSymbol value={wordDetails[selectedWord]?.e} /></h2></div><button className="action action-secondary" onClick={() => setSelectedWord(null)}>Close</button></div><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">{[["Definition", wordDetails[selectedWord]?.d || stageContent[selectedWord]?.d], ['Part of speech', wordDetails[selectedWord]?.p], ['Synonyms', wordDetails[selectedWord]?.s], ['Antonyms', wordDetails[selectedWord]?.a], ['Root', wordDetails[selectedWord]?.r], ['Word family', wordDetails[selectedWord]?.f]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd className="mt-1 leading-6 text-[var(--muted)]">{value}</dd></div>)}</dl>{wordDetails[selectedWord]?.x?.length ? <div className="mt-4"><h3 className="text-sm font-semibold">Prefixes and suffixes</h3><ul className="mt-1 list-inside list-disc text-sm leading-6 text-[var(--muted)]">{wordDetails[selectedWord].x.map(item => <li key={item}>{item}</li>)}</ul></div> : null}</div>}
  </section>;

  if (activity === 'editing') return <section className="screen-enter max-w-4xl">
    <button className="action action-secondary mb-5" onClick={onBack}><ArrowLeft size={16} /> Learning</button>
    <div className="eyebrow">Stage {session.stage} · Term {session.term} · Week {session.week}</div><h1 className="mt-2 text-3xl font-bold">Editing passage</h1>
    <p className="mt-2 text-sm text-[var(--muted)]">Correct the spelling in the passage, then compare your version with the original.</p>
    <form className="panel mt-6 p-5 sm:p-7" onSubmit={event => { event.preventDefault(); const clean = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase(); setEditFeedback(clean(editText) === clean(passage?.c || '') ? 'All spelling corrections match the original passage.' : 'Some spelling differences remain. Review the passage and try again.'); }}>
      <label className="field-label" htmlFor="editing-passage">Passage</label><textarea id="editing-passage" className="control min-h-64 resize-y font-mono text-sm leading-7" value={editText} onChange={event => setEditText(event.target.value)} />
      {editFeedback && <p className="mt-4 text-sm font-semibold text-[var(--accent)]" role="status">{editFeedback}</p>}
      <button className="action action-primary mt-4" type="submit">Check passage</button>
    </form>
  </section>;

  if (activity === 'passage') return <section className="screen-enter">
    <button className="action action-secondary mb-5" onClick={onBack}><ArrowLeft size={16} /> Learning</button>
    <div className="eyebrow">Stage {session.stage} · Term {session.term} · Week {session.week}</div><h1 className="mt-2 text-3xl font-bold">{passage?.t || title}</h1>
    <div className="panel relative mt-6 p-5 sm:p-7">
      <p ref={passageRef} className="passage-copy whitespace-pre-wrap text-base leading-8" onMouseUp={capturePassageSelection} onTouchEnd={capturePassageSelection} onKeyUp={capturePassageSelection}>{passage?.c && renderAnnotatedPassage(passage.c, annotations)}</p>
      {passage?.c && <button className="action action-secondary mt-5" onClick={() => speak(passage.c)}><Volume2 size={17} /> Read passage</button>}
      {annotations.length > 0 && <aside className="mt-6 border-t border-[var(--line)] pt-4" aria-label="Passage highlights and notes"><h2 className="mb-3 text-sm font-bold">Highlights and notes</h2><ul className="divide-y divide-[var(--line)]">{[...annotations].sort((a, b) => a.start - b.start).map(annotation => <li key={annotation.id} className="flex items-start gap-3 py-3"><span className="mt-1 size-3 shrink-0 rounded-full" style={{ backgroundColor: annotation.color }} aria-hidden="true" /><div className="min-w-0 flex-1"><blockquote className="text-sm font-semibold">“{annotation.quote}”</blockquote>{annotation.note && <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-[var(--muted)]">{annotation.note}</p>}</div><button className="action action-secondary min-h-8 px-2 py-1" aria-label={`Remove highlight: ${annotation.quote}`} onClick={() => setAnnotations(current => current.filter(item => item.id !== annotation.id))}><Trash2 size={15} /></button></li>)}</ul></aside>}
      {selectionDraft && !editingHighlight && <button className="passage-selection-action" style={{ left: selectionDraft.left, top: selectionDraft.top }} onMouseDown={event => event.preventDefault()} onClick={() => setEditingHighlight(true)}>Highlight selection</button>}
      {selectionDraft && editingHighlight && <div className="passage-note-editor" style={{ left: selectionDraft.left, top: Math.max(12, Math.min(selectionDraft.top + 44, window.innerHeight - 250)) }} role="dialog" aria-label="Add passage highlight">
        <p className="mb-3 line-clamp-2 text-sm font-semibold">“{selectionDraft.quote}”</p>
        <div className="mb-2 text-xs font-semibold text-[var(--muted)]">Highlight colour</div>
        <div className="mb-3 flex gap-2" role="group" aria-label="Highlight colour">
          {highlightColors.map(color => <button key={color.name} type="button" className={`passage-color${colorDraft === color.value ? ' selected' : ''}`} style={{ backgroundColor: color.value }} aria-label={color.name} aria-pressed={colorDraft === color.value} onMouseDown={event => event.preventDefault()} onClick={() => setColorDraft(color.value)} />)}
        </div>
        <label className="field-label" htmlFor="passage-note">Note</label>
        <textarea id="passage-note" className="control min-h-20 resize-y text-sm" placeholder="Add a note (optional)" value={noteDraft} onChange={event => setNoteDraft(event.target.value)} />
        <div className="mt-3 flex justify-end gap-2"><button className="action action-secondary" onClick={() => { setSelectionDraft(null); setEditingHighlight(false); }}>Cancel</button><button className="action action-primary" onClick={savePassageHighlight}>Save highlight</button></div>
      </div>}
    </div>
  </section>;

  if (!questionsReady) return <p className="py-8 text-sm text-[var(--muted)]" role="status">Preparing questions…</p>;
  if (questions.length === 0) return <div className="panel p-6"><h1 className="section-title">No questions available</h1><p className="mt-2 text-sm text-[var(--muted)]">This activity does not have enough matching words for the selected week.</p><button className="action action-secondary mt-5" onClick={onBack}><ArrowLeft size={16} /> Back to learning</button></div>;
  if (finished || !question) return <section className="panel screen-enter max-w-xl p-7 sm:p-9"><div className="eyebrow">Activity complete</div><h1 className="mt-2 text-3xl font-bold">{score} / {questions.length}</h1><p className="mt-2 text-[var(--muted)]">Your result is ready to save.</p>{error && <p className="notice mt-4">{error}</p>}<div className="mt-6 flex gap-2"><button className="action action-primary" disabled={saving} onClick={() => void finish()}>{saving ? 'Saving…' : 'Save result'}</button><button className="action action-secondary" onClick={onBack}>Back to learning</button></div></section>;

  const isChoice = (activity === 'defEasy' || activity === 'clozeEasy');
  const isAudio = activity === 'testEasy' || activity === 'testHard' || activity === 'dictation';
  return <section className="screen-enter max-w-3xl">
    <button className="action action-secondary mb-5" onClick={onBack}><ArrowLeft size={16} /> Learning</button>
    <div className="mb-5 flex items-center justify-between"><div><div className="eyebrow">{title}</div><h1 className="mt-1 text-2xl font-bold">Question {index + 1} of {questions.length}</h1></div><span className="text-sm font-semibold text-[var(--muted)]">{score} correct</span></div>
    <div className="panel p-5 sm:p-8"><div className="mb-6 min-h-20 text-lg leading-8">{isAudio ? <div><p className="mb-4">Listen, then type the word.</p><button className="action action-secondary" onClick={() => speak(question.word[0])}><Volume2 size={18} /> Play word</button></div> : question.prompt}</div>
      {isChoice ? <div className="grid gap-2 sm:grid-cols-2">{question.options.map(option => <button key={option} className="action action-secondary justify-start px-4" onClick={() => submit(option)}>{option}</button>)}</div> : <form className="flex flex-col gap-3 sm:flex-row" onSubmit={event => { event.preventDefault(); if (answer.trim()) submit(answer); }}><input className="control flex-1" autoFocus value={answer} onChange={event => setAnswer(event.target.value)} aria-label="Your answer" /><button className="action action-primary" type="submit">Check answer <Check size={16} /></button></form>}
    </div>
  </section>;
}
