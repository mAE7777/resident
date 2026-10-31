// Background task system: task lifecycle management with ID generation and eviction.

export type TaskType = "agent_turn" | "dream" | "delegate" | "cron";
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "killed";

export interface Task {
  id: string;
  type: TaskType;
  status: TaskStatus;
  message: string;
  startedAt: number;
  completedAt: number | null;
  output: string | null;
}

const TYPE_PREFIXES: Record<TaskType, string> = {
  agent_turn: "agt",
  dream: "drm",
  delegate: "del",
  cron: "crn",
};

const TERMINAL_STATUSES = new Set<TaskStatus>(["completed", "failed", "killed"]);
const EVICTION_DELAY_MS = 3000;

// ── ID generation ─────────────────────────────────────────────────────────────

function randomBase36(length: number): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export function generateTaskId(type: TaskType): string {
  return `${TYPE_PREFIXES[type]}_${randomBase36(8)}`;
}

// ── TaskManager ───────────────────────────────────────────────────────────────

export interface TaskManager {
  create(type: TaskType, message: string): Task;
  update(id: string, status: TaskStatus, output?: string): void;
  get(id: string): Task | undefined;
  list(): Task[];
}

export function createTaskManager(): TaskManager {
  const tasks = new Map<string, Task>();
  const evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function scheduleEviction(id: string): void {
    // Cancel existing timer if any
    const existing = evictionTimers.get(id);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      tasks.delete(id);
      evictionTimers.delete(id);
    }, EVICTION_DELAY_MS);

    evictionTimers.set(id, timer);
  }

  return {
    create(type: TaskType, message: string): Task {
      const id = generateTaskId(type);
      const task: Task = {
        id,
        type,
        status: "pending",
        message,
        startedAt: Date.now(),
        completedAt: null,
        output: null,
      };
      tasks.set(id, task);
      return task;
    },

    update(id: string, status: TaskStatus, output?: string): void {
      const task = tasks.get(id);
      if (!task) return;

      const updated: Task = {
        ...task,
        status,
        output: output !== undefined ? output : task.output,
        completedAt: TERMINAL_STATUSES.has(status) ? Date.now() : task.completedAt,
      };
      tasks.set(id, updated);

      if (TERMINAL_STATUSES.has(status)) {
        scheduleEviction(id);
      }
    },

    get(id: string): Task | undefined {
      return tasks.get(id);
    },

    list(): Task[] {
      return Array.from(tasks.values());
    },
  };
}
