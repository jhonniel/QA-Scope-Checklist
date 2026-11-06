import { AnimatePresence, Reorder, useDragControls, useReducedMotion } from "framer-motion";
import type { Task, TaskCheckSide } from "@scope/contracts";
import { transitions } from "@/lib/motion";
import { TaskRow } from "./TaskRow";

export type ToggleCheck = (task: Task, side: TaskCheckSide) => void;

export interface TaskListProps {
  tasks: Task[];
  onToggleCheck: ToggleCheck;
  onOpen?: (task: Task) => void;
  /** Called with the full new order when a drag reorder finishes. Ignored when `readOnly`. */
  onReorder?: (ordered: Task[]) => void;
  selectedUuid?: string | null;
  pickedUuids?: ReadonlySet<string>;
  onTogglePicked?: (task: Task) => void;
  showContext?: (task: Task) => string | undefined;
  /** Viewer role: no ticking, no reordering. */
  readOnly?: boolean;
  allowClientCheck?: boolean;
}

/** Vertical list of TaskRows with optional drag-and-drop reordering. */
export function TaskList({ tasks, onToggleCheck, onOpen, onReorder, selectedUuid, pickedUuids, onTogglePicked, showContext, readOnly = false, allowClientCheck = false }: TaskListProps) {
  const reduceMotion = useReducedMotion();

  if (!onReorder || readOnly) {
    return (
      <ul className="-mx-3">
        <AnimatePresence initial={false}>
          {tasks.map((task) => (
            <li key={task.uuid}>
              <TaskRow
                task={task}
                onToggleCheck={onToggleCheck}
                onOpen={onOpen}
                selected={task.uuid === selectedUuid}
                picked={pickedUuids?.has(task.uuid)}
                onTogglePicked={onTogglePicked}
                context={showContext?.(task)}
                readOnly={readOnly}
                allowClientCheck={allowClientCheck}
              />
            </li>
          ))}
        </AnimatePresence>
      </ul>
    );
  }

  return (
    <Reorder.Group axis="y" values={tasks} onReorder={onReorder} className="-mx-3 lg:ml-0" layoutScroll>
      {tasks.map((task) => (
        <ReorderableTaskRow
          key={task.uuid}
          task={task}
          onToggleCheck={onToggleCheck}
          onOpen={onOpen}
          selected={task.uuid === selectedUuid}
          picked={pickedUuids?.has(task.uuid)}
          onTogglePicked={onTogglePicked}
          reduceMotion={!!reduceMotion}
          allowClientCheck={allowClientCheck}
        />
      ))}
    </Reorder.Group>
  );
}

function ReorderableTaskRow({
  task,
  onToggleCheck,
  onOpen,
  selected,
  picked,
  onTogglePicked,
  reduceMotion,
  allowClientCheck,
}: {
  task: Task;
  onToggleCheck: ToggleCheck;
  onOpen?: (t: Task) => void;
  selected: boolean;
  picked?: boolean;
  onTogglePicked?: (task: Task) => void;
  reduceMotion: boolean;
  allowClientCheck?: boolean;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={task}
      dragListener={false}
      dragControls={controls}
      layout="position"
      transition={reduceMotion ? { duration: 0 } : transitions.layout}
      whileDrag={{ scale: 1.01, backgroundColor: "var(--color-surface)", boxShadow: "var(--shadow-panel)", zIndex: 10 }}
      className="relative rounded-xl lg:ml-5"
    >
      <TaskRow
        task={task}
        onToggleCheck={onToggleCheck}
        onOpen={onOpen}
        selected={selected}
        picked={picked}
        onTogglePicked={onTogglePicked}
        onDragHandlePointerDown={(e) => controls.start(e)}
        allowClientCheck={allowClientCheck}
      />
    </Reorder.Item>
  );
}
