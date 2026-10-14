import type { ReactNode } from "react";
import { Check, Square, X } from "lucide-react";
interface OptionItemProps {
    disabled?: boolean;
    selected: boolean;
    submitted: boolean;
    correct: boolean;
    onClick: () => void;
    onDoubleClick?: () => void;
    multi?: boolean;
    className?: string;
    children: ReactNode;
}
export function OptionItem({ disabled = false, selected, submitted, correct, onClick, onDoubleClick, multi = false, className = "", children }: OptionItemProps) {
    const state = submitted ? (correct ? "correct" : selected ? "incorrect" : "muted") : selected ? "selected" : "";
    return <button type="button" className={`quiz-option ${state} ${className}`} onClick={onClick} onDoubleClick={onDoubleClick} disabled={submitted || disabled} aria-pressed={selected}>{children}<span className="shrink-0">{submitted && correct ? <Check size={20}/> : submitted && selected ? <X size={20}/> : multi ? <Square size={20}/> : null}</span>
  </button>;
}
