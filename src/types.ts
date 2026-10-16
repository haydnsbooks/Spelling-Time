export type Role = 'student' | 'teacher';
export type ActivityId =
  | 'wordlist'
  | 'passage'
  | 'testEasy'
  | 'testHard'
  | 'defEasy'
  | 'defHard'
  | 'clozeEasy'
  | 'clozeHard'
  | 'editing'
  | 'dictation';

export interface Student {
  classNumber: number;
  firstName: string;
  lastName: string;
  displayName: string;
  yearLevel?: number | null;
  isTestAccount?: boolean;
}

export interface ClassRoom {
  room: string;
  students: Student[];
}

export type Segment = [text: string, colour: string];
export type WordEntry = [word: string, segments: Segment[], listId?: number];

export interface WeekRecord {
  l: number;
  c?: string;
  n?: string;
  lab?: string;
  p?: number | null;
  pt?: string;
}

export interface WordListRecord {
  t: string;
  w: WordEntry[];
}

export interface PassageRecord {
  t: string;
  c: string;
  e?: string;
}

export interface StageRecord {
  title: string;
  pal: Record<string, string>;
  weeks: Record<string, WeekRecord>;
  lists: Record<number, WordListRecord>;
  passages: PassageRecord[];
}

export interface WordContent {
  d?: string;
  s?: string;
}

export interface WordInfo extends WordContent {
  e?: string;
  p?: string;
  a?: string;
  r?: string;
  f?: string;
  x?: string[];
}

export interface Aisle {
  id: string;
  name: string;
  icon: string;
  fridge: string;
  colour: string;
  shelves: [string, string, string, number][][];
}

export interface Supermarket {
  version: number;
  aisles: Aisle[];
}

export interface AppConfig {
  SHEETS_URL: string;
}

export interface StudentSession {
  role: 'student';
  room: string;
  student: string;
  firstName: string;
  classNumber: number;
  term: number;
  stage: number | null;
  week: number;
}

export interface TeacherSession {
  role: 'teacher';
  room: string;
  password: string;
}

export type Session = StudentSession | TeacherSession;
