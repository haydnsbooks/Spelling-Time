import type { WordInfo } from './types';

let wordInfoPromise: Promise<Record<string, WordInfo>> | null = null;
const wordInfoChunks = import.meta.glob<Record<string, WordInfo>>('../data/word-info-shards/*.json', { import: 'default' });

export function loadWordInfo(): Promise<Record<string, WordInfo>> {
  wordInfoPromise ??= Promise.all(Object.values(wordInfoChunks).map(load => load())).then(chunks => Object.assign({}, ...chunks));
  return wordInfoPromise;
}
