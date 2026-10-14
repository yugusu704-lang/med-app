import type {
  Question,
  SingleChoice,
  MultiChoice,
  CaseQuestion,
} from "@/types";
import { OptionItem } from "./OptionItem";
import { stripOptionPrefix } from "@/lib/utils";

interface QuizContentProps {
  disabled?: boolean;
  quiz: Question;
  selected: string | string[] | Record<number, string>;
  submitted: boolean;
  subCorrectness: Record<number, boolean>;
  onSelect: (label: string, subId?: number) => void;
  getShuffled: (
    options: { label: string; content: string }[],
    key: string | number,
  ) => { label: string; content: string }[];
}

/** 题型分发渲染：A1/A2 单选、X 多选、A3 案例。移植自 MedQuiz。 */
export function QuizContent({
  disabled = false,
  quiz,
  selected,
  submitted,
  onSelect,
  getShuffled,
}: QuizContentProps) {
  const renderSingle = (q: SingleChoice) => (
    <>
      <p className="text-base mb-3 whitespace-pre-wrap leading-relaxed">{q.stem}</p>
      <div>
        {getShuffled(q.options, "").map((opt) => (
          <OptionItem
            disabled={disabled}
            key={opt.label}
            selected={selected === opt.label}
            correct={q.answer === opt.label}
            submitted={submitted}
            onClick={() => onSelect(opt.label)}
          >
            <span className="mr-2 font-medium">{opt.label}.</span>
            <span>{stripOptionPrefix(opt.content)}</span>
          </OptionItem>
        ))}
      </div>
    </>
  );

  const renderMulti = (q: MultiChoice) => (
    <>
      <p className="text-base mb-3 whitespace-pre-wrap leading-relaxed">{q.stem}</p>
      <div>
        {getShuffled(q.options, "").map((opt) => (
          <OptionItem
            disabled={disabled}
            key={opt.label}
            selected={(selected as string[]).includes(opt.label)}
            correct={q.answer.includes(opt.label)}
            submitted={submitted}
            multi
            onClick={() => onSelect(opt.label)}
          >
            <span className="mr-2 font-medium">{opt.label}.</span>
            <span>{stripOptionPrefix(opt.content)}</span>
          </OptionItem>
        ))}
      </div>
    </>
  );

  const renderCase = (q: CaseQuestion) => (
    <>
      <p className="text-base mb-4 p-3 bg-muted/50 rounded-md whitespace-pre-wrap leading-relaxed">
        {q.stem}
      </p>
      <div className="space-y-5">
        {q.subQuestions.map((sub) => {
          const subSel = (selected as Record<number, string>)[sub.subId];
          return (
            <div key={sub.subId} className={submitted ? "p-3 border rounded-md" : ""}>
              <p className="text-sm mb-2">
                <span className="font-semibold text-foreground">{sub.subId}.</span> {sub.stem}
              </p>
              <div>
                {getShuffled(sub.options, sub.subId).map((opt) => (
                  <OptionItem
            disabled={disabled}
                    key={opt.label}
                    selected={subSel === opt.label}
                    correct={submitted && sub.answer === opt.label}
                    submitted={submitted}
                    onClick={() => onSelect(opt.label, sub.subId)}
                  >
                    <span className="mr-2 font-medium">{opt.label}.</span>
                    <span>{stripOptionPrefix(opt.content)}</span>
                  </OptionItem>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  // 显式分支：X 走多选，A3 走案例，其余（A1/A2/A4/B/C）都是单选
  if (quiz.type === "X") return <>{renderMulti(quiz)}</>;
  if (quiz.type === "A3") return <>{renderCase(quiz)}</>;
  return <>{renderSingle(quiz)}</>;
}
