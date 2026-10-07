import { Suspense, lazy } from "react";
import { useUI } from "../ui/uiContext";

const TaskSheet = lazy(() => import("./sheets/TaskSheet"));
const PostSheet = lazy(() => import("./sheets/PostSheet"));
const InfluencerSheet = lazy(() => import("./sheets/InfluencerSheet"));
const InfluencerToGanttSheet = lazy(() => import("./sheets/InfluencerToGanttSheet"));
const CreatorSheet = lazy(() => import("./sheets/CreatorSheet"));
const SettingsSheet = lazy(() => import("./sheets/SettingsSheet"));
const ProjectsSheet = lazy(() => import("./sheets/ProjectsSheet"));
const HistorySheet = lazy(() => import("./sheets/HistorySheet"));
const ApprovalsSheet = lazy(() => import("./sheets/ApprovalsSheet"));
const NotificationsSheet = lazy(() => import("./sheets/NotificationsSheet"));
const DateDialog = lazy(() => import("./sheets/DateDialog"));

/** Renders whichever editor/panel the UI context asks for. One overlay at a time. */
export default function SheetHost() {
  const { sheet } = useUI();
  if (!sheet) return null;
  // `key` remounts the sheet when a different record is opened so its draft state never leaks across records
  const key = JSON.stringify(sheet);
  return (
    <Suspense fallback={null}>
      {sheet.kind === "task" && <TaskSheet key={key} id={sheet.id} defaults={sheet.defaults} />}
      {sheet.kind === "post" && <PostSheet key={key} id={sheet.id} defaults={sheet.defaults} />}
      {sheet.kind === "influencer" && <InfluencerSheet key={key} id={sheet.id} />}
      {sheet.kind === "influencerToGantt" && <InfluencerToGanttSheet key={key} influencerId={sheet.influencerId} />}
      {sheet.kind === "creator" && <CreatorSheet key={key} id={sheet.id} />}
      {sheet.kind === "settings" && <SettingsSheet key={key} section={sheet.section} />}
      {sheet.kind === "projects" && <ProjectsSheet key={key} />}
      {sheet.kind === "history" && <HistorySheet key={key} />}
      {sheet.kind === "approvals" && <ApprovalsSheet key={key} />}
      {sheet.kind === "notifications" && <NotificationsSheet key={key} />}
      {sheet.kind === "pedToGantt" && <DateDialog key={key} kind="pedToGantt" id={sheet.postId} />}
      {sheet.kind === "ganttToPed" && <DateDialog key={key} kind="ganttToPed" id={sheet.taskId} />}
    </Suspense>
  );
}
