import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyError } from 'fastify';
import { AppError } from '../lib/errors.js';

const PROBLEM_JSON = 'application/problem+json';

export const errorHandlerPlugin = fp(async function errorHandlerPlugin(
  app: FastifyInstance,
): Promise<void> {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .type(PROBLEM_JSON)
        .send({
          type: `https://dev-agent-control-plane/errors/${error.code}`,
          title: error.name,
          status: error.statusCode,
          detail: error.message,
          code: error.code,
          instance: request.id,
        });
    }

    const fastifyErr = error as FastifyError;
    if (fastifyErr.validation) {
      return reply.status(400).type(PROBLEM_JSON).send({
        type: 'https://dev-agent-control-plane/errors/validation_error',
        title: 'Validation Error',
        status: 400,
        detail: fastifyErr.message,
        code: 'validation_error',
        instance: request.id,
        errors: fastifyErr.validation,
      });
    }

    if (
      typeof fastifyErr.statusCode === 'number' &&
      fastifyErr.statusCode >= 400 &&
      fastifyErr.statusCode < 500
    ) {
      return reply
        .status(fastifyErr.statusCode)
        .type(PROBLEM_JSON)
        .send({
          type: `https://dev-agent-control-plane/errors/${fastifyErr.code ?? 'request_error'}`,
          title: fastifyErr.name,
          status: fastifyErr.statusCode,
          detail: fastifyErr.message,
          code: fastifyErr.code ?? 'request_error',
          instance: request.id,
        });
    }

    request.log.error({ err: error }, 'unhandled error');

    return reply.status(500).type(PROBLEM_JSON).send({
      type: 'https://dev-agent-control-plane/errors/internal_error',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred.',
      code: 'internal_error',
      instance: request.id,
    });
  });
});
