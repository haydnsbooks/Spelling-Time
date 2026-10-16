import dictionary from '../data/dictionary.json';

const words = dictionary as Record<string, string | string[]>;

export function isRealWord(value: string): boolean {
  const word = value.trim().toLowerCase();
  const lengthIndex = words[String(word.length)];
  const extra = words.EXTRA;
  if (typeof lengthIndex === 'string') {
    for (let index = 0; index + word.length <= lengthIndex.length; index += word.length) {
      if (lengthIndex.slice(index, index + word.length) === word) return true;
    }
  }
  return Array.isArray(extra) && extra.includes(word);
}
