// ===== 与 Rust 后端 (src-tauri/src/models.rs) 一一对应的数据契约 =====

export type QuestionType = "A1" | "A2" | "A3" | "A4" | "B" | "C" | "X";

export interface QuizOption {
  /** A / B / C / D / E */
  label: string;
  /** 已去掉前缀字母的选项文本 */
  content: string;
}

export interface Analysis {
  point: string;
  discuss: string;
  links: string[];
}

export interface SubQuestion {
  subId: number;
  stem: string;
  options: QuizOption[];
  answer: string;
}

interface QuestionBase {
  id: number;
  subject: string;
  unit: string;
  source: string | null;
  extractedYear: number | null;
  analysis: Analysis;
}

export interface SingleChoice extends QuestionBase {
  type: "A1" | "A2" | "A4" | "B" | "C";
  stem: string;
  options: QuizOption[];
  answer: string;
}

export interface MultiChoice extends QuestionBase {
  type: "X";
  stem: string;
  options: QuizOption[];
  answer: string[];
}

export interface CaseQuestion extends QuestionBase {
  type: "A3";
  stem: string;
  subQuestions: SubQuestion[];
}

export type Question = SingleChoice | MultiChoice | CaseQuestion;

// ===== 轻量查询结构 =====

export interface Subject {
  id: number;
  name: string;
  questionCount: number;
}

export interface Unit {
  id: number;
  subjectId: number;
  name: string;
  questionCount: number;
}

export interface SearchHit {
  id: number;
  type: QuestionType;
  subject: string;
  stem: string;
  source: string | null;
  extractedYear: number | null;
}

export interface QuizConfig {
  /** 不传即统考练习；大纲精练传 OBE大纲。 */
  source?: string | null;
  unitId?: number | null;
  subjectId?: number | null;
  types?: QuestionType[];
  count: number;
  randomize?: boolean;
}

export interface Stats {
  totalQuestions: number;
  totalSubjects: number;
  totalUnits: number;
  typeBreakdown: [QuestionType, number][];
  subjectBreakdown: Subject[];
}

export interface SubmittedAnswer { selected: string[]; subAnswers: { subId: number; selected: string[] }[] }
export interface AnswerRecord { position: number; answer: SubmittedAnswer; correct: boolean; subCorrectness: {subId:number;correct:boolean}[] }
export interface SessionSummary { id: number; status: "active"|"finished"; createdAt:number; updatedAt:number; currentPosition:number;total:number;correctCount:number }
export interface QuizSession extends SessionSummary { bankRevision:string;questionIds:(number|null)[];answers:AnswerRecord[];drafts:{position:number;answer:SubmittedAnswer}[] }
export interface QuestionRecord { questionId:number|null;stableKey:string;updatedAt:number }
