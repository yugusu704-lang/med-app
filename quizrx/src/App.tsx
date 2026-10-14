import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { canLeaveOnAndroidBack, primaryRouteFor } from "@/lib/androidBack";
import { BookOpen, Home, Play, Search } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
const NAV = [{ to: "/", label: "首页", icon: Home, end: true }, { to: "/quiz", label: "刷题", icon: Play, end: false }, { to: "/subjects", label: "科目", icon: BookOpen, end: false }, { to: "/search", label: "搜索", icon: Search, end: false }];
type Startup = {
    phase: "preparing" | "copying" | "ready" | "error";
    message: string;
    copiedBytes: number;
    totalBytes: number;
    error: string | null;
};
export default function App() {
    const location = useLocation();
    const navigate = useNavigate();
    const handlingBack = useRef(false);
    useEffect(() => {
        const onBack = async () => {
            if (handlingBack.current) return;
            handlingBack.current = true;
            try {
                if (await canLeaveOnAndroidBack()) {
                    navigate(primaryRouteFor(location.pathname, location.search), { replace: true });
                }
            } finally { handlingBack.current = false; }
        };
        window.addEventListener("quizrx:android-back", onBack);
        return () => window.removeEventListener("quizrx:android-back", onBack);
    }, [location.pathname, location.search, navigate]);
    useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
    const [startup, setStartup] = useState<Startup | null>(null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        if (!isTauri()) {
            setStartup({ phase: "error", message: "请在安装后的应用中使用真实离线题库。", error: null, copiedBytes: 0, totalBytes: 0 });
            return;
        }
        const check = async () => {
            try {
                const value = await invoke<Startup>("get_startup_status");
                if (cancelled) {
                    return;
                }
                setStartup(value);
                if (value.phase !== "ready" && value.phase !== "error") {
                    timer = setTimeout(check, 300);
                }
            }
            catch (e) {
                if (!cancelled) {
                    setStartup({ phase: "error", message: String(e), error: null, copiedBytes: 0, totalBytes: 0 });
                }
            }
        };
        setStartup(null);
        void check();
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [attempt]);
    return <div className="app-shell flex flex-col">
    <main className="app-main">{startup?.phase === "ready" ? <Outlet /> : <div className="page">
      <header className="brand-row">
        <span className="brand">QUIZ / RX</span>
        <span className="stamp">离线题库</span>
      </header>
      <section className="hero" aria-live="polite">
        <h1>{startup?.phase === "error" ? "题库暂未就绪" : "正在准备题库"}</h1>
        <p>{startup?.message ?? "首次启动正在准备离线资源，请稍候。"}</p>{startup?.phase === "copying" && <progress className="w-full" value={startup.copiedBytes} max={startup.totalBytes || 1}/>}</section>{startup?.phase === "error" && <button className="subject-row" onClick={async () => {
                    try {
                        await invoke("retry_startup");
                        setAttempt(x => x + 1);
                    }
                    catch (e) {
                        setStartup(current => current ? { ...current, message: String(e) } : current);
                    }
                }}>重新准备</button>}</div>}</main>
    <nav className="app-nav" aria-label="主导航">
      <div className="app-nav-inner">{NAV.map(item => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? "active" : ""}>
        <item.icon size={21} strokeWidth={2.5}/>{item.label}</NavLink>)}</div>
    </nav>
  </div>;
}
