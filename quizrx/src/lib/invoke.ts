import { invoke } from "@tauri-apps/api/core";
import type {
  Question,
  QuizConfig,
  SearchHit,
  Stats,
  Subject,
  Unit,
} from "@/types";

/** 获取全部科目（按题量倒序）。 */
export function getSubjects(source?: string): Promise<Subject[]> {
  return invoke<Subject[]>("get_subjects", { source: source ?? null });
}

/** 获取某科目下的章节。 */
export function getUnits(subjectId: number, source?: string): Promise<Unit[]> {
  return invoke<Unit[]>("get_units", { subjectId, source: source ?? null });
}

/** 按配置抽取题目 id 列表。 */
export function getQuizIds(config: QuizConfig): Promise<number[]> {
  return invoke<number[]>("get_quiz_ids", { config });
}

/** 按 id 获取完整题目。 */
export function getQuestion(id: number): Promise<Question> {
  return invoke<Question>("get_question", { id });
}

/** 批量获取题目。 */
export function getQuestions(ids: number[]): Promise<Question[]> {
  return invoke<Question[]>("get_questions", { ids });
}

/** FTS5 全文检索。 */
export function searchQuestions(keyword: string, limit = 50, source?: string): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("search_questions", { keyword, limit, source: source ?? null });
}

/** 题库统计。 */
export function getStats(source?: string): Promise<Stats> {
  return invoke<Stats>("get_stats", { source: source ?? null });
}

import type { QuizSession, SessionSummary, SubmittedAnswer } from "@/types";
export const startQuizSession = (config: QuizConfig) => invoke<QuizSession>("start_quiz_session", {config});
export const resumeQuizSession = (sessionId:number) => invoke<QuizSession>("resume_quiz_session",{sessionId});
export const listActiveSessions = () => invoke<SessionSummary[]>("list_active_sessions");
export const submitQuizAnswer = (sessionId:number,position:number,answer:SubmittedAnswer) => invoke<QuizSession>("submit_quiz_answer",{sessionId,position,answer});
export const finishQuizSession = (sessionId:number) => invoke<QuizSession>("finish_quiz_session",{sessionId});

export const saveQuizDraft = (sessionId:number,position:number,answer:SubmittedAnswer) => invoke<QuizSession>("save_quiz_draft",{sessionId,position,answer});

import type { QuestionRecord } from "@/types";
export const setBookmark = (questionId:number,bookmarked:boolean) => invoke<void>("set_bookmark",{questionId,bookmarked});
export const listBookmarks = (offset=0,limit=50) => invoke<QuestionRecord[]>("list_bookmarks",{offset,limit});
export const listMistakes = (offset=0,limit=50) => invoke<QuestionRecord[]>("list_mistakes",{offset,limit});
