// A new round requires a quiet interval after a dialog appears.
export class RestartGuard {
  constructor(activeInputs = [], now = () => performance.now(), delay = 900) {
    this.now = now;
    this.delay = delay;
    this.active = new Set(activeInputs);
    this.until = now() + delay;
    this.armed = false;
  }
  ready() {
    if (!this.armed && this.active.size === 0 && this.now() >= this.until)
      this.armed = true;
    return this.armed;
  }
  press(input) {
    const ready = this.ready();
    this.active.add(input);
    if (!ready) this.until = this.now() + this.delay;
  }
  release(input) {
    if (this.active.delete(input) && !this.armed)
      this.until = this.now() + this.delay;
  }
}
