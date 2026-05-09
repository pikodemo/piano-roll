import { openDB, type IDBPDatabase } from "idb";
import type { Project } from "./types";
import { DEFAULT_INSTRUMENT } from "./audio";

const DB_NAME = "piano-roll";
const STORE = "projects";
const VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

export async function listProjects(): Promise<Array<{ id: string; name: string; updatedAt: number }>> {
  const d = await db();
  const all = (await d.getAll(STORE)) as Project[];
  return all
    .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const d = await db();
  const p = (await d.get(STORE, id)) as Project | undefined;
  return p ? migrate(p) : undefined;
}

// Forward-compat: fill in fields added after the project was originally saved.
function migrate(p: Project): Project {
  return {
    ...p,
    voices: p.voices.map((v) => ({
      ...v,
      instrument: v.instrument ?? DEFAULT_INSTRUMENT,
      volume: v.volume ?? 1,
    })),
  };
}

export async function saveProject(project: Project): Promise<void> {
  const d = await db();
  await d.put(STORE, project);
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  await d.delete(STORE, id);
}
