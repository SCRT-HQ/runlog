import type {
  EnvironmentLink,
  ExternalEvent,
  ExternalSubject,
  LinkStatus,
} from "@runlog/engine";

/**
 * A pretend environment.
 *
 * Every real adapter needs something the developer may not have running — a
 * host application, a bridge on a socket, a folder on disk. This one needs
 * nothing, which is what lets the whole path be built and tested before any of
 * that exists: connect, snapshot, subscribe, reconcile, write a name back.
 *
 * It is also the specification by example. An adapter that behaves like this
 * one will work; the panel does not know which it is talking to.
 */
export class MockEnvironment implements EnvironmentLink {
  readonly id = "mock";
  readonly label = "Practice environment";
  readonly requires = "Nothing. It is made up, for trying the connection out.";

  private state: LinkStatus = "disconnected";
  private subjects: ExternalSubject[] = [];
  private listeners = new Set<(event: ExternalEvent) => void>();
  private nextId = 1;

  constructor(initial: string[] = []) {
    for (const name of initial) this.add(name);
  }

  status(): LinkStatus {
    return this.state;
  }

  async connect(): Promise<LinkStatus> {
    this.state = "connecting";
    // A real link is a round trip, and a panel that never shows "connecting"
    // will be written as though connection were free.
    await new Promise((resolve) => setTimeout(resolve, 120));
    this.state = "connected";
    this.emit({ t: "changed" });
    return this.state;
  }

  disconnect(): void {
    this.state = "disconnected";
    this.emit({ t: "changed" });
  }

  async snapshot(): Promise<{ subjects: ExternalSubject[] }> {
    if (this.state !== "connected") return { subjects: [] };
    return { subjects: this.subjects.map((s) => ({ ...s })) };
  }

  subscribe(listener: (event: ExternalEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async applyLabel(subjectId: string, name: string): Promise<void> {
    const found = this.subjects.find((s) => s.id === subjectId);
    if (!found) return;
    found.name = name;
    this.emit({ t: "subjectRenamed", id: subjectId, name });
  }

  /* ---- the parts a real environment would do on its own ---------------- */

  add(name: string, kind?: string): ExternalSubject {
    const subject: ExternalSubject = {
      id: `m${this.nextId++}`,
      name,
      index: this.subjects.length + 1,
      ...(kind ? { kind } : {}),
    };
    this.subjects.push(subject);
    this.emit({ t: "subjectAdded", subject });
    return subject;
  }

  remove(id: string): void {
    this.subjects = this.subjects.filter((s) => s.id !== id);
    this.reindex();
    this.emit({ t: "subjectRemoved", id });
  }

  rename(id: string, name: string): void {
    void this.applyLabel(id, name);
  }

  /** Swap two positions, to produce the disagreement that actually matters. */
  swap(a: number, b: number): void {
    const list = this.subjects;
    if (!list[a] || !list[b]) return;
    [list[a], list[b]] = [list[b]!, list[a]!];
    this.reindex();
    this.emit({ t: "changed" });
  }

  private reindex(): void {
    this.subjects.forEach((s, i) => {
      s.index = i + 1;
    });
  }

  private emit(event: ExternalEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
