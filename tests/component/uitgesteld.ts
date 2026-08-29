export function uitgesteld<T>() {
  let resolve!: (waarde: T | PromiseLike<T>) => void;
  let reject!: (reden?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
