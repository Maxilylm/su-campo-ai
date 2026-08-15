/** Share concurrent calls to an expensive async operation, then allow the
 * next caller to start a fresh operation after the current one settles. */
export function createSingleFlight<T>() {
  let inFlight: Promise<T> | null = null;

  return (operation: () => Promise<T>): Promise<T> => {
    if (inFlight) return inFlight;

    const current = operation();
    const tracked = current.finally(() => {
      if (inFlight === tracked) inFlight = null;
    });
    inFlight = tracked;
    return tracked;
  };
}
