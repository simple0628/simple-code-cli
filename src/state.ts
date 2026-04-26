/**
 * 全局共享状态 - 中断控制
 */

let controller = new AbortController();

export function getSignal(): AbortSignal {
  return controller.signal;
}

export function resetInterrupt(): void {
  controller = new AbortController();
}

export function triggerInterrupt(): void {
  controller.abort();
}

export function isInterrupted(): boolean {
  return controller.signal.aborted;
}
