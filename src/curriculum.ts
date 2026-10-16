import type { StageRecord, WordContent } from './types';

const stageFiles = import.meta.glob<StageRecord>('../data/curriculum/*.json', { import: 'default' });
const contentFiles = import.meta.glob<Record<string, WordContent>>('../data/content-shards/*.json', { import: 'default' });

export async function loadStage(stage: number): Promise<StageRecord> {
	const [file, load] = Object.entries(stageFiles).find(([name]) => name.endsWith(`/stage-${stage}.json`)) || [];
	if (!file || !load) throw new Error(`Stage ${stage} curriculum is not available.`);
	return load();
}

export async function loadStageContent(stage: number): Promise<Record<string, WordContent>> {
	const loaders = Object.entries(contentFiles).filter(([file]) => file.includes(`/stage-${stage}-`)).map(([, load]) => load());
	const chunks = await Promise.all(loaders);
	return Object.assign({}, ...chunks);
}
