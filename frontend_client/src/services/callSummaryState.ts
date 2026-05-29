type Listener = (visible: boolean) => void;

let summaryVisible = false;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((listener) => listener(summaryVisible));
}

export const callSummaryState = {
  getSummaryVisible() {
    return summaryVisible;
  },
  setSummaryVisible(nextVisible: boolean) {
    summaryVisible = nextVisible;
    notify();
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    listener(summaryVisible);
    return () => {
      listeners.delete(listener);
    };
  },
  reset() {
    summaryVisible = false;
    notify();
  },
};
