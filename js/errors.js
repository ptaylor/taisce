export class AuthError extends Error {
  constructor(message = 'not authorised') {
    super(message);
    this.name = 'AuthError';
  }
}

export class ConflictError extends Error {
  constructor(message = 'conflict') {
    super(message);
    this.name = 'ConflictError';
  }
}
