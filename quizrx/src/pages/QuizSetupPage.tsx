import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getSubjects, getUnits, startQuizSession } from "@/lib/invoke";
import type { Subject, Unit, QuestionType } from "@/types";
export function QuizSetupPage() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const source = params.get("source") === "OBE大纲" ? "OBE大纲" : undefined;
    const [subjects, setSubjects] = useState<Subject[]>([]);
    const [units, setUnits] = useState<Unit[]>([]);
    const [subjectId, setSubjectId] = useState<number | null>(Number(params.get("subject")) || null);
    const [unitId, setUnitId] = useState<number | null>(null);
    const [count, setCount] = useState(20);
    const [randomize, setRandomize] = useState(true);
    const [types, setTypes] = useState<QuestionType[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [catalogLoading, setCatalogLoading] = useState(true);
    useEffect(() => {
        let alive = true;
        setCatalogLoading(true);
        setTypes([]);
        setSubjects([]);
        setError("");
        getSubjects(source).then(s => {
            if (alive) {
                setSubjects(s);
                const requested = Number(params.get("subject"));
                setSubjectId(s.some(item => item.id === requested) ? requested : source && s.length === 1 ? s[0].id : null);
            }
        }).catch(e => { if (alive) setError(String(e)); })
          .finally(() => { if (alive) setCatalogLoading(false); });
        return () => { alive = false; };
    }, [source, params]);
    useEffect(() => {
        let alive = true;
        setUnitId(null);
        setUnits([]);
        if (subjectId !== null) {
            getUnits(subjectId, source).then(u => {
                if (alive) {
                    const order = ["绪论", "第一章 头部", "第二章 颈部", "第三章 胸部", "第四章 腹部", "第五章 盆部与会阴", "第六章 脊柱区", "第七章 上肢", "第八章 下肢"];
                    setUnits(source ? [...u].sort((a, b) => {
                        const ai = order.indexOf(a.name), bi = order.indexOf(b.name);
                        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
                    }) : u);
                }
            }).catch(e => {
                if (alive) {
                    setError(String(e));
                }
            });
        }
        return () => {
            alive = false;
        };
    }, [subjectId, source]);
    const start = async () => {
        setLoading(true);
        setError("");
        try {
            const session = await startQuizSession({ subjectId, unitId, count, types, randomize, source });
            navigate(`/quiz/session?session=${session.id}${source ? "&returnTo=obe" : ""}`);
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setLoading(false);
        }
    };
    return <div className="page">
    <header className="page-heading">
      <span className="eyebrow">{source ? "课程强化 / OBE大纲" : "LET'S PRACTICE / 开始刷题"}</span>
      <h1>{source ? "大纲精练" : "今天，练哪一科？"}</h1>
      <p>{source ? "按教材章节巩固掌握与熟悉考点。" : "科目、章节、题数，按你的节奏来。"}</p>
    </header>
    {!catalogLoading && subjects.length === 0 && !error && <p className="empty-panel">{source ? "大纲题库尚未就绪，请更新应用后再试。" : "当前范围暂无题目。"}</p>}
    <Card>
      <CardHeader>
        <CardTitle>01 / 选择范围</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <label className="block font-bold space-y-2">
          <span>科目</span>
          <select aria-label="科目" disabled={catalogLoading || subjects.length === 0} className="w-full min-h-12 border-3 rounded-lg bg-white p-3" value={subjectId ?? ""} onChange={e => setSubjectId(Number(e.target.value) || null)}>
            <option value="">全部科目</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name} · {s.questionCount} 题</option>)}</select>
        </label>
        <label className="block font-bold space-y-2">
          <span>章节</span>
          <select aria-label="章节" disabled={!subjectId} className="w-full min-h-12 border-3 rounded-lg bg-white p-3 disabled:opacity-50" value={unitId ?? ""} onChange={e => setUnitId(Number(e.target.value) || null)}>
            <option value="">全部章节</option>{units.map(u => <option key={u.id} value={u.id}>{u.name} · {u.questionCount} 题</option>)}</select>
        </label>
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <CardTitle>02 / 练习设置</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <label className="block font-bold space-y-2">
          <span>本次题数 · 最多 500 题</span>
          <Input type="number" inputMode="numeric" min={1} max={500} value={count} onChange={e => setCount(Math.min(500, Math.max(1, Number(e.target.value) || 1)))}/>
        </label>
        <div className="grid grid-cols-3 gap-3">{[10, 20, 50].map(n => <Button key={n} variant={count === n ? "default" : "outline"} onClick={() => setCount(n)}>{n} 题</Button>)}</div>
        <fieldset>
          <legend className="font-bold mb-3">题型 · 不选即全部</legend>
          <div className="flex flex-wrap gap-3">{((source ? ["A1", "A2"] : ["A1", "A2", "A3", "A4", "B", "C", "X"]) as QuestionType[]).map(t => <Button key={t} aria-pressed={types.includes(t)} variant={types.includes(t) ? "secondary" : "outline"} onClick={() => setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}>{t}</Button>)}</div>
        </fieldset>
        <label className="flex min-h-12 items-center justify-between gap-4 font-bold">
          <span>随机出题</span>
          <input type="checkbox" checked={randomize} onChange={e => setRandomize(e.target.checked)} className="h-6 w-6 accent-black" />
        </label>
      </CardContent>
    </Card>{error && <p className="error-panel" role="alert">{error}</p>}<Button className="action-main" disabled={loading || catalogLoading || subjects.length === 0} onClick={start}>
      <Play />{loading ? "正在组题…" : `开始练习 · ${count} 题`}</Button>
  </div>;
}
