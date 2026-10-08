export type FormState<T = unknown> = {
  success: boolean;
  message: string;
  data?: T;
};
