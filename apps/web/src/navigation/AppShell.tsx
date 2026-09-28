import { useEffect, useId, useRef, useState, type MouseEventHandler, type ReactNode } from "react";
import type { ProfilePage } from "../profile/route.ts";
import { ThemeMenu } from "../theme/ThemeMenu.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { useFocusTrap } from "../ui/useFocusTrap.ts";
import { SidebarAccount } from "./SidebarAccount.tsx";
import { SidebarIcon, SidebarItem, type SidebarAction, type SidebarIconName } from "./SidebarItem.tsx";

const MOBILE = "(max-width: 760px)";
const COLLAPSED_KEY = "runlog:sidebar-collapsed";

function useMobileSidebar() {
  const [mobile, setMobile] = useState(() => typeof matchMedia === "function" && matchMedia(MOBILE).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(MOBILE);
    const read = () => setMobile(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);
  return mobile;
}

export function AppShell({
  brand,
  pageKey,
  items,
  onOpenProfile,
  onOpenThemes,
  onAccountAction,
  onClickCapture,
  children,
}: {
  brand: ReactNode;
  pageKey: string;
  items: { label: string; icon: SidebarIconName; current?: boolean; primary?: boolean; act: SidebarAction }[];
  onOpenProfile: (page?: ProfilePage) => Promise<boolean>;
  onOpenThemes: () => Promise<boolean>;
  onAccountAction: (action: () => void) => Promise<boolean>;
  onClickCapture?: MouseEventHandler<HTMLDivElement>;
  children: ReactNode;
}) {
  const mobile = useMobileSidebar();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  // A phone always starts closed. Opening it never overwrites the desktop preference.
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useFocusTrap(panel, mobile && open, () => setOpen(false));
  useEffect(() => setOpen(false), [pageKey, mobile]);

  const toggle = () => {
    if (mobile) {
      setOpen((before) => !before);
      return;
    }
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, String(next));
    } catch {
      /* Still usable when storage is unavailable. */
    }
  };
  const perform = async (action: SidebarAction) => {
    setProblem(null);
    try {
      // A confirmation or other input owns focus until it resolves. Cancellation
      // leaves the drawer available; even same-page navigation closes on success.
      if ((await action()) !== false) setOpen(false);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That action could not be completed. Please try again.");
    }
  };
  const toggleLabel = mobile ? "Open sidebar" : collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <div className={`app appWithSidebar${!mobile && collapsed ? " sidebarCollapsed" : ""}`} onClickCapture={onClickCapture}>
      <header className="topbar appTopbar">
        <div className="sidebarBrand">
          <IconButton
            label={toggleLabel}
            title={toggleLabel}
            aria-controls={id}
            aria-expanded={mobile ? open : !collapsed}
            onClick={toggle}
          >
            <SidebarIcon name={mobile ? "menu" : collapsed ? "expand" : "collapse"} />
          </IconButton>
          {brand}
        </div>
        <div className="topbarEnd">
          <ThemeMenu pickerOnly />
        </div>
      </header>
      <div
        ref={panel}
        id={id}
        className={`sidebarLayer${mobile ? " sidebarDrawer" : ""}`}
        hidden={mobile && !open}
        role={mobile ? "dialog" : undefined}
        aria-modal={mobile ? true : undefined}
        aria-label={mobile ? "Navigation" : undefined}
        tabIndex={-1}
      >
        {mobile && (
          <button type="button" className="sidebarBackdrop" tabIndex={-1} aria-label="Dismiss navigation" onClick={() => setOpen(false)} />
        )}
        <aside className="appSidebar" aria-label="Sidebar">
          {mobile && (
            <div className="sidebarDrawerHead">
              <strong>Navigation</strong>
              <IconButton label="Close sidebar" onClick={() => setOpen(false)}>
                <SidebarIcon name="close" />
              </IconButton>
            </div>
          )}
          <nav aria-label="Main navigation">
            {items.map(({ act, ...item }) => (
              <SidebarItem key={item.label} {...item} onClick={() => void perform(act)} />
            ))}
          </nav>
          <SidebarAccount
            visible={!mobile || open}
            profileCurrent={pageKey === "profile"}
            themesCurrent={pageKey === "themes"}
            onOpenProfile={onOpenProfile}
            onOpenThemes={onOpenThemes}
            onAccountAction={onAccountAction}
            perform={perform}
          />
          {problem && (
            <p className="sidebarProblem" role="alert">
              {problem}
            </p>
          )}
        </aside>
      </div>
      {children}
    </div>
  );
}
