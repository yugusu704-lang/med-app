type LeaveGuard = () => Promise<boolean>;
let leaveGuard: LeaveGuard | undefined;

export function registerAndroidBackGuard(guard: LeaveGuard) {
  leaveGuard = guard;
  return () => { if (leaveGuard === guard) leaveGuard = undefined; };
}

export async function canLeaveOnAndroidBack() {
  return leaveGuard ? leaveGuard() : true;
}

/** Return a second-level page to its section, never to browser history. */
export function primaryRouteFor(pathname: string, search: string) {
  if (pathname.startsWith("/subjects/")) return "/subjects";
  if (pathname === "/quiz/session") {
    const returnTo = new URLSearchParams(search).get("returnTo");
    if (returnTo === "obe") return "/quiz?source=OBE大纲";
    return returnTo === "/search" ? "/search" : returnTo === "/subjects" ? "/subjects" : returnTo === "/" ? "/" : "/quiz";
  }
  return "/";
}
