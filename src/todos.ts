/**
 * 事务的待办清单。
 *
 * 与「执行切片」的分工（见 execution-slices.ts）：
 * - 切片是**时间维度**：这个事务在哪一天投入一份；
 * - 待办是**内容维度**：这件事还剩哪几件没做。
 *
 * 两者不互锁：切片做完不要求待办勾完，待办勾完也不代替切片。
 * 唯一的口径约定是「放弃项不扩大分母」——与切片保持一致。
 */

export type TodoStatus = "open" | "done" | "dropped";

export type Todo = {
    id: string;
    text: string;
    status: TodoStatus;
    /** 备注 · 结果：做到哪一步、结论是什么。 */
    note: string;
    /** 参考链接。 */
    links: string[];
    createdAt: number;
    updatedAt: number;
    /** 完成的本地日期（YYYY-MM-DD），非完成状态为 null。 */
    completedOn: string | null;
    /** 放弃原因，仅 dropped 使用。 */
    droppedReason: string;
};

const MAX_TODOS = 500;
const MAX_TEXT_LENGTH = 500;
const MAX_NOTE_LENGTH = 20000;
const MAX_LINKS = 50;

export function normalizeTodos(value: unknown): Todo[] {
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    const result: Todo[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== "object") continue;
        const candidate = raw as Partial<Todo>;
        const text = singleLine(candidate.text);
        if (!text) continue;
        const id = typeof candidate.id === "string" && candidate.id && !ids.has(candidate.id)
            ? candidate.id
            : createTodoId();
        if (ids.has(id)) continue;
        ids.add(id);
        const status = isTodoStatus(candidate.status) ? candidate.status : "open";
        const createdAt = finiteNumber(candidate.createdAt) ?? Date.now();
        result.push({
            id,
            text,
            status,
            note: longText(candidate.note, MAX_NOTE_LENGTH),
            links: normalizeLinks(candidate.links),
            createdAt,
            updatedAt: finiteNumber(candidate.updatedAt) ?? createdAt,
            completedOn: status === "done" ? dateKey(candidate.completedOn) : null,
            droppedReason: status === "dropped" ? singleLine(candidate.droppedReason) : "",
        });
        if (result.length >= MAX_TODOS) break;
    }
    return result;
}

/** 未放弃的条目数，也就是进度分母；放弃项不计入。 */
export function todoDenominator(todos: Todo[]): number {
    return todos.filter((todo) => todo.status !== "dropped").length;
}

export function completedTodoCount(todos: Todo[]): number {
    return todos.filter((todo) => todo.status === "done").length;
}

export function droppedTodoCount(todos: Todo[]): number {
    return todos.filter((todo) => todo.status === "dropped").length;
}

export function openTodos(todos: Todo[]): Todo[] {
    return todos.filter((todo) => todo.status === "open");
}

export function todoCompletionPercent(todos: Todo[]): number {
    const denominator = todoDenominator(todos);
    return denominator > 0 ? Math.min(100, Math.round(completedTodoCount(todos) / denominator * 100)) : 0;
}

/**
 * 一组待办的完成读数。
 *
 * `denominator` 是**有效分母**（未放弃），因此「全部放弃」的清单读数是 0/0 而不是 0/3：
 * 前者表示"这件事不用做了"，后者会永远显示成未完成。此时 `cleared` 为 true。
 */
export type TodoProgress = {
    total: number;
    done: number;
    open: number;
    dropped: number;
    denominator: number;
    percent: number;
    cleared: boolean;
};

export function todoProgress(todos: Todo[]): TodoProgress {
    const done = completedTodoCount(todos);
    const dropped = droppedTodoCount(todos);
    const denominator = todos.length - dropped;
    return {
        total: todos.length,
        done,
        open: todos.length - done - dropped,
        dropped,
        denominator,
        percent: todoCompletionPercent(todos),
        cleared: denominator === 0 || done >= denominator,
    };
}

/** 完成事务前的拦截项：还有未勾完的待办。 */
export function hasUnfinishedTodos(todos: Todo[]): boolean {
    return todos.some((todo) => todo.status === "open");
}

export function createTodo(text: string, now = Date.now(), id = createTodoId()): Todo {
    const normalized = singleLine(text);
    if (!normalized) throw new Error("待办内容不能为空。");
    return {
        id,
        text: normalized,
        status: "open",
        note: "",
        links: [],
        createdAt: now,
        updatedAt: now,
        completedOn: null,
        droppedReason: "",
    };
}

