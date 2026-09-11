import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GoogleUsage } from '../../src/translation/types';

interface UsageFile { month: string; characters: number }

export class GoogleUsageLimitError extends Error {}

export class GoogleUsageStore {
  private state: UsageFile;
  private pending = 0;

  constructor(
    private readonly file: string,
    private readonly limit = 450_000,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.state = this.load();
  }

  private currentMonth(): string {
    return this.now().toISOString().slice(0, 7);
  }

  private load(): UsageFile {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<UsageFile>;
      if (typeof parsed.month === 'string' && Number.isSafeInteger(parsed.characters) && parsed.characters! >= 0) {
        return { month: parsed.month, characters: parsed.characters! };
      }
    } catch { /* A missing or damaged counter starts at zero. */ }
    return { month: this.currentMonth(), characters: 0 };
  }

  private refreshMonth(): void {
    const month = this.currentMonth();
    if (this.state.month !== month) {
      this.state = { month, characters: 0 };
      this.persist();
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), 'utf8');
    renameSync(temporary, this.file);
  }

  getUsage(): GoogleUsage {
    this.refreshMonth();
    return { ...this.state, limit: this.limit };
  }

  consume(characters: number): GoogleUsage {
    this.refreshMonth();
    if (!Number.isSafeInteger(characters) || characters < 0) throw new Error('Invalid Google character usage.');
    if (this.state.characters + characters > this.limit) {
      throw new GoogleUsageLimitError('Google free-mode local limit reached.');
    }
    this.state.characters += characters;
    this.persist();
    return this.getUsage();
  }

  reserve(characters: number): { commit(): GoogleUsage; cancel(): void } {
    this.refreshMonth();
    if (!Number.isSafeInteger(characters) || characters < 0) throw new Error('Invalid Google character usage.');
    if (this.state.characters + this.pending + characters > this.limit) {
      throw new GoogleUsageLimitError('Google free-mode local limit reached.');
    }
    this.pending += characters;
    let open = true;
    const close = () => {
      if (!open) return false;
      open = false;
      this.pending -= characters;
      return true;
    };
    return {
      commit: () => {
        if (close()) {
          this.state.characters += characters;
          this.persist();
        }
        return this.getUsage();
      },
      cancel: () => { close(); },
    };
  }
}
