import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getQuestion, listBookmarks, listMistakes } from "@/lib/invoke";
import type { Question } from "@/types";
export function CollectionPage() {
    const [params] = useSearchParams();
    const mistakes = params.get("kind") === "mistakes";
    const [questions, setQuestions] = useState<Question[]>([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [unavailable, setUnavailable] = useState(0);
    const [offset, setOffset] = useState(0);
    const [more, setMore] = useState(false);
    const navigate = useNavigate();
    useEffect(() => {
        let active = true;
        setLoading(true);
        setError("");
        (mistakes ? listMistakes(offset, 50) : listBookmarks(offset, 50)).then(async (records) => {
            const results = await Promise.all(records.map(r => r.questionId === null ? null : getQuestion(r.questionId).catch(() => null)));
            if (active) {
                setQuestions(results.filter((q): q is Question => q !== null));
                setUnavailable(results.filter(q => q === null).length);
                setMore(records.length === 50);
            }
        }).catch(e => {
            if (active) {
                setError(String(e));
            }
        }).finally(() => {
            if (active) {
                setLoading(false);
            }
        });
        return () => {
            active = false;
        };
    }, [mistakes, offset]);
    return <div className="page">
    <header className="page-heading">
      <span className="eyebrow">MY PRACTICE / 我的练习</span>
      <h1>{mistakes ? "错题，再练一遍。" : "值得再看的题。"}</h1>
      <p>{mistakes ? "答错的题目自动留在这里，回顾解析巩固知识。" : "你的本地收藏，随时回顾。"}</p>
    </header>{error && <p role="alert" className="error-panel">{error}</p>}{loading ? <p className="empty-panel">正在加载记录…</p> : !questions.length ? <p className="empty-panel">还没有{mistakes ? "错题" : "收藏"}记录。</p> : <div className="space-y-4">{questions.map(q => <button className="subject-row" key={q.id} onClick={() => navigate(`/quiz/session?question=${q.id}&returnTo=%2F`)}>
      <span className="flex-1">
        <small>{q.type} / {q.subject}</small>
        <strong className="block mt-2 text-sm leading-relaxed line-clamp-3">{q.stem}</strong>
      </span>
      <ArrowUpRight size={20}/>
    </button>)}</div>}{unavailable > 0 && <p className="text-sm">本页有 {unavailable} 条记录对应题目已变更，已跳过。</p>}<div className="flex justify-between">
      <Button variant="outline" disabled={!offset || loading} onClick={() => setOffset(x => Math.max(0, x - 50))}>上一页</Button>
      <Button disabled={!more || loading} onClick={() => setOffset(x => x + 50)}>下一页</Button>
    </div>
  </div>;
}