export function addTodo(todos: Todo[], text: string, now = Date.now(), id = createTodoId()): Todo[] {
    return normalizeTodos([...todos, createTodo(text, now, id)]);
}

export function updateTodoText(todos: Todo[], id: string, text: string, now = Date.now()): Todo[] {
    return mapTodo(todos, id, (todo) => ({ ...todo, text: singleLine(text) || todo.text, updatedAt: now }));
}

export function updateTodoNote(todos: Todo[], id: string, note: string, now = Date.now()): Todo[] {
    return mapTodo(todos, id, (todo) => ({ ...todo, note: longText(note, MAX_NOTE_LENGTH), updatedAt: now }));
}

export function updateTodoLinks(todos: Todo[], id: string, links: string[], now = Date.now()): Todo[] {
    return mapTodo(todos, id, (todo) => ({ ...todo, links: normalizeLinks(links), updatedAt: now }));
}

/** 勾选完成：记录完成当天；再点一次撤销回未开始。 */
export function toggleTodoDone(todos: Todo[], id: string, today = localDateKey(), now = Date.now()): Todo[] {
    return mapTodo(todos, id, (todo) => todo.status === "done"
        ? { ...todo, status: "open", completedOn: null, updatedAt: now }
        : { ...todo, status: "done", completedOn: today, droppedReason: "", updatedAt: now });
}

/** 打叉：放弃但保留痕迹；再点一次恢复。 */
export function toggleTodoDropped(todos: Todo[], id: string, reason = "", now = Date.now()): Todo[] {
    return mapTodo(todos, id, (todo) => todo.status === "dropped"
        ? { ...todo, status: "open", droppedReason: "", updatedAt: now }
        : { ...todo, status: "dropped", completedOn: null, droppedReason: singleLine(reason), updatedAt: now });
}

export function dropTodos(todos: Todo[], ids: string[], now = Date.now()): Todo[] {
    const targets = new Set(ids);
    return normalizeTodos(todos.map((todo) => targets.has(todo.id) && todo.status !== "dropped"
        ? { ...todo, status: "dropped" as const, completedOn: null, updatedAt: now }
        : todo));
}

export function removeTodo(todos: Todo[], id: string): Todo[] {
    return normalizeTodos(todos.filter((todo) => todo.id !== id));
}

/** 完成事务时把剩下的未完成待办一并打叉，保留痕迹而不是删除。 */
export function dropOpenTodos(todos: Todo[], now = Date.now()): Todo[] {
    return normalizeTodos(todos.map((todo) => todo.status === "open"
        ? { ...todo, status: "dropped" as const, completedOn: null, updatedAt: now }
        : todo));
}

export function findTodo(todos: Todo[], id: string): Todo | undefined {
    return todos.find((todo) => todo.id === id);
}

/** 待办的自然顺序：未完成在前（保持创建顺序），已完成次之，已放弃最后。 */
export function sortTodosForDisplay(todos: Todo[]): Todo[] {
    const rank: Record<TodoStatus, number> = { open: 0, done: 1, dropped: 2 };
    return [...todos].sort((a, b) => rank[a.status] - rank[b.status] || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function createTodoId(now = Date.now()): string {
    return `todo-${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function localDateKey(timestamp = Date.now()): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function mapTodo(todos: Todo[], id: string, update: (todo: Todo) => Todo): Todo[] {
    if (!todos.some((todo) => todo.id === id)) throw new Error("没有找到要修改的待办，请刷新后重试。");
    return normalizeTodos(todos.map((todo) => todo.id === id ? update(todo) : todo));
}

function isTodoStatus(value: unknown): value is TodoStatus {
    return value === "open" || value === "done" || value === "dropped";
}

/** 待办标题是单行：换行与连续空白压成一个空格。 */
function singleLine(value: unknown): string {
    if (typeof value !== "string") return "";
    return value.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH);
}

function longText(value: unknown, max: number): string {
    if (typeof value !== "string") return "";
    return value.slice(0, max);
}

function normalizeLinks(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const links: string[] = [];
    for (const raw of value) {
        if (typeof raw !== "string") continue;
        const link = raw.trim().slice(0, 2000);
        if (!link || links.includes(link)) continue;
        links.push(link);
        if (links.length >= MAX_LINKS) break;
    }
    return links;
}

function dateKey(value: unknown): string | null {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function finiteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
