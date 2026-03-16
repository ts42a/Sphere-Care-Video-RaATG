export type ApiListResponse<T> = {
  success: boolean;
  data: T[];
  message?: string;
};

export type ApiItemResponse<T> = {
  success: boolean;
  data: T;
  message?: string;
};

export type ApiActionResponse<T = unknown> = {
  success: boolean;
  data?: T;
  message?: string;
};