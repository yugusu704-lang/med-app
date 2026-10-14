import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSubjects, getUnits, startQuizSession } from "@/lib/invoke";
import type { Subject, Unit } from "@/types";
export function SubjectDetailPage() {
    const { id } = useParams();
    const subjectId = Number(id);
    const navigate = useNavigate();
    const [subject, setSubject] = useState<Subject | null>(null);
    const [units, setUnits] = useState<Unit[]>([]);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        let alive = true;
        Promise.all([getUnits(subjectId), getSubjects()]).then(([u, s]) => {
            if (alive) {
                setUnits(u);
                setSubject(s.find(x => x.id === subjectId) ?? null);
            }
        }).catch(e => {
            if (alive) {
                setError(String(e));
            }
        });
        return () => {
            alive = false;
        };
    }, [subjectId]);
    const practice = async (unitId?: number) => {
        setBusy(true);
        setError("");
        try {
            const session = await startQuizSession({ subjectId, unitId, count: 20, randomize: true });
            navigate(`/quiz/session?session=${session.id}`);
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setBusy(false);
        }
    };
    return <div className="page">
    <Button variant="ghost" className="self-start" onClick={() => navigate("/subjects")}>
      <ArrowLeft />返回科目</Button>
    <header className="page-heading">
      <span className="eyebrow">CHAPTERS / 章节选择</span>
      <h1>{subject?.name ?? "正在加载…"}</h1>
      <p>{units.length} 个章节 · {subject?.questionCount.toLocaleString() ?? "—"} 道题目</p>
    </header>
    <Button disabled={busy || !subject} onClick={() => practice()}>
      <Play />整科随机练习 · 20 题</Button>{error && <p className="error-panel" role="alert">{error}</p>}<div className="subject-list">{units.map((u, i) => <button key={u.id} disabled={busy} className="subject-row" onClick={() => practice(u.id)}>
        <span className="subject-number">{String(i + 1).padStart(2, "0")}</span>
        <span className="flex-1">
          <strong>{u.name}</strong>
          <small>{u.questionCount.toLocaleString()} 道题目</small>
        </span>
        <ArrowUpRight size={20}/>
      </button>)}</div>
  </div>;
}
