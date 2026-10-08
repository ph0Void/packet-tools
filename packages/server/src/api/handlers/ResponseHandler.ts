import { Response } from "express";

interface ApiResponse<T extends any> {
  success: boolean;
  message: string;
  data?: T;
  meta?: Record<string, any>;
  timestamp: string;
}

export class ResponseHandler {
  static success<T>(
    res: Response,
    data: T,
    message = "Operación exitosa",
    statusCode = 200,
    meta?: Record<string, any>,
  ) {
    const response: ApiResponse<T> = {
      success: true,
      message,
      data,
      meta,
      timestamp: new Date().toISOString(),
    };
    res.status(statusCode).json(response);
  }

  static created<T>(
    res: Response,
    data: T,
    message = "Recurso creado exitosamente",
  ) {
    res.status(201).json({
      success: true,
      message,
      data,
      meta: undefined,
      timestamp: new Date().toISOString(),
    });
  }

  static noContent(res: Response): void {
    res.status(204).send();
  }

  static error(res: Response, message: string, statusCode = 500, errors?: any) {
    const response: ApiResponse<null> = {
      success: false,
      message,
      data: undefined,
      timestamp: new Date().toISOString(),
      ...(errors && { meta: { errors } }),
    };
    res.status(statusCode).json(response);
  }

  static paginated<T>(
    res: Response,
    data: T[],
    total: number,
    page: number,
    limit: number,
    message = "Consulta exitosa",
  ) {
    const totalPages = Math.ceil(total / limit);
    this.success(res, data, message, 200, {
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  }
}
