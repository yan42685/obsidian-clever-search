import type { ResidentShard } from "../layout/types";
import type { ResidentHotBaseArtifacts } from "../build";
import type { ResidentShardDescriptor } from "../shards";
import type { CompactJobManifest } from "./types";

export type CompactJobManifestStore = Readonly<{
	saveJob: (job: CompactJobManifest) => Promise<void>;
	loadJobs: () => Promise<readonly CompactJobManifest[]>;
	removeJob: (jobId: string) => Promise<void>;
}>;

export type CompactTempArtifact = Readonly<{
	jobId: string;
	outputShardId: string;
	outputDescriptor: ResidentShardDescriptor;
	shard: ResidentShard;
	bodyEvidenceRows?: ResidentHotBaseArtifacts["bodyEvidenceRows"];
	hanDocEvidenceRows?: ResidentHotBaseArtifacts["hanDocEvidenceRows"];
	hanBodyEvidenceRows?: ResidentHotBaseArtifacts["hanBodyEvidenceRows"];
	createdAt: number;
}>;

export type CompactTempArtifactStore = Readonly<{
	saveTempArtifact: (artifact: CompactTempArtifact) => Promise<void>;
	loadTempArtifact: (jobId: string) => Promise<CompactTempArtifact | undefined>;
	removeTempArtifact: (jobId: string) => Promise<void>;
}>;

type AsyncTable<Row, Key> = Readonly<{
	toArray: () => Promise<Row[]>;
	put: (row: Row) => Promise<unknown>;
	get: (key: Key) => Promise<Row | undefined>;
	delete: (key: Key) => Promise<unknown>;
}>;

export class MemoryCompactJobManifestStore implements CompactJobManifestStore {
	private readonly jobs = new Map<string, CompactJobManifest>();

	constructor(initialJobs: readonly CompactJobManifest[] = []) {
		for (const job of initialJobs) {
			this.jobs.set(job.jobId, job);
		}
	}

	async saveJob(job: CompactJobManifest): Promise<void> {
		this.jobs.set(job.jobId, job);
	}

	async loadJobs(): Promise<readonly CompactJobManifest[]> {
		return [...this.jobs.values()].sort((left, right) => left.createdAt - right.createdAt);
	}

	async removeJob(jobId: string): Promise<void> {
		this.jobs.delete(jobId);
	}
}

export class MemoryCompactTempArtifactStore implements CompactTempArtifactStore {
	private readonly artifacts = new Map<string, CompactTempArtifact>();

	async saveTempArtifact(artifact: CompactTempArtifact): Promise<void> {
		this.artifacts.set(artifact.jobId, artifact);
	}

	async loadTempArtifact(jobId: string): Promise<CompactTempArtifact | undefined> {
		return this.artifacts.get(jobId);
	}

	async removeTempArtifact(jobId: string): Promise<void> {
		this.artifacts.delete(jobId);
	}
}

export class DexieCompactJobManifestStore implements CompactJobManifestStore {
	constructor(private readonly table: AsyncTable<CompactJobManifest, string>) {}

	async saveJob(job: CompactJobManifest): Promise<void> {
		await this.table.put(job);
	}

	async loadJobs(): Promise<readonly CompactJobManifest[]> {
		return (await this.table.toArray()).sort((left, right) => left.createdAt - right.createdAt);
	}

	async removeJob(jobId: string): Promise<void> {
		await this.table.delete(jobId);
	}
}

export class DexieCompactTempArtifactStore implements CompactTempArtifactStore {
	constructor(private readonly table: AsyncTable<CompactTempArtifact, string>) {}

	async saveTempArtifact(artifact: CompactTempArtifact): Promise<void> {
		await this.table.put(artifact);
	}

	async loadTempArtifact(jobId: string): Promise<CompactTempArtifact | undefined> {
		return await this.table.get(jobId);
	}

	async removeTempArtifact(jobId: string): Promise<void> {
		await this.table.delete(jobId);
	}
}
