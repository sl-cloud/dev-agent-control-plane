export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  constructor(message: string, code = 'not_found') {
    super(message, code);
  }
}

export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  constructor(message: string, code = 'forbidden') {
    super(message, code);
  }
}

export class ConflictError extends AppError {
  readonly statusCode = 409;
  constructor(message: string, code = 'conflict') {
    super(message, code);
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 422;
  constructor(message: string, code = 'validation_error') {
    super(message, code);
  }
}

export class UnauthorizedError extends AppError {
  readonly statusCode = 401;
  constructor(message: string, code = 'unauthorized') {
    super(message, code);
  }
}
