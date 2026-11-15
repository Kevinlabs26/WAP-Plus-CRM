export type ImageGenerationResult = { mimeType: string; data: string };
export type ImageGenerationTask = {
  id: string;
  prompt: string;
  category: string;
  targetChatId: string | null;
  targetChatName: string;
  targetAccountId: string | null;
  status: "queued" | "running" | "complete" | "failed";
  phase: "waiting" | "generating";
  createdAt: number;
  result?: ImageGenerationResult;
  error?: string;
  saved?: boolean;
  inserted?: boolean;
};

type NewImageGenerationTask = Omit<ImageGenerationTask, "id" | "status" | "phase" | "createdAt" | "result" | "error" | "saved" | "inserted"> & {
  run: (onStart: () => void) => Promise<ImageGenerationResult>;
};

const MAX_PENDING_TASKS = 4;
let tasks: ImageGenerationTask[] = [];
const queue: string[] = [];
const runners = new Map<string, NewImageGenerationTask["run"]>();
const listeners = new Set<() => void>();
let draining = false;

export const imageGenerationTasksSnapshot = () => tasks;
export const subscribeImageGenerationTasks = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function publish() {
  for (const listener of listeners) listener();
}

function updateTask(id: string, patch: Partial<ImageGenerationTask>) {
  tasks = tasks.map(task => task.id === id ? { ...task, ...patch } : task);
  publish();
}

async function drainQueue() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      const run = runners.get(id);
      if (!run) continue;
      updateTask(id, { status: "running", phase: "waiting" });
      try {
        const result = await run(() => updateTask(id, { phase: "generating" }));
        updateTask(id, { status: "complete", result });
      } catch (error) {
        updateTask(id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
      } finally {
        runners.delete(id);
      }
    }
  } finally {
    draining = false;
  }
}

export function enqueueImageGenerationTask(input: NewImageGenerationTask) {
  if (tasks.filter(task => task.status === "queued" || task.status === "running").length >= MAX_PENDING_TASKS) {
    throw new Error("IMAGE_GENERATION_QUEUE_FULL");
  }
  const id = crypto.randomUUID();
  const { run, ...task } = input;
  tasks = [{ ...task, id, status: "queued", phase: "waiting", createdAt: Date.now() }, ...tasks];
  runners.set(id, run);
  queue.push(id);
  publish();
  void drainQueue();
  return id;
}

export function updateImageGenerationTask(id: string, patch: Partial<Pick<ImageGenerationTask, "saved" | "inserted">>) {
  updateTask(id, patch);
}

export function dismissImageGenerationTask(id: string) {
  const task = tasks.find(item => item.id === id);
  if (!task || task.status === "queued" || task.status === "running") return;
  tasks = tasks.filter(item => item.id !== id);
  publish();
}
