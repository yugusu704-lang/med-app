import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { getSubjects } from "@/lib/invoke";
import type { Subject } from "@/types";
export function SubjectsPage() {
    const [subjects, setSubjects] = useState<Subject[]>([]);
    const [filter, setFilter] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        getSubjects().then(setSubjects).catch(e => setError(String(e))).finally(() => setLoading(false));
    }, []);
    return <div className="page">
    <header className="page-heading">
      <span className="eyebrow">SUBJECT MAP / 科目地图</span>
      <h1>你的知识地图</h1>
      <p>{subjects.length} 个科目，从想练的那一科开始。</p>
    </header>
    <Input aria-label="筛选科目" placeholder="找一找想练的科目…" value={filter} onChange={e => setFilter(e.target.value)}/>{error && <p className="error-panel" role="alert">{error}</p>}{loading && <p className="empty-panel">正在加载科目…</p>}<div className="subject-list">{subjects.filter(s => s.name.includes(filter.trim())).map((s, i) => <Link className="subject-row" key={s.id} to={`/subjects/${s.id}`}>
      <span className="subject-number">{String(i + 1).padStart(2, "0")}</span>
      <span className="flex-1">
        <strong>{s.name}</strong>
        <small>{s.questionCount.toLocaleString()} 道题目</small>
      </span>
      <ArrowUpRight size={20}/>
    </Link>)}</div>
  </div>;
}
