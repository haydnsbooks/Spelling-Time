import type { ClassRoom } from './types';

const rooms = import.meta.glob<ClassRoom>('../data/classes/*.json', { eager: true, import: 'default' });
export const classLists = Object.values(rooms).sort((a, b) => Number(a.room.match(/\d+/)?.[0]) - Number(b.room.match(/\d+/)?.[0]));
