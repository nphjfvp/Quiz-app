export enum QuestionType {
  SINGLE_CHOICE = "single_choice",
  MULTIPLE_CHOICE = "multiple_choice",
  FREE_TEXT = "free_text",
  FILL_BLANK = "fill_blank",
  DRAG_DROP = "drag_drop",
  DIAGRAM_LABEL = "diagram_label",
  MARK_IMAGE = "mark_image",
  MATH_FORMULA = "math_formula",
}

export interface Option {
  text: string;
  is_correct: boolean;
}

export interface DragDropPair {
  source: string;
  target: string;
}

export interface DiagramLabel {
  label: string;
  x: number;
  y: number;
}

export interface Question {
  id: string;
  question_type: QuestionType;
  title: string;
  text: string;
  points: number;
  topic: string;
  weight: number;
  image_path: string;
  options: Option[];
  correct_text: string;
  blanks: string[];
  drag_drop_pairs: DragDropPair[];
  diagram_image_path: string;
  diagram_labels: DiagramLabel[];
  mark_regions: Record<string, any>[];
  correct_formula: string;
  tolerance: number;
  explanation: string;
}

export interface Quiz {
  id: string;
  name: string;
  description: string;
  questions: Question[];
  created: string;
  exam_date: string;
  weight: number;
}

export interface QuestionProgress {
  question_id: string;
  box: number;
  times_correct: number;
  times_wrong: number;
  last_seen: string;
}

export interface AnswerResult {
  question_id: string;
  is_correct: boolean;
  score: number;
  max_score: number;
  user_answer: string;
  correct_answer: string;
}

export interface DailyState {
  date: string;
  completed: string[];
  wrong: string[];
  extra_done: boolean;
}
