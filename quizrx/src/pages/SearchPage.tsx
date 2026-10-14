import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchQuestions } from "@/lib/invoke";
import type { SearchHit } from "@/types";
export function SearchPage() {
    const [keyword, setKeyword] = useState("");
    const [results, setResults] = useState<SearchHit[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [error, setError] = useState("");
    const request = useRef(0);
    const navigate = useNavigate();
    const search = async () => {
        if (!keyword.trim()) {
            return;
        }
        const seq = ++request.current;
        setLoading(true);
        setError("");
        try {
            const hits = await searchQuestions(keyword.trim());
            if (seq === request.current) {
                setResults(hits);
                setSearched(true);
            }
        }
        catch (e) {
            if (seq === request.current) {
                setError(String(e));
            }
        }
        finally {
            if (seq === request.current) {
                setLoading(false);
            }
        }
    };
    return <div className="page">
    <header className="page-heading">
      <span className="eyebrow">FIND IT / 真题搜索</span>
      <h1>把疑问，找明白。</h1>
      <p>输入疾病、体征或知识点，搜索本地题库。</p>
    </header>
    <form className="flex gap-3" onSubmit={e => {
        e.preventDefault();
        void search();
    }}>
      <Input aria-label="搜索题干" placeholder="例如：肺栓塞、心包摩擦音" value={keyword} onChange={e => setKeyword(e.target.value)}/>
      <Button type="submit" disabled={loading} aria-label="搜索">
        <Search />
      </Button>
    </form>{error && <p className="error-panel" role="alert">{error}</p>}{loading ? <p className="empty-panel" role="status">正在搜索…</p> : searched ? <p className="eyebrow">找到 {results.length} 道题目 · 最多显示 50 条</p> : <p className="empty-panel">想起一个知识点？<br />从这里开始查漏补缺。</p>}<div className="space-y-4">{results.map(hit => <button className="subject-row" key={hit.id} onClick={() => navigate(`/quiz/session?question=${hit.id}&returnTo=%2Fsearch`)}>
      <span className="flex-1">
        <small>{hit.type} / {hit.subject}</small>
        <strong className="block mt-2 text-sm leading-relaxed line-clamp-3">{hit.stem}</strong>
      </span>
      <ArrowUpRight size={20}/>
    </button>)}</div>{searched && !loading && !results.length && <p className="empty-panel">没有找到匹配题目，换个关键词试试。</p>}</div>;
}
