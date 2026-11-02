import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { TASK_STATUSES, type Task, type TaskCheckSide, type TaskPriority, type TaskStatus } from "@scope/contracts";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelative } from "@/lib/date";
import { canEditProject } from "@/lib/permissions";
import { CHECK_SIDE_LABEL, TASK_STATUS_META, isResolved } from "@/lib/taskStatus";
import { BottomSheet, Button, Checkbox, ConfirmDialog, Input, MemberAvatar, Select, Skeleton, Textarea } from "@/design-system";
import { useAppStore } from "@/store/useAppStore";
import { TaskStatusBadge } from "./TaskStatusBadge";
import { useTaskSheet } from "./useTaskSheet";

/**
 * "Rise for task": the task editor rises from the bottom on mobile and docks
 * as a side panel on desktop. Mounted once in the app shell; opened by the
 * `?task=` param from any page.
 */
export function TaskDetailSheet() {
  const { taskUuid, closeTask } = useTaskSheet();
  const tasksByProject = useAppStore((s) => s.tasksByProject);

  const task = useMemo(() => {
    if (!taskUuid) return null;
    for (const tasks of Object.values(tasksByProject)) {
      const found = tasks.find((t) => t.uuid === taskUuid);
      if (found) return found;
    }
    return null;
  }, [taskUuid, tasksByProject]);

  return (
    <BottomSheet open={taskUuid !== null} onClose={closeTask} snapPoints={[0.62, 0.94]} desktop="panel" desktopWidthClassName="max-w-[26rem]" title={task ? undefined : "Task"} hideClose={!!task}>
      {task ? <TaskEditor key={task.uuid} task={task} onClose={closeTask} /> : <TaskEditorSkeleton />}
    </BottomSheet>
  );
}

function TaskEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const project = useAppStore((s) => s.projects.find((p) => p.uuid === task.projectUuid));
  const currentUser = useAppStore((s) => s.currentUser);
  const canEdit = canEditProject(project, currentUser);
  const sections = useAppStore((s) => s.sectionsByProject[task.projectUuid]);
  const comments = useAppStore((s) => s.commentsByTask[task.uuid]);
  const toggleCheck = useAppStore((s) => s.toggleCheck);
  const setTaskStatus = useAppStore((s) => s.setTaskStatus);
  const updateTask = useAppStore((s) => s.updateTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const loadComments = useAppStore((s) => s.loadComments);
  const addComment = useAppStore((s) => s.addComment);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [comment, setComment] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [postingComment, setPostingComment] = useState(false);

  useEffect(() => {
    void loadComments(task.uuid);
  }, [task.uuid, loadComments]);

  const section = sections?.find((s) => s.uuid === task.sectionUuid);

  const commitTitle = () => {
    const next = title.trim();
    if (!next) {
      setTitle(task.title);
      return;
    }
    if (next !== task.title) void updateTask(task.uuid, { title: next });
  };

  const commitDescription = () => {
    const next = description.trim();
    if (next !== (task.description ?? "")) void updateTask(task.uuid, { description: next || null });
  };

  const submitComment = async (e: FormEvent) => {
    e.preventDefault();
    const body = comment.trim();
    if (!body || postingComment) return;
    setPostingComment(true);
    try {
      await addComment(task.uuid, body);
      setComment("");
    } finally {
      setPostingComment(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pt-1 lg:pt-0">
      {/* Context + close */}
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-xs text-ink-muted">
          {project?.name ?? "Project"}
          {section && <span className="text-ink-faint"> / {section.title}</span>}
        </p>
        <button type="button" onClick={onClose} className="text-xs font-medium text-ink-muted hover:text-ink">
          Done
        </button>
      </div>

      {/* Title */}
      <div>
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          rows={1}
          aria-label="Task title"
          readOnly={!canEdit}
          data-autofocus={!task.title && canEdit ? true : undefined}
          className={cn("field-sizing-content w-full resize-none bg-transparent text-lg leading-7 font-semibold text-ink focus:outline-none", isResolved(task) && "text-ink-muted")}
        />
        <TaskStatusBadge status={task.status} className="mt-1.5" />
      </div>

      {/* Remarks status — the picker from the scope document */}
      <Select label="Remarks" value={task.status} onChange={(e) => void setTaskStatus(task.uuid, e.target.value as TaskStatus)} disabled={!canEdit}>
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_META[s].label}
          </option>
        ))}
      </Select>

      {/* Checked by — Developer / Client, each with who + when */}
      <section aria-labelledby="task-checks-heading" className="rounded-xl border border-line">
        <h3 id="task-checks-heading" className="border-b border-line px-3 py-2 text-xs font-medium text-ink-muted">
          Checked by
        </h3>
        <ul className="divide-y divide-line">
          {(["developer", "client"] as TaskCheckSide[]).map((side) => {
            const check = side === "developer" ? task.developerCheck : task.clientCheck;
            return (
              <li key={side} className="flex items-center gap-3 px-3 py-2.5">
                <Checkbox checked={check !== null} onChange={() => void toggleCheck(task.uuid, side)} disabled={!canEdit} label={check ? `Clear ${CHECK_SIDE_LABEL[side]} check` : `Mark checked by ${CHECK_SIDE_LABEL[side]}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{CHECK_SIDE_LABEL[side]}</p>
                  {check ? (
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {check.checkedBy.name} · <time dateTime={check.checkedAt}>{formatDateTime(check.checkedAt)}</time>
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-ink-faint">Not yet checked</p>
                  )}
                </div>
                {check && <MemberAvatar user={check.checkedBy} size="sm" />}
              </li>
            );
          })}
        </ul>
      </section>

      <Textarea
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={commitDescription}
        placeholder={canEdit ? "Add details, acceptance criteria, or links" : "No description"}
        readOnly={!canEdit}
        className="min-h-20"
      />

      {/* Fields */}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Due date" type="date" value={task.dueDate ?? ""} onChange={(e) => void updateTask(task.uuid, { dueDate: e.target.value || null })} disabled={!canEdit} />
        <Select label="Priority" value={task.priority} onChange={(e) => void updateTask(task.uuid, { priority: e.target.value as TaskPriority })} disabled={!canEdit}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </Select>
        <Select label="Assignee" value={task.assignee?.uuid ?? ""} onChange={(e) => void updateTask(task.uuid, { assigneeUuid: e.target.value || null })} disabled={!canEdit}>
          <option value="">Unassigned</option>
          {project?.members.map((m) => (
            <option key={m.user.uuid} value={m.user.uuid}>
              {m.user.name}
            </option>
          ))}
        </Select>
        <Select label="Section" value={task.sectionUuid} onChange={(e) => void updateTask(task.uuid, { sectionUuid: e.target.value })} disabled={!canEdit}>
          {sections?.map((s) => (
            <option key={s.uuid} value={s.uuid}>
              {s.title}
            </option>
          ))}
        </Select>
      </div>

      {/* Comments */}
      <section aria-labelledby="task-comments-heading" className="flex flex-col gap-3">
        <h3 id="task-comments-heading" className="text-xs font-medium text-ink-muted">
          Comments {task.commentCount > 0 && <span className="text-ink-faint">· {task.commentCount}</span>}
        </h3>
        {comments === undefined ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-[80%]" />
          </div>
        ) : comments.length === 0 ? (
          <p className="text-sm text-ink-faint">No comments yet.</p>
        ) : (
          <ul className="space-y-3">
            {comments.map((c) => (
              <li key={c.uuid} className="flex gap-2.5">
                <MemberAvatar user={c.author} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm bg-surface-muted px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-medium text-ink">{c.author.name}</span>
                    <span className="shrink-0 text-[11px] text-ink-faint">{formatRelative(c.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink">{c.body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={submitComment} className="flex items-end gap-2">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Write a comment"
            aria-label="New comment"
            className="min-h-10 py-2"
            rows={1}
            wrapperClassName="flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submitComment(e);
            }}
          />
          <Button type="submit" variant="secondary" size="md" disabled={!comment.trim()} loading={postingComment}>
            Post
          </Button>
        </form>
      </section>

      {/* Actions */}
      <div className="mt-2 flex items-center gap-2 border-t border-line pt-4">
        {canEdit ? (
          <Button variant="ghost" size="sm" leadingIcon={<Trash2 className="size-4" aria-hidden />} className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        ) : (
          <span className="text-xs text-ink-faint">View only · you can comment</span>
        )}
        <div className="flex-1" />
        <p className="text-xs text-ink-faint">
          Updated <time dateTime={task.updatedAt}>{formatRelative(task.updatedAt)}</time>
        </p>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await deleteTask(task.uuid);
          onClose();
        }}
        title="Delete this task?"
        description={
          <>
            <span className="font-medium text-ink">“{task.title}”</span> and its comments will be removed from the checklist. This cannot be undone.
          </>
        }
        confirmLabel="Delete task"
        destructive
      />
    </div>
  );
}

function TaskEditorSkeleton() {
  return (
    <div className="space-y-5 pt-2">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-7 w-[80%]" />
      <Skeleton className="h-20 w-full" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    </div>
  );
}
