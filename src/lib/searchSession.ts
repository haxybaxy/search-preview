/**
 * The debounce-and-cancel lifecycle for one open picker.
 *
 * `show()` can be re-entered, so none of this may live on the provider - a
 * second picker would otherwise cancel the first one's work. Keeping it in one
 * object also means a dismissal has a single place to stop everything, rather
 * than a set of timers that outlive the quick pick they were writing to.
 */
export class SearchSession {
    private searchTimer?: NodeJS.Timeout;
    private previewTimer?: NodeJS.Timeout;
    private controller?: AbortController;
    private closed = false;

    /**
     * Start a new search attempt, aborting any that is still running, and
     * return the signal that will be cancelled if this one is superseded.
     */
    public begin(): AbortSignal {
        this.cancelSearch();
        this.controller = new AbortController();
        return this.controller.signal;
    }

    /** Whether this attempt has been superseded, or the picker dismissed. */
    public isStale(signal: AbortSignal): boolean {
        return this.closed || signal.aborted;
    }

    /**
     * Retire an attempt.
     *
     * @returns true if it was still the current attempt and the picker is still
     *   open - in other words, whether the caller still owns the UI.
     */
    public end(signal: AbortSignal): boolean {
        if (this.controller?.signal !== signal) {
            return false;
        }
        this.controller = undefined;
        return !this.closed;
    }

    /** Queue a search, replacing any keystroke still waiting out its delay. */
    public debounceSearch(delayMs: number, run: () => void): void {
        this.cancelSearch();
        this.searchTimer = setTimeout(() => {
            this.searchTimer = undefined;
            if (!this.closed) {
                run();
            }
        }, delayMs);
    }

    /** Queue a preview, replacing any row the user has already moved past. */
    public debouncePreview(delayMs: number, run: () => void): void {
        this.cancelPreview();
        this.previewTimer = setTimeout(() => {
            this.previewTimer = undefined;
            if (!this.closed) {
                run();
            }
        }, delayMs);
    }

    public cancelPreview(): void {
        if (this.previewTimer) {
            clearTimeout(this.previewTimer);
            this.previewTimer = undefined;
        }
    }

    /** The picker was dismissed. Stop everything and stay stopped. */
    public close(): void {
        this.closed = true;
        this.cancelSearch();
        this.cancelPreview();
    }

    private cancelSearch(): void {
        if (this.searchTimer) {
            clearTimeout(this.searchTimer);
            this.searchTimer = undefined;
        }
        this.controller?.abort();
        this.controller = undefined;
    }
}
