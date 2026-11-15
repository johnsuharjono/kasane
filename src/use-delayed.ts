import { useEffect, useState } from "react";

/**
 * True once `active` has stayed true for `delay` ms; false as soon as it ends.
 * Keeps fast operations from flashing busy states (spinners, Cancel buttons).
 */
export function useDelayed(active: boolean, delay = 300) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(timer);
  }, [active, delay]);
  return active && shown;
}
