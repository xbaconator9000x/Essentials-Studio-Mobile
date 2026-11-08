import { useCallback, useReducer } from "react";

type UndoableState<T> = {
  value: T | null;
  past: T[];
  future: T[];
};

type UndoableAction<T> =
  | { type: "set"; value: T | null | ((previous: T | null) => T | null); maxHistory: number }
  | { type: "setWithoutHistory"; value: T | null }
  | { type: "resetHistory" }
  | { type: "undo" }
  | { type: "redo"; maxHistory: number };

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function boundedHistory<T>(history: T[], maxHistory: number): T[] {
  return maxHistory > 0 ? history.slice(-maxHistory) : [];
}

function undoableReducer<T>(
  state: UndoableState<T>,
  action: UndoableAction<T>,
): UndoableState<T> {
  switch (action.type) {
    case "set": {
      const value = typeof action.value === "function"
        ? (action.value as (previous: T | null) => T | null)(state.value)
        : action.value;
      if (state.value === null) return { ...state, value };
      return {
        value,
        past: boundedHistory([...state.past, snapshot(state.value)], action.maxHistory),
        future: [],
      };
    }
    case "setWithoutHistory":
      return { ...state, value: action.value };
    case "resetHistory":
      return { ...state, past: [], future: [] };
    case "undo": {
      if (state.value === null || state.past.length === 0) return state;
      return {
        value: state.past[state.past.length - 1],
        past: state.past.slice(0, -1),
        future: [...state.future, snapshot(state.value)],
      };
    }
    case "redo": {
      if (state.value === null || state.future.length === 0) return state;
      return {
        value: state.future[state.future.length - 1],
        past: boundedHistory([...state.past, snapshot(state.value)], action.maxHistory),
        future: state.future.slice(0, -1),
      };
    }
  }
}

/**
 * Wraps a state value with undo/redo history using JSON snapshots.
 *
 * @param initialValue The initial state value
 * @param maxHistory Max number of undo steps to keep (default 50)
 */
export function useUndoable<T>(initialValue: T | null, maxHistory = 50) {
  const [state, dispatch] = useReducer(undoableReducer<T>, {
    value: initialValue,
    past: [],
    future: [],
  });

  const set = useCallback(
    (value: T | null | ((previous: T | null) => T | null)) => {
      dispatch({ type: "set", value, maxHistory });
    },
    [maxHistory],
  );
  const setWithoutHistory = useCallback((value: T | null) => {
    dispatch({ type: "setWithoutHistory", value });
  }, []);
  const resetHistory = useCallback(() => dispatch({ type: "resetHistory" }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo", maxHistory }), [maxHistory]);

  return {
    value: state.value,
    set,
    setWithoutHistory,
    resetHistory,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
