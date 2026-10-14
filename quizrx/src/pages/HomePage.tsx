import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, BookOpen, Play, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStats, listActiveSessions } from "@/lib/invoke";
import type { Stats, SessionSummary } from "@/types";
export function HomePage() {
    const navigate = useNavigate();
    const [stats, setStats] = useState<Stats | null>(null);
    const [outlineStats, setOutlineStats] = useState<Stats | null>(null);
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [error, setError] = useState("");
    useEffect(() => {
        getStats().then(setStats).catch(e => setError(String(e)));
        getStats("OBE大纲").then(setOutlineStats).catch(e => setError(String(e)));
        listActiveSessions().then(setSessions).catch(e => setError(String(e)));
    }, []);
    return <div className="page">
    <header className="brand-row">
      <span className="brand">QUIZ / RX</span>
      <span className="stamp">离线可用</span>
    </header>
    <section className="hero">
      <span className="eyebrow">医学题库 · 随时开练</span>
      <h1>把知识，<br />练成直觉。</h1>
      <p>每天一小组，慢慢把难点练熟。</p>
    </section>
    {error && <p className="error-panel" role="alert">加载失败：{error}</p>}
    <section className="stats-grid" aria-label="题库统计">{[["道题目", stats?.totalQuestions], ["个科目", stats?.totalSubjects], ["个章节", stats?.totalUnits]].map(([label, value]) => <div className="stat" key={label}>
      <strong>{typeof value === "number" ? value.toLocaleString() : "—"}</strong>
      <span>{label}</span>
    </div>)}</section>
    {sessions[0] && <Button variant="secondary" onClick={() => navigate(`/quiz/session?session=${sessions[0].id}`)}>继续上次练习 · {Math.min(sessions[0].currentPosition + 1, sessions[0].total)} / {sessions[0].total} 题</Button>}
    <div className="actions-grid">
      <Button className="action-main" onClick={() => navigate("/quiz")}>
        <span className="flex items-center gap-3">
          <Play />开始刷题</span>
        <ArrowUpRight />
      </Button>
      <Button variant="outline" onClick={() => navigate("/subjects")}>
        <BookOpen />浏览科目</Button>
      <Button variant="outline" onClick={() => navigate("/search")}>
        <Search />搜索真题</Button>
    </div>
    <Link to="/quiz?source=OBE大纲" className="subject-row bg-secondary" aria-label="大纲精练，课程强化">
      <BookOpen size={30} className="shrink-0" />
      <span className="flex-1">
        <span className="eyebrow">课程强化</span>
        <strong className="block text-xl">大纲精练</strong>
        <small>按教材章节练习 · {outlineStats ? `${outlineStats.totalQuestions} 题 / ${outlineStats.totalUnits} 章` : "正在加载…"}</small>
      </span>
      <ArrowUpRight className="shrink-0" />
    </Link>
    <div className="actions-grid">
      <Button variant="secondary" onClick={() => navigate("/collection?kind=mistakes")}>回顾错题</Button>
      <Button variant="outline" onClick={() => navigate("/collection?kind=bookmarks")}>我的收藏</Button>
    </div>
    <section className="space-y-4">
      <div className="section-title">
        <div>
          <span className="eyebrow">先从熟悉的科目开始</span>
          <h2>热门科目</h2>
        </div>
        <Link to="/subjects" className="min-h-12 flex items-center font-bold text-sm">全部 <ArrowUpRight size={18}/>
        </Link>
      </div>
      <div className="subject-list">{stats?.subjectBreakdown.slice(0, 6).map((s, i) => <Link key={s.id} to={`/subjects/${s.id}`} className="subject-row">
        <span className="subject-number">{String(i + 1).padStart(2, "0")}</span>
        <span className="flex-1">
          <strong>{s.name}</strong>
          <small>{s.questionCount.toLocaleString()} 道题目</small>
        </span>
        <ArrowUpRight size={20}/>
      </Link>)}</div>
    </section>
  </div>;
}
