import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

/* ============================================================
   NavTree — sidebar nav with collapsible groups.
   Generic over the section-id union type so each dashboard
   (Partner/Client/Admin) keeps its own typed routes.
   Auto-expands the group that contains the active section;
   the user can collapse manually.
   ============================================================ */

export type NavTreeItem<S extends string> = {
  id: S;
  label: string;
  icon: React.ReactNode;
};

export type NavTreeGroup<S extends string> = {
  kind: "group";
  id: string;
  label: string;
  icon: React.ReactNode;
  children: NavTreeItem<S>[];
};

export type NavTreeNode<S extends string> =
  | ({ kind: "item" } & NavTreeItem<S>)
  | NavTreeGroup<S>;

export function NavTree<S extends string>({
  tree,
  section,
  onSelect,
  badgeFor,
}: {
  tree: NavTreeNode<S>[];
  section: S;
  onSelect: (id: S) => void;
  /** Optional unread-count style badge per leaf section. Returns 0/undefined → no badge. */
  badgeFor?: (id: S) => number | undefined;
}) {
  // Groups that contain the active section start expanded.
  const initialExpanded = useMemo(() => {
    const ids = new Set<string>();
    for (const node of tree) {
      if (node.kind === "group" && node.children.some((c) => c.id === section)) {
        ids.add(node.id);
      }
    }
    return ids;
  }, [tree, section]);

  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);

  // When the user navigates into a different group, expand it automatically.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const node of tree) {
        if (node.kind === "group" && node.children.some((c) => c.id === section)) {
          next.add(node.id);
        }
      }
      return next;
    });
  }, [section, tree]);

  const toggle = (gid: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });

  return (
    <div className="flex flex-col gap-0.5">
      {tree.map((node) => {
        if (node.kind === "item") {
          const active = section === node.id;
          const badge = badgeFor?.(node.id);
          return (
            <button
              key={node.id}
              onClick={() => onSelect(node.id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {node.icon}
              <span className="flex-1 text-left">{node.label}</span>
              {badge !== undefined && badge > 0 && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {badge}
                </span>
              )}
            </button>
          );
        }
        // group
        const isOpen = expanded.has(node.id);
        const containsActive = node.children.some((c) => c.id === section);
        const aggregateBadge =
          badgeFor &&
          node.children.reduce((sum, c) => sum + (badgeFor(c.id) ?? 0), 0);
        return (
          <div key={node.id} className="mb-0.5">
            <button
              type="button"
              onClick={() => toggle(node.id)}
              aria-expanded={isOpen}
              className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                containsActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <span className={containsActive ? "text-primary" : ""}>{node.icon}</span>
              <span className="flex-1 text-left">{node.label}</span>
              {containsActive && !isOpen && (
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: "#E8542A" }}
                />
              )}
              {!isOpen && aggregateBadge !== undefined && aggregateBadge > 0 && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {aggregateBadge}
                </span>
              )}
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                  isOpen ? "rotate-180 text-primary" : "text-muted-foreground/70"
                }`}
              />
            </button>
            {/* Children — animated reveal via CSS grid trick */}
            <div
              className="grid transition-[grid-template-rows] duration-200 ease-out"
              style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
            >
              <div className="overflow-hidden">
                <div
                  className="relative ml-5 mt-0.5 flex flex-col gap-0.5 border-l pl-3"
                  style={{ borderColor: "rgba(244,238,226,0.10)" }}
                >
                  {node.children.map((c) => {
                    const active = section === c.id;
                    const childBadge = badgeFor?.(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => onSelect(c.id)}
                        className={`relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition ${
                          active
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        {active && (
                          <span
                            aria-hidden
                            className="absolute -left-[13px] top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full"
                            style={{ background: "#E8542A" }}
                          />
                        )}
                        <span className="opacity-80">{c.icon}</span>
                        <span className="flex-1 text-left">{c.label}</span>
                        {childBadge !== undefined && childBadge > 0 && (
                          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                            {childBadge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default NavTree;
