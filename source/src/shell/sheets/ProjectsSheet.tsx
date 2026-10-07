import { useState, type FormEvent } from "react";
import { useBoard } from "../../store";
import { useUI } from "../../ui/uiContext";
import { Sheet, SheetBody } from "../../ui/Sheet";
import { Sortable } from "../../ui/Sortable";
import { GripVertical, Plus, Trash2 } from "../../ui/icons";
import { now } from "../../data/clock";
import { CommitColor, CommitInput } from "../../ui/CommitInput";

const PALETTE = ["#147bd1", "#0f9f6e", "#e4572e", "#7c5cff", "#c98200", "#d6336c", "#64748b"];

export default function ProjectsSheet() {
  const { data, mutate } = useBoard();
  const { close } = useUI();
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[data.projects.length % PALETTE.length]);

  const use = (id: string) => data.tasks.filter((t) => t.projectId === id).length + data.pedPosts.filter((p) => p.projectId === id).length;

  function add(event: FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    void mutate((draft) => {
      if (draft.projects.some((p) => p.name.toLowerCase() === clean.toLowerCase())) return false;
      draft.projects.push({ id: `p${now()}`, name: clean, color });
    });
    setName("");
    setColor(PALETTE[(data.projects.length + 1) % PALETTE.length]);
  }

  return (
    <Sheet title="Projects" onClose={close}>
      <SheetBody>
        <p className="field-hint">
          Projects are the rows of the Gantt, in this order. Drag the handle to reorder.
          With the keyboard: focus a handle, press Space, move with the arrow keys, press Space to drop.
        </p>
        <Sortable
          label="Projects, in Gantt order"
          items={data.projects}
          getKey={(project) => project.id}
          getName={(project) => project.name}
          onReorder={(from, to) => void mutate((draft) => { const [moved] = draft.projects.splice(from, 1); draft.projects.splice(to, 0, moved); })}
          renderItem={(project, { index, handle }) => {
            const used = use(project.id);
            return (
              <>
                <button type="button" className="drag-handle" {...handle} aria-label={`Reorder ${project.name}. Position ${index + 1} of ${data.projects.length}. Press space to pick up.`}>
                  <GripVertical aria-hidden />
                </button>
                <CommitColor value={project.color} label={`Color of ${project.name}`} onCommit={(next) => void mutate((d) => { const p = d.projects.find((x) => x.id === project.id); if (p) p.color = next; })} />
                <CommitInput className="input input--sm settings-name-input" value={project.name} aria-label={`Name of ${project.name}`} onCommit={(next) => void mutate((d) => { const p = d.projects.find((x) => x.id === project.id); if (p) p.name = next; })} />
                {used > 0 && <span className="project-row-count">{used} {used === 1 ? "item" : "items"}</span>}
                <button type="button" className="icon-btn icon-btn--sm" disabled={used > 0} title={used > 0 ? `${used} tasks or posts use this project` : "Remove project"} aria-label={used > 0 ? `${project.name} is in use and cannot be removed` : `Remove ${project.name}`} onClick={() => void mutate((d) => { d.projects = d.projects.filter((x) => x.id !== project.id); })}><Trash2 /></button>
              </>
            );
          }}
        />
        <form className="add-row" onSubmit={add}>
          <input className="input input--sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" aria-label="New project name" autoComplete="off" data-autofocus={data.projects.length === 0 ? true : undefined} />
          <input className="input input--sm color-input" type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="New project color" />
          <button type="submit" className="btn btn--sm btn--primary" disabled={!name.trim()}><Plus />Add</button>
        </form>
      </SheetBody>
    </Sheet>
  );
}
