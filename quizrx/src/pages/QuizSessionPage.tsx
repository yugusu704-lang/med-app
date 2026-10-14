import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getQuestion, resumeQuizSession, submitQuizAnswer, saveQuizDraft, finishQuizSession, setBookmark, listBookmarks } from "@/lib/invoke";
import type { Question, QuizSession, SubmittedAnswer, AnswerRecord, QuestionType } from "@/types";
import { useQuizLogic } from "@/hooks/useQuizLogic";
import { QuizContent } from "@/components/quiz/QuizContent";
import { QuizAnalysis } from "@/components/quiz/QuizAnalysis";
import { registerAndroidBackGuard } from "@/lib/androidBack";
const LABEL: Record<QuestionType, string> = { A1: "单选", A2: "案例单选", A3: "共用题干", A4: "案例单选", B: "配伍单选", C: "配伍不定", X: "多选" };
function toSelection(q: Question, answer?: SubmittedAnswer) {
    if (q.type === "A3") {
        return Object.fromEntries((answer?.subAnswers ?? []).map(s => [s.subId, s.selected[0] ?? ""]));
    }
    if (q.type === "X") {
        return answer?.selected ?? [];
    }
    return answer?.selected[0] ?? "";
}
function toAnswer(q: Question, selected: string | string[] | Record<number, string>): SubmittedAnswer {
    if (q.type === "A3") {
        const subSelections = selected as Record<number, string>;
        return {
            selected: [],
            subAnswers: q.subQuestions.map(sub => ({
                subId: sub.subId,
                selected: subSelections[sub.subId] ? [subSelections[sub.subId]] : [],
            })),
        };
    }
    return {
        selected: typeof selected === "string" ? (selected ? [selected] : []) : selected as string[],
        subAnswers: [],
    };
}

