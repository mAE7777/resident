export interface FloodControl {
  onEditFailure(): void;
  onEditSuccess(): void;
  shouldEdit(): boolean;
  getCurrentInterval(): number;
  resetForNewTurn(): void;
}

const MAX_FLOOD_STRIKES = 3;

export function createFloodControl(baseIntervalMs = 1000): FloodControl {
  let consecutiveFailures = 0;
  let editingDisabled = false;
  let currentIntervalMs = baseIntervalMs;

  return {
    onEditFailure() {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_FLOOD_STRIKES) {
        editingDisabled = true;
      } else {
        currentIntervalMs *= 2;
      }
    },
    onEditSuccess() {
      consecutiveFailures = 0;
      currentIntervalMs = baseIntervalMs;
    },
    shouldEdit() {
      return !editingDisabled;
    },
    getCurrentInterval() {
      return currentIntervalMs;
    },
    resetForNewTurn() {
      consecutiveFailures = 0;
      editingDisabled = false;
      currentIntervalMs = baseIntervalMs;
    },
  };
}
