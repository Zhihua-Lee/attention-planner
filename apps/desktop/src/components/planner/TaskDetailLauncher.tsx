import { createContext, useContext } from 'react';

/** Standalone legacy task rows keep their editor; the application supplies a common detail route. */
export const TaskDetailLauncher = createContext<((taskId: string) => void) | null>(null);
export const useTaskDetailLauncher = () => useContext(TaskDetailLauncher);