export function QuizSessionPage() {
    const [params] = useSearchParams();
    const sessionId = Number(params.get("session"));
    const questionId = Number(params.get("question"));
    const navigate = useNavigate();
    const [session, setSession] = useState<QuizSession | null>(null);
    const [quiz, setQuiz] = useState<Question | null>(null);
    const setupRoute = params.get("returnTo") === "obe" || quiz?.source === "OBE大纲" ? "/quiz?source=OBE大纲" : "/quiz";
    const [position, setPosition] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const queue = useRef<Promise<unknown>>(Promise.resolve());
    const saveFailed = useRef(false);
    useEffect(() => registerAndroidBackGuard(async () => {
        if (busy) return false;
        await queue.current;
        return !saveFailed.current;
    }), [busy]);
    useEffect(() => {
        let alive = true;
        setLoading(true);
        setError("");
        setSession(null);
        setQuiz(null);
        if (sessionId) {
            resumeQuizSession(sessionId).then(s => {
                if (alive) {
                    setSession(s);
                    setPosition(Math.min(s.currentPosition, Math.max(0, s.total - 1)));
                }
            }).catch(e => {
                if (alive) {
                    setError(String(e));
                    setLoading(false);
                }
            });
        }
        else if (questionId) {
            getQuestion(questionId).then(q => {
                if (alive) {
                    setQuiz(q);
                    setLoading(false);
                }
            }).catch(e => {
                if (alive) {
                    setError(String(e));
                    setLoading(false);
                }
            });
        }
        else {
            navigate("/quiz", { replace: true });
        }
        return () => {
            alive = false;
        };
    }, [sessionId, questionId, navigate]);
    const id = session?.questionIds[position];
    const hasSession = !!session;
    useEffect(() => {
        if (!hasSession) {
            return;
        }
        let alive = true;
        setQuiz(null);
        setLoading(true);
        if (id == null) {
            setLoading(false);
            return;
        }
        getQuestion(id).then(q => {
            if (alive) {
                setQuiz(q);
            }
        }).catch(e => {
            if (alive) {
                setError(String(e));
            }
        }).finally(() => {
            if (alive) {
                setLoading(false);
            }
        });
        return () => {
            alive = false;
        };
    }, [id, position, hasSession]);
    const save = (answer: SubmittedAnswer) => {
        if (!sessionId) {
            return;
        }
        setSession(current => current ? { ...current, drafts: [...current.drafts.filter(d => d.position !== position), { position, answer }] } : current);
        queue.current = queue.current.then(() => saveQuizDraft(sessionId, position, answer)).then(() => {
            saveFailed.current = false;
        }).catch(e => {
            saveFailed.current = true;
            setError(`保存失败：${String(e)}。请重试选择后再退出。`);
        });
    };
    // A queued write captures its own position; changing questions waits for that
    // queue, so a delayed result cannot replace a newer question's selection.
    const changePosition = async (delta: number) => {
        setBusy(true);
        await queue.current;
        if (!saveFailed.current) setPosition(p => p + delta);
        setBusy(false);
    };
    const submit = async (answer: SubmittedAnswer) => {
        if (!sessionId) {
            return;
        }
        setBusy(true);
        setError("");
        try {
            await queue.current;
            setSession(await submitQuizAnswer(sessionId, position, answer));
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setBusy(false);
        }
    };
    const finish = async () => {
        if (!sessionId) {
            return;
        }
        setBusy(true);
        try {
            await queue.current;
            if (saveFailed.current) return;
            setSession(await finishQuizSession(sessionId));
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setBusy(false);
        }
    };
    if (loading) {
        return <div className="page">
      <p className="empty-panel">正在加载题目…</p>
    </div>;
    }
    if (session?.status === "finished") {
        return <div className="page">
      <section className="hero">
        <span className="eyebrow">PRACTICE COMPLETE / 练习完成</span>
        <h1>又进步了一点。</h1>
        <p>已答 {session.answers.length} / {session.total} 题 · 正确 {session.correctCount} 题</p>
      </section>
      <Button onClick={() => navigate(setupRoute)}>再来一组</Button>
      <Button variant="outline" onClick={() => navigate("/")}>返回首页</Button>
    </div>;
    }
    return <div className="page">{error && <p role="alert" className="error-panel">{error}</p>}{quiz ? <QuizQuestion key={quiz.id} quiz={quiz} position={position} total={session?.total ?? 1} record={session?.answers.find(a => a.position === position)} draft={session?.drafts.find(a => a.position === position)?.answer} readOnly={!sessionId} busy={busy} onSave={save} onSubmit={submit}/> : <p className="empty-panel">这道题在当前题库中已不可用，请跳过。</p>}<div className="flex justify-between gap-3">
    <Button variant="outline" onClick={async () => {
            await queue.current;
            if (!saveFailed.current) {
                navigate("/");
            }
        }}>
      <ArrowLeft />保存并退出</Button>{session && <Button variant="outline" disabled={busy} onClick={finish}>结束练习</Button>}</div>{session && <div className="flex justify-between gap-3">
        <Button variant="outline" disabled={position === 0 || busy} onClick={() => changePosition(-1)}>
          <ArrowLeft />上一题</Button>
        <Button disabled={position >= session.total - 1 || busy} onClick={() => changePosition(1)}>下一题<ArrowRight />
        </Button>
      </div>}</div>;
}
function QuizQuestion({ quiz, position, total, record, draft, readOnly, busy, onSave, onSubmit }: {
    quiz: Question;
    position: number;
    total: number;
    record?: AnswerRecord;
    draft?: SubmittedAnswer;
    readOnly: boolean;
    busy: boolean;
    onSave: (answer: SubmittedAnswer) => void;
    onSubmit: (answer: SubmittedAnswer) => Promise<void>;
}) {
    const [bookmarked, setBookmarked] = useState(false);
    const [bookmarkBusy, setBookmarkBusy] = useState(false);
    const [bookmarkError, setBookmarkError] = useState("");
    useEffect(() => {
        let active = true;
        const find = async () => {
            for (let offset = 0; active; offset += 500) {
                const records = await listBookmarks(offset, 500);
                if (!active) {
                    return;
                }
                if (records.some(r => r.questionId === quiz.id)) {
                    setBookmarked(true);
                    return;
                }
                if (records.length < 500) {
                    setBookmarked(false);
                    return;
                }
            }
        };
        void find().catch(e => {
            if (active) {
                setBookmarkError(String(e));
            }
        });
        return () => {
            active = false;
        };
    }, [quiz.id]);
    const bookmark = async () => {
        setBookmarkBusy(true);
        setBookmarkError("");
        try {
            await setBookmark(quiz.id, !bookmarked);
            setBookmarked(!bookmarked);
        }
        catch (e) {
            setBookmarkError(String(e));
        }
        finally {
            setBookmarkBusy(false);
        }
    };
    const restored = useMemo(() => ({ selected: toSelection(quiz, record?.answer ?? draft), submitted: !!record || readOnly, correct: record?.correct ?? false, subCorrectness: Object.fromEntries((record?.subCorrectness ?? []).map(s => [s.subId, s.correct])) }), [quiz, record, draft, readOnly]);
    const { selected, submitted, isCorrect, subCorrectness, getShuffled, handleOptionSelect, hasSelection } = useQuizLogic(quiz, restored);
    const select = (label: string, subId?: number) => {
        if (busy || submitted) return;
        handleOptionSelect(label, subId);
        let next: typeof selected;
        if (quiz.type === "A3") {
            next = { ...(selected as Record<number, string>), [subId!]: label };
        }
        else if (quiz.type === "X") {
            const values = selected as string[];
            next = values.includes(label) ? values.filter(v => v !== label) : [...values, label];
        }
        else {
            next = label;
        }
        onSave(toAnswer(quiz, next));
    };
    return <>
    <div className="brand-row">
      <span className="eyebrow">{readOnly ? quiz.source === "OBE大纲" ? "大纲题目详情" : "真题详情" : `${quiz.source === "OBE大纲" ? "大纲精练 · " : ""}第 ${position + 1} / ${total} 题`}</span>
      <Badge variant="secondary">{quiz.type} / {LABEL[quiz.type]}</Badge>
    </div>{!readOnly && <Progress value={(position + 1) / total * 100}/>}<Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <strong>{quiz.subject}</strong>
          <Badge variant="outline">{quiz.unit}</Badge>{quiz.extractedYear && <Badge variant="outline">{quiz.extractedYear} 年</Badge>}</div>
      </CardHeader>
      <CardContent className="space-y-5">
        <Button variant="outline" disabled={bookmarkBusy} aria-pressed={bookmarked} onClick={bookmark}>{bookmarked ? "取消收藏" : "收藏这道题"}</Button>{bookmarkError && <p className="error-panel" role="alert">{bookmarkError}</p>}<QuizContent disabled={busy} quiz={quiz} selected={selected} submitted={submitted} subCorrectness={subCorrectness} onSelect={select} getShuffled={getShuffled}/>{!submitted ? <Button className="w-full" disabled={!hasSelection() || busy} onClick={() => onSubmit(toAnswer(quiz, selected))}>{busy ? "正在保存…" : "确认答案"}</Button> : <>{!readOnly && <div className="border-3 rounded-lg p-4 flex items-center gap-2 font-bold" style={{ background: isCorrect ? "#4DEEEA" : "#FF5E7E" }}>{isCorrect ? <CheckCircle2 /> : <XCircle />}{isCorrect ? "回答正确，继续保持！" : "再看一遍解析，把难点练熟。"}</div>}<QuizAnalysis analysis={quiz.analysis}/>
        </>}</CardContent>
    </Card>
  </>;
}
